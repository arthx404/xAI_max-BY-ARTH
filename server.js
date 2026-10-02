'use strict';

require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const helmet     = require('helmet');
const morgan     = require('morgan');
const rateLimit  = require('express-rate-limit');
const path       = require('path');
const crypto     = require('crypto');
const { OpenAI } = require('openai');
const Groq       = require('groq-sdk');
const multer     = require('multer');
const pdfParse   = require('pdf-parse');
const mammoth    = require('mammoth');
const xlsx       = require('xlsx');
const { createClient } = require('@supabase/supabase-js');

const app  = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

// Clients
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY || 'groq-not-configured' });
const supabase = createClient(
  process.env.SUPABASE_URL || 'https://xyz.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy_key'
);
const createOpenAIClient = (apiKey) =>
  new OpenAI({
    baseURL: 'https://integrate.api.nvidia.com/v1',
    apiKey:  apiKey || process.env.NVIDIA_API_KEY || '',
    timeout: 60000,
  });

function getSupabaseOrigin() {
  const configuredUrl = process.env.SUPABASE_URL?.trim();
  if (!configuredUrl) return null;

  try {
    const url = new URL(configuredUrl);
    if (url.protocol !== 'https:') return null;
    return url.origin;
  } catch (_) {
    return null;
  }
}

const supabaseOrigin = getSupabaseOrigin();
const supabaseConfigured = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const requestWindows = new Map();
const providerStats = new Map();
const adminSessions = new Map();
const otpChallenges = new Map();
let runtimeSettings = {
  maxUserRequestsPerHour: Math.max(1, Number.parseInt(process.env.MAX_USER_REQUESTS_PER_HOUR || '60', 10)),
  announcement: '',
  enabledAgents: [],
  adminPasswordHash: null,
};

function markProvider(provider, ok, error = null) {
  providerStats.set(provider, { ok, error, checkedAt: new Date().toISOString() });
}

async function getRequestUser(req) {
  if (!supabaseConfigured) return null;
  const token = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : null;
  if (!token) return null;
  const { data } = await supabase.auth.getUser(token);
  return data?.user || null;
}

function consumeUserRequest(key) {
  const now = Date.now();
  const windowMs = 60 * 60 * 1000;
  const max = Math.max(1, Number.parseInt(runtimeSettings.maxUserRequestsPerHour || '60', 10));
  const existing = requestWindows.get(key) || [];
  const recent = existing.filter(timestamp => now - timestamp < windowMs);
  if (recent.length >= max) return { allowed: false, remaining: 0 };
  recent.push(now);
  requestWindows.set(key, recent);
  return { allowed: true, remaining: max - recent.length };
}

function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').filter(Boolean).map(part => {
    const index = part.indexOf('=');
    return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
  }));
}

function isAdminRequest(req) {
  const legacyKey = process.env.ADMIN_DASHBOARD_KEY && req.headers['x-admin-key'] === process.env.ADMIN_DASHBOARD_KEY;
  const sessionId = parseCookies(req).xai_admin_session;
  return Boolean(legacyKey || (sessionId && adminSessions.has(sessionId)));
}

function safeSecretEqual(leftValue, rightValue) {
  const left = Buffer.from(String(leftValue || ''));
  const right = Buffer.from(String(rightValue || ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, expected] = stored.split(':');
  const actual = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return safeSecretEqual(actual, expected);
}

function adminSettingsResponse() {
  const { adminPasswordHash, ...safeSettings } = runtimeSettings;
  return safeSettings;
}

async function loadRuntimeSettings() {
  if (!supabaseConfigured) return;
  const { data } = await supabase.from('app_settings').select('value').eq('id', 'runtime').maybeSingle();
  if (data?.value && typeof data.value === 'object') runtimeSettings = { ...runtimeSettings, ...data.value };
}

async function streamOpenAIChat(client, model, messages, sendEvent) {
  const stream = await client.chat.completions.create({ model, messages, stream: true });
  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content || '';
    if (content) sendEvent({ type: 'delta', content });
  }
}

// Agent Catalog
const AGENTS = [
  { id: 'lightning', provider: 'groq', model: 'openai/gpt-oss-120b', name: 'Lightning' },
  { id: 'reasoning', provider: 'groq', model: 'qwen/qwen3.8-27b', name: 'Reasoning' },
  { id: 'coder', provider: 'groq', model: 'openai/gpt-oss-20b', name: 'Coder' },
  { id: 'writer', provider: 'groq', model: 'openai/gpt-oss-20b', name: 'Writer' },
  { id: 'creative', provider: 'groq', model: 'openai/gpt-oss-20b', name: 'Creative' },
  { id: 'image-gen', provider: 'pollinations', model: 'flux', name: 'Image Gen' },
  { id: 'analyst', provider: 'gemini', model: 'gemini-2.0-flash', name: 'Analyst' },
  { id: 'artist', provider: 'pollinations', model: 'flux', name: 'Artist' },
];
if (!runtimeSettings.enabledAgents.length) runtimeSettings.enabledAgents = AGENTS.map(agent => agent.id);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'self'"],
      scriptSrc:   ["'self'", "'unsafe-inline'", 'cdnjs.cloudflare.com', 'cdn.jsdelivr.net'],
      styleSrc:    ["'self'", "'unsafe-inline'", 'fonts.googleapis.com', 'cdnjs.cloudflare.com'],
      fontSrc:     ["'self'", 'fonts.gstatic.com'],
      imgSrc:      ["'self'", 'data:', 'blob:', 'https://image.pollinations.ai'],
      connectSrc:  [
        "'self'",
        ...(supabaseOrigin ? [supabaseOrigin] : []),
        'https://api.groq.com',
        'https://api-inference.huggingface.co',
        'https://integrate.api.nvidia.com',
        'https://generativelanguage.googleapis.com',
        'https://image.pollinations.ai',
      ],
    }
  }
}));

app.use(cors({ origin: process.env.CORS_ORIGIN || '*', credentials: true }));
app.use(morgan('dev'));
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT || '100'),
});
app.use('/api/', limiter);

function sanitizeMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages.filter(m => m && typeof m.role === 'string').map(m => ({
    role: m.role,
    content: m.content
  })).slice(-50);
}

// Upload endpoint
const upload = multer({ storage: multer.memoryStorage() });
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const { originalname, buffer, mimetype } = req.file;
    let content = '';
    
    if (mimetype === 'application/pdf' || originalname.endsWith('.pdf')) {
      const data = await pdfParse(buffer);
      content = data.text;
    } else if (mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || originalname.endsWith('.docx')) {
      const result = await mammoth.extractRawText({ buffer });
      content = result.value;
    } else if (mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || originalname.endsWith('.xlsx')) {
      const workbook = xlsx.read(buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      content = xlsx.utils.sheet_to_csv(sheet);
    } else {
      content = buffer.toString('utf-8');
    }
    
    res.json({ success: true, filename: originalname, type: 'text', content });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/log-qa', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid authorization header' });
    }
    const token = authHeader.split(' ')[1];
    
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    
    const { conversation_id, conversationId, question, answer, agent_id, agentId, model } = req.body;
    const name = user.user_metadata?.full_name || user.user_metadata?.name || null;
    const email = user.email || null;
    
    const { error: insertError } = await supabase
      .from('question_logs')
      .insert([
        {
          user_id: user.id,
          name,
          email,
          conversation_id: conversation_id || conversationId || null,
          question,
          answer,
          agent_id: agent_id || agentId || null,
          model,
        }
      ]);
      
    if (insertError) throw insertError;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/chat', async (req, res) => {
  const { messages, agentId, systemPrompt } = req.body;
  let agent = AGENTS.find(a => a.id === agentId) || AGENTS[0];
  const requestUser = await getRequestUser(req);
  const quota = consumeUserRequest(requestUser?.id || `ip:${req.ip}`);
  res.setHeader('X-RateLimit-Remaining', String(quota.remaining));
  if (!quota.allowed) return res.status(429).json({ error: 'Hourly request limit reached. Please try again later.' });
  
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  
  const sendEvent = (data) => res.write("data: " + JSON.stringify(data) + "\n\n");
  sendEvent({ type: 'agent', agent });
  
  try {
    const sysMsg = { role: 'system', content: systemPrompt || 'You are a helpful assistant.' };
    const fullMsgs = [sysMsg, ...sanitizeMessages(messages)];

    if (agent.provider === 'groq') {
      try {
        await streamOpenAIChat(groq, agent.model, fullMsgs, sendEvent);
        markProvider('groq', true);
      } catch (primaryError) {
        markProvider('groq', false, primaryError.message);
        if (!process.env.NVIDIA_API_KEY) throw primaryError;
        sendEvent({ type: 'fallback', from: 'groq', to: 'nvidia' });
        await streamOpenAIChat(createOpenAIClient(), 'openai/gpt-oss-120b', fullMsgs, sendEvent);
        markProvider('nvidia', true);
      }
      sendEvent({ type: 'done' });
    } 
    else if (agent.provider === 'gemini') {
      if (!process.env.GEMINI_API_KEY) throw new Error('Gemini is not configured. Add GEMINI_API_KEY to the server environment.');

      const contents = fullMsgs
        .filter(message => message.role !== 'system')
        .map(message => ({
          role: message.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: String(message.content || '') }],
        }));
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(agent.model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: sysMsg.content }] },
            contents,
            generationConfig: { temperature: 0.7 },
          }),
        }
      );
      if (!response.ok) throw new Error(`Gemini Error: ${response.status}`);

      const decoder = new TextDecoder();
      let buffer = '';
      for await (const chunk of response.body) {
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));
            const content = data.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('') || '';
            if (content) sendEvent({ type: 'delta', content });
          } catch (_) {}
        }
      }
      sendEvent({ type: 'done' });
    }
    else if (agent.provider === 'pollinations') {
      const prompt = fullMsgs[fullMsgs.length - 1]?.content || 'A beautiful digital illustration';
      const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?model=${encodeURIComponent(agent.model)}&nologo=true`;
      const fallbackUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?model=turbo&nologo=true`;
      sendEvent({ type: 'image', url: imageUrl, fallbackUrl });
      markProvider('pollinations', true);
      sendEvent({ type: 'done' });
    }
    else if (agent.provider === 'huggingface') {
      const url = "https://api-inference.huggingface.co/models/" + agent.model;
      const hfToken = process.env.HF_TOKEN;
      
      if (agent.id === 'image-gen') {
        // Image generation
        const prompt = fullMsgs[fullMsgs.length - 1].content;
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': "Bearer " + hfToken,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ inputs: prompt })
        });
        
        if (!response.ok) throw new Error("HF Error: " + response.status);
        
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const base64 = buffer.toString('base64');
        sendEvent({ type: 'image', url: "data:image/jpeg;base64," + base64 });
        sendEvent({ type: 'done' });
      } 
      else {
        // Text streaming for HF
        const response = await fetch(url + '/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': "Bearer " + hfToken,
            'Content-Type': 'application/json',
            'Accept': 'text/event-stream'
          },
          body: JSON.stringify({
            model: agent.model,
            messages: fullMsgs,
            stream: true
          })
        });
        
        if (!response.ok) {
           if (process.env.NVIDIA_API_KEY) {
             // fallback to NVIDIA
             const fallbackClient = createOpenAIClient();
             const stream = await fallbackClient.chat.completions.create({
               model: 'openai/gpt-oss-120b',
               messages: fullMsgs,
               stream: true
             });
             for await (const chunk of stream) {
               const content = chunk.choices[0]?.delta?.content || '';
               if (content) sendEvent({ type: 'delta', content });
             }
             sendEvent({ type: 'done' });
             return res.end();
           } else {
             throw new Error("HF Error: " + response.status);
           }
        }
        
        const decoder = new TextDecoder();
        for await (const chunk of response.body) {
          const text = decoder.decode(chunk);
          const lines = text.split('\n');
          for (const line of lines) {
            if (line.startsWith('data: ') && line !== 'data: [DONE]') {
              try {
                const data = JSON.parse(line.slice(6));
                const content = data.choices[0]?.delta?.content || '';
                if (content) sendEvent({ type: 'delta', content });
              } catch (e) {}
            }
          }
        }
        sendEvent({ type: 'done' });
      }
    }
  } catch (err) {
    sendEvent({ type: 'error', message: err.message });
  } finally {
    res.end();
  }
});

app.get('/api/health', (req, res) => res.json({
  status: 'ok',
  hasServerKey: Boolean(process.env.NVIDIA_API_KEY || process.env.GROQ_API_KEY || process.env.HF_TOKEN || process.env.GEMINI_API_KEY),
}));

app.get('/api/models', async (req, res) => {
  let availableModels = [];
  if (req.query.live === '1' && process.env.GROQ_API_KEY) {
    try {
      const result = await groq.models.list();
      availableModels = result.data.map(model => model.id);
      markProvider('groq', true);
    } catch (error) {
      markProvider('groq', false, error.message);
    }
  }
  const catalog = [
    { id: 'auto', name: 'Auto', emoji: '✦', specialty: 'Smart Routing', speed: 'Adaptive', color: '#76b900' },
    { id: 'lightning', name: 'Lightning', emoji: '⚡', provider: 'groq', model: 'openai/gpt-oss-120b', specialty: 'Daily Workhorse', speed: 'Fast', color: '#0064e0' },
    { id: 'reasoning', name: 'Reasoning', emoji: '🧠', provider: 'groq', model: 'qwen/qwen3.8-27b', specialty: 'Advanced Logic', speed: 'Deep', color: '#4169e1' },
    { id: 'coder', name: 'Coder', emoji: '🧑‍💻', provider: 'groq', model: 'openai/gpt-oss-20b', specialty: 'Coding & Tech', speed: 'Fast', color: '#4169e1' },
    { id: 'writer', name: 'Writer', emoji: '🌊', provider: 'groq', model: 'openai/gpt-oss-20b', specialty: 'Writing & Analysis', speed: 'Fast', color: '#ff6b35' },
    { id: 'creative', name: 'Creative', emoji: '🌸', provider: 'groq', model: 'openai/gpt-oss-20b', specialty: 'Creative & Chat', speed: 'Fast', color: '#ea4335' },
    { id: 'image-gen', name: 'Image Gen', emoji: '🎨', provider: 'pollinations', model: 'flux', specialty: 'Image Generation', speed: 'Adaptive', color: '#a855f7' },
    { id: 'analyst', name: 'Analyst', emoji: '🔎', provider: 'gemini', model: 'gemini-2.0-flash', specialty: 'Files & Analysis', speed: 'Adaptive', color: '#34a853' },
    { id: 'artist', name: 'Artist', emoji: '🖼️', provider: 'pollinations', model: 'flux', specialty: 'Free Image Generation', speed: 'Adaptive', color: '#f59e0b' }
  ];
  res.json({ availableModels, agents: catalog.filter(agent => agent.id === 'auto' || runtimeSettings.enabledAgents.includes(agent.id)) });
});

app.get('/api/config', (req, res) => {
  res.json({
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
    announcement: runtimeSettings.announcement || '',
  });
});

app.get('/api/providers', (req, res) => {
  res.json({
    providers: ['groq', 'nvidia', 'gemini', 'pollinations', 'huggingface'].map(provider => ({
      provider,
      configured: provider === 'pollinations' || Boolean({
        groq: process.env.GROQ_API_KEY,
        nvidia: process.env.NVIDIA_API_KEY,
        gemini: process.env.GEMINI_API_KEY,
        huggingface: process.env.HF_TOKEN,
      }[provider]),
      ...(providerStats.get(provider) || { ok: null, error: null, checkedAt: null }),
    })),
  });
});

app.get('/api/groq-models', async (req, res) => {
  if (!process.env.GROQ_API_KEY) return res.status(503).json({ error: 'Groq is not configured.' });
  try {
    const result = await groq.models.list();
    res.json({ models: result.data.map(model => ({ id: model.id, ownedBy: model.owned_by })) });
  } catch (error) {
    markProvider('groq', false, error.message);
    res.status(502).json({ error: 'Groq model discovery failed.' });
  }
});

app.post('/api/admin/login', (req, res) => {
  const { uid, password } = req.body || {};
  if (!process.env.ADMIN_UID || !process.env.ADMIN_PASSWORD) {
    return res.status(503).json({ error: 'Admin credentials are not configured on the server.' });
  }
  const validUid = safeSecretEqual(uid, process.env.ADMIN_UID);
  const validPassword = runtimeSettings.adminPasswordHash
    ? verifyPassword(password, runtimeSettings.adminPasswordHash)
    : safeSecretEqual(password, process.env.ADMIN_PASSWORD);
  if (!validUid || !validPassword) return res.status(401).json({ error: 'Invalid admin credentials.' });
  const sessionId = crypto.randomBytes(32).toString('hex');
  adminSessions.set(sessionId, { createdAt: Date.now(), uid: process.env.ADMIN_UID });
  res.setHeader('Set-Cookie', `xai_admin_session=${sessionId}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
  res.json({ success: true, uid: process.env.ADMIN_UID });
});

app.post('/api/admin/logout', (req, res) => {
  const sessionId = parseCookies(req).xai_admin_session;
  if (sessionId) adminSessions.delete(sessionId);
  res.setHeader('Set-Cookie', 'xai_admin_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  res.json({ success: true });
});

app.post('/api/admin/users', async (req, res) => {
  if (!isAdminRequest(req)) return res.status(403).json({ error: 'Admin access required.' });
  if (!supabaseConfigured) return res.status(503).json({ error: 'Supabase is not configured.' });
  const { email, password, name } = req.body || {};
  if (!email || !password || String(password).length < 8) return res.status(400).json({ error: 'Email and a password of at least 8 characters are required.' });
  const { data, error } = await supabase.auth.admin.createUser({
    email: String(email).trim().toLowerCase(),
    password: String(password),
    email_confirm: true,
    user_metadata: { name: String(name || '').trim().slice(0, 120) },
  });
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json({ user: { id: data.user.id, email: data.user.email, name: data.user.user_metadata?.name || null } });
});

app.post('/api/admin/forgot-password', async (req, res) => {
  const { uid } = req.body || {};
  if (!process.env.ADMIN_UID || !safeSecretEqual(uid, process.env.ADMIN_UID)) return res.status(202).json({ success: true });
  const code = String(crypto.randomInt(100000, 1000000));
  const challenge = { codeHash: hashPassword(code), expiresAt: Date.now() + 10 * 60 * 1000, attempts: 0 };
  otpChallenges.set(String(uid), challenge);
  const recipient = process.env.ADMIN_RECOVERY_EMAIL;
  if (process.env.RESEND_API_KEY && recipient && process.env.ADMIN_OTP_FROM) {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: process.env.ADMIN_OTP_FROM, to: [recipient], subject: 'Veylora admin recovery code', text: `Your Veylora admin recovery code is ${code}. It expires in 10 minutes.` }),
    });
    if (!response.ok) return res.status(502).json({ error: 'Recovery email could not be sent.' });
    return res.json({ success: true, delivery: 'email' });
  }
  if (process.env.NODE_ENV === 'production') return res.status(503).json({ error: 'Configure recovery email delivery before using OTP recovery.' });
  res.json({ success: true, delivery: 'development', otp: code });
});

app.post('/api/admin/reset-password', async (req, res) => {
  const { uid, otp, newPassword } = req.body || {};
  const challenge = otpChallenges.get(String(uid));
  if (!challenge || Date.now() > challenge.expiresAt || challenge.attempts >= 5) return res.status(401).json({ error: 'Invalid or expired OTP.' });
  if (!verifyPassword(otp, challenge.codeHash)) {
    challenge.attempts += 1;
    return res.status(401).json({ error: 'Invalid or expired OTP.' });
  }
  if (!newPassword || String(newPassword).length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  runtimeSettings.adminPasswordHash = hashPassword(newPassword);
  if (supabaseConfigured) {
    const { error } = await supabase.from('app_settings').upsert({ id: 'runtime', value: runtimeSettings, updated_at: new Date().toISOString() });
    if (error) return res.status(502).json({ error: error.message });
  }
  otpChallenges.delete(String(uid));
  res.json({ success: true });
});

app.get('/api/admin/settings', async (req, res) => {
  if (!isAdminRequest(req)) return res.status(403).json({ error: 'Admin access required.' });
  await loadRuntimeSettings();
  res.json({ settings: adminSettingsResponse() });
});

app.put('/api/admin/settings', async (req, res) => {
  if (!isAdminRequest(req)) return res.status(403).json({ error: 'Admin access required.' });
  const incoming = req.body || {};
  const next = {
    maxUserRequestsPerHour: Math.min(10000, Math.max(1, Number.parseInt(incoming.maxUserRequestsPerHour || runtimeSettings.maxUserRequestsPerHour, 10))),
    announcement: String(incoming.announcement ?? runtimeSettings.announcement).slice(0, 500),
    enabledAgents: Array.isArray(incoming.enabledAgents)
      ? incoming.enabledAgents.filter(id => AGENTS.some(agent => agent.id === id))
      : runtimeSettings.enabledAgents,
    adminPasswordHash: runtimeSettings.adminPasswordHash || null,
  };
  runtimeSettings = next;
  if (supabaseConfigured) {
    const { error } = await supabase.from('app_settings').upsert({ id: 'runtime', value: next, updated_at: new Date().toISOString() });
    if (error) return res.status(502).json({ error: error.message });
  }
  res.json({ success: true, settings: adminSettingsResponse() });
});

app.get('/api/admin/summary', async (req, res) => {
  if (!isAdminRequest(req)) return res.status(403).json({ error: 'Admin access required.' });
  if (!supabaseConfigured) return res.status(503).json({ error: 'Supabase is not configured.' });

  const [{ data: users, error: usersError }, { data: logs, error: logsError }] = await Promise.all([
    supabase.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    supabase.from('question_logs').select('name,email,agent_id,model,created_at').order('created_at', { ascending: false }).limit(5000),
  ]);
  if (usersError || logsError) return res.status(502).json({ error: usersError?.message || logsError?.message });
  const usage = {};
  for (const log of logs || []) {
    const key = log.email || log.user_id || 'unknown';
    usage[key] = usage[key] || { name: log.name, email: log.email, requests: 0, agents: {} };
    usage[key].requests += 1;
    usage[key].agents[log.agent_id || 'unknown'] = (usage[key].agents[log.agent_id || 'unknown'] || 0) + 1;
  }
  res.json({ users: (users?.users || []).map(item => ({ id: item.id, name: item.user_metadata?.full_name || item.user_metadata?.name || null, email: item.email, createdAt: item.created_at })), usage: Object.values(usage), providers: [...providerStats.entries()] });
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

void loadRuntimeSettings();
app.listen(PORT, () => {
  console.log("Running on " + PORT);
});

module.exports = app;

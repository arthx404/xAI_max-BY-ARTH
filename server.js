// ═══════════════════════════════════════════════════════════════════════════
//  xAI Max — Production Express Backend
//  NVIDIA NIM API Proxy with SSE Streaming & Agent Orchestration
// ═══════════════════════════════════════════════════════════════════════════

'use strict';

require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const helmet     = require('helmet');
const morgan     = require('morgan');
const rateLimit  = require('express-rate-limit');
const path       = require('path');
const { OpenAI } = require('openai');

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── NVIDIA NIM Client ───────────────────────────────────────────────────────
// Key is read from .env or passed per-request from the client settings modal
const createClient = (apiKey) =>
  new OpenAI({
    baseURL: 'https://integrate.api.nvidia.com/v1',
    apiKey:  apiKey || process.env.NVIDIA_API_KEY || '',
    timeout: 60000,
  });

async function* streamNvidiaCompletion({ apiKey, model, messages, temperature, maxTokens }) {
  const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      temperature,
      max_tokens: maxTokens,
    }),
    signal: AbortSignal.timeout(60000),
  });

  if (!response.ok) {
    const error = new Error(`NVIDIA API returned ${response.status}`);
    error.status = response.status;
    throw error;
  }
  if (!response.body) throw new Error('NVIDIA API returned an empty stream.');

  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() || '';
    for (const block of blocks) {
      const data = block.split(/\r?\n/)
        .filter(line => line.startsWith('data: '))
        .map(line => line.slice(6))
        .join('\n')
        .trim();
      if (!data || data === '[DONE]') continue;
      yield JSON.parse(data);
    }
  }
}

// ─── Agent Catalog ───────────────────────────────────────────────────────────
const AGENTS = [
  {
    id:          'nemotron-ultra',
    name:        'Nemotron Ultra',
    emoji:       '⚡',
    model:       'nvidia/llama-3.1-nemotron-ultra-253b-v1',
    description: 'NVIDIA\'s frontier model — 253B parameters, best for complex multi-step reasoning, agentic workflows and deep analysis.',
    specialty:   'Frontier Reasoning',
    speed:       'Deep',
    color:       '#76b900',
    system:      'You are xAI Max Ultra, the world\'s most advanced AI assistant powered by NVIDIA Nemotron Ultra 253B. You excel at multi-step reasoning, complex analysis, scientific thinking, and agentic task execution. Always think step-by-step, be precise, and provide exhaustively detailed answers. You are not just an assistant — you are a thinking partner.'
  },
  {
    id:          'nemotron-super',
    name:        'Nemotron Super',
    emoji:       '🧠',
    model:       'nvidia/nemotron-3-super-120b-a12b',
    description: 'NVIDIA\'s 49B MoE model optimized for agentic workflows, fast reasoning and tool use.',
    specialty:   'Agentic Tasks',
    speed:       'Fast',
    color:       '#76b900',
    system:      'You are xAI Max Super, powered by NVIDIA Nemotron Super 49B. You are highly optimized for agentic workflows, multi-turn reasoning, tool calling, and efficient task execution. Balance speed with depth — always decompose complex tasks into clear steps.'
  },
  {
    id:          'llama-405b',
    name:        'Llama 3.1 405B',
    emoji:       '🦙',
    model:       'deepseek-ai/deepseek-v4.1-flash',
    description: 'Meta\'s largest open-weight model — 405B parameters, exceptional reasoning and knowledge.',
    specialty:   'General Intelligence',
    speed:       'Deep',
    color:       '#0064e0',
    system:      'You are xAI Max, powered by Meta\'s Llama 3.1 405B — the largest open-weight AI model ever created. You have vast knowledge across all domains. Be thorough, insightful, and always cite your reasoning. You represent the pinnacle of open AI research.'
  },
  {
    id:          'llama-70b',
    name:        'Llama 3.3 70B',
    emoji:       '🔥',
    model:       'nvidia/nemotron-3-super-120b-a12b',
    description: 'The most capable 70B model — blazing fast, incredibly smart, the perfect daily driver.',
    specialty:   'Daily Workhorse',
    speed:       'Fast',
    color:       '#0064e0',
    system:      'You are xAI Max, powered by Meta\'s Llama 3.3 70B. You are fast, smart, and versatile. Excel at everyday tasks, writing, analysis, and coding. Be concise when appropriate, detailed when needed. You are the ideal AI companion.'
  },
  {
    id:          'deepseek-r1',
    name:        'DeepSeek R1',
    emoji:       '🔍',
    model:       'deepseek-ai/deepseek-v4.1-flash',
    description: 'Specialized chain-of-thought reasoning model — shows its thinking process for math, logic and science.',
    specialty:   'Chain-of-Thought',
    speed:       'Deep',
    color:       '#4169e1',
    system:      'You are xAI Max Reason, powered by DeepSeek R1. You specialize in rigorous logical reasoning, mathematics, science, and complex problem-solving. Always show your full chain of thought. Reason step by step before giving your final answer. For math problems, show all work. For logic puzzles, enumerate each deduction.'
  },
  {
    id:          'deepseek-v3',
    name:        'DeepSeek V3',
    emoji:       '💻',
    model:       'deepseek-ai/deepseek-v4.1-flash',
    description: 'DeepSeek\'s latest general model — outstanding at coding, algorithms and technical tasks.',
    specialty:   'Coding & Tech',
    speed:       'Fast',
    color:       '#4169e1',
    system:      'You are xAI Max Code, powered by DeepSeek V3. You are an elite software engineer and technical expert. Write clean, efficient, well-commented code. Follow best practices. Explain complex technical concepts clearly. Help debug, architect, and optimize software systems.'
  },
  {
    id:          'mistral-large',
    name:        'Mistral Large',
    emoji:       '🌊',
    model:       'mistralai/mistral-large',
    description: 'Mistral AI\'s flagship model — multilingual, efficient, excellent for writing and analysis.',
    specialty:   'Writing & Analysis',
    speed:       'Fast',
    color:       '#ff6b35',
    system:      'You are xAI Max, powered by Mistral Large. You excel at writing, content creation, multilingual tasks, summarization, and nuanced analysis. Your responses are eloquent, structured, and insightful. You adapt your tone to match the user\'s needs.'
  },
  {
    id:          'mistral-nemo',
    name:        'Mistral NeMo',
    emoji:       '⚡',
    model:       'mistralai/mistral-nemotron',
    description: 'Ultra-fast 12B model by Mistral x NVIDIA — ideal for quick answers and high-volume tasks.',
    specialty:   'Ultra Speed',
    speed:       'Lightning',
    color:       '#ff6b35',
    system:      'You are xAI Max Fast, powered by Mistral NeMo 12B. You prioritize speed and clarity. Give direct, accurate answers. Avoid unnecessary preamble. Be the fastest and most efficient AI assistant.'
  },
  {
    id:          'gemma-27b',
    name:        'Gemma 3 27B',
    emoji:       '🌸',
    model:       'google/gemma-4-31b-it',
    description: 'Google\'s open Gemma 3 model — creative, thoughtful, great for nuanced conversations.',
    specialty:   'Creative & Chat',
    speed:       'Fast',
    color:       '#ea4335',
    system:      'You are xAI Max, powered by Google Gemma 3 27B. You are warm, thoughtful, and creative. Excel at conversations, creative writing, brainstorming, and explaining ideas in engaging ways. Balance intelligence with approachability.'
  },
  {
    id:          'phi-4',
    name:        'Microsoft Phi-4',
    emoji:       '🔷',
    model:       'microsoft/phi-3.5-moe-instruct',
    description: 'Microsoft\'s small but mighty Phi-4 — punches far above its weight class in reasoning.',
    specialty:   'Efficient Reasoning',
    speed:       'Lightning',
    color:       '#00bcf2',
    system:      'You are xAI Max, powered by Microsoft Phi-4. You are compact yet extraordinarily capable at reasoning and structured thinking. Give precise, well-reasoned answers. Demonstrate that intelligence is not just about scale.'
  },
  {
    id:          'kimi-k1',
    name:        'Kimi K1.5',
    emoji:       '🌙',
    model:       'moonshotai/kimi-k2.6',
    description: 'Moonshot AI\'s thinking model — exceptional for long-context tasks, coding and multi-hop reasoning.',
    specialty:   'Long Context',
    speed:       'Deep',
    color:       '#6366f1',
    system:      'You are xAI Max, powered by Moonshot Kimi K1.5. You excel at long-context understanding, complex multi-hop reasoning, and extended coding tasks. Handle very long documents, codebases, and intricate problem sequences with ease.'
  },
  {
    id:          'llama-vision',
    name:        'Llama 3.2 Vision',
    emoji:       '👁️',
    model:       'meta/llama-3.2-90b-vision-instruct',
    description: 'Meta\'s 90B vision-language model — understands images, charts, screenshots and documents.',
    specialty:   'Vision + Language',
    speed:       'Deep',
    color:       '#0064e0',
    system:      'You are xAI Max Vision, powered by Meta Llama 3.2 90B Vision. You can understand and analyze images, charts, screenshots, diagrams, and visual content. Provide detailed, accurate descriptions and insights about what you see.'
  }
];

const AUTO_AGENT = {
  id: 'auto',
  name: 'Auto',
  emoji: '✦',
  description: 'Automatically selects the best NVIDIA model for each request.',
  specialty: 'Smart Routing',
  speed: 'Adaptive',
  color: '#76b900',
};

function getRequestText(messages) {
  const lastUser = [...(Array.isArray(messages) ? messages : [])]
    .reverse()
    .find(message => message?.role === 'user');
  if (!lastUser) return '';
  if (typeof lastUser.content === 'string') return lastUser.content;
  if (!Array.isArray(lastUser.content)) return '';
  return lastUser.content
    .filter(part => part?.type === 'text')
    .map(part => part.text || '')
    .join('\n');
}

function selectAutoAgent(messages) {
  const text = getRequestText(messages).toLowerCase();
  const hasImage = (Array.isArray(messages) ? messages : []).some(message =>
    Array.isArray(message?.content) &&
    message.content.some(part => part?.type === 'image_url')
  );

  if (hasImage || /\b(image|photo|screenshot|diagram|chart|visual|pdf)\b/.test(text)) {
    return AGENTS.find(agent => agent.id === 'llama-vision') || AGENTS[AGENTS.length - 1];
  }
  if (/\b(code|coding|program|debug|javascript|typescript|python|api|sql|algorithm|software)\b/.test(text)) {
    return AGENTS.find(agent => agent.id === 'mistral-nemo') || AGENTS[7];
  }
  if (/\b(math|mathematics|equation|calculate|proof|logic|reason)\b/.test(text)) {
    return AGENTS.find(agent => agent.id === 'nemotron-super') || AGENTS[1];
  }
  if (/\b(write|rewrite|story|creative|email|essay|translate|summarize)\b/.test(text)) {
    return AGENTS.find(agent => agent.id === 'mistral-nemo') || AGENTS[7];
  }
  if (text.length < 120 || /\b(quick|fast|simple|brief)\b/.test(text)) {
    return AGENTS.find(agent => agent.id === 'mistral-nemo') || AGENTS[7];
  }
  return AGENTS.find(agent => agent.id === 'mistral-nemo') || AGENTS[7];
}

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'self'"],
      scriptSrc:   ["'self'", "'unsafe-inline'", 'cdnjs.cloudflare.com', 'cdn.jsdelivr.net'],
      styleSrc:    ["'self'", "'unsafe-inline'", 'fonts.googleapis.com', 'cdnjs.cloudflare.com'],
      fontSrc:     ["'self'", 'fonts.gstatic.com'],
      imgSrc:      ["'self'", 'data:', 'blob:'],
      connectSrc:  ["'self'"],
    }
  }
}));

app.use(cors({
  origin:      process.env.CORS_ORIGIN || '*',
  credentials: true
}));

app.use(morgan('dev'));
app.use(express.json({ limit: '4mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Rate limiter — protect NVIDIA API quota
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max:      parseInt(process.env.RATE_LIMIT || '100'),
  message:  { error: 'Too many requests. Please wait a moment.' },
  standardHeaders: true,
  legacyHeaders:   false
});
app.use('/api/', limiter);

// ─── Utility: Sanitize messages ───────────────────────────────────────────────
function sanitizeMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter(m => m && typeof m.role === 'string' && (typeof m.content === 'string' || Array.isArray(m.content)))
    .map(m => ({
      role:    ['user', 'assistant', 'system'].includes(m.role) ? m.role : 'user',
      content: Array.isArray(m.content) ? m.content : String(m.content).slice(0, 32000)
    }))
    .slice(-50); // keep last 50 messages max
}

// ─── GET /api/models ──────────────────────────────────────────────────────────
app.get('/api/models', (_req, res) => {
  res.json({ agents: [AUTO_AGENT, ...AGENTS].map(({ id, name, emoji, model, description, specialty, speed, color }) =>
    ({ id, name, emoji, model, description, specialty, speed, color })
  )});
});

// ─── GET /api/health ─────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({
    status:    'ok',
    version:   '1.0.0',
    agents:       AGENTS.length,
    hasServerKey: !!(process.env.NVIDIA_API_KEY && process.env.NVIDIA_API_KEY.trim() !== ''),
    timestamp:    new Date().toISOString()
  });

});

// Only public client configuration is safe to send to the browser.
app.get('/api/config', (_req, res) => {
  res.json({
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
  });
});

// ─── POST /api/chat (SSE Streaming) ──────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  const { messages, agentId, temperature = 0.7, maxTokens = 2048, systemPrompt } = req.body;

  // Resolve agent
  const requestedAgent = AGENTS.find(a => a.id === agentId);
  let agent = agentId === 'auto'
    ? selectAutoAgent(messages)
    : requestedAgent || AGENTS.find(a => a.id === 'llama-70b');

  // Resolve API key (client-provided > .env)
  const resolvedKey = process.env.NVIDIA_API_KEY;
  if (!resolvedKey || resolvedKey === 'nvapi-your-key-here') {
    return res.status(503).json({ error: 'NVIDIA API key is not configured on the server.' });
  }

  const client = createClient(resolvedKey);

  // Build message list: system prompt first
  const systemMessage  = {
    role: 'system',
    content: [agent.system, typeof systemPrompt === 'string' ? systemPrompt.trim() : '']
      .filter(Boolean)
      .join('\n\n')
  };
  const sanitized      = sanitizeMessages(messages);
  const fullMessages   = [systemMessage, ...sanitized];

  // ── Set SSE headers ──
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
  res.flushHeaders();

  // Helper to write SSE events
  const sendEvent = (data) => {
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    }
  };

  // Send agent info at start
  sendEvent({
    type: 'agent',
    agent: { id: agent.id, name: agent.name, model: agent.model },
    requestedAgentId: agentId || 'llama-70b',
    autoRouted: agentId === 'auto'
  });

  let totalTokens = 0;

  try {
    let stream;
    try {
      stream = streamNvidiaCompletion({
        apiKey: resolvedKey,
        model: agent.model,
        messages: fullMessages,
        temperature: Math.min(Math.max(parseFloat(temperature) || 0.7, 0), 2),
        maxTokens: Math.min(parseInt(maxTokens) || 4096, 8192),
      });
    } catch (err) {
      const fallback = AGENTS.find(candidate => candidate.model === 'nvidia/nemotron-3-super-120b-a12b');
      const canFallback = [400, 404, 408, 409, 429, 500, 502, 503, 504].includes(err.status) ||
        ['ETIMEDOUT', 'ECONNRESET', 'UND_ERR_CONNECT_TIMEOUT'].includes(err.code);
      if (!canFallback || !fallback || fallback.model === agent.model) throw err;
      agent = fallback;
      sendEvent({
        type: 'agent',
        agent: { id: agent.id, name: agent.name, model: agent.model },
        requestedAgentId: agentId || 'llama-70b',
        fallback: true
      });
      stream = streamNvidiaCompletion({
        apiKey: resolvedKey,
        model: agent.model,
        messages: fullMessages,
        temperature: Math.min(Math.max(parseFloat(temperature) || 0.7, 0), 2),
        maxTokens: Math.min(parseInt(maxTokens) || 4096, 8192),
      });
    }

    for await (const chunk of stream) {
      if (res.writableEnded) break;

      const delta   = chunk.choices?.[0]?.delta?.content || '';
      const finish  = chunk.choices?.[0]?.finish_reason;
      const usage   = chunk.usage;

      if (delta) {
        sendEvent({ type: 'delta', content: delta });
      }

      if (usage) {
        totalTokens = usage.total_tokens;
      }

      if (finish) {
        sendEvent({ type: 'done', finish_reason: finish, total_tokens: totalTokens });
        break;
      }

      // Backpressure: if client is slow, pause briefly
      if (!res.write('')) {
        await new Promise(resolve => res.once('drain', resolve));
      }
    }

  } catch (err) {
    console.error('[xAI Max] Stream error:', err.message);

    // Classify error for better UX
    let userMessage = 'An unexpected error occurred.';
    let statusCode  = 500;

    if (err.status === 401 || err.message?.includes('401')) {
      userMessage = 'Invalid NVIDIA API key. Please check your key in Settings.';
      statusCode  = 401;
    } else if (err.status === 429 || err.message?.includes('429')) {
      userMessage = 'Rate limit reached. Please wait a moment and try again.';
      statusCode  = 429;
    } else if (err.status === 404 || err.status === 410 || err.message?.includes('404') || err.message?.includes('410')) {
      userMessage = `Model "${agent.model}" not available. Try a different agent.`;
      statusCode  = err.status || 404;
    } else if (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT') {
      userMessage = 'Connection to NVIDIA API timed out. Please retry.';
    }

    if (!res.writableEnded) {
      sendEvent({ type: 'error', message: userMessage, status: statusCode });
    }
  } finally {
    if (!res.writableEnded) res.end();
  }
});

// ─── POST /api/validate-key ───────────────────────────────────────────────────
app.post('/api/validate-key', async (req, res) => {
  const { apiKey } = req.body;
  if (!apiKey?.startsWith('nvapi-')) {
    return res.json({ valid: false, message: 'Key must start with nvapi-' });
  }
  try {
    const client = createClient(apiKey);
    // Test with a tiny completion
    await client.chat.completions.create({
      model:      'meta/llama-3.3-70b-instruct',
      messages:   [{ role: 'user', content: 'hi' }],
      max_tokens: 1,
      stream:     false
    });
    res.json({ valid: true, message: 'API key validated successfully!' });
  } catch (err) {
    const invalid = err.status === 401;
    res.json({
      valid:   !invalid,
      message: invalid ? 'Invalid API key.' : 'Key appears valid (model may be unavailable).'
    });
  }
});

// ─── Fallback: serve index.html for all other routes ─────────────────────────
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Start Server ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n  ✦ xAI Max is running`);
  console.log(`  ─────────────────────────────`);
  console.log(`  🌐  http://localhost:${PORT}`);
  console.log(`  🤖  ${AGENTS.length + 1} agents available (including Auto)`);
  console.log(`  🔑  API key: ${process.env.NVIDIA_API_KEY ? '✅ loaded from .env' : '⚠️  not set (use Settings panel)'}`);
  console.log(`\n`);
});

module.exports = app;

// ═══════════════════════════════════════════════════════════════════════════
//  xAI Max — app.js
//  AI Logic: Streaming, Conversation Management, Agent State
// ═══════════════════════════════════════════════════════════════════════════

'use strict';

// ── State ──────────────────────────────────────────────────────────────────
const State = {
  messages:       [],        // Current conversation messages
  conversations:  [],        // Saved conversations
  activeConvId:   null,      // Active conversation UUID
  activeAgent:    null,      // Active agent object
  agents:         [],        // All available agents from server
  streaming:      false,     // Is AI currently responding
  abortController: null,     // For cancelling streams
  settings: {
    apiKey:       '',
    temperature:  0.7,
    maxTokens:    4096,
    systemPrompt: '',
    auroraLevel:  60,
  },
  hasServerKey:   false,     // If server has API key in .env
  totalTokens:    0,
  resolvedAgent:  null,
  supabase:       null,
  user:           null,
  authReady:      false,
};

// ── Constants ──────────────────────────────────────────────────────────────
const API_BASE = window.location.origin;
const STORAGE_KEYS = {
  conversations: 'xaimax_conversations',
  settings:      'xaimax_settings',
  activeAgent:   'xaimax_active_agent',
};

// ── DOM Shortcuts ──────────────────────────────────────────────────────────
const $  = (id) => document.getElementById(id);
const $$ = (sel, ctx = document) => ctx.querySelector(sel);

// ─────────────────────────────────────────────────────────────────────────
//  INITIALISATION
// ─────────────────────────────────────────────────────────────────────────
async function init() {
  loadSettings();
  loadConversations();
  const configPromise = checkServerConfig();
  const agentsPromise = fetchAgents();
  await initSupabase();
  await Promise.all([configPromise, agentsPromise]);
  startNewConversation(false);
  setupKeyboardShortcuts();
  applyAuroraLevel(State.settings.auroraLevel);
  console.log('[xAI Max] Ready ✦');
}

async function loadCloudConversations() {
  if (!State.supabase || !State.user) return;
  const { data, error } = await State.supabase
    .from('conversations')
    .select('id,title,agent_id,agent_emoji,messages,tokens,updated_at')
    .order('updated_at', { ascending: false })
    .limit(100);
  if (error) {
    console.error('[xAI Max] Cloud history load failed:', error);
    UI.showToast('Cloud history could not be loaded.', 'error');
    return;
  }
  const cloudConversations = (data || []).map(conversation => ({
    id: conversation.id,
    title: conversation.title,
    agentId: conversation.agent_id,
    agentEmoji: conversation.agent_emoji,
    messages: conversation.messages || [],
    tokens: conversation.tokens || 0,
    updated: Date.parse(conversation.updated_at) || Date.now(),
  }));
  // The query is protected by Supabase RLS; only merge records belonging to
  // the current account into that account's local cache.
  const localById = new Map(State.conversations.map(conversation => [conversation.id, conversation]));
  cloudConversations.forEach(conversation => localById.set(conversation.id, conversation));
  State.conversations = [...localById.values()]
    .sort((a, b) => (b.updated || 0) - (a.updated || 0))
    .slice(0, 100);
  saveConversations();
  UI.renderHistoryList();
}

async function saveConversationToCloud(conversation) {
  if (!State.supabase || !State.user || !conversation) return;
  const { error } = await State.supabase.from('conversations').upsert({
    id: conversation.id,
    user_id: State.user.id,
    title: conversation.title,
    agent_id: conversation.agentId || null,
    agent_emoji: conversation.agentEmoji || null,
    messages: conversation.messages,
    tokens: conversation.tokens || 0,
    updated_at: new Date(conversation.updated || Date.now()).toISOString(),
  });
  if (error) {
    console.error('[xAI Max] Cloud history save failed:', error);
    UI.showToast('Cloud history could not be saved. Check your Supabase policies.', 'error');
  }
}

async function migrateGuestConversations(conversations) {
  if (!State.user || !Array.isArray(conversations) || !conversations.length) return;
  for (const conversation of conversations) {
    await saveConversationToCloud(conversation);
  }
  localStorage.removeItem(`${STORAGE_KEYS.conversations}_guest`);
}

async function loadSignedInHistory(guestConversations = []) {
  if (!State.user) return;
  loadConversations();
  await loadCloudConversations();
  await migrateGuestConversations(guestConversations);
  await loadCloudConversations();
}

async function saveQuestionLogToCloud(question, answer, agent) {
  if (!State.supabase || !State.user || !question || !answer) return;
  const { error } = await State.supabase.from('question_logs').insert({
    user_id: State.user.id,
    conversation_id: State.activeConvId,
    question,
    answer,
    agent_id: agent?.id || null,
    model: agent?.model || null,
  });
  if (error) {
    console.error('[xAI Max] Question log save failed:', error);
    UI.showToast('Answer was not saved to Supabase. Check your account and policies.', 'error');
  }
}

async function initSupabase() {
  const authButton = $('btn-auth');
  try {
    const callbackError = new URLSearchParams(window.location.search).get('error_description');
    if (callbackError) {
      UI.showToast(`❌ Google sign-in failed: ${callbackError}`, 'error');
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    const res = await fetch(`${API_BASE}/api/config`);
    const config = await res.json();
    if (!config.supabaseUrl || !config.supabaseAnonKey || !window.supabase?.createClient) {
      if (authButton) authButton.style.display = 'none';
      return;
    }

    State.supabase = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
    const hashParams = new URLSearchParams(window.location.hash.slice(1));
    const accessToken = hashParams.get('access_token');
    const refreshToken = hashParams.get('refresh_token');
    if (accessToken && refreshToken) {
      const { error } = await State.supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      if (error) throw error;
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    const { data: { session } } = await State.supabase.auth.getSession();
    updateAuthState(session?.user || null);
    if (session?.user) {
      const guestConversations = State.conversations;
      await loadSignedInHistory(guestConversations);
    }
    State.supabase.auth.onAuthStateChange(async (_event, nextSession) => {
      updateAuthState(nextSession?.user || null);
      if (nextSession?.user) {
        const guestConversations = State.conversations;
        await loadSignedInHistory(guestConversations);
      }
      else {
        State.conversations = [];
        State.activeConvId = null;
        UI.renderHistoryList();
      }
    });

    const signInOrOut = async () => {
      try {
        if (State.user) {
          const { error } = await State.supabase.auth.signOut();
          if (error) throw error;
          return;
        }
        const { error } = await State.supabase.auth.signInWithOAuth({
          provider: 'google',
          options: { redirectTo: window.location.origin }
        });
        if (error) throw error;
      } catch (error) {
        console.error('[xAI Max] Google sign-in failed:', error);
        UI.showToast(`❌ Google sign-in failed: ${error.message}`, 'error');
      }
    };
    authButton?.addEventListener('click', signInOrOut);
    $('account-menu-action')?.addEventListener('click', signInOrOut);
  } catch (error) {
    console.error('[xAI Max] Supabase initialization failed:', error);
    if (authButton) authButton.style.display = 'none';
  } finally {
    State.authReady = true;
  }
}

function updateAuthState(user) {
  State.user = user;
  const button = $('btn-auth');
  const label = $('auth-label');
  if (!button) return;
  button.style.display = '';
  if (label) label.textContent = user ? 'Sign out' : 'Sign in with Google';
  button.setAttribute('aria-label', user ? 'Sign out of xAI Max' : 'Sign in with Google');
  button.title = user ? `Signed in as ${user.email || 'your Google account'}` : 'Sign in with Google';
  const avatarUrl = user?.user_metadata?.avatar_url || user?.user_metadata?.picture || '';
  const displayName = user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email || 'Google account';
  const avatarElements = [$('account-avatar'), $('account-menu-avatar')].filter(Boolean);
  avatarElements.forEach(avatar => {
    avatar.textContent = user ? (displayName.charAt(0).toUpperCase() || 'U') : '?';
    avatar.classList.toggle('account-avatar-fallback', !avatarUrl);
    avatar.style.backgroundImage = avatarUrl ? `url("${avatarUrl.replace(/"/g, '')}")` : '';
  });
  const accountButton = $('btn-account');
  const accountLabel = $('account-button-label');
  const menuName = $('account-menu-name');
  const menuEmail = $('account-menu-email');
  const menuAction = $('account-menu-action');
  if (accountButton) accountButton.setAttribute('aria-label', user ? `Open account menu for ${displayName}` : 'Sign in with Google');
  if (accountLabel) accountLabel.textContent = user ? 'Account' : 'Sign in';
  if (menuName) menuName.textContent = user ? displayName : 'Guest';
  if (menuEmail) menuEmail.textContent = user?.email || 'Sign in to sync chats';
  if (menuAction) menuAction.textContent = user ? 'Sign out' : 'Sign in with Google';
}

async function checkServerConfig() {
  try {
    const res = await fetch(`${API_BASE}/api/health`);
    const data = await res.json();
    State.hasServerKey = !!data.hasServerKey;
  } catch (err) {
    console.log('[xAI Max] Health check failed:', err);
  }
}

// ─────────────────────────────────────────────────────────────────────────
//  FETCH AGENTS FROM BACKEND
// ─────────────────────────────────────────────────────────────────────────
async function fetchAgents() {
  try {
    const res    = await fetch(`${API_BASE}/api/models`);
    const data   = await res.json();
    State.agents = data.agents || [];

    const savedId = localStorage.getItem(STORAGE_KEYS.activeAgent);
    const found   = State.agents.find(a => a.id === savedId);
    State.activeAgent = found || State.agents.find(a => a.id === 'auto') || State.agents[0];

    UI.renderAgentStrip();
    UI.updateTopbar();
  } catch (err) {
    console.error('[xAI Max] Failed to fetch agents:', err);
    UI.showToast('⚠️ Could not connect to backend. Is the server running?', 'error');
  }
}

// ─────────────────────────────────────────────────────────────────────────
//  SETTINGS
// ─────────────────────────────────────────────────────────────────────────
function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEYS.settings) || '{}');
    Object.assign(State.settings, saved);
    State.settings.apiKey = '';
  } catch (_) {}
}

function saveSettings() {
  localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(State.settings));
}

// ─────────────────────────────────────────────────────────────────────────
//  CONVERSATION MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────
function loadConversations() {
  try {
    State.conversations = JSON.parse(localStorage.getItem(getConversationStorageKey()) || '[]');
  } catch (_) { State.conversations = []; }
}

function saveConversations() {
  // Keep last 100 conversations
  if (State.conversations.length > 100) {
    State.conversations = State.conversations.slice(-100);
  }
  localStorage.setItem(getConversationStorageKey(), JSON.stringify(State.conversations));
}

function getConversationStorageKey() {
  return State.user
    ? `${STORAGE_KEYS.conversations}_${State.user.id}`
    : `${STORAGE_KEYS.conversations}_guest`;
}

function startNewConversation(render = true) {
  // Save current if has messages
  if (State.messages.length > 0 && State.activeConvId) {
    persistCurrentConversation();
  }

  State.activeConvId = crypto.randomUUID();
  State.messages     = [];
  State.resolvedAgent = null;
  State.totalTokens  = 0;
  $('token-count').textContent = '0';

  if (render) {
    $('messages-container').innerHTML = '';
    $('welcome-screen').style.display = '';
    UI.renderHistoryList();
  }
}

async function persistCurrentConversation() {
  if (!State.messages.length) return;

  const title  = State.messages[0]?.content?.slice(0, 60) || 'Conversation';
  const exists = State.conversations.findIndex(c => c.id === State.activeConvId);
  const conv   = {
    id:        State.activeConvId,
    title,
    agentId:   State.activeAgent?.id,
    agentEmoji: State.activeAgent?.emoji,
    messages:  State.messages,
    tokens:    State.totalTokens,
    updated:   Date.now(),
  };

  if (exists >= 0) State.conversations[exists] = conv;
  else             State.conversations.unshift(conv);
  saveConversations();
  await saveConversationToCloud(conv);
  UI.renderHistoryList();
}

function loadConversation(id) {
  const conv = State.conversations.find(c => c.id === id);
  if (!conv) return;

  persistCurrentConversation();

  State.activeConvId = conv.id;
  State.messages     = [...conv.messages];
  State.totalTokens  = conv.tokens || 0;
  $('token-count').textContent = State.totalTokens;

  // Restore agent
  const agent = State.agents.find(a => a.id === conv.agentId);
  if (agent) {
    State.activeAgent = agent;
    UI.updateTopbar();
    UI.renderAgentStrip();
  }

  // Render messages
  $('messages-container').innerHTML = '';
  $('welcome-screen').style.display = 'none';
  State.messages.forEach(m => {
    if (m.role === 'user')      UI.appendUserMessage(m.content);
    if (m.role === 'assistant') UI.appendAssistantMessage(m.content, false);
  });

  UI.renderHistoryList();
  UI.closeSidebar();
}

function deleteConversation(id) {
  State.conversations = State.conversations.filter(c => c.id !== id);
  saveConversations();
  if (State.supabase && State.user) {
    State.supabase.from('conversations').delete().eq('id', id).eq('user_id', State.user.id)
      .then(({ error }) => {
        if (error) {
          console.error('[xAI Max] Cloud history delete failed:', error);
          UI.showToast('Cloud conversation could not be deleted.', 'error');
        }
      });
  }
  if (State.activeConvId === id) startNewConversation(true);
  UI.renderHistoryList();
}

function clearAllHistory() {
  if (State.supabase && State.user) {
    State.supabase.from('conversations').delete().eq('user_id', State.user.id)
      .then(({ error }) => {
        if (error) {
          console.error('[xAI Max] Cloud history clear failed:', error);
          UI.showToast('Cloud history could not be cleared.', 'error');
        }
      });
  }
  State.conversations = [];
  saveConversations();
  startNewConversation(true);
  UI.renderHistoryList();
  UI.showToast('History cleared');
}

// ─────────────────────────────────────────────────────────────────────────
//  SELECT AGENT
// ─────────────────────────────────────────────────────────────────────────
function selectAgent(agentId) {
  const agent = State.agents.find(a => a.id === agentId);
  if (!agent) return;
  State.activeAgent = agent;
  localStorage.setItem(STORAGE_KEYS.activeAgent, agentId);
  UI.updateTopbar();
  UI.renderAgentStrip();
  UI.showToast(`${agent.emoji} Switched to ${agent.name}`);
}

// ─────────────────────────────────────────────────────────────────────────
//  SEND MESSAGE
// ─────────────────────────────────────────────────────────────────────────
async function sendMessage(content) {
  content = content.trim();
  if (!content || State.streaming) return;

  // Check for API key
  if (!State.hasServerKey) {
    // Try server .env key (health check)
    UI.openSettings();
    UI.showToast('⚠️ NVIDIA access is not configured on the server.', 'error');
    return;
  }

  // Handle Attachments
  const attachments = window.UI ? UI.getPendingAttachments() : [];
  let finalContent = content;
  let messagePayload = content;
  
  if (attachments.length > 0) {
    const textAttachments = attachments.filter(a => !a.isImage);
    const imageAttachments = attachments.filter(a => a.isImage);
    
    // Append text files to the prompt text
    if (textAttachments.length > 0) {
      finalContent += '\n\n' + textAttachments.map(a => `[Attached File: ${a.name}]\n\`\`\`\n${a.data}\n\`\`\``).join('\n\n');
    }
    
    // Format payload for vision models if there are images
    if (imageAttachments.length > 0) {
      messagePayload = [
        { type: 'text', text: finalContent },
        ...imageAttachments.map(img => ({ type: 'image_url', image_url: { url: img.data } }))
      ];
    } else {
      messagePayload = finalContent;
    }
    
    if (window.UI) UI.clearPendingAttachments();
  }

  // Hide welcome screen
  $('welcome-screen').style.display = 'none';

  // Add user message to state + UI (UI gets the raw text, backend gets the payload)
  State.messages.push({ role: 'user', content: messagePayload });
  UI.appendUserMessage(content + (attachments.length ? ` [${attachments.length} attachments]` : ''));

  // Clear input
  const input = $('chat-input');
  input.value = '';
  input.style.height = 'auto';
  UI.updateSendBtn();
  UI.updateCharCounter();

  // Show typing indicator
  const typingEl = UI.showTypingIndicator();

  // Set streaming state
  State.streaming = true;
  State.abortController = new AbortController();
  UI.setStreamingState(true);
  $('status-dot').className = 'status-dot loading';

  let assistantContent = '';
  let bubble = null;
  let requestTimeout = null;
  let requestTimedOut = false;

  try {
    const payload = {
      messages:    State.messages,
      agentId:     State.activeAgent?.id || 'auto',
      temperature: State.settings.temperature,
      maxTokens:   Math.min(State.settings.maxTokens, 4096),
      ...(State.settings.systemPrompt && { systemPrompt: State.settings.systemPrompt }),
    };

    requestTimeout = setTimeout(() => {
      requestTimedOut = true;
      State.abortController.abort();
    }, 90000);
    const res = await fetch(`${API_BASE}/api/chat`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
      signal:  State.abortController.signal,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Server error' }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }

    // Remove typing indicator; create AI bubble
    typingEl.remove();
    bubble = UI.createAssistantBubble();

    // Read SSE stream
    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let   buffer  = '';
    let   streamEndedWithError = false;

    const processSseBlock = (block) => {
      const data = block
        .split(/\r?\n/)
        .filter(line => line.startsWith('data: '))
        .map(line => line.slice(6))
        .join('\n')
        .trim();
      if (!data) return;

      try {
        const event = JSON.parse(data);
        if (event.type === 'error') streamEndedWithError = true;
        handleStreamEvent(event, bubble, (c) => { assistantContent += c; });
      } catch (error) {
        console.error('[xAI Max] Invalid SSE event:', error);
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        buffer += decoder.decode();
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() || '';
      for (const block of blocks) {
        processSseBlock(block);
      }
    }
    if (buffer.trim()) processSseBlock(buffer);

    if (!assistantContent && !streamEndedWithError) {
      throw new Error('The AI returned an empty response. Please try again.');
    }

  } catch (err) {
    if (requestTimeout) clearTimeout(requestTimeout);
    typingEl?.remove();
    if (err.name === 'AbortError' && requestTimedOut) {
      UI.showToast('❌ The request timed out. Please try again or choose a faster model.', 'error');
    } else if (err.name === 'AbortError') {
      // User cancelled
      if (assistantContent) {
        UI.finalizeAssistantBubble(bubble, assistantContent + '\n\n*[Stopped]*');
      }
    } else {
      UI.showToast(`❌ ${err.message}`, 'error');
      console.error('[xAI Max] Stream error:', err);
    }
  } finally {
    if (requestTimeout) clearTimeout(requestTimeout);
    State.streaming = false;
    State.abortController = null;
    UI.setStreamingState(false);
    $('status-dot').className = 'status-dot';

    if (assistantContent) {
      State.messages.push({ role: 'assistant', content: assistantContent });
      UI.finalizeAssistantBubble(bubble, assistantContent);
      persistCurrentConversation();
      const userMessage = State.messages
        .slice(0, -1)
        .reverse()
        .find(message => message.role === 'user');
      const question = typeof userMessage?.content === 'string'
        ? userMessage.content
        : JSON.stringify(userMessage?.content || '');
      await saveQuestionLogToCloud(question, assistantContent, State.resolvedAgent || State.activeAgent);
    } else {
      // Clean up empty bubble if stream failed or returned no text
      bubble?.closest('.message')?.remove();
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────
//  SSE EVENT HANDLER
// ─────────────────────────────────────────────────────────────────────────
function handleStreamEvent(event, bubble, onDelta) {
  switch (event.type) {
    case 'delta':
      onDelta(event.content);
      UI.streamDelta(bubble, event.content);
      break;

    case 'done':
      if (event.total_tokens) {
        State.totalTokens = event.total_tokens;
        $('token-count').textContent = event.total_tokens.toLocaleString();
      }
      break;

    case 'agent':
      if (event.agent) {
        State.resolvedAgent = event.agent;
      }
      if (event.autoRouted && event.agent?.name) {
        UI.showToast(`✦ Auto selected ${event.agent.name}`);
      }
      break;

    case 'error':
      UI.showToast(`❌ ${event.message}`, 'error');
      break;
  }
}

// ─────────────────────────────────────────────────────────────────────────
//  STOP GENERATION
// ─────────────────────────────────────────────────────────────────────────
function stopGeneration() {
  if (State.abortController) {
    State.abortController.abort();
  }
}

// ─────────────────────────────────────────────────────────────────────────
//  VALIDATE API KEY
// ─────────────────────────────────────────────────────────────────────────
async function validateApiKey(key) {
  const statusEl = $('key-status');
  statusEl.className = 'key-status';
  statusEl.textContent = 'Validating…';
  statusEl.style.display = 'block';

  try {
    const res  = await fetch(`${API_BASE}/api/validate-key`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ apiKey: key }),
    });
    const data = await res.json();
    statusEl.className   = `key-status ${data.valid ? 'success' : 'error'}`;
    statusEl.textContent = (data.valid ? '✅ ' : '❌ ') + data.message;
  } catch (_) {
    statusEl.className   = 'key-status error';
    statusEl.textContent = '❌ Could not reach validation server.';
  }
}

// ─────────────────────────────────────────────────────────────────────────
//  EXPORT CHAT
// ─────────────────────────────────────────────────────────────────────────
function exportChat() {
  const text = State.messages
    .map(m => `[${m.role.toUpperCase()}]\n${m.content}`)
    .join('\n\n---\n\n');

  const blob = new Blob([text], { type: 'text/plain' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `xAI-Max-${new Date().toISOString().slice(0,10)}.txt`;
  a.click();
  URL.revokeObjectURL(url);
  UI.showToast('💾 Chat exported');
}

// ─────────────────────────────────────────────────────────────────────────
//  KEYBOARD SHORTCUTS
// ─────────────────────────────────────────────────────────────────────────
function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    const meta = e.metaKey || e.ctrlKey;

    if (meta && e.key === 'k') { e.preventDefault(); startNewConversation(true); }
    if (meta && e.key === ',') { e.preventDefault(); UI.openSettings(); }
    if (meta && e.key === 'e') { e.preventDefault(); exportChat(); }
    if (e.key === 'Escape')    { UI.closeAllModals(); }
  });
}

// Apply aurora intensity
function applyAuroraLevel(level) {
  const orbs = document.querySelectorAll('.aurora-orb');
  orbs.forEach(o => { o.style.opacity = (level / 100) * 0.8; });
}

// ── Expose globally for UI module ──────────────────────────────────────────
window.App = {
  State, init, selectAgent, sendMessage, stopGeneration,
  startNewConversation, loadConversation, deleteConversation,
  clearAllHistory, validateApiKey, exportChat, saveSettings,
  loadSettings, applyAuroraLevel,
};

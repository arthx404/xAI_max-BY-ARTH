// ═══════════════════════════════════════════════════════════════════════════
//  xAI Max — ui.js
//  UI Components: Rendering, Animations, Modals, Voice, Interactions
// ═══════════════════════════════════════════════════════════════════════════

'use strict';

// ── DOM References ─────────────────────────────────────────────────────────
const El = {
  chatFeed:      () => document.getElementById('chat-feed'),
  messages:      () => document.getElementById('messages-container'),
  welcome:       () => document.getElementById('welcome-screen'),
  input:         () => document.getElementById('chat-input'),
  sendBtn:       () => document.getElementById('btn-send'),
  charCounter:   () => document.getElementById('char-counter'),
  tokenCount:    () => document.getElementById('token-count'),
  topbarEmoji:   () => document.getElementById('topbar-agent-emoji'),
  topbarName:    () => document.getElementById('topbar-agent-name'),
  topbarSpec:    () => document.getElementById('topbar-agent-specialty'),
  agentStrip:    () => document.getElementById('agent-strip'),
  agentGrid:     () => document.getElementById('agent-grid'),
  historyList:   () => document.getElementById('history-list'),
  historyEmpty:  () => document.getElementById('history-empty'),
  toastContainer:() => document.getElementById('toast-container'),
  sidebar:       () => document.getElementById('sidebar'),
  sidebarOverlay:() => document.getElementById('sidebar-overlay'),
  settingsModal: () => document.getElementById('settings-overlay'),
  agentModal:    () => document.getElementById('agent-overlay'),
  btnScrollBottom:()=> document.getElementById('btn-scroll-bottom'),
};

// ── Markdown + Code renderer ───────────────────────────────────────────────
let _markedReady = false;
let _hlReady     = false;

document.addEventListener('DOMContentLoaded', () => {
  if (window.marked) {
    marked.setOptions({
      breaks:   true,
      gfm:      true,
      renderer: buildRenderer(),
    });

    // Account menu
    const accountButton = document.getElementById('btn-account');
    const accountMenu = document.getElementById('account-menu');
    accountButton?.addEventListener('click', (event) => {
      event.stopPropagation();
      const open = accountMenu?.hasAttribute('hidden');
      if (open) accountMenu?.removeAttribute('hidden');
      else accountMenu?.setAttribute('hidden', '');
      accountButton.setAttribute('aria-expanded', String(open));
    });
    accountMenu?.addEventListener('click', event => event.stopPropagation());
    document.addEventListener('click', () => {
      accountMenu?.setAttribute('hidden', '');
      accountButton?.setAttribute('aria-expanded', 'false');
    });
    _markedReady = true;
  }
  if (window.hljs) { _hlReady = true; }
});

function buildRenderer() {
  const renderer = new marked.Renderer();

  // Code blocks → custom wrapper with copy button
  renderer.code = (code, lang) => {
    const language    = lang || 'text';
    let highlighted   = code;
    if (_hlReady && hljs.getLanguage(language)) {
      try { highlighted = hljs.highlight(code, { language }).value; } catch(_) {}
    }
    const id = `code-${Math.random().toString(36).slice(2,8)}`;
    return `
      <div class="code-block-wrapper">
        <div class="code-block-header">
          <span class="code-lang">${language}</span>
          <button class="code-copy-btn" onclick="UI.copyCode('${id}')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2"/>
              <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
            </svg>
            Copy
          </button>
        </div>
        <pre><code id="${id}" class="hljs language-${language}">${highlighted}</code></pre>
      </div>`;
  };

  return renderer;
}

function renderMarkdown(text) {
  if (!_markedReady) return escapeHtml(text).replace(/\n/g, '<br>');
  try { return marked.parse(text); } catch(_) { return escapeHtml(text); }
}

function escapeHtml(str) {
  return str
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;')
    .replace(/'/g,'&#039;');
}

// ── Streaming renderer ─────────────────────────────────────────────────────
// We accumulate raw text and re-render markdown on every chunk
const streamBuffers = new WeakMap();

function createAssistantBubble() {
  const agent = window.App?.State?.activeAgent || {};

  const msgDiv = document.createElement('div');
  msgDiv.className = 'message assistant';
  msgDiv.innerHTML = `
    <div class="agent-avatar">${agent.emoji || '🤖'}</div>
    <div class="bubble streaming-bubble"></div>
  `;

  El.messages().appendChild(msgDiv);
  scrollToBottom();

  const bubble = msgDiv.querySelector('.bubble');
  streamBuffers.set(bubble, '');
  return bubble;
}

function streamDelta(bubble, delta) {
  if (!bubble) return;
  const current = streamBuffers.get(bubble) || '';
  const updated = current + delta;
  streamBuffers.set(bubble, updated);

  // Render markdown incrementally
  bubble.innerHTML = renderMarkdown(updated) + '<span class="cursor-blink">▋</span>';
  scrollToBottom();
}

function finalizeAssistantBubble(bubble, fullContent) {
  if (!bubble) return;
  bubble.classList.remove('streaming-bubble');

  // Remove blink cursor
  const cursor = bubble.querySelector('.cursor-blink');
  if (cursor) cursor.remove();

  // Final render
  bubble.innerHTML = renderMarkdown(fullContent);

  // Attach message actions
  const actions = document.createElement('div');
  actions.className = 'message-actions';
  actions.innerHTML = `
    <button class="msg-action-btn" title="Copy response" onclick="UI.copyBubble(this)">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
      </svg>
      Copy
    </button>
    <button class="msg-action-btn" title="Regenerate" onclick="UI.regenerate(this)">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/>
      </svg>
      Retry
    </button>
  `;
  bubble.closest('.message').appendChild(actions);

  // Highlight any remaining code blocks
  if (_hlReady) {
    bubble.querySelectorAll('pre code:not(.hljs)').forEach(el => hljs.highlightElement(el));
  }

  streamBuffers.delete(bubble);
}

function appendUserMessage(content) {
  const div = document.createElement('div');
  div.className = 'message user';
  div.innerHTML = `<div class="bubble">${escapeHtml(content).replace(/\n/g,'<br>')}</div>`;
  El.messages().appendChild(div);
  scrollToBottom();
}

function appendAssistantMessage(content, withActions = true) {
  const agent = window.App?.State?.activeAgent || {};
  const div = document.createElement('div');
  div.className = 'message assistant';
  div.innerHTML = `
    <div class="agent-avatar">${agent.emoji || '🤖'}</div>
    <div class="bubble">${renderMarkdown(content)}</div>
  `;
  El.messages().appendChild(div);
  if (withActions) {
    const actions = document.createElement('div');
    actions.className = 'message-actions';
    div.appendChild(actions);
  }
  if (_hlReady) {
    div.querySelectorAll('pre code').forEach(el => hljs.highlightElement(el));
  }
  scrollToBottom();
}

// ── Typing Indicator ───────────────────────────────────────────────────────
function showTypingIndicator() {
  const agent = window.App?.State?.activeAgent || {};
  const div = document.createElement('div');
  div.className = 'typing-indicator';
  div.innerHTML = `
    <div class="typing-avatar">${agent.emoji || '🤖'}</div>
    <div class="typing-bubble">
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
    </div>
  `;
  El.messages().appendChild(div);
  scrollToBottom();
  return div;
}

// ── Auto-scroll ────────────────────────────────────────────────────────────
let userScrolled = false;

function scrollToBottom(force = false) {
  const feed = El.chatFeed();
  if (!force && userScrolled) return;
  feed.scrollTop = feed.scrollHeight;
}

// Detect manual scroll
El.chatFeed()?.addEventListener?.('scroll', () => {
  const feed = El.chatFeed();
  const atBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 80;
  userScrolled = !atBottom;
}, { passive: true });

// ── Topbar ─────────────────────────────────────────────────────────────────
function updateTopbar() {
  const agent = window.App?.State?.activeAgent;
  if (!agent) return;
  El.topbarEmoji().textContent   = agent.emoji;
  El.topbarName().textContent    = agent.name;
  El.topbarSpec().textContent    = agent.specialty;
}

// ── Agent Strip ────────────────────────────────────────────────────────────
function renderAgentStrip() {
  const strip = El.agentStrip();
  const agents = window.App?.State?.agents || [];
  const active = window.App?.State?.activeAgent;

  strip.innerHTML = '';

  // Show first 6 agents as chips, rest via "More" button
  const visible = agents.slice(0, 7);

  visible.forEach(agent => {
    const isDev = agent.development === true;
    const chip = document.createElement('button');
    chip.className   = `agent-chip${agent.id === active?.id ? ' active' : ''}${isDev ? ' dev' : ''}`;
    chip.role        = 'option';
    chip.setAttribute('aria-selected', agent.id === active?.id);
    chip.style.setProperty('--chip-color', agent.color || '#a78bfa');
    chip.innerHTML   = `
      <span class="agent-chip-emoji">${agent.emoji}</span>
      <span class="agent-chip-name">${agent.name}</span>
      ${isDev ? `<span class="agent-chip-dev">Dev</span>` : (agent.speed === 'Lightning' ? `<span class="agent-chip-speed">${agent.speed}</span>` : '')}
    `;
    if (isDev) {
      chip.disabled = true;
      chip.title = 'Under development — not available yet';
    } else {
      chip.addEventListener('click', () => {
        App.selectAgent(agent.id);
        userScrolled = false;
      });
    }
    strip.appendChild(chip);
  });

  if (agents.length > 7) {
    const more = document.createElement('button');
    more.className = 'agent-more-btn';
    more.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
      All Agents
    `;
    more.addEventListener('click', openAgentModal);
    strip.appendChild(more);
  }
}

// ── Agent Modal ────────────────────────────────────────────────────────────
function openAgentModal() {
  const overlay = El.agentModal();
  overlay.hidden = false;
  renderAgentGrid();
}

function closeAgentModal() {
  El.agentModal().hidden = true;
}

function renderAgentGrid() {
  const grid   = El.agentGrid();
  const agents = window.App?.State?.agents || [];
  const active = window.App?.State?.activeAgent;
  grid.innerHTML = '';

  agents.forEach(agent => {
    const isDev = agent.development === true;
    const card = document.createElement('div');
    card.className = `agent-card${agent.id === active?.id ? ' active' : ''}${isDev ? ' dev' : ''}`;
    card.role      = 'option';
    card.style.setProperty('--agent-color', agent.color || '#a78bfa');
    card.innerHTML = `
      <div class="agent-card-top">
        <div class="agent-card-emoji">${agent.emoji}</div>
        <div class="agent-card-info">
          <div class="agent-card-name">${agent.name}</div>
          <div class="agent-card-specialty">${agent.specialty}</div>
        </div>
      </div>
      <div class="agent-card-desc">${agent.description}</div>
      <span class="agent-card-speed">${isDev ? '🚧 Under Development' : '⚡ ' + agent.speed}</span>
    `;
    if (isDev) {
      card.style.opacity = '0.6';
      card.style.cursor = 'not-allowed';
      card.title = 'Under development — not available yet';
    } else {
      card.addEventListener('click', () => {
        App.selectAgent(agent.id);
        closeAgentModal();
      });
    }
    grid.appendChild(card);
  });
}

// ── History Sidebar ────────────────────────────────────────────────────────
function renderHistoryList() {
  const list    = El.historyList();
  const empty   = El.historyEmpty();
  const convs   = window.App?.State?.conversations || [];
  const activeId = window.App?.State?.activeConvId;

  // Clear all except empty placeholder
  list.querySelectorAll('.history-item').forEach(el => el.remove());

  if (convs.length === 0) {
    empty.style.display = '';
    return;
  }
  empty.style.display = 'none';

  convs.slice(0, 40).forEach(conv => {
    const item = document.createElement('div');
    item.className = `history-item${conv.id === activeId ? ' active' : ''}`;
    item.role      = 'listitem';
    item.innerHTML = `
      <span class="history-item-emoji">${conv.agentEmoji || '🤖'}</span>
      <span class="history-item-title" title="${conv.title}">${conv.title}</span>
      <button class="history-item-delete" title="Delete" aria-label="Delete conversation"
        onclick="event.stopPropagation(); App.deleteConversation('${conv.id}')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 6L6 18M6 6l12 12"/>
        </svg>
      </button>
    `;
    item.addEventListener('click', () => App.loadConversation(conv.id));
    list.appendChild(item);
  });
}

// ── Sidebar ────────────────────────────────────────────────────────────────
function openSidebar() {
  El.sidebar().classList.add('open');
  El.sidebarOverlay().classList.add('active');
}

function closeSidebar() {
  El.sidebar().classList.remove('open');
  El.sidebarOverlay().classList.remove('active');
}

function openAuthPrompt() {
  const overlay = document.getElementById('auth-overlay');
  if (overlay) overlay.hidden = false;
}

function closeAuthPrompt() {
  const overlay = document.getElementById('auth-overlay');
  if (overlay) overlay.hidden = true;
}

// ── Settings Modal ─────────────────────────────────────────────────────────
function openSettings() {
  const settings = window.App?.State?.settings || {};
  document.getElementById('temperature-slider').value = settings.temperature ?? 0.7;
  document.getElementById('temp-value').textContent   = settings.temperature ?? 0.7;
  document.getElementById('max-tokens-input').value   = settings.maxTokens ?? 4096;
  document.getElementById('system-prompt-input').value= settings.systemPrompt || '';
  document.getElementById('aurora-slider').value      = settings.auroraLevel ?? 60;

  El.settingsModal().hidden = false;
}

function closeSettings() {
  El.settingsModal().hidden = true;
}

function closeAllModals() {
  closeSettings();
  closeAgentModal();
}

// ── Input Handling ─────────────────────────────────────────────────────────
function updateSendBtn() {
  const input = El.input();
  const btn   = El.sendBtn();
  const hasText = input.value.trim().length > 0;
  const streaming = window.App?.State?.streaming;

  if (streaming) {
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>`;
    btn.disabled = false;
    btn.title = 'Stop generation';
  } else {
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>`;
    btn.disabled = !hasText;
    btn.title = 'Send message';
  }
}

function updateCharCounter() {
  const len = El.input()?.value?.length || 0;
  const counter = El.charCounter();
  if (!counter) return;
  counter.textContent = `${len.toLocaleString()} / 32,000`;
  counter.className = 'char-counter' +
    (len > 28000 ? ' danger' : len > 20000 ? ' warning' : '');
}

function autoResize(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
}

function setStreamingState(streaming) {
  updateSendBtn();
  El.input().disabled = streaming;
}

// ── Copy helpers ───────────────────────────────────────────────────────────
function copyCode(id) {
  const el = document.getElementById(id);
  if (!el) return;
  navigator.clipboard.writeText(el.innerText).then(() => showToast('Copied!'));
}

function copyBubble(btn) {
  const bubble = btn.closest('.message').querySelector('.bubble');
  navigator.clipboard.writeText(bubble.innerText).then(() => showToast('Copied!'));
}

function regenerate(btn) {
  const message = btn.closest('.message');
  const allMessages = [...document.querySelectorAll('.message')];
  const idx = allMessages.indexOf(message);

  // Remove this and all subsequent messages from DOM + state
  const toRemove = allMessages.slice(idx);
  toRemove.forEach(m => m.remove());

  const state = window.App?.State;
  if (state) {
    // Remove last assistant message from state
    const lastUser = [...state.messages].reverse().find(m => m.role === 'user');
    if (lastUser) {
      const userIdx = state.messages.lastIndexOf(lastUser);
      state.messages = state.messages.slice(0, userIdx);
      App.sendMessage(lastUser.content);
    }
  }
}

// ── Toast ──────────────────────────────────────────────────────────────────
function showToast(msg, type = '') {
  const container = El.toastContainer();
  const toast = document.createElement('div');
  toast.className = `toast${type ? ` ${type}` : ''}`;
  toast.textContent = msg;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'toastOut 0.3s ease forwards';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ── Voice Input ────────────────────────────────────────────────────────────
let recognition = null;

function toggleVoice() {
  const btn = document.getElementById('btn-voice');
  if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
    showToast('🎤 Voice not supported in this browser', 'error');
    return;
  }

  if (recognition) {
    recognition.stop();
    recognition = null;
    btn.classList.remove('recording');
    return;
  }

  const SRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SRec();
  recognition.continuous     = true;
  recognition.interimResults = true;
  recognition.lang           = 'en-US';

  const input = El.input();
  let interim = '';

  recognition.onresult = (e) => {
    let final = '', inter = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) final += e.results[i][0].transcript;
      else inter += e.results[i][0].transcript;
    }
    if (final) { input.value += final + ' '; interim = ''; }
    else        { interim = inter; }
    autoResize(input);
    updateSendBtn();
    updateCharCounter();
  };

  recognition.onend = () => {
    recognition = null;
    btn.classList.remove('recording');
  };

  recognition.onerror = (e) => {
    showToast(`🎤 Voice error: ${e.error}`, 'error');
    recognition = null;
    btn.classList.remove('recording');
  };

  recognition.start();
  btn.classList.add('recording');
  showToast('🎤 Listening…');
}

// ── Handle Send ────────────────────────────────────────────────────────────
function handleSend() {
  const input = El.input();
  const text  = input.value.trim();
  if (text) {
    userScrolled = false;
    App.sendMessage(text);
  }
}

// ─────────────────────────────────────────────────────────────────────────
//  EVENT LISTENERS
// ─────────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Scroll to Bottom Button Logic
  const feed = El.chatFeed();
  const btnScroll = El.btnScrollBottom();
  
  feed.addEventListener('scroll', () => {
    const isNearBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 150;
    if (isNearBottom) {
      btnScroll.classList.remove('visible');
    } else {
      btnScroll.classList.add('visible');
    }
  });
  
  btnScroll.addEventListener('click', () => {
    feed.scrollTo({ top: feed.scrollHeight, behavior: 'smooth' });
  });

  El.sendBtn().addEventListener('click', () => {
    if (window.App?.State?.streaming) App.stopGeneration();
    else handleSend();
  });

  // Input
  const input = El.input();
  input.addEventListener('input',   () => { autoResize(input); updateSendBtn(); updateCharCounter(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!window.App?.State?.streaming) handleSend();
    }
  });

  // Voice
  document.getElementById('btn-voice').addEventListener('click', toggleVoice);

  // Attach
  const btnAttach = document.getElementById('btn-attach');
  const fileUpload = document.getElementById('file-upload');
  btnAttach.addEventListener('click', () => fileUpload.click());
  fileUpload.addEventListener('change', handleFileSelect);

  // Sidebar
  document.getElementById('btn-sidebar-open').addEventListener('click', openSidebar);
  document.getElementById('btn-sidebar-close').addEventListener('click', closeSidebar);
  El.sidebarOverlay().addEventListener('click', closeSidebar);

  // New chat
  document.getElementById('btn-new-chat-sidebar').addEventListener('click', () => {
    App.startNewConversation(true);
    closeSidebar();
  });

  // Settings
  document.getElementById('btn-settings').addEventListener('click', openSettings);
  document.getElementById('btn-settings-close').addEventListener('click', closeSettings);
  El.settingsModal().addEventListener('click', (e) => {
    if (e.target === El.settingsModal()) closeSettings();
  });

  // Settings save
  document.getElementById('btn-settings-save').addEventListener('click', () => {
    const s = window.App.State.settings;
    s.apiKey       = '';
    s.temperature  = parseFloat(document.getElementById('temperature-slider').value);
    s.maxTokens    = parseInt(document.getElementById('max-tokens-input').value);
    s.systemPrompt = document.getElementById('system-prompt-input').value.trim();
    s.auroraLevel  = parseInt(document.getElementById('aurora-slider').value);
    App.saveSettings();
    App.applyAuroraLevel(s.auroraLevel);
    closeSettings();
    showToast('✅ Settings saved');
  });

  // Settings reset
  document.getElementById('btn-settings-reset').addEventListener('click', () => {
    document.getElementById('temperature-slider').value  = 0.7;
    document.getElementById('temp-value').textContent    = '0.7';
    document.getElementById('max-tokens-input').value    = 4096;
    document.getElementById('system-prompt-input').value = '';
    document.getElementById('aurora-slider').value       = 60;
  });

  // Temperature display
  document.getElementById('temperature-slider').addEventListener('input', (e) => {
    document.getElementById('temp-value').textContent = e.target.value;
  });

  // Agent modal
  document.getElementById('btn-agent-close').addEventListener('click', closeAgentModal);
  El.agentModal().addEventListener('click', (e) => {
    if (e.target === El.agentModal()) closeAgentModal();
  });

  // Clear history
  document.getElementById('btn-clear-history').addEventListener('click', () => {
    if (confirm('Clear all conversation history?')) App.clearAllHistory();
  });

  // Export
  document.getElementById('btn-export-chat').addEventListener('click', App.exportChat);

  // Suggestion cards
  document.querySelectorAll('.suggestion-card').forEach(card => {
    card.addEventListener('click', () => {
      const prompt = card.dataset.prompt;
      El.input().value = prompt;
      autoResize(El.input());
      updateSendBtn();
      handleSend();
    });
  });

  // Kick off app
  App.init();
});

// ── Cursor blink style ─────────────────────────────────────────────────────
const style = document.createElement('style');
style.textContent = `
  .cursor-blink {
    display: inline-block;
    color: var(--accent);
    animation: cursorBlink 0.75s step-start infinite;
    font-weight: 300;
    margin-left: 1px;
  }
  @keyframes cursorBlink {
    0%, 100% { opacity: 1; }
    50%       { opacity: 0; }
  }
`;
document.head.appendChild(style);

// ── Attachments ────────────────────────────────────────────────────────────
let pendingAttachments = [];

async function handleFileSelect(e) {
  const files = Array.from(e.target.files);
  if (!files.length) return;
  
  for (const file of files) {
    if (file.size > 4 * 1024 * 1024) {
      showToast(`⚠️ ${file.name} is larger than 4MB`, 'error');
      continue;
    }
    
    // Read file as base64 or text
    const isImage = file.type.startsWith('image/');
    const reader = new FileReader();
    
    reader.onload = (ev) => {
      pendingAttachments.push({
        file,
        name: file.name,
        type: file.type,
        data: ev.target.result,
        isImage
      });
      renderAttachmentPreview();
    };
    
    if (isImage) {
      reader.readAsDataURL(file);
    } else {
      reader.readAsText(file);
    }
  }
  e.target.value = ''; // Reset input
}

function renderAttachmentPreview() {
  const container = document.getElementById('attachment-preview');
  if (pendingAttachments.length === 0) {
    container.style.display = 'none';
    container.innerHTML = '';
    return;
  }
  
  container.style.display = 'flex';
  container.innerHTML = pendingAttachments.map((att, idx) => `
    <div class="attach-item" title="${att.name}">
      ${att.isImage ? `<img src="${att.data}" alt="${att.name}">` : `<span>📄</span>`}
      <span class="file-name">${att.name}</span>
      <button class="remove-btn" aria-label="Remove" onclick="UI.removeAttachment(${idx})">✕</button>
    </div>
  `).join('');
}

function removeAttachment(idx) {
  pendingAttachments.splice(idx, 1);
  renderAttachmentPreview();
}

function getPendingAttachments() {
  return [...pendingAttachments];
}

function clearPendingAttachments() {
  pendingAttachments = [];
  renderAttachmentPreview();
}

// ── Expose UI globally ─────────────────────────────────────────────────────
window.UI = {
  removeAttachment, getPendingAttachments, clearPendingAttachments,
  renderAgentStrip, renderAgentGrid, renderHistoryList, updateTopbar,
  appendUserMessage, appendAssistantMessage, createAssistantBubble,
  streamDelta, finalizeAssistantBubble, showTypingIndicator,
  openSettings, closeSettings, closeAllModals,
  openSidebar, closeSidebar, openAgentModal, closeAgentModal,
  openAuthPrompt, closeAuthPrompt,
  setStreamingState, updateSendBtn, updateCharCounter,
  showToast, copyCode, copyBubble, regenerate,
};

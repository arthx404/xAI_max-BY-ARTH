# ═══════════════════════════════════════════════════════════════════════════
#  xAI Max — Streamlit App
#  Free deployment at: username.streamlit.app
#  Multi-agent AI powered by NVIDIA NIM
# ═══════════════════════════════════════════════════════════════════════════

import streamlit as st
from openai import OpenAI

# ─── Page Config ─────────────────────────────────────────────────────────────
st.set_page_config(
    page_title  = "xAI Max — Multi-Agent AI",
    page_icon   = "✦",
    layout      = "wide",
    initial_sidebar_state = "expanded",
)

# ─── Agent Catalog ────────────────────────────────────────────────────────────
AGENTS = {
    "⚡ Nemotron Ultra 253B": {
        "model":       "nvidia/llama-3.1-nemotron-ultra-253b-v1",
        "description": "NVIDIA's frontier model — deepest reasoning, agentic tasks",
        "speed":       "🟡 Deep",
        "system":      "You are xAI Max Ultra, the world's most advanced AI assistant powered by NVIDIA Nemotron Ultra 253B. You excel at multi-step reasoning, complex analysis, scientific thinking, and agentic task execution. Always think step-by-step, be precise, and provide exhaustively detailed answers.",
    },
    "🧠 Nemotron Super 49B": {
        "model":       "nvidia/llama-3.3-nemotron-super-49b-v1",
        "description": "NVIDIA's 49B MoE — agentic workflows & tool use",
        "speed":       "🟢 Fast",
        "system":      "You are xAI Max Super, powered by NVIDIA Nemotron Super 49B. You are highly optimized for agentic workflows, multi-turn reasoning, and efficient task execution. Always decompose complex tasks into clear steps.",
    },
    "🦙 Llama 3.1 405B": {
        "model":       "meta/llama-3.1-405b-instruct",
        "description": "Meta's largest open model — vast knowledge across all domains",
        "speed":       "🟡 Deep",
        "system":      "You are xAI Max, powered by Meta's Llama 3.1 405B — the largest open-weight AI model ever created. Be thorough, insightful, and always cite your reasoning.",
    },
    "🔥 Llama 3.3 70B": {
        "model":       "nvidia/llama-3.1-nemotron-70b-instruct",
        "description": "The perfect daily driver — fast, smart, versatile",
        "speed":       "🟢 Fast",
        "system":      "You are xAI Max, powered by NVIDIA Nemotron 70B. You are fast, smart, and versatile. Excel at everyday tasks, writing, analysis, and coding.",
    },
    "🔍 DeepSeek R1 (Reasoning)": {
        "model":       "deepseek-ai/deepseek-r1",
        "description": "Chain-of-thought specialist — shows reasoning for math & logic",
        "speed":       "🟡 Deep",
        "system":      "You are xAI Max Reason, powered by DeepSeek R1. Always show your full chain of thought. Reason step by step before giving your final answer. For math problems, show all work.",
    },
    "💻 DeepSeek V3 (Coding)": {
        "model":       "deepseek-ai/deepseek-v3-0324",
        "description": "Elite coding & technical reasoning",
        "speed":       "🟢 Fast",
        "system":      "You are xAI Max Code, powered by DeepSeek V3. You are an elite software engineer. Write clean, efficient, well-commented code. Follow best practices and explain technical concepts clearly.",
    },
    "🌊 Mistral Large": {
        "model":       "mistralai/mistral-large-2-instruct",
        "description": "Multilingual, great for writing & analysis",
        "speed":       "🟢 Fast",
        "system":      "You are xAI Max, powered by Mistral Large. You excel at writing, content creation, multilingual tasks, summarization, and nuanced analysis.",
    },
    "⚡ Mistral NeMo 12B": {
        "model":       "nv-mistralai/mistral-nemo-12b-instruct",
        "description": "Ultra-fast lightweight model by Mistral × NVIDIA",
        "speed":       "🔵 Lightning",
        "system":      "You are xAI Max Fast, powered by Mistral NeMo 12B. Prioritize speed and clarity. Give direct, accurate answers without unnecessary preamble.",
    },
    "🌸 Gemma 3 27B": {
        "model":       "google/gemma-3-27b-it",
        "description": "Google's open model — creative & conversational",
        "speed":       "🟢 Fast",
        "system":      "You are xAI Max, powered by Google Gemma 3 27B. You are warm, thoughtful, and creative. Excel at conversations, creative writing, and explaining ideas engagingly.",
    },
    "🔷 Microsoft Phi-4": {
        "model":       "microsoft/phi-4",
        "description": "Punches above its weight — compact yet brilliant",
        "speed":       "🔵 Lightning",
        "system":      "You are xAI Max, powered by Microsoft Phi-4. You are compact yet extraordinarily capable at reasoning. Give precise, well-reasoned answers.",
    },
    "🌙 Kimi K1.5 (Long Context)": {
        "model":       "moonshotai/kimi-k1.5-thinking",
        "description": "Long-context expert — handles massive documents & codebases",
        "speed":       "🟡 Deep",
        "system":      "You are xAI Max, powered by Moonshot Kimi K1.5. You excel at long-context understanding and complex multi-hop reasoning. Handle very long documents with ease.",
    },
}

# ─── Liquid Glass Custom CSS ──────────────────────────────────────────────────
st.markdown("""
<style>
  /* ── Import fonts ── */
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');

  /* ── Global ── */
  html, body, [data-testid="stAppViewContainer"] {
    background: #06070a !important;
    font-family: 'Inter', -apple-system, sans-serif !important;
    color: rgba(255,255,255,0.92) !important;
  }
  [data-testid="stHeader"] { background: transparent !important; }
  [data-testid="stSidebar"] {
    background: rgba(255,255,255,0.038) !important;
    border-right: 1px solid rgba(255,255,255,0.08) !important;
    backdrop-filter: blur(28px) !important;
  }
  [data-testid="stSidebar"] * { color: rgba(255,255,255,0.85) !important; }

  /* ── Aurora background ── */
  [data-testid="stAppViewContainer"]::before {
    content: '';
    position: fixed;
    top: -200px; left: -200px;
    width: 700px; height: 700px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(167,139,250,0.18) 0%, transparent 70%);
    filter: blur(80px);
    pointer-events: none;
    z-index: 0;
    animation: auroraFloat 18s ease-in-out infinite;
  }
  [data-testid="stAppViewContainer"]::after {
    content: '';
    position: fixed;
    bottom: -150px; right: -100px;
    width: 600px; height: 600px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(52,211,153,0.12) 0%, transparent 70%);
    filter: blur(80px);
    pointer-events: none;
    z-index: 0;
    animation: auroraFloat2 22s ease-in-out infinite;
  }
  @keyframes auroraFloat  { 0%,100%{transform:translate(0,0)} 50%{transform:translate(60px,80px)} }
  @keyframes auroraFloat2 { 0%,100%{transform:translate(0,0)} 50%{transform:translate(-60px,-50px)} }

  /* ── Main content padding ── */
  [data-testid="stMainBlockContainer"] {
    padding-top: 1rem !important;
    max-width: 860px !important;
  }

  /* ── Title / Hero ── */
  .xai-hero {
    text-align: center;
    padding: 2.5rem 1rem 2rem;
    animation: fadeInUp 0.6s ease both;
  }
  .xai-logo {
    font-size: 52px;
    filter: drop-shadow(0 0 20px rgba(167,139,250,0.5));
    display: block;
    margin-bottom: 12px;
    animation: pulse 3s ease-in-out infinite;
  }
  .xai-title {
    font-family: 'Space Grotesk', sans-serif;
    font-size: 3rem;
    font-weight: 700;
    letter-spacing: -0.04em;
    background: linear-gradient(135deg, #fff 0%, #a78bfa 50%, #34d399 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    margin-bottom: 0.5rem;
  }
  .xai-subtitle {
    font-size: 1rem;
    color: rgba(255,255,255,0.5);
    line-height: 1.55;
  }
  @keyframes pulse  { 0%,100%{transform:scale(1)} 50%{transform:scale(1.06)} }
  @keyframes fadeInUp { from{opacity:0;transform:translateY(14px)} to{opacity:1;transform:translateY(0)} }

  /* ── Agent card ── */
  .agent-info-card {
    background: rgba(255,255,255,0.048);
    border: 1px solid rgba(255,255,255,0.09);
    border-radius: 14px;
    padding: 14px 18px;
    margin-bottom: 12px;
    backdrop-filter: blur(20px);
  }
  .agent-name-display {
    font-family: 'Space Grotesk', sans-serif;
    font-size: 1.05rem;
    font-weight: 600;
    margin-bottom: 4px;
  }
  .agent-desc-display {
    font-size: 0.82rem;
    color: rgba(255,255,255,0.48);
    line-height: 1.4;
  }
  .speed-badge {
    font-size: 0.75rem;
    font-weight: 600;
    padding: 3px 9px;
    background: rgba(52,211,153,0.1);
    border: 1px solid rgba(52,211,153,0.2);
    border-radius: 100px;
    color: #34d399;
    display: inline-block;
    margin-top: 8px;
  }

  /* ── Chat messages ── */
  [data-testid="stChatMessage"] {
    background: rgba(255,255,255,0.042) !important;
    border: 1px solid rgba(255,255,255,0.08) !important;
    border-radius: 14px !important;
    backdrop-filter: blur(20px) !important;
    margin-bottom: 8px !important;
    padding: 14px 16px !important;
    animation: fadeInUp 0.3s ease both !important;
  }
  /* User messages - warm tint */
  [data-testid="stChatMessage"]:has([data-testid="stChatMessageAvatarUser"]) {
    background: rgba(167,139,250,0.1) !important;
    border-color: rgba(167,139,250,0.18) !important;
  }
  /* AI messages - glass */
  [data-testid="stChatMessage"]:has([data-testid="stChatMessageAvatarAssistant"]) {
    background: rgba(255,255,255,0.042) !important;
  }
  [data-testid="stChatMessage"] p {
    color: rgba(255,255,255,0.9) !important;
    font-size: 0.93rem !important;
    line-height: 1.65 !important;
  }
  [data-testid="stChatMessage"] code {
    background: rgba(167,139,250,0.12) !important;
    color: #a78bfa !important;
    border-radius: 5px !important;
    padding: 1px 5px !important;
    font-family: 'JetBrains Mono', monospace !important;
    font-size: 0.82rem !important;
  }
  [data-testid="stChatMessage"] pre {
    background: rgba(0,0,0,0.45) !important;
    border: 1px solid rgba(255,255,255,0.08) !important;
    border-radius: 10px !important;
    padding: 14px !important;
    overflow-x: auto !important;
  }

  /* ── Chat input ── */
  [data-testid="stChatInputContainer"] {
    background: rgba(255,255,255,0.048) !important;
    border: 1px solid rgba(255,255,255,0.1) !important;
    border-radius: 16px !important;
    backdrop-filter: blur(28px) !important;
    box-shadow: 0 8px 32px rgba(0,0,0,0.3) !important;
  }
  [data-testid="stChatInputContainer"]:focus-within {
    border-color: rgba(167,139,250,0.4) !important;
    box-shadow: 0 0 0 3px rgba(167,139,250,0.1), 0 8px 32px rgba(0,0,0,0.3) !important;
  }
  [data-testid="stChatInput"] {
    background: transparent !important;
    color: rgba(255,255,255,0.92) !important;
    font-family: 'Inter', sans-serif !important;
    font-size: 0.95rem !important;
  }

  /* ── Selectbox / inputs ── */
  [data-testid="stSelectbox"] > div {
    background: rgba(255,255,255,0.05) !important;
    border: 1px solid rgba(255,255,255,0.1) !important;
    border-radius: 10px !important;
    color: rgba(255,255,255,0.9) !important;
  }
  [data-testid="stTextInput"] > div {
    background: rgba(255,255,255,0.05) !important;
    border: 1px solid rgba(255,255,255,0.1) !important;
    border-radius: 10px !important;
  }
  [data-testid="stTextInput"] input {
    color: rgba(255,255,255,0.9) !important;
    font-family: 'JetBrains Mono', monospace !important;
    font-size: 0.85rem !important;
  }

  /* ── Buttons ── */
  [data-testid="stButton"] > button {
    background: linear-gradient(135deg, rgba(167,139,250,0.2), rgba(167,139,250,0.08)) !important;
    border: 1px solid rgba(167,139,250,0.3) !important;
    border-radius: 10px !important;
    color: rgba(255,255,255,0.9) !important;
    font-family: 'Inter', sans-serif !important;
    font-weight: 500 !important;
    transition: all 0.2s ease !important;
    backdrop-filter: blur(10px) !important;
  }
  [data-testid="stButton"] > button:hover {
    background: linear-gradient(135deg, rgba(167,139,250,0.32), rgba(167,139,250,0.14)) !important;
    border-color: rgba(167,139,250,0.5) !important;
    transform: translateY(-1px) !important;
    box-shadow: 0 4px 16px rgba(167,139,250,0.25) !important;
  }

  /* ── Sidebar elements ── */
  .sidebar-brand {
    font-family: 'Space Grotesk', sans-serif;
    font-size: 1.4rem;
    font-weight: 700;
    letter-spacing: -0.03em;
    margin-bottom: 1.5rem;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .sidebar-logo { color: #a78bfa; filter: drop-shadow(0 0 8px rgba(167,139,250,0.5)); }

  /* ── Divider ── */
  hr { border-color: rgba(255,255,255,0.07) !important; margin: 1rem 0 !important; }

  /* ── Scrollbar ── */
  ::-webkit-scrollbar { width: 4px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 100px; }

  /* ── Stats pills ── */
  .stat-pill {
    display: inline-flex; align-items: center; gap: 5px;
    padding: 4px 10px;
    background: rgba(255,255,255,0.045);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 100px;
    font-size: 0.78rem;
    color: rgba(255,255,255,0.45);
    margin-right: 6px;
    font-family: 'JetBrains Mono', monospace;
  }

  /* ── Warning / info ── */
  [data-testid="stAlert"] {
    background: rgba(255,255,255,0.04) !important;
    border: 1px solid rgba(255,255,255,0.09) !important;
    border-radius: 12px !important;
    backdrop-filter: blur(16px) !important;
  }
</style>
""", unsafe_allow_html=True)

# ─── Session State ────────────────────────────────────────────────────────────
if "messages"      not in st.session_state: st.session_state.messages      = []
if "total_tokens"  not in st.session_state: st.session_state.total_tokens  = 0
if "active_agent"  not in st.session_state: st.session_state.active_agent  = "🔥 Llama 3.3 70B"

# ─── Sidebar ──────────────────────────────────────────────────────────────────
with st.sidebar:
    st.markdown('<div class="sidebar-brand"><span class="sidebar-logo">✦</span> xAI Max</div>', unsafe_allow_html=True)

    # API Key input — also supports Streamlit secrets
    api_key = st.text_input(
        "NVIDIA API Key",
        type     = "password",
        value    = st.secrets.get("NVIDIA_API_KEY", ""),
        help     = "Get your free key at https://build.nvidia.com",
        placeholder = "nvapi-...",
    )

    st.markdown("---")

    # Agent selection
    st.markdown("**🤖 Select Agent**")
    selected_agent_name = st.selectbox(
        "Agent",
        options        = list(AGENTS.keys()),
        index          = list(AGENTS.keys()).index(st.session_state.active_agent),
        label_visibility = "collapsed",
    )
    st.session_state.active_agent = selected_agent_name
    agent = AGENTS[selected_agent_name]

    # Agent info card
    st.markdown(f"""
    <div class="agent-info-card">
      <div class="agent-name-display">{selected_agent_name}</div>
      <div class="agent-desc-display">{agent['description']}</div>
      <span class="speed-badge">{agent['speed']}</span>
    </div>
    """, unsafe_allow_html=True)

    st.markdown("---")

    # Generation settings
    st.markdown("**⚙️ Settings**")
    temperature = st.slider("Temperature",  0.0, 2.0, 0.7, 0.1,
                            help="Higher = more creative, lower = more precise")
    max_tokens  = st.select_slider("Max Tokens",
                            options = [512, 1024, 2048, 4096, 8192],
                            value   = 4096,
                            help    = "Maximum length of each response")

    st.markdown("---")

    # Stats
    msg_count = len([m for m in st.session_state.messages if m["role"] == "user"])
    st.markdown(f"""
    <span class="stat-pill">💬 {msg_count} msgs</span>
    <span class="stat-pill">🔤 {st.session_state.total_tokens:,} tokens</span>
    """, unsafe_allow_html=True)

    st.markdown("<br>", unsafe_allow_html=True)

    col1, col2 = st.columns(2)
    with col1:
        if st.button("🗑️ Clear Chat", use_container_width=True):
            st.session_state.messages     = []
            st.session_state.total_tokens = 0
            st.rerun()
    with col2:
        if st.button("📥 Export", use_container_width=True):
            text = "\n\n---\n\n".join(
                f"[{m['role'].upper()}]\n{m['content']}"
                for m in st.session_state.messages
            )
            st.download_button(
                "Download",
                data      = text,
                file_name = "xai-max-chat.txt",
                mime      = "text/plain",
                use_container_width = True,
            )

# ─── Main Content ─────────────────────────────────────────────────────────────
# Hero header (shown when no messages)
if not st.session_state.messages:
    st.markdown("""
    <div class="xai-hero">
      <span class="xai-logo">✦</span>
      <div class="xai-title">xAI Max</div>
      <div class="xai-subtitle">
        The world's most powerful multi-agent AI platform.<br>
        12 frontier models. One interface.
      </div>
    </div>
    """, unsafe_allow_html=True)

    # Suggestion buttons
    suggestions = [
        ("⚛️", "Explain quantum entanglement in simple terms with a practical example"),
        ("🐍", "Write a production-ready async Python web scraper with error handling and rate limiting"),
        ("🤖", "What are the most important AI developments of 2025 and their future impact?"),
        ("🏗️", "Design a scalable microservices architecture for a real-time chat application"),
        ("🧮", "Solve this step by step: What is the derivative of x²·sin(x)?"),
        ("✍️", "Write a compelling short story set in a world where AI achieved consciousness"),
    ]
    cols = st.columns(3)
    for i, (icon, prompt) in enumerate(suggestions):
        with cols[i % 3]:
            if st.button(f"{icon} {prompt[:50]}…" if len(prompt) > 50 else f"{icon} {prompt}",
                        use_container_width=True, key=f"sug_{i}"):
                st.session_state.messages.append({"role": "user", "content": prompt})
                st.rerun()

# ─── Render Chat History ──────────────────────────────────────────────────────
for message in st.session_state.messages:
    with st.chat_message(message["role"], avatar="✦" if message["role"] == "assistant" else "👤"):
        st.markdown(message["content"])

# ─── Chat Input ───────────────────────────────────────────────────────────────
if prompt := st.chat_input(f"Message {selected_agent_name}…"):

    # Validate API key
    if not api_key or not api_key.startswith("nvapi-"):
        st.error("⚠️ Please enter your NVIDIA API key in the sidebar. Get one free at [build.nvidia.com](https://build.nvidia.com).")
        st.stop()

    # Display user message
    st.session_state.messages.append({"role": "user", "content": prompt})
    with st.chat_message("user", avatar="👤"):
        st.markdown(prompt)

    # Stream AI response
    with st.chat_message("assistant", avatar="✦"):
        # Build messages for API
        system_msg = {"role": "system", "content": agent["system"]}
        api_messages = [system_msg] + [
            {"role": m["role"], "content": m["content"]}
            for m in st.session_state.messages[-50:]  # context window: last 50 msgs
        ]

        try:
            client = OpenAI(
                base_url = "https://integrate.api.nvidia.com/v1",
                api_key  = api_key,
            )

            stream = client.chat.completions.create(
                model       = agent["model"],
                messages    = api_messages,
                stream      = True,
                temperature = temperature,
                max_tokens  = max_tokens,
            )

            # Stream the response
            response_text = st.write_stream(stream)

            # Track tokens (approximate — NVIDIA API may not always return usage in stream)
            st.session_state.total_tokens += len(response_text.split()) * 1.3  # rough estimate

        except Exception as e:
            err = str(e)
            if "401" in err:
                response_text = "❌ **Invalid API key.** Please check your NVIDIA API key in the sidebar."
            elif "404" in err or "410" in err:
                response_text = f"❌ **Model unavailable.** The model `{agent['model']}` is not available on your plan. Try a different agent."
            elif "429" in err:
                response_text = "❌ **Rate limit reached.** Please wait a moment and try again."
            else:
                response_text = f"❌ **Error:** {err}"
            st.markdown(response_text)

    # Save assistant response
    st.session_state.messages.append({"role": "assistant", "content": response_text})

# Veylora — Multi-Agent Personal AI Assistant

A free, open-source, multi-agent AI assistant built with Streamlit.

## 🤖 Agents

| Agent | Label | Powered By | Purpose |
|-------|-------|------------|---------|
| **Code** | 🧑‍💻 Claude-like | Qwen2.5-Coder-32B | Programming, debugging, code review |
| **Fast Mode** | ⚡ ChatGPT-like | Mistral-Small-24B | Quick answers, general chat |
| **Image Gen** | 🎨 Gemini-like | FLUX.1-schnell | Image generation from text |

All models run via **HuggingFace's free Inference API** — no paid subscriptions needed.

## 📎 File Support

Upload and analyze any of these file types:
- **Documents:** PDF, DOCX, XLSX, PPTX, CSV, TXT, MD
- **Code:** Python, JavaScript, TypeScript, Java, C/C++, Go, Rust, PHP, Ruby, Swift, Kotlin, SQL, HTML, CSS, and 30+ more
- **Images:** PNG, JPG, GIF, BMP, WebP
- **Config:** JSON, YAML, TOML, XML, INI, ENV

## ☁️ Supabase Integration

Optional cloud backend with:
- **Auth:** User login / signup / logout
- **Database:** Chat history synced across devices
- **Storage:** File uploads stored in the cloud

## 🚀 Quick Setup

### 1. Install dependencies
```bash
pip install -r requirements.txt
```

### 2. Get a free HuggingFace token
Go to https://huggingface.co/settings/tokens and create a free token.

### 3. Configure secrets
Edit `.streamlit/secrets.toml`:
```toml
HF_TOKEN = "hf_your_token_here"

# Optional — for cloud features:
SUPABASE_URL = "https://your-project.supabase.co"
SUPABASE_KEY = "your_anon_key"
```

### 4. (Optional) Set up Supabase
1. Create a free project at https://supabase.com
2. Run the SQL from `supabase_client/database.py` in the SQL Editor
3. Create a storage bucket named `user-files`

### 5. Run the app
```bash
streamlit run app.py
```

## 📁 Project Structure

```
Veylora/
├── app.py                    # Main Streamlit application
├── requirements.txt          # Python dependencies
├── .streamlit/
│   └── secrets.toml          # API keys (never commit this!)
├── agents/
│   ├── __init__.py
│   ├── code_agent.py         # 🧑‍💻 Code agent (Qwen2.5-Coder)
│   ├── fast_agent.py         # ⚡ Fast mode agent (Mistral)
│   └── image_agent.py        # 🎨 Image generation agent (FLUX)
├── supabase_client/
│   ├── __init__.py
│   ├── auth.py               # Authentication
│   ├── database.py           # Chat persistence
│   └── storage.py            # File storage
└── utils/
    ├── __init__.py
    └── file_reader.py         # Universal file reader
```

## 🌐 Deploy Free on Streamlit Cloud

1. Push this repo to GitHub
2. Go to https://share.streamlit.io
3. Connect your repo and set secrets in the dashboard
4. Your app runs 24/7 for free — no need to keep your PC on!

## License

MIT

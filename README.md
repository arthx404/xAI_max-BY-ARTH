# xAI Max — Multi-Agent AI Platform

Premium multi-agent AI chat powered by NVIDIA NIM, with automatic model routing, streaming responses, Google sign-in, and account-scoped conversation history.

---

## Features

- NVIDIA NIM streaming proxy with server-side API-key protection
- Auto agent that routes requests to a suitable model
- Multiple NVIDIA catalog agents with fallback handling
- Vanilla HTML/CSS/JavaScript liquid-glass interface
- Google authentication through Supabase
- Account-scoped cloud conversations and question/answer logs
- Text and image attachments
- Local guest history when the user is signed out

## Local development

### 1. Install Node.js dependencies
```bash
npm install
```

### 2. Configure environment variables
```bash
copy .env.example .env
```

Set `NVIDIA_API_KEY` in `.env`. Optionally set `SUPABASE_URL` and
`SUPABASE_ANON_KEY` to enable Google sign-in and cloud history.

### 3. Run the server
```bash
npm start
# Open http://localhost:3000
```

## Production deployment

Deploy this as a Node.js web service, not as static files only.

1. Use Node.js 18 or newer.
2. Set the service start command to `npm start`.
3. Configure these environment variables in the hosting provider:

```env
NVIDIA_API_KEY=your-new-server-only-key
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-public-supabase-key
CORS_ORIGIN=https://your-domain.example
PORT=provided-by-host
RATE_LIMIT=100
```

Never commit `.env`, NVIDIA keys, Supabase service-role keys, OAuth secrets, or
files from the local credentials folder. Rotate any key that has been exposed.

After deployment, add the production URL to Supabase Authentication URL
Configuration and to the Google OAuth authorized origins. The redirect callback
remains the Supabase callback URL:

```text
https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback
```

## Supabase setup

Run [supabase-schema.sql](./supabase-schema.sql) in the Supabase SQL editor once.
It creates the conversation and question-log tables with row-level security.

---

## Agents

The catalog is served by `/api/models`. Select **Auto** to route by request
type. The server falls back to the verified fast model when an NVIDIA model is
temporarily unavailable.

## Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl/Cmd + K` | New conversation |
| `Ctrl/Cmd + ,` | Open settings |
| `Ctrl/Cmd + E` | Export chat |
| `Enter` | Send message |
| `Shift + Enter` | New line |
| `Esc` | Close modals |

---

## 📁 File Structure

```
xAI Max/
├── server.js           # Express backend — NVIDIA NIM proxy + SSE
├── package.json        # Node dependencies
├── .env.example        # Environment template (copy to .env)
├── .gitignore
├── streamlit_app.py    # 🐍 Streamlit version (free hosting)
├── requirements.txt    # Python deps for Streamlit
├── README.md
└── public/
    ├── index.html      # App shell
    ├── style.css       # Apple Liquid Glass design system
    ├── app.js          # AI core logic + streaming
    └── ui.js           # UI components + animations
```

---

## Security

- NVIDIA API keys remain on the server and are never sent to the browser.
- Rate limiting and Helmet security headers are enabled.
- Supabase row-level security isolates account data.
- Rotate credentials immediately if they are accidentally exposed.

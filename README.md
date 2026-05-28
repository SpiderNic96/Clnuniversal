# 🧠 ADHD Cleaning Command Center

Persistent, shared cleaning task tracker. Changes sync across all users in real time via Vercel KV.

---

## Stack
- **Frontend**: Vanilla HTML/CSS/JS in `/public/index.html`
- **Backend**: Vercel Serverless Function in `/api/data.js`
- **Storage**: Vercel KV (Redis)

---

## Setup — step by step

### 1. Push to GitHub
```bash
git init
git add .
git commit -m "init"
gh repo create cleaning-app --public --push
# or push to existing repo
```

### 2. Import to Vercel
- Go to https://vercel.com/new
- Import your GitHub repo
- Deploy (no build settings needed — it's plain HTML)

### 3. Enable Vercel KV
- In your Vercel project dashboard → **Storage** tab
- Click **Create Database** → **KV**
- Name it anything (e.g. `cleaning-kv`)
- Click **Connect to Project**
- Vercel auto-injects `KV_REST_API_URL` and `KV_REST_API_TOKEN` as env vars

### 4. Redeploy
After connecting KV, trigger a redeploy:
- Vercel dashboard → **Deployments** → **Redeploy**

That's it. Visit your `.vercel.app` URL — data persists and syncs across all visitors.

---

## How sync works
- Any change (add/remove/check) saves to KV within ~400ms
- Every 12 seconds, the page polls for remote changes
- If another device made a change, the page updates automatically with a toast notification

---

## File structure
```
cleaning-app/
├── public/
│   └── index.html      ← entire frontend SPA
├── api/
│   └── data.js         ← GET/POST handler for KV
├── package.json
└── README.md
```

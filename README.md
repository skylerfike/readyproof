# ReadyProof

A photography studio client proofing and workflow platform. Clients view their gallery via a magic link, select and favorite images, add notes, and submit their final selection — which automatically notifies the editor with a clean brief.

---

## Features

- **Client gallery** — magic link access (no login), masonry grid, heart/favorite, multi-select, per-image notes, auto-save
- **Admin dashboard** — create sessions, send gallery invite emails, monitor client progress, view editor brief, send brief to editor
- **Editor workflow** — structured email with filenames + client notes + favorites, auto-sent on your command
- **Dropbox integration** — uses your existing shared folder links, no re-organizing needed
- **RAW file support** — CR2, NEF, ARW etc. shown as placeholders (can't preview in browser, but fully included in selection)
- **SQLite** — zero-config database, single file, perfect for 1–20 sessions

---

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your values (see below).

### 3. Run

```bash
npm start
# or for development with auto-restart:
npm run dev
```

Open `http://localhost:3000` — you'll land on the admin dashboard.

---

## Environment Variables

```
# Dropbox API
DROPBOX_APP_KEY=         Your Dropbox app key
DROPBOX_APP_SECRET=      Your Dropbox app secret
DROPBOX_REFRESH_TOKEN=   Long-lived refresh token (see below)

# Email
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=you@gmail.com
SMTP_PASS=               App password (NOT your Gmail password)

# Studio
STUDIO_EMAIL=you@studio.com     Who receives editor briefs
STUDIO_NAME=Your Studio Name    Appears in all emails

# App
PORT=3000
BASE_URL=https://yourapp.com    Important: set this to your deployed URL
ADMIN_SECRET=                   Strong secret for admin access
```

---

## Getting Dropbox Credentials

### 1. Create a Dropbox App

1. Go to [https://www.dropbox.com/developers/apps](https://www.dropbox.com/developers/apps)
2. Click **Create app**
3. Choose **Scoped access** → **Full Dropbox** (or **App folder** if you prefer)
4. Name it anything (e.g. "ReadyProof")
5. Copy your **App key** and **App secret** into `.env`

### 2. Set Required Permissions

In your app's **Permissions** tab, enable:
- `files.metadata.read`
- `files.content.read`
- `sharing.read`

### 3. Get a Refresh Token (one-time setup)

Run this in your terminal (replace with your actual app key/secret):

```bash
# Step 1 — get an auth code
open "https://www.dropbox.com/oauth2/authorize?client_id=YOUR_APP_KEY&response_type=code&token_access_type=offline"
```

Authorize it, copy the code shown, then:

```bash
# Step 2 — exchange for refresh token
curl -X POST https://api.dropbox.com/oauth2/token \
  -u "YOUR_APP_KEY:YOUR_APP_SECRET" \
  -d "code=YOUR_AUTH_CODE&grant_type=authorization_code"
```

Copy the `refresh_token` from the response into your `.env`.

---

## Gmail App Password (SMTP)

If using Gmail:
1. Go to your Google Account → Security → 2-Step Verification → **App passwords**
2. Create one for "Mail" on "Other" (name it ReadyProof)
3. Use the 16-character password as `SMTP_PASS`

Other providers (SendGrid, Mailgun, Postmark) also work — just update `SMTP_HOST`/`SMTP_PORT`.

---

## Usage

### Creating a Session

1. Book a session and upload images to Dropbox as usual
2. Create a Dropbox **shared folder link** for the client's folder
3. In the Admin dashboard, click **+ New Session**
4. Enter client name, email, the Dropbox link, and optional package info
5. Click **Send Gallery Link** to email the client their magic link

### The Client Experience

1. Client opens their unique link (no account needed)
2. They browse their gallery, heart favorites, select final picks, add notes
3. Changes auto-save as they go
4. When done, they click **Submit Final Selection**
5. They receive a confirmation email; your admin view updates to "Selection Ready"

### Sending to the Editor

1. When a session shows **Selection Ready**, open the admin dashboard
2. Click **View Brief** to preview the file list and notes
3. Click **Send Editor Brief** — the editor receives a formatted email with:
   - Client name and package info
   - Numbered list of all selected filenames (e.g. `IMG_1234.CR2`)
   - ★ marking for favorites
   - Any client notes per image
4. Click **Mark Complete** when editing is done

---

## Deployment

### Option A — Railway (Recommended, free tier)

1. Push code to GitHub
2. Connect repo at [railway.app](https://railway.app)
3. Add all env variables in Railway's Variables tab
4. Set `BASE_URL` to your Railway URL
5. Deploy — done

The SQLite database persists on Railway's volume automatically.

### Option B — Render

Same process as Railway. Use a **Web Service** with start command `npm start`. Add a persistent disk mounted at `/opt/render/project/src` to persist the SQLite file.

### Option C — VPS (DigitalOcean, Linode, etc.)

```bash
git clone <your-repo>
cd readyproof
npm install --production
# Install PM2 for process management
npm install -g pm2
pm2 start server.js --name readyproof
pm2 save
```

Use nginx as a reverse proxy for port 80/443 + SSL.

---

## File Structure

```
readyproof/
├── server.js          Main Express server + all routes
├── db.js              SQLite schema + prepared queries
├── dropbox.js         Dropbox API helpers
├── email.js           Nodemailer email templates
├── readyproof.db      Auto-created SQLite database
├── .env               Your environment config (not committed)
├── .env.example       Template
├── package.json
└── public/
    ├── gallery.html   Client-facing gallery UI
    └── admin.html     Studio admin dashboard
```

---

## Tips

- **Temporary links** from Dropbox expire after ~4 hours. If a client leaves the page open overnight, they'll need to refresh. The app has a `/refresh-link` endpoint for this.
- **RAW files** (CR2, NEF, ARW etc.) appear as a dark placeholder tile in the gallery — they can't be previewed in a browser. But they show up in the selection list and editor brief correctly.
- **Package limits** — if a client selects more than their included amount, the gallery shows a warning. This is informational only (you handle billing).
- The admin secret is stored in `sessionStorage` so you stay logged in for the browser session.

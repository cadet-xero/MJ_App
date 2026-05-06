# Deploy On Render (Public Domain)

This app is ready to deploy on Render as a public web service.
This guide is configured for **Render Free tier** (no persistent disk).

## 1. Push to GitHub

1. Create a new GitHub repository.
2. Commit and push this project.
3. Confirm these files exist in repo root:
   - `server.js`
   - `package.json`
   - `render.yaml`
   - `public/`

## 2. Create Render Service

1. Sign in to Render.
2. Click **New** -> **Blueprint**.
3. Connect your GitHub repo.
4. Render will detect `render.yaml`.
5. Click **Apply**.

This creates:
- A Node web service on the Free plan

## 3. Verify Environment

In Render service settings, confirm:
- `NODE_ENV=production`

This is already defined in `render.yaml`, but verify after first deploy.

## 4. First Smoke Test

After deploy is green:
1. Open the Render URL.
2. Record, analyze, save score, open rankings.
3. Check health endpoint:
   - `https://<your-app>.onrender.com/health`

Expected JSON:
- `ok: true`
- `storeReady: true`
- `referenceReady: true`

## 5. Add Custom Domain

1. In Render -> Service -> **Settings** -> **Custom Domains**.
2. Add your domain/subdomain.
3. Add DNS records from your domain provider.
4. Enable WHOIS privacy at your registrar to protect personal identity details.

## 6. Notes

- This setup does not use your home server/IP.
- Static assets are served from `public/` only.
- Server code and database files are not web-exposed.
- On Free tier, the filesystem is ephemeral.
- Leaderboard data may reset on redeploy/restart/spin-down wake cycles.
- Free web services can spin down when idle, so first request after idle may be slower.

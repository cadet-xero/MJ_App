# Deploy On Render (Paid + Persistent Leaderboard)

This guide configures your app on Render so:
- It does not sleep (paid plan)
- Leaderboard data persists across deploys/restarts (persistent disk)

## 1. Push to GitHub

1. Create or use your GitHub repository.
2. Commit and push this project.
3. Confirm these files exist in repo root:
   - `server.js`
   - `package.json`
   - `render.yaml`
   - `public/`

## 2. Create/Update Render Service

1. In Render, click **New** -> **Blueprint**.
2. Connect your GitHub repo.
3. Render will read `render.yaml`.
4. Click **Apply**.

Current blueprint values:
- `plan: starter`
- persistent disk mounted at `/var/data`
- `SCORE_DATA_DIR=/var/data`

## 3. Verify Health

After deploy is green, open:
- `https://<your-app>.onrender.com/health`

Expected fields:
- `ok: true`
- `storeReady: true`
- `referenceReady: true`
- `storePath: "/var/data/leaderboard.json"`

## 4. Smoke Test

1. Open the site.
2. Record and save a score.
3. Open rankings and confirm the new entry appears.
4. Trigger a manual deploy in Render.
5. Open rankings again and confirm prior data is still there.

## 5. Custom Domain

1. Render -> Service -> **Settings** -> **Custom Domains**.
2. Add domain/subdomain.
3. Add DNS records at your registrar.
4. Keep WHOIS privacy enabled at registrar.

## 6. Notes

- Persistent disk keeps file data under `/var/data` only.
- Data outside disk mount remains ephemeral.
- Disk-attached services run as a single instance.
- With paid plan + disk, this app no longer depends on free-tier sleep behavior.
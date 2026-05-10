# HeeHee Score App

This app uses a backend server so leaderboard save/view works reliably and scores are computed server-side.

## Run

```powershell
npm install
npm start
```

Open: `http://localhost:8080`

Frontend files are served from `public/` only.

## Server-side API

- `POST /api/submit-score`: receives name + recorded audio, computes score on the server, stores result in persistent file storage.
- `GET /api/leaderboard`: returns top performers.
- `POST /api/analyze-score`: computes score on server before save.

Storage details:
- Uses JSON file storage at `SCORE_DATA_DIR/leaderboard.json`
- If `SCORE_DATA_DIR` is not set, defaults to local `./data/`

## Security posture

- Score is calculated on the server from uploaded audio, so clients cannot directly submit arbitrary score values.
- API endpoints are rate-limited.
- Static hosting is locked to `public/`, so server code/store and local paths are not publicly served.
- Upload type and size are validated server-side.

For public launch, add:

- Optional: CAPTCHA verification on `submit-score` if abuse becomes a problem.
- Stricter abuse controls (IP/device limits, bot detection).

## Recommended hosting

Good options:

- Render (simple Node deploy + persistent disk or managed DB)
- Railway (easy Node deploy + managed DB)
- Fly.io (more control, global regions)

Render deployment guide for this project:

- `DEPLOY_RENDER.md`

## Paid Render mode (recommended)

This repo is now configured for paid Render Starter + persistent disk:
- No free-tier sleep behavior
- Leaderboard persists across deploy/restart

Health check example:
- `/health` returns `storeReady: true` and `storePath` (expected `/var/data/leaderboard.json` on Render)

Privacy tips:

- Use domain WHOIS privacy.
- Never host from your home IP.
- Keep `.env`, `data/`, and `node_modules/` out of git (already covered by `.gitignore`).
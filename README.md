# HeeHee Score App

This app now uses a backend server so leaderboard save/view works reliably and scores are computed server-side.

## Run

```powershell
npm install
npm start
```

Open: `http://localhost:8080`

Frontend files are served from `public/` only.

## Server-side API

- `POST /api/submit-score`: receives name + recorded audio, computes score on the server, stores result in memory.
- `GET /api/leaderboard`: returns top performers.
- `POST /api/analyze-score`: computes score on server before save.

On the current free-tier setup, leaderboard storage is in-memory (ephemeral).

## Security posture

- Score is calculated on the server from uploaded audio, so clients cannot directly submit arbitrary score values.
- API endpoints are rate-limited.
- Static hosting is locked to `public/`, so server code/DB and local paths are not publicly served.
- Upload type and size are validated server-side.

For public launch, add:

- Optional: CAPTCHA verification on `submit-score` if abuse becomes a problem.
- Stricter abuse controls (IP/device limits, bot detection).

## Recommended public hosting

Good options:

- Render (simple Node deploy + managed Postgres)
- Railway (easy Node deploy + managed DB)
- Fly.io (more control, global regions)

Render quick-start guide for this project:

- `DEPLOY_RENDER.md`

Free-tier note:

- Current `render.yaml` is configured for Render Free plan (no persistent disk), so leaderboard data can reset.

Privacy tips:

- Use domain WHOIS privacy.
- Never host from your home IP.
- Keep `.env`, `data/`, and `node_modules/` out of git (already covered by `.gitignore`).

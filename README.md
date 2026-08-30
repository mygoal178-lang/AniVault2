# AniVault

Anime streaming platform: discover anime, watch episodes, manage watchlist, and track history.

## Run locally

**Prerequisites:** Node.js 18+

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy environment variables:
   ```bash
   cp .env.example .env.local
   ```
   Fill in Supabase values (see `.env.example`).
3. Run:
   ```bash
   npm run dev
   ```

## Production smoke test

After deployment, verify in order:

1. `/api/health`
2. `/api/db/health`
3. AniList search / top endpoints
4. Admin anime import
5. Anime details + watch page
6. Watchlist + Recently Updated

The app treats **MAL ID** as the canonical public/database ID and keeps AniList native ID separate.

## Deploy (Vercel)

See `VERCEL_DEPLOY.md` and `FINAL_DEPLOY_CHECKLIST.md`.

Required environment variables:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (server-only, never prefix with `VITE_`)

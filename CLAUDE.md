# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm install       # install dependencies
pnpm dev           # ts-node-dev, auto-reload dev server on $PORT (default 3000)
pnpm build         # tsc -> dist/
pnpm start         # run compiled dist/server.js

docker compose up -d --build   # rebuild and run app + Cloudflare tunnel; app on host port 3002
docker compose logs -f tips    # tail app logs
```

There is no test suite, linter, or CI config in this repo.

**After any change to `src/server.ts` or `public/`, rebuild the container** (`docker compose up -d --build`) before testing — the compose stack runs the built image, not a live-reloading dev server.

**Check `Dockerfile` against `package.json`/`docker-compose.yml` on every change** — e.g. new env vars need adding to both `docker-compose.yml`'s `environment:` block and `.env.example`; new dependencies need a `pnpm-lock.yaml` regeneration (`pnpm install --lockfile-only`) since the Dockerfile's `COPY package.json pnpm-lock.yaml ./` + `pnpm install` step will fail or drift silently otherwise.

## Architecture

Single Express + TypeScript server (`src/server.ts`) with two responsibilities that share one HTTP server instance: serving the static frontend (`public/`) and running a `ws` WebSocket server for real-time overlay updates. There is no database — the only state is the in-memory `Set` of connected WebSocket clients.

**Donation flow:**
1. `public/index.html` (Thai-localized form) posts to `POST /api/create-payment`, which creates a Stripe Checkout Session (THB, dynamic payment methods — PromptPay/card are configured in the Stripe Dashboard, not hardcoded in code) and returns the session URL for redirect.
2. Stripe calls `POST /stripe-webhook` on `payment_intent.succeeded`. **This route is registered before `app.use(express.json())`** and uses `express.raw()` itself — this ordering is load-bearing: if the global JSON parser ran first it would consume the raw body Stripe's signature verification needs, and the webhook would always 400.
3. The webhook handler synthesizes speech for the donation message via `synthesizeSpeech()` (Google Translate's unofficial `translate_tts` endpoint — free, no API key, ~200-char chunking, base64 mp3 returned), then `broadcast()`s a `{ type: 'donation', donation: {...} }` message to every connected WebSocket client.
4. `public/overlay.html` (added as an OBS Browser Source) holds the WebSocket connection, queues incoming donation alerts (`AlertQueue`, shrinking display duration as the queue backs up), and on each alert: plays a synthesized "ding" via Web Audio API, renders a generated SVG initial-avatar (no image assets), shows the message, and plays the TTS audio — falling back to the browser's `SpeechSynthesisUtterance` API if `audioContent` is null (e.g. TTS fetch failed).
5. `POST /test-donation` broadcasts a fake donation (optionally with a custom `nickname`/`message` in the body) without touching Stripe — the fastest way to test the overlay end-to-end.

**Local webhook testing:** `stripe listen --forward-to localhost:3002/stripe-webhook` (Stripe CLI) prints a `whsec_...` to put in `STRIPE_WEBHOOK_SECRET` — no public URL needed for dev.

**Public exposure without a VPS:** the `cloudflared` service in `docker-compose.yml` runs a Cloudflare Quick Tunnel pointed at the `tips` container; the public URL is printed in its logs and changes on every restart (it's not a named/domain-bound tunnel).

**OBS gotcha:** the Browser Source's *Shutdown source when not visible* and *Refresh browser when scene becomes active* must be unchecked, or OBS repeatedly reloads the overlay page and drops its WebSocket connection between scene switches — donation events fired during a reload are lost (no replay/buffering on reconnect).

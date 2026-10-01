# GET LEADS

Solana Web3-gated B2B lead sourcing app. Describe a business, verify a SOL payment on-chain, and source matching B2B leads with personalized outreach templates — all powered by live search grounding.

## Features

- **Campaign wizard** with inline validation (business name, niche, location required;
  website must be a full http(s) URL) — no more cryptic failures from bad input.
- **Saved searches** — save any wizard configuration and reload it in one click
  (stored in `localStorage`, up to 25).
- **Lead dashboard** — search across company/contact/email/domain, filter by status,
  sort by warmth / company / status; 3-tier warmth badges (hot ≥ 85, warm ≥ 65, cold).
- **Automatic deduplication** — duplicate companies/domains are removed before a
  campaign is saved (see `src/lib/leads.js`).
- **CSV export** via Blob download (Excel-friendly BOM) — safe for 10k-lead campaigns.
- **Keyless mode** — header badge shows `Keyless` vs `AI Live` at a glance; without a
  key you still get the Sample Campaign, campaign manager, and a downloadable
  **Manual Prospecting Kit** (ready-made Google search queries for your niche/location).
- **Honest error states** — Gemini failures are classified (invalid key, rate limit,
  permission denied, network, bad response) into plain-language messages; client
  errors (400/401/403) fail fast instead of retrying five times.

## Stack

- React 18 + Vite
- Tailwind CSS
- lucide-react icons

## Getting started

```bash
npm install
npm run dev
```

The app reads/writes campaigns and your profile from `localStorage`, fetches the live SOL price from CoinGecko, and verifies payments directly against Solana Mainnet RPC.

## Configuration

- `VITE_GEMINI_API_KEY` (build-time env var, documented in `.env.example`) — **optional**.
  Without it, the app runs keyless: the welcome screen, free Sample Campaign,
  campaign manager, CSV export, payment verification flow, and session-recovery
  scan all work client-side. Live AI lead generation (Gemini 2.5 Flash + Google
  Search grounding) shows a clear "key missing" message instead of failing
  cryptically — add the key to `.env`, rebuild, and redeploy to enable it.
- `MERCHANT_SOL_ADDRESS` in `src/App.jsx` — the wallet that receives SOL payments
  (default is the owner's address; change it to yours if you self-host this).
- Free-access bypass for testing: set "Your Solana Wallet Address" in the
  Personalization Profile to `1` and payment verification is skipped (no SOL
  leaves your wallet).

> Note: this app calls the Gemini `generativelanguage` API from the browser. For production, proxy these calls through a backend so the API key is never exposed client-side.

## Payment verification (how it works)

1. Send the quoted SOL amount to `MERCHANT_SOL_ADDRESS` from your own wallet.
2. Paste the transaction signature in the app.
3. The app reads the transaction from Solana Mainnet RPC and checks: the sender
   matches your profile wallet, the merchant received at least the quoted SOL,
   and the signature hasn't already been claimed by another browser session.

Transaction signatures are locked to a per-browser session token in `localStorage`
as a light anti-reuse measure. If you lose your browser data, use **Scan & Restore
Campaigns** on the welcome screen — the app scans your wallet's recent on-chain
history for a qualifying merchant payment and re-binds it to the new session.

## Build

```bash
npm install
npm run build   # outputs dist/
```

## Tests

Pure logic (dedupe, validation, error classification, prospecting kit, CSV helpers)
lives in `src/lib/leads.js` and is covered by a node assertion suite:

```bash
npm test   # runs scripts/test-helpers.mjs
```

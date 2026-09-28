# GET LEADS

Solana Web3-gated B2B lead sourcing app. Describe a business, verify a SOL payment on-chain, and source matching B2B leads with personalized outreach templates — all powered by live search grounding.

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

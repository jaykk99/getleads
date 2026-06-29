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

- `MERCHANT_SOL_ADDRESS` in `src/App.jsx` — the wallet that receives payments.
- The Gemini API key is injected at runtime (`apiKey` in `src/App.jsx`).

> Note: this app calls the Gemini `generativelanguage` API from the browser. For production, proxy these calls through a backend so the API key is never exposed client-side.

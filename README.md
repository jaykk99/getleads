# GET LEADS

Live: https://project-d3cxp.vercel.app (currently returns 402 — the Vercel
team is paused; the code builds and runs clean locally)

Solana Web3-gated B2B lead sourcing app. Describe a business, verify a SOL payment on-chain, and source matching B2B leads with personalized outreach templates — all powered by live search grounding.

## Features

- **Campaign wizard** with inline validation (business name, niche, location required;
  website must be a full http(s) URL) — no more cryptic failures from bad input.
- **Saved searches** — save any wizard configuration and reload it in one click
  (stored in `localStorage`, up to 25).
- **Lead dashboard** — search across company/contact/email/domain, filter by status,
  sort by warmth / company / status; 3-tier warmth badges (hot ≥ 85, warm ≥ 65, cold).
- **Automatic deduplication** — duplicate companies/domains are removed before a
  campaign is saved (see `src/lib/leads.js`). The dedupe is fuzzy: near-duplicate
  company names with no website ("Acme Dental" vs "Acme Dentals") are merged when
  their normalized similarity is >= 0.85.
- **CSV export** via Blob download (Excel-friendly BOM) — safe for 10k-lead campaigns.
- **CSV import** — bring your own list: paste CSV or upload a file from the
  dashboard, preview how rows map (with duplicates and skips listed), then import
  as a new campaign. See "CSV import format" below.
- **Batch actions** — select multiple leads (checkboxes), apply one status to all,
  or delete them in one go. The selection follows the current search/filter/sort.
- **Data-quality scoring** — every lead gets a 0–100 completeness score (grade
  A–F, hover for missing fields) plus a sortable "Data Quality" column; the
  dashboard metrics bar shows the campaign average.
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

## CSV import format

The import recognizes these columns (case-insensitive, any order, extra columns
are ignored):

| Column | Maps to | Notes |
|---|---|---|
| Company / Business Name | Company name | **Required** — rows without one are skipped |
| Website / URL / Domain | Website | Must be a full `http(s)` URL; invalid values are dropped |
| Contact Name / Decision Maker | Contact name | |
| Contact Title / Role | Contact title | |
| Email | Email | Must look like an email; invalid values are dropped |
| Phone / Tel / Mobile | Phone | |
| Score / Warmth | Warmth score | Clamped to 1–100; defaults to 50 when missing |
| Reason / Lead Reason | Match reason | |
| Notes | Notes | |
| Source / Source URL | Source URL | |
| Status | Status | Defaults to `New` |

Example:

```csv
Company,Website,Contact Name,Email,Phone,Score
Acme Dental,https://acme.com,Jane Smith,jane@acme.com,204-555-0100,92
Beta Roofing,,Bob,bob@beta.com,,60
```

Duplicates are removed with the same fuzzy dedupe used on AI-generated
campaigns, and the preview modal reports rows read, importable rows, skipped
rows, and duplicates removed before anything is saved.

## Data-quality scoring

`scoreLeadCompleteness()` in `src/lib/leads.js` scores how complete/actionable
a lead record is (not AI fit):

| Field | Weight |
|---|---|
| Contact name | 18 |
| Email | 20 |
| Company name | 15 |
| Website | 12 |
| Phone | 12 |
| Contact title | 10 |
| Match reason | 8 |
| Source URL | 5 |

Total 0–100 → grade A (90+) / B (75+) / C (55+) / D (35+) / F. Hovering a lead's
`Data:` badge lists the missing fields for that row.

## Tests

Pure logic (dedupe + fuzzy dedupe, validation, error classification, prospecting
kit, CSV helpers, CSV import, scoring) lives in `src/lib/leads.js` and is
covered by a node assertion suite:

```bash
npm test   # runs scripts/test-helpers.mjs
```

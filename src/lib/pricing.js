// Lead-tier pricing + Solana payment-tier matching.
// Pure helpers; no DOM, no React — safe to unit test with plain node.
//
// Tier prices are in USD. The SOL amount a tier costs is derived from the
// LIVE solPriceUSD the app fetches (CoinGecko, with a fallback), never from
// hardcoded SOL thresholds — a hardcoded threshold silently undercharges
// whenever the SOL price moves (e.g. 1.5 SOL was ~$660 at $440/SOL but is
// only ~$223 at $148/SOL, so the old recovery code granted the $660 tier
// for a $223 payment).

/** USD price per lead tier, keyed by the tier's lead count. */
export const TIER_PRICES_USD = {
  15: 1.0,
  150: 10.0,
  1500: 100.0,
  10000: 660.0,
};

/** Tier keys in ascending price order. */
export const TIER_KEYS = ["15", "150", "1500", "10000"];

/** USD price of a lead tier (defaults to the cheapest tier). */
export function getTierPriceUSD(tier) {
  return TIER_PRICES_USD[String(tier)] ?? TIER_PRICES_USD["15"];
}

/** SOL a tier costs at the given live SOL price (USD per SOL). */
export function tierPriceSOL(tier, solPriceUSD) {
  const price = Number(solPriceUSD);
  if (!Number.isFinite(price) || price <= 0) return Infinity;
  return getTierPriceUSD(tier) / price;
}

/**
 * Highest lead tier a SOL payment actually covers at the live price.
 * Returns the tier key ("15" | "150" | "1500" | "10000"), or null when the
 * payment does not cover even the cheapest ($1) tier.
 */
export function tierForSolAmount(solTransferred, solPriceUSD) {
  const sol = Number(solTransferred);
  const price = Number(solPriceUSD);
  if (!Number.isFinite(sol) || !Number.isFinite(price) || sol <= 0 || price <= 0) return null;
  const usd = sol * price;
  let best = null;
  for (const key of TIER_KEYS) {
    if (usd >= TIER_PRICES_USD[key]) best = key;
  }
  return best;
}

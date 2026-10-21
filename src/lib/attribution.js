// Lead source attribution.
// Normalizes the "where did this lead come from?" story: attribute a source
// from a URL or free text, and roll up per-campaign source breakdowns for
// the performance dashboard.

/** Known source patterns: [regex, canonical source name]. */
const SOURCE_PATTERNS = [
  [/linkedin\.com/i, "LinkedIn"],
  [/maps\.google|google\.com\/maps/i, "Google Maps"],
  [/google\.com\/search|google\.search/i, "Google Search"],
  [/yelp\.com/i, "Yelp"],
  [/yellowpages|yp\.com/i, "Yellow Pages"],
  [/facebook\.com/i, "Facebook"],
  [/instagram\.com/i, "Instagram"],
  [/twitter\.com|x\.com/i, "X / Twitter"],
  [/crunchbase\.com/i, "Crunchbase"],
  [/angel\.co|wellfound\.com/i, "Wellfound"],
  [/indeed\.com|linkedin\.com\/jobs|glassdoor/i, "Job boards"],
  [/csv|spreadsheet|import/i, "CSV import"],
  [/manual|hand|prospect/i, "Manual prospecting"],
  [/referral|referred/i, "Referral"],
  [/gemini|ai generated|ai-generated/i, "AI generated"],
  [/apollo\.io/i, "Apollo"],
  [/hunter\.io/i, "Hunter"],
  [/zoominfo/i, "ZoomInfo"],
];

export const UNKNOWN_SOURCE = "Unknown";

/**
 * Attribute a source from a URL or free-text note.
 * Returns the canonical source name or "Unknown".
 */
export function attributeSource(raw) {
  const v = String(raw || "").trim();
  if (!v) return UNKNOWN_SOURCE;
  for (const [re, name] of SOURCE_PATTERNS) {
    if (re.test(v)) return name;
  }
  return UNKNOWN_SOURCE;
}

/**
 * Best-effort source for a lead: explicit `source` field wins, then
 * sourcedFromUrl, then any sourceNote text.
 */
export function leadSource(lead) {
  if (!lead) return UNKNOWN_SOURCE;
  const explicit = String(lead.source || "").trim();
  if (explicit) return explicit;
  const fromUrl = attributeSource(lead.sourcedFromUrl);
  if (fromUrl !== UNKNOWN_SOURCE) return fromUrl;
  return attributeSource(lead.sourceNote);
}

/** Normalize a lead's source field in place (returns a new object). */
export function normalizeLeadSource(lead) {
  if (!lead) return lead;
  return { ...lead, source: leadSource(lead) };
}

/**
 * Count leads per source across a list.
 * Returns [{ source, count, pct }] sorted by count desc.
 */
export function sourceBreakdown(leads) {
  const counts = new Map();
  const list = leads || [];
  for (const lead of list) {
    const s = leadSource(lead);
    counts.set(s, (counts.get(s) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([source, count]) => ({
      source,
      count,
      pct: list.length ? Math.round((count / list.length) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count);
}

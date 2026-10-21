// Lead tagging: bulk add/remove of tags across selected leads.
// Tags are free-form short labels stored on lead.tags (array of strings).
// Pure functions; no DOM, no React.

/** Normalize a tag: lowercase, trimmed, spaces -> dashes, max 40 chars. */
export function normalizeTag(tag) {
  const v = String(tag || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-_]/g, "")
    .slice(0, 40);
  return v;
}

/** Normalize a list of raw tags, dropping empties and duplicates. */
export function normalizeTags(tags) {
  const seen = new Set();
  const out = [];
  for (const t of tags || []) {
    const n = normalizeTag(t);
    if (n && !seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  return out;
}

/** Add tags to a lead (returns a new object; no duplicates). */
export function addTagsToLead(lead, tags) {
  const current = Array.isArray(lead?.tags) ? lead.tags : [];
  const merged = normalizeTags([...current, ...normalizeTags(tags)]);
  return { ...(lead || {}), tags: merged };
}

/** Remove tags from a lead (returns a new object). */
export function removeTagsFromLead(lead, tags) {
  const drop = new Set(normalizeTags(tags));
  const current = Array.isArray(lead?.tags) ? lead.tags : [];
  return { ...(lead || {}), tags: current.filter((t) => !drop.has(normalizeTag(t))) };
}

/**
 * Bulk add tags to the leads whose ids are in `ids`.
 * Returns { leads, updated } (new array; untouched leads keep identity).
 */
export function bulkAddTags(leads, ids, tags) {
  const want = new Set(ids || []);
  const add = normalizeTags(tags);
  let updated = 0;
  const out = (leads || []).map((lead) => {
    if (!want.has(lead?.id)) return lead;
    updated += 1;
    return addTagsToLead(lead, add);
  });
  return { leads: out, updated };
}

/** Bulk remove tags. Returns { leads, updated }. */
export function bulkRemoveTags(leads, ids, tags) {
  const want = new Set(ids || []);
  const drop = normalizeTags(tags);
  let updated = 0;
  const out = (leads || []).map((lead) => {
    if (!want.has(lead?.id)) return lead;
    updated += 1;
    return removeTagsFromLead(lead, drop);
  });
  return { leads: out, updated };
}

/**
 * All tags in use across a lead list, with counts.
 * Returns [{ tag, count }] sorted by count desc.
 */
export function allTags(leads) {
  const counts = new Map();
  for (const lead of leads || []) {
    for (const t of lead?.tags || []) {
      const n = normalizeTag(t);
      if (n) counts.set(n, (counts.get(n) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count);
}

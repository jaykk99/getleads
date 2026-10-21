// Blacklist / do-not-contact list.
// Pure helpers. Entries live in localStorage as an array of entry objects:
//
//   { id, type: "domain" | "email" | "name", value, reason, addedAt }
//
// Leads matching any entry are excluded from outreach drafts, imports, and
// batch actions.

import { normalizeDomain, normalizeCompanyName } from "./leads.js";

let blSeq = 0;

export function makeBlacklistId() {
  blSeq += 1;
  return `bl_${Date.now().toString(36)}_${blSeq}`;
}

/** Validate a blacklist entry draft. Returns error list (empty = ok). */
export function validateBlacklistEntry(draft) {
  const errors = [];
  if (!draft || typeof draft !== "object") return ["Entry data is missing."];
  const type = draft.type;
  if (!["domain", "email", "name"].includes(type)) {
    errors.push('Type must be "domain", "email", or "name".');
    return errors;
  }
  const value = String(draft.value || "").trim();
  if (!value) {
    errors.push("A value is required.");
    return errors;
  }
  if (type === "domain" && !normalizeDomain(value)) {
    errors.push("Domain does not look valid (e.g. example.com).");
  }
  if (type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    errors.push("Email address does not look valid.");
  }
  if (type === "name" && !normalizeCompanyName(value)) {
    errors.push("Company name is empty after normalization.");
  }
  return errors;
}

/** Create a normalized blacklist entry. Throws on invalid input. */
export function createBlacklistEntry(draft) {
  const errors = validateBlacklistEntry(draft || {});
  if (errors.length) throw new Error(errors[0]);
  const type = draft.type;
  const raw = String(draft.value).trim();
  const value = type === "domain" ? normalizeDomain(raw) : type === "email" ? raw.toLowerCase() : raw.trim();
  return {
    id: draft.id || makeBlacklistId(),
    type,
    value,
    reason: String(draft.reason || "").trim(),
    addedAt: new Date().toISOString(),
  };
}

/** Does this entry match the given lead? */
export function entryMatchesLead(entry, lead) {
  if (!entry || !lead) return false;
  if (entry.type === "domain") {
    const d = normalizeDomain(lead.website);
    if (d && d === entry.value) return true;
    // also match the lead's email domain (lead may lack a website)
    const email = String(lead.email || "").trim().toLowerCase();
    const at = email.lastIndexOf("@");
    if (at > 0 && email.slice(at + 1) === entry.value) return true;
    return false;
  }
  if (entry.type === "email") {
    return String(lead.email || "").trim().toLowerCase() === entry.value;
  }
  if (entry.type === "name") {
    const n = normalizeCompanyName(lead.companyName);
    return !!n && n === normalizeCompanyName(entry.value);
  }
  return false;
}

/**
 * Check a lead against the whole blacklist.
 * Returns { blacklisted: bool, matches: [entries] }.
 */
export function checkLeadBlacklist(lead, blacklist) {
  const matches = (blacklist || []).filter((e) => entryMatchesLead(e, lead));
  return { blacklisted: matches.length > 0, matches };
}

/**
 * Partition leads into { allowed, blocked } where blocked matched the
 * blacklist. Blocked entries carry a `blockedBy` field listing the
 * matched blacklist entry values.
 */
export function filterBlacklistedLeads(leads, blacklist) {
  const allowed = [];
  const blocked = [];
  for (const lead of leads || []) {
    const { blacklisted, matches } = checkLeadBlacklist(lead, blacklist);
    if (blacklisted) blocked.push({ ...lead, blockedBy: matches.map((m) => `${m.type}:${m.value}`) });
    else allowed.push(lead);
  }
  return { allowed, blocked };
}

/**
 * Check freshly imported leads against the blacklist.
 * Returns { allowed, blockedCount, notes } for the import report.
 */
export function checkImportAgainstBlacklist(leads, blacklist) {
  const { allowed, blocked } = filterBlacklistedLeads(leads, blacklist);
  const notes = blocked.map(
    (l) => `${l.companyName || "Unnamed lead"} blocked by ${l.blockedBy.join(", ")}.`
  );
  return { allowed, blockedCount: blocked.length, notes: notes.slice(0, 20) };
}

/** Add an entry, replacing any existing entry with the same type+value. */
export function upsertBlacklistEntry(blacklist, entry) {
  const rest = (blacklist || []).filter((e) => !(e.type === entry.type && e.value === entry.value));
  return [entry, ...rest];
}

/** Remove an entry by id. */
export function removeBlacklistEntry(blacklist, id) {
  return (blacklist || []).filter((e) => e.id !== id);
}

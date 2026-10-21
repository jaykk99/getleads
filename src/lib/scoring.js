// Lead warmth scoring engine.
// Scores how "warm" (engagement-ready) a lead is from observable signals:
// email validity, email domain signals, website domain quality, and social
// presence. This is a deterministic heuristic, not AI fit — it answers
// "can I actually reach this lead?" rather than "do they match the niche?".
// No DOM, no React — safe to unit test with plain node.

import { normalizeDomain } from "./leads.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Free / consumer mailbox providers: reachable, but a personal mailbox is a
// weaker buying signal than a corporate address on the lead's own domain.
const FREE_MAIL_PROVIDERS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.uk",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "msn.com",
  "aol.com",
  "icloud.com",
  "protonmail.com",
  "proton.me",
  "gmx.com",
  "zoho.com",
  "mail.com",
  "yandex.com",
]);

// Senior buying roles get a small bump: replies usually convert better.
const SENIOR_ROLE_RE =
  /\b(owner|founder|ceo|cto|cfo|coo|president|partner|director|vp|vice president|head of|manager|principal|managing)\b/i;

/**
 * Split an email into { local, domain }. Returns null when malformed.
 */
export function splitEmail(email) {
  const v = String(email || "").trim().toLowerCase();
  if (!EMAIL_RE.test(v)) return null;
  const at = v.lastIndexOf("@");
  return { local: v.slice(0, at), domain: v.slice(at + 1) };
}

/**
 * Grade an email domain for outreach quality.
 * Returns { kind, reason } where kind is:
 *  - "corporate": address on a real company domain
 *  - "free": consumer mailbox provider
 *  - "mismatch": corporate-sounding domain that doesn't match the lead's website
 *  - "invalid": no parseable domain
 */
export function gradeEmailDomain(email, leadWebsite) {
  const parts = splitEmail(email);
  if (!parts) return { kind: "invalid", reason: "Email address is malformed." };
  const { domain } = parts;
  if (FREE_MAIL_PROVIDERS.has(domain)) {
    return {
      kind: "free",
      reason: `Uses a free mailbox provider (${domain}) instead of a company domain.`,
    };
  }
  const leadDomain = normalizeDomain(leadWebsite);
  if (leadDomain && domain !== leadDomain) {
    return {
      kind: "mismatch",
      reason: `Email domain (${domain}) does not match the lead website (${leadDomain}) — possible alias or forwarded address.`,
    };
  }
  return { kind: "corporate", reason: `Corporate address on ${domain}.` };
}

/**
 * Grade website domain quality 0..30.
 * penalizes throwaway-looking domains (hyphens, digits, odd TLDs).
 */
export function scoreDomainQuality(website) {
  const domain = normalizeDomain(website);
  if (!domain) return { points: 0, reasons: ["No website on file."] };
  let points = 22;
  const reasons = [`Website present (${domain}).`];
  const tld = domain.split(".").pop();
  const PREMIUM_TLDS = new Set(["com", "io", "co", "net", "org", "ca", "us", "uk", "de", "au", "dev", "app"]);
  if (PREMIUM_TLDS.has(tld)) {
    points += 4;
    reasons.push(`Recognized commercial TLD (.${tld}).`);
  } else {
    points -= 3;
    reasons.push(`Unusual TLD (.${tld}) — slightly lower trust.`);
  }
  const label = domain.split(".")[0];
  if (/[-0-9]/.test(label)) {
    points -= 4;
    reasons.push("Domain label contains hyphens or digits — looks less established.");
  }
  if (label.length < 4 || label.length > 24) {
    points -= 2;
    reasons.push("Domain label length is unusual (very short or very long).");
  }
  return { points: Math.max(0, Math.min(30, points)), reasons };
}

/**
 * Score a lead's warmth 0..100 and explain every signal.
 *
 * Signals (weights sum to 100):
 *  - Email presence + validity ............ 25
 *  - Email domain kind .................... 15  (corporate > mismatch > free > invalid)
 *  - Website domain quality ............... 20
 *  - Social presence (LinkedIn / profiles) . 15
 *  - Decision-maker identity .............. 15  (name + title, seniority bump)
 *  - Phone ................................ 10
 *
 * Returns { score, tier, signals } where signals is a list of
 * { label, points, detail } rows shown in the UI breakdown.
 */
export function scoreLeadWarmth(lead) {
  const signals = [];
  const add = (label, points, detail) => signals.push({ label, points, detail });
  let score = 0;
  const l = lead || {};

  // --- Email presence + validity (25) -------------------------------------
  const emailParts = splitEmail(l.email);
  if (emailParts) {
    score += 25;
    add("Email", 25, `Valid email address: ${String(l.email).trim()}.`);
  } else if (String(l.email || "").trim()) {
    score += 5;
    add("Email", 5, "Email is present but malformed — likely unusable.");
  } else {
    add("Email", 0, "No email address — outreach limited to web forms or phone.");
  }

  // --- Email domain kind (15) ---------------------------------------------
  const grade = gradeEmailDomain(l.email, l.website);
  if (grade.kind === "corporate") {
    score += 15;
    add("Email domain", 15, grade.reason);
  } else if (grade.kind === "mismatch") {
    score += 8;
    add("Email domain", 8, grade.reason);
  } else if (grade.kind === "free") {
    score += 5;
    add("Email domain", 5, grade.reason);
  } else {
    add("Email domain", 0, grade.reason);
  }

  // --- Website domain quality (20 of the 30-scale) -------------------------
  const dq = scoreDomainQuality(l.website);
  const dqPoints = Math.round((dq.points / 30) * 20);
  score += dqPoints;
  add("Website", dqPoints, dq.reasons.join(" "));

  // --- Social presence (15) ------------------------------------------------
  const linkedin = String(l.linkedinUrl || "").trim();
  const profiles = Array.isArray(l.socialProfiles)
    ? l.socialProfiles.filter((s) => String(s || "").trim())
    : [];
  if (linkedin) {
    score += 10;
    add("LinkedIn", 10, "LinkedIn profile on file — direct outreach path.");
  } else {
    add("LinkedIn", 0, "No LinkedIn profile recorded.");
  }
  if (profiles.length) {
    const p = Math.min(5, profiles.length * 2);
    score += p;
    add("Other profiles", p, `${profiles.length} other social profile(s) recorded.`);
  } else {
    add("Other profiles", 0, "No other social profiles recorded.");
  }

  // --- Decision-maker identity (15) ----------------------------------------
  const name = String(l.contactName || "").trim();
  const title = String(l.contactTitle || "").trim();
  if (name && title) {
    score += 10;
    add("Contact", 10, `Decision maker identified: ${name} (${title}).`);
    if (SENIOR_ROLE_RE.test(title)) {
      score += 5;
      add("Seniority", 5, `Senior title ("${title}") — replies convert better.`);
    } else {
      add("Seniority", 0, `Title ("${title}") is not a senior buying role.`);
    }
  } else if (name || title) {
    score += 6;
    add("Contact", 6, "Partial contact identity (name or title only).");
    add("Seniority", 0, "Seniority unknown without a title.");
  } else {
    add("Contact", 0, "No decision maker identified.");
    add("Seniority", 0, "Seniority unknown without a title.");
  }

  // --- Phone (10) -----------------------------------------------------------
  const phone = String(l.phone || "").trim();
  if (phone) {
    score += 10;
    add("Phone", 10, "Phone number on file — second outreach channel.");
  } else {
    add("Phone", 0, "No phone number — email-only outreach.");
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, tier: warmthTier(score), signals };
}

/** Warmth band for a 0..100 warmth score. */
export function warmthTier(score) {
  const s = Number(score) || 0;
  if (s >= 75) return "Hot";
  if (s >= 50) return "Warm";
  if (s >= 25) return "Lukewarm";
  return "Cold";
}

/**
 * Warmth distribution across a campaign's leads.
 * Returns { hot, warm, lukewarm, cold, average }.
 */
export function campaignWarmthDistribution(leads) {
  const dist = { hot: 0, warm: 0, lukewarm: 0, cold: 0, average: 0 };
  if (!leads || !leads.length) return dist;
  let total = 0;
  for (const lead of leads) {
    const { score, tier } = scoreLeadWarmth(lead);
    total += score;
    if (tier === "Hot") dist.hot += 1;
    else if (tier === "Warm") dist.warm += 1;
    else if (tier === "Lukewarm") dist.lukewarm += 1;
    else dist.cold += 1;
  }
  dist.average = Math.round(total / leads.length);
  return dist;
}

/**
 * Rank leads by warmth, highest first. Does not mutate the input.
 * Returns [{ lead, score, tier, signals }] rows.
 */
export function rankLeadsByWarmth(leads) {
  return (leads || [])
    .map((lead) => ({ lead, ...scoreLeadWarmth(lead) }))
    .sort((a, b) => b.score - a.score);
}

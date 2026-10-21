// Pure, testable helpers for the Get Leads app.
// No DOM, no React — safe to unit test with plain node.

const COMPANY_SUFFIXES =
  /\b(inc|incorporated|llc|ltd|limited|corp|corporation|co|company|plc|gmbh|sarl|pty|group|holdings|solutions|services)\.?$/i;

/**
 * Normalize a website value to a bare domain: "www.example.com".
 * Returns "" for anything that doesn't look like a real domain.
 */
export function normalizeDomain(raw) {
  if (!raw || typeof raw !== "string") return "";
  let v = raw.trim().toLowerCase();
  v = v.replace(/^https?:\/\//, "").replace(/^www\./, "");
  v = v.split(/[/?#]/)[0];
  // must look like a domain: at least one dot, valid chars
  if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/.test(v)) return "";
  return v;
}

/** Normalize a company name for comparison: lowercased, punctuation stripped, suffixes dropped. */
export function normalizeCompanyName(name) {
  if (!name || typeof name !== "string") return "";
  let v = name.toLowerCase().trim();
  v = v.replace(/[&]/g, " and ");
  v = v.replace(/[^a-z0-9\s]/g, " ");
  v = v.replace(/\s+/g, " ").trim();
  v = v.replace(COMPANY_SUFFIXES, "").trim();
  return v;
}

/** Stable identity key for a lead: "domain" when available, else normalized name. */
export function leadKey(lead) {
  const domain = normalizeDomain(lead?.website);
  if (domain) return `d:${domain}`;
  return `n:${normalizeCompanyName(lead?.companyName)}`;
}

/**
 * Remove duplicate leads, keeping the first occurrence.
 * Two leads are duplicates if they share a website domain, or — when the
 * website is missing — the same normalized company name.
 * Returns { leads, removed }.
 */
export function dedupeLeads(leads) {
  const seen = new Set();
  const kept = [];
  let removed = 0;
  for (const lead of leads || []) {
    const key = leadKey(lead);
    if (!key || key === "n:") {
      removed += 1; // unnamed, unusable row
      continue;
    }
    if (seen.has(key)) {
      removed += 1;
      continue;
    }
    seen.add(key);
    kept.push(lead);
  }
  return { leads: kept, removed };
}

/** Light URL check for the optional website field. */
export function isValidWebsite(value) {
  if (!value || !value.trim()) return true; // optional
  const v = value.trim();
  if (!/^https?:\/\/.+/i.test(v)) return false;
  return normalizeDomain(v) !== "";
}

/**
 * Validate the campaign wizard form. Returns an object mapping field -> message;
 * empty object means valid.
 */
export function validateWizardForm(form) {
  const errors = {};
  const name = (form.businessName || "").trim();
  if (name.length < 2) {
    errors.businessName = "Enter your business name (at least 2 characters).";
  } else if (name.length > 120) {
    errors.businessName = "Business name is too long (max 120 characters).";
  }
  const industry = (form.targetIndustry || "").trim();
  if (industry.length < 2) {
    errors.targetIndustry = "Enter a target industry or niche (at least 2 characters).";
  } else if (industry.length > 120) {
    errors.targetIndustry = "Target industry is too long (max 120 characters).";
  }
  const location = (form.targetLocation || "").trim();
  if (location.length < 2) {
    errors.targetLocation = "Enter a target location (at least 2 characters).";
  } else if (location.length > 120) {
    errors.targetLocation = "Target location is too long (max 120 characters).";
  }
  if (!isValidWebsite(form.website)) {
    errors.website =
      "Website must be a full URL starting with http:// or https:// (e.g. https://example.com).";
  }
  const desc = (form.description || "").trim();
  if (desc.length > 2000) {
    errors.description = "Description is too long (max 2000 characters).";
  }
  return errors;
}

/**
 * Turn a raw Gemini/API failure into an honest, actionable message.
 */
export function classifyGeminiError(rawMessage) {
  const msg = String(rawMessage || "");
  if (/api key not valid|api_key_invalid|API_KEY_INVALID/i.test(msg)) {
    return "Your Gemini API key was rejected (invalid or disabled). Check VITE_GEMINI_API_KEY and rebuild — or use the free Sample Campaign while you fix it.";
  }
  if (/\b429\b|quota|exceeded|RESOURCE_EXHAUSTED/i.test(msg)) {
    return "Gemini rate limit hit (free-tier quota). Wait a minute and try again, or reduce the lead count. Your saved campaigns are untouched.";
  }
  if (/\b403\b|PERMISSION_DENIED/i.test(msg)) {
    return "Gemini refused the request (permission denied). Make sure the Generative Language API is enabled for this key in Google AI Studio.";
  }
  if (/network|fetch|failed to fetch|ENOTFOUND|ECONNREFUSED|timed out|timeout/i.test(msg)) {
    return "Network error reaching the Gemini API. Check your connection and try again.";
  }
  if (/No leads returned|invalid json|unexpected token/i.test(msg)) {
    return "Gemini returned an unusable response. Try again — narrowing the target industry usually fixes this.";
  }
  return msg || "An unexpected error occurred during lead generation.";
}

/**
 * Keyless manual prospecting kit: ready-made Google search queries built from
 * the campaign form so users can prospect by hand without an API key.
 * Returns rows of { query, url, purpose }.
 */
export function buildProspectingKit(form) {
  const niche = (form.targetIndustry || "businesses").trim();
  const location = (form.targetLocation || "").trim();
  const role = (form.targetRole || "owner").trim();
  const offer = (form.description || "").trim().slice(0, 80);
  const geo = location ? ` "${location}"` : "";
  const queries = [
    {
      purpose: "Find companies on LinkedIn",
      query: `site:linkedin.com/company ${niche}${geo}`,
    },
    {
      purpose: "Find decision makers on LinkedIn",
      query: `site:linkedin.com/in ${niche} ${role}${geo}`,
    },
    {
      purpose: "Find businesses via Google Maps listings",
      query: `${niche} near ${location || "your city"}`.trim(),
    },
    {
      purpose: "Find companies with contact pages",
      query: `"${niche}"${geo} "contact us" email`,
    },
    {
      purpose: "Find recently funded / growing targets",
      query: `"${niche}"${geo} (funding OR hiring OR expanding)`,
    },
    {
      purpose: "Find directories listing targets",
      query: `"${niche}"${geo} directory OR listing OR association`,
    },
    {
      purpose: "Find competitors' customers for conquesting",
      query: `"${niche}"${geo} reviews`,
    },
    {
      purpose: "Find targets talking about their pain points",
      query: `"${niche}"${geo} ("looking for" OR "need help with")`,
    },
  ];
  if (offer) {
    queries.push({
      purpose: "Match your offer to stated needs",
      query: `"${niche}"${geo} "${offer.split(" ").slice(0, 4).join(" ")}"`,
    });
  }
  return queries.map((q) => ({
    ...q,
    url: `https://www.google.com/search?q=${encodeURIComponent(q.query)}`,
  }));
}

/** Escape a single CSV cell. */
export function csvCell(value) {
  const v = String(value ?? "");
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

/* ==========================================================================
 * Lead scoring, CSV import, and fuzzy dedupe
 * ========================================================================== */

/**
 * Levenshtein edit distance between two strings (case already normalized by
 * callers). Iterative two-row implementation; O(a*b) time, O(min) space.
 */
export function levenshtein(a, b) {
  const s = String(a || "");
  const t = String(b || "");
  if (s === t) return 0;
  if (!s.length) return t.length;
  if (!t.length) return s.length;
  let prev = new Array(t.length + 1);
  let curr = new Array(t.length + 1);
  for (let j = 0; j <= t.length; j++) prev[j] = j;
  for (let i = 1; i <= s.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= t.length; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    const tmp = prev;
    prev = curr;
    curr = tmp;
  }
  return prev[t.length];
}

/**
 * Similarity ratio 0..1 between two strings, based on normalized names.
 * 1 = identical, 0 = completely different.
 */
export function nameSimilarity(a, b) {
  const na = normalizeCompanyName(a);
  const nb = normalizeCompanyName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const dist = levenshtein(na, nb);
  const longest = Math.max(na.length, nb.length);
  return 1 - dist / longest;
}

/**
 * Fuzzy duplicate removal.
 * Two leads are duplicates when they share a website domain (exact), or when
 * neither has a website and their normalized company names are similar enough
 * (similarity >= threshold). Keeps the first occurrence.
 *
 * This catches the near-dupes the exact dedupe misses: "Acme Dental" vs
 * "Acme Dental LLC" (suffix-stripped by normalization), typos like
 * "Acme Dnetal", and domain-less rows that only differ in punctuation.
 *
 * Returns { leads, removed, fuzzy } where fuzzy counts merges that the exact
 * dedupe would have kept.
 */
export function dedupeLeadsFuzzy(leads, threshold = 0.85) {
  const exact = dedupeLeads(leads);
  const kept = [];
  const keptKeys = [];
  let fuzzy = 0;
  for (const lead of exact.leads) {
    const domain = normalizeDomain(lead?.website);
    if (domain) {
      // domains are unique after the exact pass; no fuzzy name check needed
      kept.push(lead);
      keptKeys.push(null);
      continue;
    }
    const name = normalizeCompanyName(lead?.companyName);
    let isDup = false;
    for (const kn of keptKeys) {
      if (kn && nameSimilarity(name, kn) >= threshold) {
        isDup = true;
        break;
      }
    }
    if (isDup) {
      fuzzy += 1;
    } else {
      kept.push(lead);
      keptKeys.push(name);
    }
  }
  return { leads: kept, removed: exact.removed + fuzzy, fuzzy };
}

/* --------------------------------------------------------------------------
 * CSV import
 * -------------------------------------------------------------------------- */

/**
 * Robust CSV parser (RFC 4180-ish): handles quoted fields, escaped quotes
 * (""), commas inside quotes, and newlines inside quoted fields.
 * Returns an array of rows, each an array of cell strings. Trims a leading
 * BOM. Ignores fully-empty trailing rows.
 */
export function parseCSV(text) {
  const src = String(text || "").replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    // drop rows that are entirely empty
    if (row.length && !(row.length === 1 && row[0] === "")) rows.push(row);
    row = [];
  };
  while (i < src.length) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i += 1;
        }
      } else {
        field += c;
        i += 1;
      }
    } else if (c === '"') {
      inQuotes = true;
      i += 1;
    } else if (c === ",") {
      pushField();
      i += 1;
    } else if (c === "\r") {
      pushField();
      pushRow();
      i += src[i + 1] === "\n" ? 2 : 1;
    } else if (c === "\n") {
      pushField();
      pushRow();
      i += 1;
    } else {
      field += c;
      i += 1;
    }
  }
  pushField();
  pushRow();
  return rows;
}

/**
 * Common CSV column-name aliases, mapped to lead object fields.
 * Keys are lowercased, punctuation-stripped header names.
 */
const HEADER_ALIASES = {
  companyname: "companyName",
  company: "companyName",
  business: "companyName",
  businessname: "companyName",
  organization: "companyName",
  org: "companyName",
  website: "website",
  url: "website",
  domain: "website",
  site: "website",
  webpage: "website",
  contactname: "contactName",
  contact: "contactName",
  name: "contactName",
  decisionmaker: "contactName",
  owner: "contactName",
  contacttitle: "contactTitle",
  title: "contactTitle",
  jobtitle: "contactTitle",
  role: "contactTitle",
  position: "contactTitle",
  email: "email",
  emailaddress: "email",
  mail: "email",
  phone: "phone",
  phonenumber: "phone",
  tel: "phone",
  telephone: "phone",
  mobile: "phone",
  warmth: "warmthScore",
  warmthscore: "warmthScore",
  score: "warmthScore",
  fit: "warmthScore",
  leadreason: "leadReason",
  reason: "leadReason",
  whylead: "leadReason",
  notes: "notes",
  note: "notes",
  customhook: "customHook",
  hook: "customHook",
  icebreaker: "customHook",
  sourcedfromurl: "sourcedFromUrl",
  source: "sourcedFromUrl",
  sourceurl: "sourcedFromUrl",
  status: "status",
};

/** Map a header row (array of strings) to lead-field names. Unknown -> null. */
export function mapCsvHeaders(headers) {
  return (headers || []).map((h) => {
    const key = String(h || "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
    return HEADER_ALIASES[key] || null;
  });
}

/** Normalize one raw imported row into a lead object. Returns null if unusable. */
export function rowToLead(cells, mapping) {
  const lead = {};
  mapping.forEach((field, idx) => {
    if (!field) return;
    const v = (cells[idx] || "").trim();
    if (v) lead[field] = v;
  });
  if (!lead.companyName) return null;
  if (lead.website && !isValidWebsite(lead.website)) delete lead.website;
  if (lead.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email)) delete lead.email;
  if (lead.warmthScore != null) {
    const n = Number(lead.warmthScore);
    lead.warmthScore = Number.isFinite(n) ? Math.max(1, Math.min(100, Math.round(n))) : 50;
  } else {
    lead.warmthScore = 50; // unknown: neutral midpoint
  }
  if (!lead.status) lead.status = "New";
  return lead;
}

/**
 * Import leads from raw CSV text.
 *
 * Returns {
 *   leads: [...],        // sanitized, deduped lead objects ready to save
 *   parsed: n,           // data rows seen (header excluded)
 *   dropped: n,          // rows with no usable company name
 *   removedDuplicates: n,
 *   errors: [..],        // human-readable problem list (max 20)
 * }
 */
export function importLeadsFromCSV(text) {
  const rows = parseCSV(text);
  const errors = [];
  if (!rows.length) return { leads: [], parsed: 0, dropped: 0, removedDuplicates: 0, errors: ["No rows found in the CSV."] };
  const mapping = mapCsvHeaders(rows[0]);
  if (!mapping.some(Boolean)) {
    return {
      leads: [],
      parsed: 0,
      dropped: 0,
      removedDuplicates: 0,
      errors: ["Could not recognize any columns. Expected headers like Company, Website, Contact Name, Email, Phone."],
    };
  }
  const out = [];
  let dropped = 0;
  for (let r = 1; r < rows.length; r++) {
    const lead = rowToLead(rows[r], mapping);
    if (!lead) {
      dropped += 1;
      continue;
    }
    out.push(lead);
  }
  const { leads, removed } = dedupeLeadsFuzzy(out);
  if (dropped) errors.push(`${dropped} row(s) skipped: no company name.`);
  if (removed) errors.push(`${removed} duplicate row(s) removed.`);
  return {
    leads,
    parsed: rows.length - 1,
    dropped,
    removedDuplicates: removed,
    errors: errors.slice(0, 20),
  };
}

/* --------------------------------------------------------------------------
 * Lead data-quality scoring
 * -------------------------------------------------------------------------- */

/**
 * Score a lead's data completeness 0..100 and explain what's missing.
 * This is about the record quality (how actionable it is), not AI fit.
 *
 * Returns { score, grade, missing } where grade is A/B/C/D/F and missing
 * lists the empty high-value fields.
 */
export function scoreLeadCompleteness(lead) {
  const weights = [
    ["companyName", 15, "Company name"],
    ["website", 12, "Website"],
    ["contactName", 18, "Decision maker name"],
    ["contactTitle", 10, "Decision maker title"],
    ["email", 20, "Email"],
    ["phone", 12, "Phone"],
    ["leadReason", 8, "Match reason"],
    ["sourcedFromUrl", 5, "Source URL"],
  ];
  let score = 0;
  const missing = [];
  for (const [field, w, label] of weights) {
    if (lead && String(lead[field] || "").trim()) score += w;
    else missing.push(label);
  }
  const grade = score >= 90 ? "A" : score >= 75 ? "B" : score >= 55 ? "C" : score >= 35 ? "D" : "F";
  return { score, grade, missing };
}

/** Average completeness score across a campaign's leads (0..100). */
export function campaignDataQuality(leads) {
  if (!leads || !leads.length) return 0;
  const total = leads.reduce((acc, l) => acc + scoreLeadCompleteness(l).score, 0);
  return Math.round(total / leads.length);
}

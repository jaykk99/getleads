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

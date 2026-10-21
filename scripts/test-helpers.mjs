import assert from "node:assert/strict";
import {
  normalizeDomain,
  normalizeCompanyName,
  dedupeLeads,
  isValidWebsite,
  validateWizardForm,
  classifyGeminiError,
  buildProspectingKit,
  csvCell,
  levenshtein,
  nameSimilarity,
  dedupeLeadsFuzzy,
  parseCSV,
  mapCsvHeaders,
  rowToLead,
  importLeadsFromCSV,
  scoreLeadCompleteness,
  campaignDataQuality,
  findCrossCampaignDuplicates,
} from "../src/lib/leads.js";
import {
  splitEmail,
  gradeEmailDomain,
  scoreDomainQuality,
  scoreLeadWarmth,
  warmthTier,
  campaignWarmthDistribution,
  rankLeadsByWarmth,
} from "../src/lib/scoring.js";

// normalizeDomain
assert.equal(normalizeDomain("https://www.Acme.com/about"), "acme.com");
assert.equal(normalizeDomain("http://acme.com"), "acme.com");
assert.equal(normalizeDomain("acme.com"), "acme.com");
assert.equal(normalizeDomain("not a domain"), "");
assert.equal(normalizeDomain(""), "");
assert.equal(normalizeDomain("https://example"), "");

// normalizeCompanyName
assert.equal(normalizeCompanyName("Acme Inc."), "acme");
assert.equal(normalizeCompanyName("ACME LLC"), "acme");
assert.equal(normalizeCompanyName("Beta & Sons Co"), "beta and sons");

// dedupeLeads: same domain -> dup; same name no website -> dup; unique kept
const res = dedupeLeads([
  { companyName: "Acme Inc", website: "https://acme.com" },
  { companyName: "Acme Corporation", website: "http://www.acme.com/" },
  { companyName: "Beta LLC", website: "" },
  { companyName: "Beta Ltd", website: "" },
  { companyName: "Gamma", website: "https://gamma.io" },
  { companyName: "", website: "" },
]);
assert.equal(res.leads.length, 3);
assert.equal(res.removed, 3);

// isValidWebsite
assert.equal(isValidWebsite(""), true);
assert.equal(isValidWebsite("https://example.com"), true);
assert.equal(isValidWebsite("example.com"), false);
assert.equal(isValidWebsite("notaurl"), false);

// validateWizardForm
assert.deepEqual(validateWizardForm({ businessName: "Acme", targetIndustry: "SaaS", targetLocation: "Austin" }), {});
const errs = validateWizardForm({ businessName: "x", targetIndustry: "", targetLocation: "  ", website: "badurl" });
assert.ok(errs.businessName && errs.targetIndustry && errs.targetLocation && errs.website);
assert.equal(validateWizardForm({ businessName: "Acme", targetIndustry: "SaaS", targetLocation: "TX", description: "z".repeat(2001) }).description.includes("2000"), true);

// classifyGeminiError
assert.ok(classifyGeminiError("API key not valid. Please pass a valid API key.").includes("API key was rejected"));
assert.ok(classifyGeminiError("429 RESOURCE_EXHAUSTED").includes("rate limit"));
assert.ok(classifyGeminiError("403 PERMISSION_DENIED").includes("permission denied"));
assert.ok(classifyGeminiError("failed to fetch").includes("Network error"));
assert.ok(classifyGeminiError("").includes("unexpected error"));

// buildProspectingKit
const kit = buildProspectingKit({ targetIndustry: "Dental Clinics", targetLocation: "Austin TX", targetRole: "Owner", description: "we clean gutters" });
assert.ok(kit.length >= 8);
assert.ok(kit.every((k) => k.url.startsWith("https://www.google.com/search?q=")));
assert.ok(kit[0].query.includes("Dental Clinics"));

// csvCell
assert.equal(csvCell('say "hi", ok'), '"say ""hi"", ok"');
assert.equal(csvCell("plain"), "plain");

// levenshtein
assert.equal(levenshtein("acme", "acme"), 0);
assert.equal(levenshtein("", "abc"), 3);
assert.equal(levenshtein("kitten", "sitting"), 3);
assert.equal(levenshtein("acme dental", "acme dnetal"), 2);

// nameSimilarity
assert.equal(nameSimilarity("Acme Inc", "ACME LLC"), 1);
assert.ok(nameSimilarity("Acme Dental", "Acme Dentals") > 0.85);
assert.ok(nameSimilarity("Acme Dental", "Beta Plumbing") < 0.5);
assert.equal(nameSimilarity("", "x"), 0);

// dedupeLeadsFuzzy: exact dupes removed; fuzzy name dupes (no domain) merged
{
  const r = dedupeLeadsFuzzy([
    { companyName: "Acme Dental", website: "" },
    { companyName: "Acme Dentals", website: "" }, // single-char typo, no domain -> fuzzy dup
    { companyName: "Beta Inc", website: "https://beta.com" },
    { companyName: "Beta Corp", website: "https://beta.com/" }, // exact domain dup
    { companyName: "Gamma LLC", website: "" },
  ]);
  assert.equal(r.leads.length, 3);
  assert.equal(r.fuzzy, 1);
  assert.ok(r.leads.some((l) => l.companyName === "Acme Dental"));
}
// threshold=1 behaves like the exact dedupe (no fuzzy merging)
{
  const r = dedupeLeadsFuzzy(
    [
      { companyName: "Acme Dental", website: "" },
      { companyName: "Acme Dentals", website: "" },
    ],
    1
  );
  assert.equal(r.leads.length, 2);
  assert.equal(r.fuzzy, 0);
}

// parseCSV: quotes, escaped quotes, embedded commas and newlines
{
  const rows = parseCSV('a,b,c\n"x, y","say ""hi""",plain\n"multi\nline",z,');
  assert.deepEqual(rows, [
    ["a", "b", "c"],
    ["x, y", 'say "hi"', "plain"],
    ["multi\nline", "z", ""],
  ]);
}
assert.deepEqual(parseCSV("\uFEFFh1,h2\nv1,v2\n"), [["h1", "h2"], ["v1", "v2"]]);
assert.deepEqual(parseCSV(""), []);
assert.deepEqual(parseCSV("a,b\n\n"), [["a", "b"]]); // trailing empty row ignored

// mapCsvHeaders
{
  const m = mapCsvHeaders(["Company Name", "URL", "E-mail", "Phone Number", "Score", "Weird Column"]);
  assert.deepEqual(m, ["companyName", "website", "email", "phone", "warmthScore", null]);
}

// rowToLead: sanitize bad website/email, clamp warmth, default status
{
  const mapping = ["companyName", "website", "email", "warmthScore", "status"];
  const l = rowToLead(["Acme", "notaurl", "bad-email", "150", ""], mapping);
  assert.equal(l.companyName, "Acme");
  assert.equal(l.website, undefined);
  assert.equal(l.email, undefined);
  assert.equal(l.warmthScore, 100);
  assert.equal(l.status, "New");
  assert.equal(rowToLead(["", "", "", "", ""], mapping), null);
}

// importLeadsFromCSV: header mapping, dedupe, error notes
{
  const csv = [
    "Company,Website,Contact Name,Email,Phone,Score",
    'Acme Dental,https://acme.com,Jane Smith,jane@acme.com,555-0100,92',
    "Acme Dental,https://acme.com,Jane Smith,jane@acme.com,555-0100,92",
    ",https://nobody.com,x,x,555-0000,10",
    "Beta Roofing,,Bob,bob@beta.com,,60",
  ].join("\n");
  const res = importLeadsFromCSV(csv);
  assert.equal(res.parsed, 4);
  assert.equal(res.leads.length, 2);
  assert.equal(res.dropped, 1);
  assert.equal(res.removedDuplicates, 1);
  assert.ok(res.errors.length > 0);
}
assert.ok(importLeadsFromCSV("").errors.length > 0);
assert.ok(importLeadsFromCSV("foo,bar\n1,2").errors[0].includes("Could not recognize"));

// scoreLeadCompleteness
{
  const full = scoreLeadCompleteness({
    companyName: "Acme",
    website: "https://acme.com",
    contactName: "Jane",
    contactTitle: "Owner",
    email: "j@acme.com",
    phone: "555",
    leadReason: "good fit",
    sourcedFromUrl: "https://x.com",
  });
  assert.equal(full.score, 100);
  assert.equal(full.grade, "A");
  assert.deepEqual(full.missing, []);

  const bare = scoreLeadCompleteness({ companyName: "Acme", website: "https://acme.com" });
  assert.equal(bare.score, 27);
  assert.equal(bare.grade, "F");
  assert.ok(bare.missing.includes("Email"));
}

// campaignDataQuality
assert.equal(campaignDataQuality([]), 0);
assert.equal(
  campaignDataQuality([
    { companyName: "A", website: "https://a.com", contactName: "J", contactTitle: "T", email: "j@a.com", phone: "1", leadReason: "r", sourcedFromUrl: "u" },
    { companyName: "B" },
  ]),
  58
);

// findCrossCampaignDuplicates
{
  const camps = [
    {
      id: "c1",
      businessInfo: { name: "Dentists" },
      leads: [
        { companyName: "Acme Dental", website: "https://acme.com" },
        { companyName: "Solo Row", website: "" },
      ],
    },
    {
      id: "c2",
      businessInfo: { name: "Roofers" },
      leads: [
        { companyName: "Acme Dental LLC", website: "https://www.acme.com/" },
        { companyName: "Beta Roofing", website: "" },
      ],
    },
    {
      id: "c3",
      businessInfo: { name: "Plumbers" },
      leads: [{ companyName: "Gamma Plumbing", website: "" }],
    },
  ];
  const dupes = findCrossCampaignDuplicates(camps);
  assert.equal(dupes.length, 1);
  assert.equal(dupes[0].entries.length, 2);
  assert.ok(dupes[0].entries.some((e) => e.campaignName === "Dentists"));
  assert.ok(dupes[0].entries.some((e) => e.campaignName === "Roofers"));
  // unnamed leads never form groups
  assert.equal(findCrossCampaignDuplicates([]).length, 0);
}

console.log("All helper tests passed.");

// --- scoring.js: lead warmth engine ----------------------------------------
{
  // splitEmail
  assert.deepEqual(splitEmail("Jane@Acme.COM"), { local: "jane", domain: "acme.com" });
  assert.equal(splitEmail("not-an-email"), null);
  assert.equal(splitEmail(""), null);

  // gradeEmailDomain
  assert.equal(gradeEmailDomain("jane@acme.com", "https://acme.com").kind, "corporate");
  assert.equal(gradeEmailDomain("jane@gmail.com", "https://acme.com").kind, "free");
  assert.equal(gradeEmailDomain("jane@other.com", "https://acme.com").kind, "mismatch");
  assert.equal(gradeEmailDomain("bad-email", "").kind, "invalid");
  // no website on file -> domain can't mismatch, counts as corporate
  assert.equal(gradeEmailDomain("jane@acme.com", "").kind, "corporate");

  // scoreDomainQuality: 0..30
  {
    const q = scoreDomainQuality("https://acme.com");
    assert.ok(q.points > 20 && q.points <= 30);
    assert.equal(scoreDomainQuality("").points, 0);
    const odd = scoreDomainQuality("https://my-shop-1234.xyz");
    assert.ok(odd.points < q.points);
  }

  // scoreLeadWarmth: a fully-loaded lead scores Hot; empty lead is Cold
  const hotLead = {
    companyName: "Acme Dental",
    website: "https://acme.com",
    contactName: "Jane Smith",
    contactTitle: "Owner",
    email: "jane@acme.com",
    phone: "555-0100",
    linkedinUrl: "https://linkedin.com/company/acme",
    socialProfiles: ["https://twitter.com/acme"],
  };
  const hot = scoreLeadWarmth(hotLead);
  assert.equal(hot.tier, "Hot");
  assert.ok(hot.score >= 75);
  assert.ok(hot.signals.length >= 8);
  assert.ok(hot.signals.every((s) => typeof s.points === "number"));

  const cold = scoreLeadWarmth({ companyName: "Ghost Co" });
  assert.equal(cold.tier, "Cold");
  assert.ok(cold.score < 25);

  const free = scoreLeadWarmth({
    companyName: "Beta",
    email: "bob@gmail.com",
    website: "https://beta.com",
  });
  const freeSignal = free.signals.find((s) => s.label === "Email domain");
  assert.equal(freeSignal.points, 5);
  assert.ok(freeSignal.detail.includes("gmail.com"));

  const senior = scoreLeadWarmth({ companyName: "X", contactName: "A", contactTitle: "CEO" });
  assert.ok(senior.signals.find((s) => s.label === "Seniority").points === 5);
  const junior = scoreLeadWarmth({ companyName: "X", contactName: "A", contactTitle: "Intern" });
  assert.ok(junior.signals.find((s) => s.label === "Seniority").points === 0);

  // warmthTier boundaries
  assert.equal(warmthTier(75), "Hot");
  assert.equal(warmthTier(74), "Warm");
  assert.equal(warmthTier(50), "Warm");
  assert.equal(warmthTier(49), "Lukewarm");
  assert.equal(warmthTier(25), "Lukewarm");
  assert.equal(warmthTier(24), "Cold");
  assert.equal(warmthTier(0), "Cold");

  // campaignWarmthDistribution + rankLeadsByWarmth
  const dist = campaignWarmthDistribution([hotLead, { companyName: "Ghost Co" }]);
  assert.equal(dist.hot, 1);
  assert.equal(dist.cold, 1);
  assert.ok(dist.average > 0 && dist.average <= 100);
  assert.deepEqual(campaignWarmthDistribution([]), { hot: 0, warm: 0, lukewarm: 0, cold: 0, average: 0 });

  const ranked = rankLeadsByWarmth([{ companyName: "Ghost Co" }, hotLead]);
  assert.equal(ranked[0].lead.companyName, "Acme Dental");
  assert.equal(ranked[1].lead.companyName, "Ghost Co");
  assert.ok(ranked[0].score >= ranked[1].score);
}

console.log("All scoring tests passed.");

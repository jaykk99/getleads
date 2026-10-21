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
import {
  makeTaskId,
  todayISO,
  shiftISODate,
  validateFollowUp,
  createFollowUp,
  completeFollowUp,
  reopenFollowUp,
  skipFollowUp,
  isOverdue,
  isDueToday,
  allFollowUps,
  nextDueForLead,
  followUpStats,
  suggestedFollowUpsForLead,
} from "../src/lib/tasks.js";
import {
  DRAFT_ONLY,
  SEQUENCE_TEMPLATES,
  listSequenceTemplates,
  renderPlaceholders,
  firstNameOf,
  buildSequenceContext,
  renderSequence,
  sequenceReadiness,
} from "../src/lib/sequences.js";
import {
  validateBlacklistEntry,
  createBlacklistEntry,
  entryMatchesLead,
  checkLeadBlacklist,
  filterBlacklistedLeads,
  checkImportAgainstBlacklist,
  upsertBlacklistEntry,
  removeBlacklistEntry,
} from "../src/lib/blacklist.js";
import {
  attributeSource,
  leadSource,
  normalizeLeadSource,
  sourceBreakdown,
  UNKNOWN_SOURCE,
} from "../src/lib/attribution.js";
import {
  PIPELINE_STAGES,
  statusDistribution,
  pipelineFunnel,
  warmthHistogram,
  completenessGrades,
  campaignPerformance,
  compareCampaigns,
} from "../src/lib/reporting.js";
import {
  normalizeTag,
  normalizeTags,
  addTagsToLead,
  removeTagsFromLead,
  bulkAddTags,
  bulkRemoveTags,
  allTags,
} from "../src/lib/tags.js";

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

// --- tasks.js: follow-up tracker -------------------------------------------
{
  assert.match(makeTaskId(), /^task_/);
  assert.match(todayISO(new Date(2026, 0, 5)), /^\d{4}-01-05$/);
  assert.equal(shiftISODate("2026-01-31", 1), "2026-02-01");

  assert.deepEqual(validateFollowUp({}), ["Task needs a title."]);
  assert.ok(validateFollowUp({ title: "x", dueDate: "bad" }).length > 0);
  assert.deepEqual(validateFollowUp({ title: "Call Jane", dueDate: "2026-10-22", priority: "high" }), []);

  const t = createFollowUp("lead_1", { title: " Call Jane ", priority: "high" });
  assert.equal(t.title, "Call Jane");
  assert.equal(t.status, "open");
  assert.equal(t.leadId, "lead_1");
  assert.throws(() => createFollowUp("l", {}), /title/);

  const done = completeFollowUp(t);
  assert.equal(done.status, "done");
  assert.ok(done.completedAt);
  assert.equal(t.status, "open"); // no mutation
  assert.equal(reopenFollowUp(done).status, "open");
  const skipped = skipFollowUp(t, "no answer");
  assert.equal(skipped.status, "skipped");
  assert.ok(skipped.notes.includes("no answer"));

  assert.equal(isOverdue({ status: "open", dueDate: "2026-01-01" }, "2026-10-21"), true);
  assert.equal(isOverdue({ status: "open", dueDate: "2026-10-22" }, "2026-10-21"), false);
  assert.equal(isOverdue({ status: "done", dueDate: "2026-01-01" }, "2026-10-21"), false);
  assert.equal(isDueToday({ status: "open", dueDate: "2026-10-21" }, "2026-10-21"), true);

  const camp = {
    leads: [
      { id: "a", companyName: "Acme", followUps: [
        { id: "t1", title: "old", dueDate: "2026-01-01", status: "open", priority: "normal" },
        { id: "t2", title: "done one", dueDate: "2026-01-01", status: "done", priority: "high" },
      ]},
      { id: "b", companyName: "Beta", followUps: [
        { id: "t3", title: "today", dueDate: "2026-10-21", status: "open", priority: "high" },
      ]},
    ],
  };
  const all = allFollowUps(camp, "2026-10-21");
  assert.equal(all.length, 3);
  assert.equal(all[0].id, "t1"); // overdue open first
  assert.ok(all[0].overdue);
  assert.equal(all[all.length - 1].status, "done"); // done last
  assert.equal(all[0].companyName, "Acme");

  const next = nextDueForLead(camp.leads[0], "2026-10-21");
  assert.equal(next.id, "t1");
  assert.equal(nextDueForLead({ companyName: "No tasks" }, "2026-10-21"), null);

  const stats = followUpStats(camp, "2026-10-21");
  assert.deepEqual(stats, { total: 3, open: 2, done: 1, skipped: 0, overdue: 1, dueToday: 1, leadsWithOpen: 2, leadCount: 2 });

  const suggested = suggestedFollowUpsForLead({ companyName: "Acme", contactName: "Jane Smith" });
  assert.equal(suggested.length, 3);
  assert.ok(suggested[0].title.includes("Jane Smith"));
  assert.ok(suggested[0].dueDate > suggested[1].dueDate === false); // ascending
}

console.log("All tasks tests passed.");

// --- sequences.js: draft-only email sequences --------------------------------
{
  assert.equal(DRAFT_ONLY, true);
  const list = listSequenceTemplates();
  assert.ok(list.length >= 3);
  assert.ok(list.every((t) => t.steps > 0));

  assert.equal(renderPlaceholders("Hi {{firstName}} ({{missing}})", { firstName: "Jane" }), "Hi Jane ({{missing}})");
  assert.equal(firstNameOf("  Jane Smith "), "Jane");
  assert.equal(firstNameOf(""), "");

  const lead = {
    companyName: "Acme Dental",
    contactName: "Jane Smith",
    contactTitle: "Owner",
    email: "jane@acme.com",
    customHook: "Saw your new location opening downtown.",
  };
  const campaign = { businessInfo: { name: "Growth Co", targetIndustry: "dental clinics", targetLocation: "Austin TX" } };
  const ctx = buildSequenceContext(lead, campaign, { senderName: "Jay", senderCompany: "Growth Co" });
  assert.equal(ctx.firstName, "Jane");
  assert.equal(ctx.hook, "Saw your new location opening downtown.");

  const seq = renderSequence("email_warm", lead, campaign, { senderName: "Jay", senderCompany: "Growth Co" });
  assert.equal(seq.draft, true);
  assert.equal(seq.sendable, false);
  assert.equal(seq.steps.length, 3);
  assert.ok(seq.steps[0].subject.includes("Acme Dental"));
  assert.ok(seq.steps[0].body.includes("Jane"));
  assert.ok(!seq.steps[0].body.includes("{{"));
  assert.deepEqual(seq.steps[0].missing, []);

  // missing contact name falls back to a generic greeting ("there")
  const bare = renderSequence("email_cold", { companyName: "X" }, {}, {});
  assert.deepEqual(bare.steps[0].missing, []);
  assert.ok(bare.steps[0].body.includes("Hi there,"));

  assert.throws(() => renderSequence("nope", {}, {}, {}), /Unknown sequence template/);

  assert.deepEqual(sequenceReadiness(lead), []);
  assert.ok(sequenceReadiness({}).length === 3);
}

console.log("All sequences tests passed.");

// --- blacklist.js: do-not-contact --------------------------------------------
{
  assert.deepEqual(validateBlacklistEntry({}), ['Type must be "domain", "email", or "name".']);
  assert.ok(validateBlacklistEntry({ type: "domain", value: "not a domain" }).length > 0);
  assert.deepEqual(validateBlacklistEntry({ type: "email", value: "jane@acme.com" }), []);

  const d = createBlacklistEntry({ type: "domain", value: "HTTPS://Acme.COM/", reason: "asked to stop" });
  assert.equal(d.type, "domain");
  assert.equal(d.value, "acme.com");
  assert.equal(d.reason, "asked to stop");

  const bl = [
    createBlacklistEntry({ type: "domain", value: "acme.com" }),
    createBlacklistEntry({ type: "email", value: "bob@beta.com" }),
    createBlacklistEntry({ type: "name", value: "Gamma LLC" }),
  ];
  assert.equal(entryMatchesLead(bl[0], { website: "https://www.acme.com/x" }), true);
  assert.equal(entryMatchesLead(bl[0], { email: "sales@acme.com" }), true); // email domain match
  assert.equal(entryMatchesLead(bl[0], { website: "https://other.com" }), false);
  assert.equal(entryMatchesLead(bl[1], { email: "BOB@beta.com" }), true);
  assert.equal(entryMatchesLead(bl[1], { email: "alice@beta.com" }), false);
  assert.equal(entryMatchesLead(bl[2], { companyName: "Gamma Ltd" }), true); // normalized name match

  const check = checkLeadBlacklist({ website: "https://acme.com", companyName: "Acme Inc" }, bl);
  assert.equal(check.blacklisted, true);
  assert.equal(check.matches.length, 1);
  assert.equal(checkLeadBlacklist({ companyName: "Delta" }, bl).blacklisted, false);

  const { allowed, blocked } = filterBlacklistedLeads(
    [{ companyName: "Acme", website: "https://acme.com" }, { companyName: "Delta" }],
    bl
  );
  assert.equal(allowed.length, 1);
  assert.equal(blocked.length, 1);
  assert.ok(blocked[0].blockedBy[0].includes("acme.com"));

  const imp = checkImportAgainstBlacklist([{ companyName: "Acme", website: "https://acme.com" }], bl);
  assert.equal(imp.allowed.length, 0);
  assert.equal(imp.blockedCount, 1);
  assert.ok(imp.notes[0].includes("Acme"));

  const up = upsertBlacklistEntry(bl, createBlacklistEntry({ type: "domain", value: "acme.com", reason: "updated" }));
  assert.equal(up.length, 3); // replaced, not duplicated
  assert.equal(up[0].reason, "updated");
  assert.equal(removeBlacklistEntry(bl, bl[0].id).length, 2);
}

console.log("All blacklist tests passed.");

// --- attribution.js: source attribution ---------------------------------------
{
  assert.equal(attributeSource("https://www.linkedin.com/company/acme"), "LinkedIn");
  assert.equal(attributeSource("https://maps.google.com/?q=dentist"), "Google Maps");
  assert.equal(attributeSource("https://www.google.com/search?q=dentist"), "Google Search");
  assert.equal(attributeSource("yelp.com/biz/acme"), "Yelp");
  assert.equal(attributeSource("imported csv file"), "CSV import");
  assert.equal(attributeSource("prospected by hand"), "Manual prospecting");
  assert.equal(attributeSource("AI generated batch"), "AI generated");
  assert.equal(attributeSource(""), UNKNOWN_SOURCE);
  assert.equal(attributeSource("https://randomsite.example/page"), UNKNOWN_SOURCE);

  assert.equal(leadSource({ source: "Custom CRM" }), "Custom CRM");
  assert.equal(leadSource({ sourcedFromUrl: "https://linkedin.com/x" }), "LinkedIn");
  assert.equal(leadSource({ sourceNote: "found on yelp.com/biz/x" }), "Yelp");
  assert.equal(leadSource({}), UNKNOWN_SOURCE);
  assert.deepEqual(normalizeLeadSource({ companyName: "A", sourcedFromUrl: "https://x.com/y" }).source, "X / Twitter");

  const bd = sourceBreakdown([
    { sourcedFromUrl: "https://linkedin.com/a" },
    { sourcedFromUrl: "https://linkedin.com/b" },
    { companyName: "No source" },
  ]);
  assert.equal(bd[0].source, "LinkedIn");
  assert.equal(bd[0].count, 2);
  assert.equal(bd[0].pct, 67);
}

console.log("All attribution tests passed.");

// --- reporting.js: campaign performance ---------------------------------------
{
  const leads = [
    { companyName: "A", status: "New", email: "a@a.com", website: "https://a.com", contactName: "Ann", contactTitle: "Owner", phone: "1", linkedinUrl: "https://linkedin.com/a", sourcedFromUrl: "https://linkedin.com/a" },
    { companyName: "B", status: "Contacted", email: "b@b.com", website: "https://b.com", contactName: "Bob", contactTitle: "CEO", phone: "2", sourcedFromUrl: "https://maps.google.com/x" },
    { companyName: "C", status: "Replied" },
    { companyName: "D", status: "Won", email: "d@d.com" },
    { companyName: "E", status: "Mystery" },
  ];
  const camp = { id: "c1", businessInfo: { name: "Test Campaign" }, leads };

  const { counts, total } = statusDistribution(leads);
  assert.equal(total, 5);
  assert.equal(counts["New"], 1);
  assert.equal(counts["Mystery"], 1);

  const funnel = pipelineFunnel(leads);
  assert.equal(funnel[0].stage, "New");
  assert.equal(funnel[0].count, 5);
  assert.equal(funnel[0].pct, 100);
  const won = funnel.find((f) => f.stage === "Won");
  assert.equal(won.count, 1);

  const hist = warmthHistogram(leads);
  assert.equal(hist.length, 5);
  assert.equal(hist.reduce((a, b) => a + b.count, 0), 5);

  const grades = completenessGrades(leads);
  assert.equal(Object.values(grades).reduce((a, b) => a + b, 0), 5);

  const perf = campaignPerformance(camp);
  assert.equal(perf.campaignName, "Test Campaign");
  assert.equal(perf.total, 5);
  assert.equal(perf.contacted, 3); // Contacted + Replied + Won
  assert.equal(perf.replyRate, 67); // 2 of 3 contacted replied+
  assert.ok(perf.warmth.average > 0);
  assert.ok(perf.sources.length > 0);
  assert.ok(perf.dataQuality >= 0 && perf.dataQuality <= 100);
  assert.ok(Array.isArray(perf.warmthHistogram) && perf.warmthHistogram.length === 5);

  const rows = compareCampaigns([camp, { id: "c2", businessInfo: { name: "Empty" }, leads: [] }]);
  assert.equal(rows.length, 2);
  assert.equal(rows[1].leads, 0);
  assert.equal(rows[1].replyRate, 0);
  assert.ok(PIPELINE_STAGES.includes("Meeting"));
}

console.log("All reporting tests passed.");

// --- tags.js: bulk tag editing -------------------------------------------------
{
  assert.equal(normalizeTag("  Hot Lead! "), "hot-lead");
  assert.equal(normalizeTag(""), "");
  assert.deepEqual(normalizeTags(["A", "a", "B C", ""]), ["a", "b-c"]);

  const withTags = addTagsToLead({ companyName: "X" }, ["Hot", "hot", "New"]);
  assert.deepEqual(withTags.tags, ["hot", "new"]);
  const removed = removeTagsFromLead(withTags, ["HOT"]);
  assert.deepEqual(removed.tags, ["new"]);

  const leads = [
    { id: "1", companyName: "A", tags: ["old"] },
    { id: "2", companyName: "B" },
    { id: "3", companyName: "C", tags: ["old"] },
  ];
  const { leads: added, updated } = bulkAddTags(leads, ["1", "2"], ["Hot Lead", "Q4"]);
  assert.equal(updated, 2);
  assert.deepEqual(added[0].tags, ["old", "hot-lead", "q4"]);
  assert.deepEqual(added[2].tags, ["old"]); // untouched keeps identity
  assert.equal(added[2], leads[2]);

  const { leads: rm, updated: u2 } = bulkRemoveTags(added, ["1", "3"], ["old"]);
  assert.equal(u2, 2);
  assert.deepEqual(rm[0].tags, ["hot-lead", "q4"]);
  assert.deepEqual(rm[2].tags, []);

  const tags = allTags(rm);
  assert.ok(tags[0].count >= tags[tags.length - 1].count);
  assert.ok(tags.some((t) => t.tag === "hot-lead" && t.count === 2));
}

console.log("All tags tests passed.");

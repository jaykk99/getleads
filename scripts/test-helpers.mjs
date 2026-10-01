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
} from "../src/lib/leads.js";

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

console.log("All helper tests passed.");

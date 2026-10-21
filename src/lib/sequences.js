// Email sequence drafting per campaign.
// DRAFTS ONLY — this module never sends email. Every rendered step carries
// a "draft" flag and the app must show them as copy-and-paste drafts the
// user sends manually from their own inbox. There is no send function here
// on purpose.
//
// Placeholders use {{token}} syntax and are substituted from a context
// object built from the lead + campaign + user profile.

export const DRAFT_ONLY = true;

/**
 * Sequence templates. Each step: { day, subject, body }.
 * Supported placeholders:
 *   {{firstName}} {{fullName}} {{company}} {{title}} {{industry}}
 *   {{location}} {{senderName}} {{senderCompany}} {{hook}}
 */
export const SEQUENCE_TEMPLATES = {
  email_warm: {
    label: "Warm intro (referral / prior touch)",
    steps: [
      {
        day: 0,
        subject: "Quick intro, {{company}}",
        body: [
          "Hi {{firstName}},",
          "",
          "{{hook}}",
          "",
          "I help {{industry}} companies in {{location}} {{senderCompany}} — happy to share a 2-minute breakdown of what that could look like for {{company}}.",
          "",
          "Worth a quick chat this week?",
          "",
          "— {{senderName}}",
          "{{senderCompany}}",
        ].join("\n"),
      },
      {
        day: 3,
        subject: "Re: Quick intro, {{company}}",
        body: [
          "Hi {{firstName}},",
          "",
          "Floating this back up in case it got buried. The short version: we help {{industry}} teams get more out of {{company}}'s current setup without adding headcount.",
          "",
          "Open to a 10-minute call Thursday or Friday?",
          "",
          "— {{senderName}}",
        ].join("\n"),
      },
      {
        day: 9,
        subject: "Closing the loop",
        body: [
          "Hi {{firstName}},",
          "",
          "I'll close the loop on my end for now. If {{company}} ever wants a second pair of eyes on growth, just reply and I'll send over the breakdown.",
          "",
          "— {{senderName}}",
        ].join("\n"),
      },
    ],
  },
  email_cold: {
    label: "Cold outreach (no prior contact)",
    steps: [
      {
        day: 0,
        subject: "{{company}} — one idea",
        body: [
          "Hi {{firstName}},",
          "",
          "Noticed {{company}} while researching {{industry}} in {{location}}. {{hook}}",
          "",
          "We work with companies like yours on {{senderCompany}} — typically seeing results within the first 30 days.",
          "",
          "Would a brief intro call be useful, or should I send the one-pager first?",
          "",
          "— {{senderName}}",
          "{{senderCompany}}",
        ].join("\n"),
      },
      {
        day: 4,
        subject: "Re: {{company}} — one idea",
        body: [
          "Hi {{firstName}},",
          "",
          "Quick bump — curious whether the idea I sent over landed, or if I should point you to someone else at {{company}}.",
          "",
          "— {{senderName}}",
        ].join("\n"),
      },
      {
        day: 11,
        subject: "Permission to close your file?",
        body: [
          "Hi {{firstName}},",
          "",
          "Last note from me — I'll assume timing isn't right and close your file. If things change, reply anytime and I'll resend the breakdown.",
          "",
          "— {{senderName}}",
        ].join("\n"),
      },
    ],
  },
  email_referral: {
    label: "Referral intro",
    steps: [
      {
        day: 0,
        subject: "Intro via {{hook}}",
        body: [
          "Hi {{firstName}},",
          "",
          "{{hook}} suggested I reach out. I help {{industry}} companies with {{senderCompany}}.",
          "",
          "Would love 10 minutes to see if there's a fit for {{company}} — would Tuesday or Wednesday work?",
          "",
          "— {{senderName}}",
          "{{senderCompany}}",
        ].join("\n"),
      },
      {
        day: 5,
        subject: "Re: Intro via {{hook}}",
        body: [
          "Hi {{firstName}},",
          "",
          "Bumping this in case {{hook}}'s intro got lost in the shuffle. Happy to work around your schedule.",
          "",
          "— {{senderName}}",
        ].join("\n"),
      },
    ],
  },
};

/** List available template keys + labels for the UI picker. */
export function listSequenceTemplates() {
  return Object.entries(SEQUENCE_TEMPLATES).map(([key, t]) => ({ key, label: t.label, steps: t.steps.length }));
}

/**
 * Substitute {{tokens}} in text from a context object.
 * Unknown tokens are left as-is so the user can see what to fill in.
 */
export function renderPlaceholders(text, context) {
  return String(text || "").replace(/\{\{(\w+)\}\}/g, (match, token) => {
    const v = context?.[token];
    if (v === undefined || v === null || String(v).trim() === "") return match;
    return String(v);
  });
}

/** First name from a full name string. */
export function firstNameOf(fullName) {
  const parts = String(fullName || "").trim().split(/\s+/).filter(Boolean);
  return parts[0] || "";
}

/**
 * Build the placeholder context for a lead + campaign + sender profile.
 */
export function buildSequenceContext(lead, campaign, sender) {
  const l = lead || {};
  const biz = campaign?.businessInfo || {};
  const s = sender || {};
  return {
    firstName: firstNameOf(l.contactName) || "there",
    fullName: l.contactName || "",
    company: l.companyName || "",
    title: l.contactTitle || "",
    industry: biz.targetIndustry || "your industry",
    location: biz.targetLocation || "your area",
    hook: l.customHook || l.leadReason || "Your company stood out in my research.",
    senderName: s.senderName || "Your Name",
    senderCompany: s.senderCompany || biz.name || "Your Company",
  };
}

/**
 * Render a full draft sequence for one lead.
 * Returns { templateKey, label, draft: true, steps: [{ day, subject, body, missing }] }
 * where `missing` lists placeholder tokens that had no value (user must fill).
 */
export function renderSequence(templateKey, lead, campaign, sender) {
  const tpl = SEQUENCE_TEMPLATES[templateKey];
  if (!tpl) throw new Error(`Unknown sequence template: ${templateKey}`);
  const ctx = buildSequenceContext(lead, campaign, sender);
  const steps = tpl.steps.map((step) => {
    const subject = renderPlaceholders(step.subject, ctx);
    const body = renderPlaceholders(step.body, ctx);
    const missing = new Set();
    for (const text of [subject, body]) {
      for (const m of text.matchAll(/\{\{(\w+)\}\}/g)) missing.add(m[1]);
    }
    return { day: step.day, subject, body, missing: [...missing], draft: true };
  });
  return { templateKey, label: tpl.label, draft: true, sendable: false, steps };
}

/**
 * Validate a lead has the minimum fields to produce a non-empty draft.
 * Returns a list of warnings (empty = ready).
 */
export function sequenceReadiness(lead) {
  const warnings = [];
  if (!String(lead?.contactName || "").trim()) warnings.push("No contact name — drafts will use a generic greeting.");
  if (!String(lead?.companyName || "").trim()) warnings.push("No company name — drafts will read generically.");
  if (!String(lead?.email || "").trim()) warnings.push("No email address — there is nowhere to paste the draft yet.");
  return warnings;
}

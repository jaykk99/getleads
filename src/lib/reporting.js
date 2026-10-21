// Campaign performance reporting: aggregates the numbers behind the
// performance dashboard (stats cards + bar data). Pure functions over
// campaigns/leads; no DOM, no React.

import { scoreLeadCompleteness, campaignDataQuality } from "./leads.js";
import { scoreLeadWarmth, campaignWarmthDistribution } from "./scoring.js";
import { followUpStats } from "./tasks.js";
import { sourceBreakdown } from "./attribution.js";

/** Canonical pipeline stages in order. */
export const PIPELINE_STAGES = ["New", "Contacted", "Replied", "Meeting", "Won", "Lost"];

/**
 * Count leads per status. Unknown statuses are kept as their own bucket.
 * Returns { counts, total }.
 */
export function statusDistribution(leads) {
  const counts = {};
  for (const lead of leads || []) {
    const s = String(lead?.status || "New").trim() || "New";
    counts[s] = (counts[s] || 0) + 1;
  }
  return { counts, total: (leads || []).length };
}

/**
 * Funnel conversion: % of leads that reached each pipeline stage.
 * A lead counts for a stage if its status is that stage or later.
 * Returns [{ stage, count, pct }].
 */
export function pipelineFunnel(leads) {
  const order = new Map(PIPELINE_STAGES.map((s, i) => [s, i]));
  const total = (leads || []).length;
  return PIPELINE_STAGES.map((stage) => {
    const idx = order.get(stage);
    let count = 0;
    for (const lead of leads || []) {
      const s = String(lead?.status || "New").trim();
      const li = order.has(s) ? order.get(s) : 0;
      if (li >= idx) count += 1;
    }
    return { stage, count, pct: total ? Math.round((count / total) * 100) : 0 };
  });
}

/** Warmth histogram: bucket scores 0..100 into 5 bins. */
export function warmthHistogram(leads) {
  const bins = [
    { label: "0-19", count: 0 },
    { label: "20-39", count: 0 },
    { label: "40-59", count: 0 },
    { label: "60-79", count: 0 },
    { label: "80-100", count: 0 },
  ];
  for (const lead of leads || []) {
    const { score } = scoreLeadWarmth(lead);
    const idx = Math.min(4, Math.floor(score / 20));
    bins[idx].count += 1;
  }
  return bins;
}

/**
 * Completeness grade distribution: { A, B, C, D, F } counts.
 */
export function completenessGrades(leads) {
  const grades = { A: 0, B: 0, C: 0, D: 0, F: 0 };
  for (const lead of leads || []) {
    const { grade } = scoreLeadCompleteness(lead);
    grades[grade] = (grades[grade] || 0) + 1;
  }
  return grades;
}

/**
 * Full performance snapshot for one campaign.
 * Returns a plain object the dashboard UI renders directly.
 */
export function campaignPerformance(campaign, nowISO) {
  const leads = campaign?.leads || [];
  const { counts: byStatus, total } = statusDistribution(leads);
  const funnel = pipelineFunnel(leads);
  const warmth = campaignWarmthDistribution(leads);
  const followUps = followUpStats(campaign, nowISO);
  const sources = sourceBreakdown(leads);
  const grades = completenessGrades(leads);
  const dataQuality = campaignDataQuality(leads);
  const contacted = (byStatus["Contacted"] || 0) + (byStatus["Replied"] || 0) + (byStatus["Meeting"] || 0) + (byStatus["Won"] || 0) + (byStatus["Lost"] || 0);
  const replyRate = contacted ? Math.round((((byStatus["Replied"] || 0) + (byStatus["Meeting"] || 0) + (byStatus["Won"] || 0)) / contacted) * 100) : 0;
  return {
    campaignId: campaign?.id || null,
    campaignName: campaign?.businessInfo?.name || "Untitled",
    total,
    byStatus,
    contacted,
    replyRate,
    funnel,
    warmth,
    warmthHistogram: warmthHistogram(leads),
    followUps,
    sources,
    completenessGrades: grades,
    dataQuality,
  };
}

/**
 * Compare campaigns head to head: returns rows of
 * { id, name, leads, avgWarmth, dataQuality, replyRate, openFollowUps }.
 */
export function compareCampaigns(campaigns, nowISO) {
  return (campaigns || []).map((c) => {
    const perf = campaignPerformance(c, nowISO);
    return {
      id: c.id,
      name: perf.campaignName,
      leads: perf.total,
      avgWarmth: perf.warmth.average,
      dataQuality: perf.dataQuality,
      replyRate: perf.replyRate,
      openFollowUps: perf.followUps.open,
      overdue: perf.followUps.overdue,
    };
  });
}

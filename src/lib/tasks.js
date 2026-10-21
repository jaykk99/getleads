// Follow-up task tracker for leads.
// Pure helpers: tasks live on the campaign object as lead.followUps (arrays of
// task objects). No DOM, no React — safe to unit test with plain node.
//
// Task shape:
//   { id, leadId, title, dueDate (ISO yyyy-mm-dd), status, priority,
//     notes, createdAt, completedAt }
// status: "open" | "done" | "skipped"
// priority: "low" | "normal" | "high"

let taskSeq = 0;

/** Generate a reasonably unique task id without external deps. */
export function makeTaskId() {
  taskSeq += 1;
  return `task_${Date.now().toString(36)}_${taskSeq}`;
}

/** Today as yyyy-mm-dd in local time (no Date.parse timezone surprises). */
export function todayISO(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Shift a yyyy-mm-dd date by n days, returning yyyy-mm-dd. */
export function shiftISODate(iso, days) {
  const [y, m, d] = String(iso).split("-").map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  dt.setDate(dt.getDate() + days);
  return todayISO(dt);
}

/**
 * Validate a follow-up task draft. Returns a list of error strings (empty = ok).
 */
export function validateFollowUp(draft) {
  const errors = [];
  if (!draft || typeof draft !== "object") return ["Task data is missing."];
  if (!String(draft.title || "").trim()) errors.push("Task needs a title.");
  else if (String(draft.title).trim().length > 200) errors.push("Title is too long (max 200 characters).");
  if (draft.dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(String(draft.dueDate))) {
    errors.push("Due date must be YYYY-MM-DD.");
  }
  if (draft.priority && !["low", "normal", "high"].includes(draft.priority)) {
    errors.push("Priority must be low, normal, or high.");
  }
  if (draft.status && !["open", "done", "skipped"].includes(draft.status)) {
    errors.push("Status must be open, done, or skipped.");
  }
  return errors;
}

/**
 * Create a follow-up task for a lead. Returns the task object.
 * Throws on invalid input (callers should validate first with validateFollowUp).
 */
export function createFollowUp(leadId, draft) {
  const errors = validateFollowUp(draft || {});
  if (errors.length) throw new Error(errors[0]);
  const title = String(draft.title).trim();
  return {
    id: draft.id || makeTaskId(),
    leadId: leadId || null,
    title,
    dueDate: draft.dueDate || todayISO(),
    status: "open",
    priority: draft.priority || "normal",
    notes: String(draft.notes || "").trim(),
    createdAt: new Date().toISOString(),
    completedAt: null,
  };
}

/** Mark a task done (returns a new object; does not mutate). */
export function completeFollowUp(task) {
  if (!task) return task;
  return { ...task, status: "done", completedAt: new Date().toISOString() };
}

/** Reopen a done/skipped task. */
export function reopenFollowUp(task) {
  if (!task) return task;
  return { ...task, status: "open", completedAt: null };
}

/** Skip a task with an optional reason stored in notes. */
export function skipFollowUp(task, reason) {
  if (!task) return task;
  const notes = reason
    ? `${String(task.notes || "").trim()}${task.notes ? " " : ""}[skipped: ${reason}]`.trim()
    : task.notes;
  return { ...task, status: "skipped", notes, completedAt: new Date().toISOString() };
}

/** True when an open task's due date is before today. */
export function isOverdue(task, nowISO) {
  if (!task || task.status !== "open" || !task.dueDate) return false;
  const today = nowISO || todayISO();
  return task.dueDate < today;
}

/** True when an open task is due today. */
export function isDueToday(task, nowISO) {
  if (!task || task.status !== "open" || !task.dueDate) return false;
  return task.dueDate === (nowISO || todayISO());
}

/**
 * Flatten every follow-up across a campaign's leads into one list,
 * each annotated with the lead's company name. Sorted: overdue first,
 * then by due date ascending, then priority.
 */
export function allFollowUps(campaign, nowISO) {
  const today = nowISO || todayISO();
  const out = [];
  for (const lead of campaign?.leads || []) {
    for (const task of lead.followUps || []) {
      out.push({
        ...task,
        leadId: lead.id,
        companyName: lead.companyName || "Untitled lead",
        overdue: isOverdue(task, today),
        dueToday: isDueToday(task, today),
      });
    }
  }
  out.sort((a, b) => {
    const aOpen = a.status === "open" ? 0 : 1;
    const bOpen = b.status === "open" ? 0 : 1;
    if (aOpen !== bOpen) return aOpen - bOpen;
    if (a.dueDate !== b.dueDate) return (a.dueDate || "") < (b.dueDate || "") ? -1 : 1;
    const rank = { high: 0, normal: 1, low: 2 };
    return (rank[a.priority] ?? 1) - (rank[b.priority] ?? 1);
  });
  return out;
}

/** Next open follow-up due for a single lead (earliest due date), or null. */
export function nextDueForLead(lead, nowISO) {
  const today = nowISO || todayISO();
  const open = (lead?.followUps || []).filter((t) => t.status === "open");
  if (!open.length) return null;
  open.sort((a, b) => ((a.dueDate || "") < (b.dueDate || "") ? -1 : 1));
  const next = open[0];
  return { ...next, overdue: isOverdue(next, today), dueToday: isDueToday(next, today) };
}

/**
 * Follow-up coverage stats for a campaign:
 * { total, open, done, skipped, overdue, dueToday, leadsWithOpen, leadCount }
 */
export function followUpStats(campaign, nowISO) {
  const today = nowISO || todayISO();
  const stats = {
    total: 0,
    open: 0,
    done: 0,
    skipped: 0,
    overdue: 0,
    dueToday: 0,
    leadsWithOpen: 0,
    leadCount: (campaign?.leads || []).length,
  };
  for (const lead of campaign?.leads || []) {
    const tasks = lead.followUps || [];
    let hasOpen = false;
    for (const t of tasks) {
      stats.total += 1;
      if (t.status === "done") stats.done += 1;
      else if (t.status === "skipped") stats.skipped += 1;
      else {
        stats.open += 1;
        hasOpen = true;
        if (isOverdue(t, today)) stats.overdue += 1;
        if (isDueToday(t, today)) stats.dueToday += 1;
      }
    }
    if (hasOpen) stats.leadsWithOpen += 1;
  }
  return stats;
}

/**
 * Suggest default follow-up tasks for a freshly-added lead.
 * Returns drafts (not saved) the UI can offer one click to add.
 */
export function suggestedFollowUpsForLead(lead) {
  const today = todayISO();
  const name = lead?.contactName ? ` ${lead.contactName}` : "";
  return [
    {
      title: `Initial outreach to${name} (${lead?.companyName || "lead"})`,
      dueDate: shiftISODate(today, 1),
      priority: "high",
      notes: "First touch — use the drafted email sequence.",
    },
    {
      title: "Bump / follow-up if no reply",
      dueDate: shiftISODate(today, 4),
      priority: "normal",
      notes: "Polite nudge referencing the first message.",
    },
    {
      title: "Breakup email if still silent",
      dueDate: shiftISODate(today, 10),
      priority: "low",
      notes: "Close the loop politely; keep the door open.",
    },
  ];
}

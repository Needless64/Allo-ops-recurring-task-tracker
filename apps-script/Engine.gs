/**
 * Allo Innoware — Recurring Task Tracking, Pending Reports & Escalation
 * FILE 2 of 9 — cycle engine, completion, alerts, escalation, views.
 */

/* ------------------------------------------------------------------ */
/* Readers                                                             */
/* ------------------------------------------------------------------ */

function tasks_() {
  const t = table_(S.TASKS);
  const c = t.col;
  return t.rows.map(function (r, i) { return { rowIndex: i + 2, raw: r }; })
    .filter(function (x) { return String(x.raw[c.TaskID] || '').trim(); })
    .map(function (x) {
      const r = x.raw;
      return {
        rowIndex: x.rowIndex,
        id: String(r[c.TaskID]).trim(),
        name: String(r[c.TaskName] || '').trim(),
        employee: String(r[c.EmployeeName] || '').trim(),
        email: String(r[c.EmployeeEmail] || '').trim().toLowerCase(),
        frequency: String(r[c.Frequency] || '').trim().toUpperCase(),
        anchorDate: parseDate_(r[c.AnchorDate]),
        dueTime: hhmm_(r[c.DueTime]) || '18:00',
        grace: num_(r[c.GraceMinutes], 30),
        requiresTicket: truthy_(r[c.RequiresTicket]),
        ticketPattern: String(r[c.TicketPattern] || '').trim(),
        proofLabel: String(r[c.ProofLabel] || 'Proof').trim(),
        escalationRule: String(r[c.EscalationRule] || 'HOURS').trim().toUpperCase(),
        active: truthy_(r[c.Active]),
        ownerManager: String(r[c.OwnerManager] || '').trim().toLowerCase(),
        notes: String(r[c.Notes] || '').trim()
      };
    });
}

function cycles_() {
  const t = table_(S.CYCLES);
  const c = t.col;
  return t.rows.map(function (r, i) { return { rowIndex: i + 2, raw: r }; })
    .filter(function (x) { return String(x.raw[c.CycleID] || '').trim(); })
    .map(function (x) {
      const r = x.raw;
      return {
        rowIndex: x.rowIndex,
        id: String(r[c.CycleID]).trim(),
        taskId: String(r[c.TaskID] || '').trim(),
        cycleNo: num_(r[c.CycleNo], 0),
        scheduledDue: parseDate_(r[c.ScheduledDue]),
        dueAt: parseDate_(r[c.DueAt]),
        status: String(r[c.Status] || '').trim().toUpperCase(),
        createdAt: parseDate_(r[c.CreatedAt]),
        completedAt: parseDate_(r[c.CompletedAt]),
        completedBy: String(r[c.CompletedBy] || '').trim(),
        ticketId: String(r[c.TicketID] || '').trim(),
        note: String(r[c.ProofNote] || '').trim(),
        proofUrl: String(r[c.ProofURL] || '').trim(),
        lateMinutes: num_(r[c.LateByMinutes], 0),
        managerAlertAt: parseDate_(r[c.ManagerAlertAt]),
        managerAckAt: parseDate_(r[c.ManagerAckAt]),
        managerAckBy: String(r[c.ManagerAckBy] || '').trim(),
        escalatedAt: parseDate_(r[c.EscalatedAt]),
        escalationAckAt: parseDate_(r[c.EscalationAckAt]),
        key: String(r[c.IdempotencyKey] || '').trim(),
        updatedAt: parseDate_(r[c.LastUpdated]),
        submissionId: String(r[c.SubmissionID] || '').trim()
      };
    });
}

function getCycle_(cycleId) {
  const all = cycles_();
  for (let i = 0; i < all.length; i++) {
    if (all[i].id === String(cycleId)) return all[i];
  }
  return null;
}

function taskMap_() {
  const out = {};
  tasks_().forEach(function (t) { out[t.id] = t; });
  return out;
}

function pad_(n, width) {
  let s = String(n);
  while (s.length < width) s = '0' + s;
  return s;
}

/* ------------------------------------------------------------------ */
/* Cycle maths                                                         */
/* ------------------------------------------------------------------ */

function advance_(task, from, hols) {
  if (task.frequency === 'DAILY') {
    return atTime_(addWorkdays_(startOfDay_(from), 1, hols), task.dueTime);
  }
  const n = Number(task.frequency);
  if (!n || n < 1) throw new Error('Task ' + task.id + ' has an invalid frequency: ' + task.frequency);
  let d = atTime_(addDays_(from, n), task.dueTime);
  if (!isWorkday_(d, hols)) d = atTime_(nextWorkdayOnOrAfter_(d, hols), task.dueTime);
  return d;
}

/**
 * HYBRID basis: next = max(scheduled due, completed at) + cycle.
 * - completing early never pulls the cadence earlier;
 * - completing late never makes the next cycle instantly overdue.
 */
function computeNextDue_(task, last, now, hols) {
  if (!last || !last.scheduledDue) {
    const anchor = task.anchorDate || startOfDay_(now);
    let first = atTime_(anchor, task.dueTime);
    if (!isWorkday_(first, hols)) first = atTime_(nextWorkdayOnOrAfter_(first, hols), task.dueTime);
    let guard = 0;
    while (first.getTime() <= now.getTime() && guard++ < 400) first = advance_(task, first, hols);
    return first;
  }
  const sched = last.scheduledDue;
  const comp = last.completedAt || sched;
  const base = new Date(Math.max(sched.getTime(), comp.getTime()));
  let next = advance_(task, base, hols);
  let guard = 0;
  while (next.getTime() <= now.getTime() && guard++ < 400) next = advance_(task, next, hols);
  return next;
}

function cycleRow_(task, due, cycleNo, key, now) {
  const dueAt = new Date(due.getTime() + task.grace * 60000);
  return [
    task.id + '-C' + pad_(cycleNo, 4), task.id, cycleNo, due, dueAt, 'OPEN', now,
    '', '', '', '', '', '', '', '', '', '', '', key, now, ''
  ];
}

/**
 * Creates the next cycle for every active task that has no live cycle.
 * Idempotent by (task, due date) key and by the one-live-cycle invariant.
 */
function reconcileCycles_() {
  const tasks = tasks_().filter(function (t) { return t.active && t.frequency; });
  const all = cycles_();
  const hols = holidays_();
  const now = new Date();
  const seen = {};
  const live = {};
  const latest = {};

  all.forEach(function (c) {
    if (c.key) seen[c.key] = true;
    if (ACTIVE_STATES.indexOf(c.status) >= 0) live[c.taskId] = c;
    const cur = latest[c.taskId];
    if (!cur || c.cycleNo > cur.cycleNo) latest[c.taskId] = c;
  });

  const rows = [];
  const audit = [];

  tasks.forEach(function (task) {
    if (live[task.id]) return;
    let due = computeNextDue_(task, latest[task.id] || null, now, hols);
    let key = task.id + '|' + isoDate_(due);
    let guard = 0;
    while (seen[key] && guard++ < 64) {
      due = advance_(task, due, hols);
      key = task.id + '|' + isoDate_(due);
    }
    if (seen[key]) return;
    const cycleNo = ((latest[task.id] && latest[task.id].cycleNo) || 0) + 1;
    const row = cycleRow_(task, due, cycleNo, key, now);
    rows.push(row);
    audit.push([now, 'system', 'SYSTEM', 'CYCLE_CREATED', 'Cycle', row[0], '',
      'due=' + fmtDT_(due) + '; key=' + key, '', 'reconcile']);
    seen[key] = true;
    latest[task.id] = { cycleNo: cycleNo, scheduledDue: due, dueAt: due, completedAt: null, status: 'OPEN' };
  });

  if (rows.length) appendRows_(S.CYCLES, rows);
  auditRows_(audit);
  return { created: rows.length };
}

function escalationDeadline_(cycle, task) {
  if (task.escalationRule === 'NEXT_WORKDAY') {
    const d = addWorkdays_(startOfDay_(cycle.dueAt), 1, holidays_());
    return atTime_(d, cfg_().DAILY_ESCALATION_TIME || '11:00');
  }
  return new Date(cycle.dueAt.getTime() + num_(cfg_().ESCALATION_HOURS, 24) * 3600000);
}

/* ------------------------------------------------------------------ */
/* Tick                                                                */
/* ------------------------------------------------------------------ */

function tick() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) return { skipped: true, created: 0, sent: 0 };
  try {
    refreshCaches_();
    if (!validateConfig_()) return { error: 'config', created: 0, sent: 0 };
    const created = reconcileCycles_();
    markMissed_();
    enqueueEscalations_();
    enqueueReminders_();
    const sent = flushOutbox_();
    refreshPending_();
    refreshReview_();
    return { created: created.created, sent: sent.sent, deferred: sent.deferred || 0 };
  } finally {
    lock.releaseLock();
  }
}

function runTickNow() {
  if (!requireAdmin_()) {
    adminDenied_('Only an admin can run the automation on demand.');
    return null;
  }
  const r = tick();
  const ui = safeUi_();
  if (!ui) return r;
  let msg = 'Cycles created: ' + (r.created || 0) + '\nEmails sent: ' + (r.sent || 0);
  if (r.deferred) msg += '\nDeferred (quiet hours): ' + r.deferred;
  if (r.skipped) msg += '\nAnother run was already in progress.';
  if (r.error) msg += '\nStopped: configuration invalid (' + r.error + '). See AuditLog.';
  ui.alert('Automation run', msg, ui.ButtonSet.OK);
  return r;
}

function validateConfig_() {
  const c = cfg_();
  const good = function (e) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(e || '').trim()); };
  if (!good(c.MANAGER_EMAIL)) {
    failClosed_('MANAGER_EMAIL is missing or not a valid email.');
    return false;
  }
  return true;
}

function leadershipList_() {
  return String(cfg_().LEADERSHIP_EMAILS || '').split(',')
    .map(function (s) { return s.trim(); })
    .filter(function (s) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s); });
}

function failClosed_(message) {
  audit_('system', 'SYSTEM', 'CONFIG_INVALID', 'Config', '', message, 'alerts paused', '', 'tick');
  try { console.error('Allo Ops fail-closed: ' + message); } catch (e) { /* ignore */ }
}

/**
 * Retention stub: reports cycles older than RETENTION_MONTHS and prunes expired
 * single-use tokens. Archiving old cycles out of the live file is a deliberate
 * manual step so the audit trail is never silently destroyed.
 */
function retentionSweep() {
  refreshCaches_();
  const months = num_(cfg_().RETENTION_MONTHS, 24);
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);
  const old = cycles_().filter(function (c) {
    return c.completedAt && c.completedAt.getTime() < cutoff.getTime();
  }).length;

  const sh = sheet_(S.TOKENS);
  const t = table_(S.TOKENS);
  const c = t.col;
  let pruned = 0;
  for (let i = t.rows.length - 1; i >= 0; i--) {
    const exp = parseDate_(t.rows[i][c.ExpiresAt]);
    if (exp && exp.getTime() < Date.now() - 7 * 86400000) {
      sh.deleteRow(i + 2);
      pruned++;
    }
  }
  audit_('system', 'SYSTEM', 'RETENTION_CHECK', 'Cycles', '', '',
    old + ' cycle(s) older than ' + months + ' months; ' + pruned + ' expired token(s) pruned', '', 'trigger');
}

/* ------------------------------------------------------------------ */
/* Completion                                                          */
/* ------------------------------------------------------------------ */

function safeText_(v, max) {
  let s = String(v == null ? '' : v).replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
  if (s.length > max) s = s.slice(0, max);
  // Formula-injection guard: never let a stored value be evaluated.
  if (/^[=+\-@]/.test(s)) s = ' ' + s;
  return s;
}

function validateInput_(task, p) {
  const rawTicket = String(p.ticketId == null ? '' : p.ticketId).trim().toUpperCase();
  const rawNote = String(p.note == null ? '' : p.note).trim();
  const rawUrl = String(p.proofUrl == null ? '' : p.proofUrl).trim();
  const pattern = task.ticketPattern || cfg_().TICKET_PATTERN;

  if (task.requiresTicket) {
    if (!rawTicket) throw new Error('Ticket ID is required for this task.');
    if (rawTicket.length > 60) throw new Error('Ticket ID is too long.');
    let re = null;
    try { re = new RegExp(pattern); } catch (e) { re = null; }
    if (re && !re.test(rawTicket)) {
      throw new Error('Ticket ID does not match ' + pattern + ' (example: OPS-10234).');
    }
  } else if (rawNote.length < 10) {
    throw new Error('Add a short summary of the update (at least 10 characters).');
  }
  if (rawUrl) {
    if (!/^https:\/\//i.test(rawUrl)) throw new Error('Proof link must start with https://');
    if (rawUrl.length > 500) throw new Error('Proof link is too long.');
  }
  return { ticket: safeText_(rawTicket, 60), note: safeText_(rawNote, 200), url: rawUrl };
}

/**
 * A ticket is evidence for one cycle only. Returns the earlier cycle that already
 * carries this ticket, or null when it is unused.
 */
function ticketAlreadyUsed_(ticket, cycleId) {
  const want = String(ticket || '').trim().toUpperCase();
  if (!want) return null;
  const all = cycles_();
  for (let i = 0; i < all.length; i++) {
    const c = all[i];
    if (c.id === String(cycleId)) continue;
    if (String(c.ticketId || '').trim().toUpperCase() === want) return c;
  }
  return null;
}

function completeCycle_(cycleId, p) {
  p = p || {};
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { ok: false, error: 'The sheet is busy. Try again in a few seconds.' };
  try {
    const actor = actorEmail_();
    const email = actor.email;
    if (!email) {
      return { ok: false, error: 'Your Google account could not be identified. Open the sheet with your work account.' };
    }
    const cycle = getCycle_(cycleId);
    if (!cycle) return { ok: false, error: 'That task could not be found. Refresh and try again.' };
    if (cycle.status === 'COMPLETED') {
      return { ok: false, error: 'Already completed by ' + (cycle.completedBy || 'someone') + ' at ' + fmtDT_(cycle.completedAt) + '.' };
    }
    if (cycle.status === 'CANCELLED') return { ok: false, error: 'This cycle was cancelled.' };

    const task = taskMap_()[cycle.taskId];
    if (!task) return { ok: false, error: 'The task definition is missing from TaskMaster.' };

    if (actor.fallback) {
      audit_(email, 'SYSTEM', 'IDENTITY_FALLBACK', 'Cycle', cycle.id, '',
        'viewer email hidden by Google; demo fallback used', '', 'sidebar');
    }

    // Completion is always the assigned employee. Managers acknowledge; they do
    // not complete work on someone else's behalf.
    if (roleOf_(email) === 'NONE') {
      return { ok: false, error: 'Your account is not on the Allo Ops access list.' };
    }
    if (email !== task.email) {
      return { ok: false, error: 'This task belongs to ' + (task.employee || task.email) + '.' };
    }
    if (p.submissionId && cycle.submissionId && String(p.submissionId) === cycle.submissionId) {
      return { ok: false, error: 'That submission was already recorded.' };
    }

    const input = validateInput_(task, p);

    // Duplicate-proof guard: the same ticket cannot stand as proof twice. The
    // attempt is recorded before the refusal so managers can see what was tried.
    const reused = ticketAlreadyUsed_(input.ticket, cycle.id);
    if (reused) {
      const priorTask = taskMap_()[reused.taskId];
      const where = priorTask && priorTask.id !== task.id ? priorTask.name : 'this task';
      const when = fulfilledWhen_(reused);
      audit_(email, roleOf_(email), 'PROOF_DUPLICATE_BLOCKED', 'Cycle', cycle.id, '',
        'ticket=' + input.ticket + '; already used on ' + reused.id + ' (task ' + reused.taskId +
        ', cycle #' + reused.cycleNo + ')', p.submissionId || '', 'sidebar');
      return {
        ok: false,
        error: 'Ticket ' + input.ticket + ' was already used for ' + where +
          (when ? ' on ' + when : '') + '. Each cycle needs its own ticket reference.'
      };
    }

    const now = new Date();
    const late = Math.max(0, Math.round((now.getTime() - cycle.dueAt.getTime()) / 60000));
    const sh = sheet_(S.CYCLES);

    sh.getRange(cycle.rowIndex, CYC.STATUS).setValue('COMPLETED');
    sh.getRange(cycle.rowIndex, CYC.COMPLETED).setValue(now);
    sh.getRange(cycle.rowIndex, CYC.BY).setValue(email);
    sh.getRange(cycle.rowIndex, CYC.TICKET).setValue(input.ticket);
    sh.getRange(cycle.rowIndex, CYC.NOTE).setValue(input.note);
    sh.getRange(cycle.rowIndex, CYC.URL).setValue(input.url);
    sh.getRange(cycle.rowIndex, CYC.LATE).setValue(late);
    sh.getRange(cycle.rowIndex, CYC.UPD).setValue(now);
    sh.getRange(cycle.rowIndex, CYC.SUB).setValue(p.submissionId || '');

    const role = roleOf_(email);
    audit_(email, role, 'COMPLETED', 'Cycle', cycle.id,
      cycle.status, 'late=' + late + 'm; ticket=' + input.ticket + '; submission=' + (p.submissionId || ''),
      p.submissionId || '', 'sidebar');

    // The completion is already durable. A failure in bookkeeping must not turn a
    // successful save into an error the employee will retry.
    try { suppressAlerts_(cycle.id); } catch (e) {
      audit_('system', 'SYSTEM', 'ALERT_SUPPRESS_FAILED', 'Cycle', cycle.id, '', e.message || '', '', 'completion');
    }
    try { reconcileCycles_(); } catch (e) {
      audit_('system', 'SYSTEM', 'NEXT_CYCLE_FAILED', 'Cycle', cycle.id, '', e.message || '', '', 'completion');
    }

    const next = cycles_().filter(function (c) {
      return c.taskId === cycle.taskId && c.status === 'OPEN';
    }).sort(function (a, b) { return a.dueAt - b.dueAt; })[0];

    try { refreshPending_(); refreshReview_(); } catch (e) {
      audit_('system', 'SYSTEM', 'VIEW_REFRESH_FAILED', 'Cycle', cycle.id, '', e.message || '', '', 'completion');
    }

    return {
      ok: true,
      message: late > 0 ? 'Completed (late by ' + late + ' min). Next cycle is ready.' : 'Completed. Next cycle is ready.',
      nextDueLabel: next ? fmtDT_(next.dueAt) : '',
      nextDueIso: next ? next.dueAt.toISOString() : '',
      nextCycleNo: next ? next.cycleNo : '',
      lateMinutes: late
    };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  } finally {
    lock.releaseLock();
  }
}

function fulfilledWhen_(c) {
  const d = c.completedAt || c.scheduledDue;
  return d ? fmtDT_(d) : '';
}

function suppressAlerts_(cycleId) {
  const t = table_(S.ALERTS);
  const c = t.col;
  t.rows.forEach(function (r, i) {
    if (String(r[c.CycleID]) === cycleId && String(r[c.Status]) === 'PENDING') {
      t.sh.getRange(i + 2, c.Status + 1).setValue('SUPPRESSED');
    }
  });
}

/* ------------------------------------------------------------------ */
/* Detection + outbox                                                  */
/* ------------------------------------------------------------------ */

function markMissed_() {
  const now = new Date();
  const tasks = taskMap_();
  const sh = sheet_(S.CYCLES);
  cycles_().forEach(function (c) {
    if (c.status !== 'OPEN' || !c.dueAt || c.dueAt.getTime() > now.getTime()) return;
    const task = tasks[c.taskId];
    if (!task) return;
    sh.getRange(c.rowIndex, CYC.STATUS).setValue('MISSED');
    sh.getRange(c.rowIndex, CYC.MALERT).setValue(now);
    sh.getRange(c.rowIndex, CYC.UPD).setValue(now);
    audit_('system', 'SYSTEM', 'MISSED', 'Cycle', c.id, 'OPEN', 'due=' + fmtDT_(c.dueAt), '', 'tick');
    const mail = managerAlertEmail_(c, task);
    enqueue_('MGR_ALERT:' + c.id, c.id, 'MGR_ALERT', mail.to, mail.cc, mail.subject, mail.html);
  });
}

function enqueueEscalations_() {
  const now = new Date();
  const tasks = taskMap_();
  const sh = sheet_(S.CYCLES);
  cycles_().forEach(function (c) {
    if (c.status !== 'MISSED' && c.status !== 'OPEN') return;
    const task = tasks[c.taskId];
    if (!task) return;
    const deadline = escalationDeadline_(c, task);
    if (now.getTime() < deadline.getTime()) return;

    const firstEscalation = c.status !== 'ESCALATED';
    if (firstEscalation) {
      sh.getRange(c.rowIndex, CYC.STATUS).setValue('ESCALATED');
      sh.getRange(c.rowIndex, CYC.ESC).setValue(now);
      sh.getRange(c.rowIndex, CYC.UPD).setValue(now);
      audit_('system', 'SYSTEM', 'ESCALATED', 'Cycle', c.id, c.status,
        'deadline=' + fmtDT_(deadline) + '; managerAck=' + (c.managerAckAt ? 'yes' : 'no'), '', 'tick');
    }

    const mail = leadershipEmail_(c, task, deadline);
    if (!mail) {
      if (firstEscalation) {
        audit_('system', 'SYSTEM', 'ESCALATION_NO_RECIPIENTS', 'Cycle', c.id, '',
          'LEADERSHIP_EMAILS is empty; manager alert still works', '', 'tick');
      }
      return;
    }
    enqueue_('LEAD_ESC:' + c.id, c.id, 'LEAD_ESC', mail.to, mail.cc, mail.subject, mail.html);
  });
}

function enqueueReminders_() {
  const now = new Date();
  const tasks = taskMap_();
  cycles_().forEach(function (c) {
    if (c.status !== 'OPEN' && c.status !== 'MISSED') return;
    const task = tasks[c.taskId];
    if (!task) return;
    const remindAt = new Date(c.dueAt.getTime() + 2 * 3600000);
    if (now.getTime() < remindAt.getTime()) return;
    if (now.getTime() >= escalationDeadline_(c, task).getTime()) return;

    const html = emailShell_('Still pending: ' + task.name,
      '<p>This task is still not completed. Please finish it from <b>Allo Ops &gt; My tasks &amp; leave</b>.</p>',
      kvTable_([['Task', task.name], ['Due', fmtDT_(c.dueAt)], ['Required', task.proofLabel]]),
      '');
    enqueue_('EMP_REM:' + c.id, c.id, 'EMP_REM', task.email, '',
      '[Allo Ops] Still pending: ' + task.name, html);
  });
}

function enqueue_(key, cycleId, type, to, cc, subject, html) {
  const t = table_(S.ALERTS);
  const c = t.col;
  for (let i = 0; i < t.rows.length; i++) {
    if (String(t.rows[i][c.AlertKey]) === key) return false;
  }
  appendRows_(S.ALERTS, [[key, cycleId || '', type, 'EMAIL', to || '', cc || '', subject, html,
    'PENDING', 0, '', '', '']]);
  return true;
}

function flushOutbox_() {
  const t = table_(S.ALERTS);
  const c = t.col;
  const pending = [];
  t.rows.forEach(function (r, i) {
    if (String(r[c.Status]) === 'PENDING') pending.push({ r: r, row: i + 2 });
  });
  if (!pending.length) return { sent: 0, deferred: 0 };
  if (inQuietHours_()) return { sent: 0, deferred: pending.length };

  const byId = {};
  cycles_().forEach(function (cy) { byId[cy.id] = cy; });
  const quota = MailApp.getRemainingDailyQuota();
  const sh = sheet_(S.ALERTS);
  let sent = 0;

  for (let i = 0; i < pending.length; i++) {
    if (quota - i < 3) break;
    const item = pending[i];
    const r = item.r;
    const type = String(r[c.Type]);
    const cycle = byId[String(r[c.CycleID])];

    if ((type === 'MGR_ALERT' || type === 'LEAD_ESC') && cycle && cycle.status === 'COMPLETED') {
      sh.getRange(item.row, c.Status + 1).setValue('SUPPRESSED');
      continue;
    }
    const to = String(r[c.Recipients] || '').trim();
    if (!to) {
      sh.getRange(item.row, c.Status + 1).setValue('FAILED');
      sh.getRange(item.row, c.Error + 1).setValue('No recipients');
      continue;
    }
    try {
      // Sign the action URL at send time so no usable token is ever stored in the sheet.
      let html = String(r[c.Html] || '');
      const cid = String(r[c.CycleID] || '');
      if (cid) {
        html = html.replace(/\{\{ACK_URL\}\}/g, actionUrl_(cid, 'ACK'))
          .replace(/\{\{LEAD_ACK_URL\}\}/g, actionUrl_(cid, 'LEAD_ACK'));
      }
      const opts = {
        to: to,
        subject: String(r[c.Subject] || '[Allo Ops] Notification'),
        htmlBody: html,
        name: String(cfg_().COMPANY_NAME || 'Allo') + ' Ops'
      };
      const cc = String(r[c.Cc] || '').trim();
      if (cc) opts.cc = cc;
      MailApp.sendEmail(opts);
      sh.getRange(item.row, c.Status + 1).setValue('SENT');
      sh.getRange(item.row, c.Attempts + 1).setValue(num_(r[c.Attempts], 0) + 1);
      sh.getRange(item.row, c.Sent + 1).setValue(new Date());
      sent++;
    } catch (e) {
      sh.getRange(item.row, c.Status + 1).setValue('FAILED');
      sh.getRange(item.row, c.Attempts + 1).setValue(num_(r[c.Attempts], 0) + 1);
      sh.getRange(item.row, c.Error + 1).setValue(String(e.message || e).slice(0, 200));
    }
  }
  return { sent: sent, deferred: 0 };
}

/* ------------------------------------------------------------------ */
/* Email templates                                                     */
/* ------------------------------------------------------------------ */

function escHtml_(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function kvTable_(pairs) {
  const rows = pairs.map(function (p) {
    return '<tr><td style="padding:6px 12px 6px 0;color:#475467;white-space:nowrap">' + escHtml_(p[0]) +
      '</td><td style="padding:6px 0;color:#101828"><b>' + escHtml_(p[1]) + '</b></td></tr>';
  }).join('');
  return '<table style="border-collapse:collapse;margin:16px 0;font-size:14px">' + rows + '</table>';
}

function buttonHtml_(url, label) {
  if (!url) return '<p style="color:#667085;font-size:13px">Deploy the web app and run ' +
    '<b>Allo Ops &gt; Admin &gt; Set web app URL</b> to enable one-click action links. ' +
    'Until then, use ManagerReview in the sheet.</p>';
  return '<p style="margin:24px 0"><a href="' + escHtml_(url) +
    '" style="background:#1F6FEB;color:#fff;text-decoration:none;padding:11px 18px;border-radius:8px;' +
    'font-weight:600;display:inline-block">' + escHtml_(label) + '</a></p>';
}

function emailShell_(title, introHtml, bodyHtml, ctaHtml) {
  return '<div style="background:#F2F4F7;padding:24px;font-family:Arial,Helvetica,sans-serif">' +
    '<div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid #EAECF0;border-radius:12px;overflow:hidden">' +
    '<div style="background:#101828;color:#fff;padding:16px 24px;font-size:16px;font-weight:700">' +
    escHtml_(title) + '</div>' +
    '<div style="padding:24px;color:#101828;font-size:14px;line-height:1.55">' + introHtml +
    (bodyHtml || '') + (ctaHtml || '') + '</div>' +
    '<div style="padding:12px 24px;background:#F9FAFB;color:#667085;font-size:12px">' +
    'Automated message from the ' + escHtml_(cfg_().COMPANY_NAME || 'Allo') +
    ' recurring-task system. Do not reply.</div></div></div>';
}

function overdueLabel_(cycle, now) {
  const mins = Math.max(0, Math.round((now.getTime() - cycle.dueAt.getTime()) / 60000));
  if (mins < 60) return mins + ' min overdue';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h < 24) return h + 'h ' + m + 'm overdue';
  return Math.floor(h / 24) + 'd ' + (h % 24) + 'h overdue';
}

function managerAlertEmail_(cycle, task) {
  const employeeManager = (personFor_(task.email) || {}).managerEmail || '';
  const to = task.ownerManager || employeeManager || cfg_().MANAGER_EMAIL;
  const html = emailShell_('Task overdue: ' + task.name,
    '<p><b>' + escHtml_(task.name) + '</b> was not completed by <b>' + escHtml_(task.employee) +
    '</b> by its due time.</p>',
    kvTable_([
      ['Employee', task.employee + ' <' + task.email + '>'],
      ['Cycle', '#' + cycle.cycleNo + ' · ' + cycle.id],
      ['Due', fmtDT_(cycle.dueAt)],
      ['Progress', overdueLabel_(cycle, new Date())],
      ['Required', task.proofLabel],
      ['Status', 'MISSED']
    ]),
    buttonHtml_(webAppUrl_() ? '{{ACK_URL}}' : '', 'Acknowledge') +
    '<p style="color:#667085;font-size:13px">Acknowledging records your review. It does not close the task; ' +
    'completion does. Unresolved work escalates to leadership automatically.</p>');
  return {
    to: to,
    cc: '',
    subject: '[Allo Ops] Overdue: ' + task.name + ' — ' + task.employee,
    html: html
  };
}

function leadershipEmail_(cycle, task, deadline) {
  const leads = leadershipList_().join(',');
  if (!leads) return null;
  const employeeManager = (personFor_(task.email) || {}).managerEmail || '';
  const manager = String(task.ownerManager || employeeManager || cfg_().MANAGER_EMAIL || '').trim();
  const cc = leads.toLowerCase().split(',').indexOf(manager.toLowerCase()) >= 0 ? '' : manager;
  const html = emailShell_('Escalation: ' + task.name,
    '<p>Operational task <b>' + escHtml_(task.name) + '</b> remains unresolved past its escalation deadline ' +
    '(manager: ' + escHtml_(task.ownerManager || cfg_().MANAGER_EMAIL) + ').</p>',
    kvTable_([
      ['Employee', task.employee + ' <' + task.email + '>'],
      ['Cycle', '#' + cycle.cycleNo + ' · ' + cycle.id],
      ['Due', fmtDT_(cycle.dueAt)],
      ['Escalation deadline', fmtDT_(deadline)],
      ['Manager acknowledged', cycle.managerAckAt ? 'Yes — ' + fmtDT_(cycle.managerAckAt) : 'No'],
      ['Progress', overdueLabel_(cycle, new Date())]
    ]),
    buttonHtml_(webAppUrl_() ? '{{LEAD_ACK_URL}}' : '', 'Acknowledge escalation') +
    '<p style="color:#667085;font-size:13px">Completion by the employee stops further escalation for this cycle.</p>');
  return {
    to: leads,
    cc: cc,
    subject: '[Allo Ops] ESCALATION: ' + task.name + ' — ' + task.employee,
    html: html
  };
}

/* ------------------------------------------------------------------ */
/* Digests                                                             */
/* ------------------------------------------------------------------ */

function morningDigest() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return;
  try {
    refreshCaches_();
    if (!validateConfig_()) return;
    const tasks = taskMap_();
    const all = cycles_().filter(function (c) { return c.status === 'MISSED' || c.status === 'ESCALATED'; });
    if (!all.length) return;

    const managers = activeManagers_().length
      ? activeManagers_()
      : [{ email: String(cfg_().MANAGER_EMAIL || '').trim().toLowerCase(), name: 'Manager' }];
    managers.forEach(function (mgr) {
      const email = String(mgr.email || '').trim().toLowerCase();
      if (!email) return;
      const items = all.filter(function (c) { return canManageTask_(email, tasks[c.taskId]); });
      if (!items.length) return;

      const rows = items.map(function (c) {
        const t = tasks[c.taskId] || { employee: '', name: c.taskId };
        return [t.employee, t.name, fmtDT_(c.dueAt), c.status, c.managerAckAt ? 'yes' : 'no'];
      });
      const html = emailShell_('Daily pending digest — ' + items.length + ' item(s)',
        '<p>Recurring tasks in your scope that are still unresolved as of ' + escHtml_(fmtDT_(new Date())) + '.</p>',
        dataTable_(['Employee', 'Task', 'Due', 'Status', 'Acknowledged'], rows), '');
      enqueue_('MGR_DIGEST:' + isoDate_(new Date()) + ':' + email, '', 'MGR_DIGEST', email, '',
        '[Allo Ops] Daily pending digest — ' + items.length + ' item(s)', html);
    });
    flushOutbox_();
  } finally {
    lock.releaseLock();
  }
}

function weeklyLeadershipDigest() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return;
  try {
    refreshCaches_();
    if (!validateConfig_()) return;
    const tasks = taskMap_();
    const items = cycles_().filter(function (c) { return c.status === 'ESCALATED'; });
    if (!items.length) return;
    const leads = leadershipList_().join(',');
    if (!leads) return;
    const rows = items.map(function (c) {
      const t = tasks[c.taskId] || { employee: '', name: c.taskId };
      return [t.employee, t.name, fmtDT_(c.dueAt), c.escalationAckAt ? 'yes' : 'no'];
    });
    const html = emailShell_('Weekly escalations — ' + items.length + ' open',
      '<p>Escalated recurring tasks still open this week.</p>',
      dataTable_(['Employee', 'Task', 'Due', 'Lead acknowledged'], rows), '');
    enqueue_('LEAD_DIGEST:' + Utilities.formatDate(new Date(), tz_(), 'yyyy-ww'), '', 'LEAD_DIGEST',
      leads, '', '[Allo Ops] Weekly escalations — ' + items.length + ' open', html);
    flushOutbox_();
  } finally {
    lock.releaseLock();
  }
}

function dataTable_(headers, rows) {
  const head = headers.map(function (h) {
    return '<th style="text-align:left;padding:8px 10px;border-bottom:1px solid #EAECF0;color:#475467;font-size:12px">' +
      escHtml_(h) + '</th>';
  }).join('');
  const body = rows.map(function (r) {
    return '<tr>' + r.map(function (v) {
      return '<td style="padding:8px 10px;border-bottom:1px solid #F2F4F7;font-size:13px">' + escHtml_(v) + '</td>';
    }).join('') + '</tr>';
  }).join('');
  return '<table style="width:100%;border-collapse:collapse;margin:16px 0">' + head + body + '</table>';
}

/* ------------------------------------------------------------------ */
/* Acknowledgement                                                     */
/* ------------------------------------------------------------------ */

function ackCycle_(cycleId, kind, label, skipRefresh) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return { ok: false, error: 'The sheet is busy. Try again.' };
  try {
    const c = getCycle_(cycleId);
    if (!c) return { ok: false, error: 'Cycle not found.' };

    // Direct sidebar/sheet calls must be authorised. Signed email links are
    // verified by doGet() and pass the internal label.
    if (label !== 'signed email link') {
      const actor = callerEmail_();
      const task = taskMap_()[c.taskId];
      if (kind === 'leadership') {
        if (!isLeadership_(actor)) return { ok: false, error: 'Only leadership can acknowledge this escalation.' };
      } else if (!isManager_(actor) || !canManageTask_(actor, task)) {
        return { ok: false, error: 'You can acknowledge only tasks in your team.' };
      }
    }

    const now = new Date();
    const sh = sheet_(S.CYCLES);

    if (kind === 'leadership') {
      if (c.escalationAckAt) return { ok: true, already: true, at: c.escalationAckAt };
      sh.getRange(c.rowIndex, CYC.ESCACK).setValue(now);
    } else {
      if (c.managerAckAt) return { ok: true, already: true, at: c.managerAckAt };
      sh.getRange(c.rowIndex, CYC.MACK).setValue(now);
      sh.getRange(c.rowIndex, CYC.MACKBY).setValue(label || 'manager');
    }
    sh.getRange(c.rowIndex, CYC.UPD).setValue(now);
    audit_(label || 'manager', kind === 'leadership' ? 'LEADERSHIP' : 'MANAGER',
      kind === 'leadership' ? 'ESCALATION_ACK' : 'MANAGER_ACK', 'Cycle', cycleId, '',
      'ack=' + fmtDT_(now), '', 'link');
    if (!skipRefresh) {
      // The acknowledgement is already durable; a view refresh must not turn a
      // successful action into an error the manager will retry.
      try {
        refreshPending_();
        refreshReview_();
      } catch (e) {
        audit_(label || 'manager', 'MANAGER', 'VIEW_REFRESH_FAILED', 'Cycle', cycleId, '',
          String(e.message || e).slice(0, 200), '', 'ack');
      }
    }
    return { ok: true, at: now };
  } finally {
    lock.releaseLock();
  }
}

/* ------------------------------------------------------------------ */
/* Views                                                               */
/* ------------------------------------------------------------------ */

function refreshPending_() {
  const sh = sheet_(S.PENDING);
  const tasks = taskMap_();
  const all = cycles_();
  const now = new Date();

  const lastTicket = {};
  all.forEach(function (c) {
    if (c.status !== 'COMPLETED' || !c.ticketId) return;
    const cur = lastTicket[c.taskId];
    if (!cur || c.cycleNo > cur.cycleNo) lastTicket[c.taskId] = { cycleNo: c.cycleNo, ticket: c.ticketId };
  });

  const live = all.filter(function (c) { return ACTIVE_STATES.indexOf(c.status) >= 0; })
    .sort(function (a, b) { return a.dueAt - b.dueAt; });

  const rows = live.map(function (c) {
    const t = tasks[c.taskId];
    if (!t) return null;
    const late = Math.max(0, Math.round((now.getTime() - c.dueAt.getTime()) / 3600000 * 10) / 10);
    return [c.id, t.name, t.employee, c.scheduledDue, c.dueAt, c.status, c.cycleNo,
      t.proofLabel, (lastTicket[c.taskId] && lastTicket[c.taskId].ticket) || '', late, t.notes, 'Open'];
  }).filter(function (r) { return !!r; });

  sh.getRange(2, 1, Math.max(sh.getMaxRows() - 1, 1), H.PENDING.length).clearContent();
  if (rows.length) {
    sh.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
    sh.getRange(2, 4, rows.length, 2).setNumberFormat('dd mmm yyyy hh:mm');
  }
}

function refreshReview_() {
  const sh = sheet_(S.REVIEW);
  const tasks = taskMap_();
  const now = new Date();
  const prevComments = {};
  table_(S.REVIEW).rows.forEach(function (r) {
    if (r[0]) prevComments[String(r[0])] = r[7];
  });

  const items = cycles_().filter(function (c) { return c.status === 'MISSED' || c.status === 'ESCALATED'; })
    .sort(function (a, b) { return a.dueAt - b.dueAt; });

  const rows = items.map(function (c) {
    const t = tasks[c.taskId];
    if (!t) return null;
    const late = Math.max(0, Math.round((now.getTime() - c.dueAt.getTime()) / 3600000 * 10) / 10);
    return [c.id, t.employee, t.name, c.dueAt, c.status, late, !!c.managerAckAt,
      prevComments[c.id] || '', c.managerAckAt || ''];
  }).filter(function (r) { return !!r; });

  sh.getRange(2, 1, Math.max(sh.getMaxRows() - 1, 1), H.REVIEW.length).clearContent();
  if (rows.length) {
    sh.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
    sh.getRange(2, 4, rows.length, 1).setNumberFormat('dd mmm yyyy hh:mm');
    sh.getRange(2, 9, rows.length, 1).setNumberFormat('dd mmm yyyy hh:mm');
    sh.getRange(2, 7, rows.length, 1).insertCheckboxes();
  }
}

function refreshDashboard_() {
  const ss = getSS_();
  let sh = ss.getSheetByName(S.DASH);
  if (!sh) sh = ss.insertSheet(S.DASH);

  sh.clear();
  sh.setHiddenGridlines(true);
  sh.getRange('A1').setValue('Allo Innoware — Recurring Ops Dashboard').setFontSize(16).setFontWeight('bold');
  sh.getRange('A2').setValue('Live calculations from Cycles. Do not edit; it is rebuilt by the automation.')
    .setFontColor('#667085');

  const kpis = [
    ['A4', 'Open', 'B4', '=COUNTIF(Cycles!$F:$F,"OPEN")', '#FFFAEB', '#B54708'],
    ['C4', 'Missed', 'D4', '=COUNTIF(Cycles!$F:$F,"MISSED")', '#FEF3F2', '#B42318'],
    ['E4', 'Escalated', 'F4', '=COUNTIF(Cycles!$F:$F,"ESCALATED")', '#B42318', '#FFFFFF'],
    ['G4', 'Ack pending', 'H4', '=COUNTIFS(Cycles!$F:$F,"MISSED",Cycles!$O:$O,"")+COUNTIFS(Cycles!$F:$F,"ESCALATED",Cycles!$O:$O,"")', '#F2F4F7', '#344054'],
    ['I4', 'On-time %', 'J4', '=IFERROR(COUNTIFS(Cycles!$F:$F,"COMPLETED",Cycles!$M:$M,0)/COUNTIFS(Cycles!$F:$F,"COMPLETED"),0)', '#ECFDF3', '#067647']
  ];
  kpis.forEach(function (k) {
    sh.getRange(k[0]).setValue(k[1]).setFontWeight('bold').setFontSize(12);
    sh.getRange(k[2]).setFormula(k[3]).setFontWeight('bold').setFontSize(16)
      .setBackground(k[4]).setFontColor(k[5]).setHorizontalAlignment('center');
  });
  sh.getRange('J4').setNumberFormat('0%');

  const head = ['TaskID', 'Task', 'Employee', 'Frequency', 'Next due', 'Open', 'Missed', 'Escalated', 'Unacked'];
  sh.getRange(7, 1, 1, head.length).setValues([head]).setFontWeight('bold').setBackground('#EAECF0');
  sh.setFrozenRows(7);

  const active = tasks_().filter(function (t) { return t.active; }).sort(function (a, b) {
    return a.name.localeCompare(b.name);
  });
  const start = 8;
  sh.getRange(start, 1, Math.max(sh.getMaxRows() - start + 1, 1), head.length).clearContent();

  if (active.length) {
    // Row references are written explicitly so each formula points at its own row.
    const out = active.map(function (t, i) {
      const r = start + i;
      return [
        t.id, t.name, t.employee, t.frequency,
        '=IF(COUNTIFS(Cycles!$B:$B,$A' + r + ',Cycles!$F:$F,"<>COMPLETED")=0,"—",TEXT(MINIFS(Cycles!$D:$D,Cycles!$B:$B,$A' + r + ',Cycles!$F:$F,"<>COMPLETED"),"dd mmm hh:mm"))',
        '=COUNTIFS(Cycles!$B:$B,$A' + r + ',Cycles!$F:$F,"OPEN")',
        '=COUNTIFS(Cycles!$B:$B,$A' + r + ',Cycles!$F:$F,"MISSED")',
        '=COUNTIFS(Cycles!$B:$B,$A' + r + ',Cycles!$F:$F,"ESCALATED")',
        '=COUNTIFS(Cycles!$B:$B,$A' + r + ',Cycles!$F:$F,"MISSED",Cycles!$O:$O,"")'
      ];
    });
    sh.getRange(start, 1, out.length, out[0].length).setValues(out);
  }

  sh.setColumnWidth(1, 120);
  sh.setColumnWidth(2, 240);
  sh.setColumnWidth(3, 140);
  sh.setColumnWidth(5, 150);
  if (active.length) {
    const rules = [
      SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$F8>0')
        .setBackground('#FFFAEB').setFontColor('#B54708').setRanges([sh.getRange(8, 6, active.length, 1)]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$G8>0')
        .setBackground('#FEF3F2').setFontColor('#B42318').setRanges([sh.getRange(8, 7, active.length, 1)]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$H8>0')
        .setBackground('#B42318').setFontColor('#FFFFFF').setRanges([sh.getRange(8, 8, active.length, 1)]).build()
    ];
    sh.setConditionalFormatRules(rules);
  }
}

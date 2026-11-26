/**
 * Allo Innoware — Recurring Task Tracking, Pending Reports & Escalation
 * FILE 4 of 9 — demo / test helpers (menu > Allo Ops > Test tools).
 *
 * These create disposable TaskMaster rows and send REAL email.
 * Run them on a demo account before showing the evaluator.
 */

function devAlert_(title, message) {
  const ui = safeUi_();
  try { console.log(title + '\n' + message); } catch (e) { /* ignore */ }
  if (ui) ui.alert(title, message, ui.ButtonSet.OK);
}

function devAddTask_(name, frequency, dueTime, grace, requiresTicket, escalationRule) {
  const email = ownerEmail_();
  const id = 'T-TEST-' + Utilities.formatDate(new Date(), tz_(), 'HHmmss') + '-' +
    String(Math.floor(Math.random() * 900) + 100);
  appendRows_(S.TASKS, [[
    id, name, 'Test Employee', email, frequency, startOfDay_(new Date()), dueTime, grace,
    requiresTicket, '', requiresTicket ? 'Ticket ID' : 'Update summary', escalationRule || 'HOURS',
    true, cfg_().MANAGER_EMAIL, 'Disposable test row created by Test tools.'
  ]]);
  refreshCaches_();
  return id;
}

/** Test 4 — a task that becomes overdue two minutes from now, with no grace. */
function devCreateTestTask() {
  if (!devRequireAdmin_()) return;
  const due = new Date(Date.now() + 2 * 60000);
  const dueTime = Utilities.formatDate(due, tz_(), 'HH:mm');
  const id = devAddTask_('TEST — same-day alert', 'DAILY', dueTime, 0, false, 'NEXT_WORKDAY');
  reconcileCycles_();
  refreshPending_();
  refreshReview_();
  refreshDashboard_();
  devAlert_('Test task created',
    'Task ' + id + ' is due at ' + dueTime + ' today with zero grace.\n\n' +
    '1. Wait until that minute passes (at most ~3 minutes).\n' +
    '2. Menu > Allo Ops > Run automation now.\n' +
    '3. The task turns MISSED and a manager email is sent the same day.\n\n' +
    'A real email will be sent to ' + cfg_().MANAGER_EMAIL + '.');
}

/** Test 6 — forces a cycle 30 hours overdue so missed + leadership escalate in one tick. */
function devSeedEscalationTest() {
  if (!devRequireAdmin_()) return;
  const duePast = new Date(Date.now() - 2 * 3600000);
  const dueTime = Utilities.formatDate(duePast, tz_(), 'HH:mm');
  const id = devAddTask_('TEST — escalation path', '15', dueTime, 0, false, 'HOURS');
  reconcileCycles_();

  const open = cycles_().filter(function (c) { return c.taskId === id && c.status === 'OPEN'; })[0];
  if (!open) {
    devAlert_('Could not create test', 'No open cycle was created for ' + id + '.');
    return;
  }

  const when = new Date(Date.now() - 30 * 3600000);
  const sh = sheet_(S.CYCLES);
  sh.getRange(open.rowIndex, CYC.SCHED).setValue(when);
  sh.getRange(open.rowIndex, CYC.DUE).setValue(when);
  sh.getRange(open.rowIndex, CYC.UPD).setValue(new Date());
  audit_('dev', 'SYSTEM', 'DEV_FORCE_OVERDUE', 'Cycle', open.id, '', 'due=' + fmtDT_(when), '', 'dev');

  const run = tick();
  refreshDashboard_();
  devAlert_('Escalation test',
    'Cycle ' + open.id + ' was moved 30h into the past.\n\n' +
    'Missed alert + leadership escalation should both have fired now.\n\n' +
    'Cycles created: ' + (run.created || 0) + '\nEmails sent: ' + (run.sent || 0) + '\n\n' +
    'Check the manager and leadership inboxes, and Status=ESCALATED in Cycles.');
}

/** Test 4 shortcut — makes the oldest open cycle 3 hours overdue, then runs the tick. */
function devForceOverdue() {
  if (!devRequireAdmin_()) return;
  const open = cycles_().filter(function (c) { return c.status === 'OPEN'; })
    .sort(function (a, b) { return a.dueAt - b.dueAt; })[0];
  if (!open) {
    devAlert_('Nothing to force', 'There is no OPEN cycle. Create a test task first.');
    return;
  }
  const when = new Date(Date.now() - 3 * 3600000);
  const sh = sheet_(S.CYCLES);
  sh.getRange(open.rowIndex, CYC.SCHED).setValue(when);
  sh.getRange(open.rowIndex, CYC.DUE).setValue(when);
  sh.getRange(open.rowIndex, CYC.UPD).setValue(new Date());
  audit_('dev', 'SYSTEM', 'DEV_FORCE_OVERDUE', 'Cycle', open.id, '', 'due=' + fmtDT_(when), '', 'dev');

  const run = tick();
  refreshDashboard_();
  devAlert_('Cycle forced overdue',
    open.id + ' is now 3h overdue.\n\nEmails sent: ' + (run.sent || 0) +
    '\n\nIt will show as MISSED and appear in ManagerReview.');
}

/** Test 8 — proves the automation is replay-safe. */
function devRunTickThrice() {
  if (!devRequireAdmin_()) return;
  tick(); // settle any already-pending alert first, so the deltas below are only the 3 runs
  const before = devCounts_();
  const runs = [];
  for (let i = 0; i < 3; i++) runs.push(tick());
  const after = devCounts_();
  refreshDashboard_();

  const delta = {
    cycles: after.cycles - before.cycles,
    alerts: after.alerts - before.alerts,
    sent: after.sent - before.sent
  };

  devAlert_('Idempotency check',
    'Ran tick() three times back to back.\n\n' +
    'Before: ' + JSON.stringify(before) + '\n' +
    'After:  ' + JSON.stringify(after) + '\n' +
    'Delta:  ' + JSON.stringify(delta) + '\n\n' +
    'Expected: delta cycles 0 and delta sent 0 (no duplicate rows, no duplicate emails).\n' +
    'A new cycle is only created when a task is completed, not by re-running the automation.');
}

function devCounts_() {
  const a = table_(S.ALERTS);
  const c = a.col;
  let sent = 0, pending = 0, failed = 0, suppressed = 0;
  a.rows.forEach(function (r) {
    const s = String(r[c.Status]);
    if (s === 'SENT') sent++;
    else if (s === 'PENDING') pending++;
    else if (s === 'FAILED') failed++;
    else if (s === 'SUPPRESSED') suppressed++;
  });
  return {
    cycles: cycles_().length,
    alerts: a.rows.length,
    sent: sent,
    pending: pending,
    failed: failed,
    suppressed: suppressed
  };
}

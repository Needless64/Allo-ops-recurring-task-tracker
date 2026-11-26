/**
 * Allo Innoware — per-tab review sidebar (server side).
 *
 * FILE 5 of 9 — read-only views of every operational tab.
 * The sidebar opens on whichever tab is active and can switch between tabs
 * without changing the sheet selection. No writes are made from this file.
 */

const REVIEW_SPECS = {
  'START HERE': { title: 'Start here', kind: 'text', public: true },
  'Pending': {
    title: 'Pending report', kind: 'table', limit: 200, manager: true,
    columns: ['CycleID', 'Task', 'Employee', 'Due', 'Status', 'HoursOverdue', 'LastTicket', 'Action']
  },
  'ManagerReview': {
    title: 'Manager review', kind: 'table', limit: 200, manager: true,
    columns: ['CycleID', 'Employee', 'Task', 'Due', 'Status', 'HoursOverdue', 'Reviewed', 'Comment', 'AckedAt']
  },
  'ManagerDashboard': { title: 'Dashboard', kind: 'dashboard', manager: true },
  'TaskMaster': {
    title: 'Task master', kind: 'table', limit: 200, fromTop: true, manager: true,
    columns: ['TaskID', 'TaskName', 'EmployeeName', 'EmployeeEmail', 'Frequency', 'DueTime',
      'GraceMinutes', 'Active', 'OwnerManager']
  },
  'Cycles': {
    title: 'Cycle ledger', kind: 'table', limit: 150, manager: true,
    columns: ['CycleID', 'TaskID', 'CycleNo', 'ScheduledDue', 'DueAt', 'Status', 'CompletedAt',
      'CompletedBy', 'TicketID', 'LateByMinutes', 'ManagerAckAt', 'EscalatedAt']
  },
  'AlertLedger': {
    title: 'Alert ledger', kind: 'table', limit: 100,
    columns: ['AlertKey', 'Type', 'Recipients', 'Subject', 'Status', 'SentAt', 'Error']
  },
  'AuditLog': {
    title: 'Audit log', kind: 'table', limit: 150,
    columns: ['Timestamp', 'Actor', 'Role', 'Action', 'Entity', 'EntityID', 'After']
  },
  'Config': {
    title: 'Configuration', kind: 'table', limit: 100,
    columns: ['Key', 'Value', 'Notes']
  },
  'Holidays': {
    title: 'Holidays', kind: 'table', limit: 200, manager: true,
    columns: ['Date', 'Description']
  },
  'LeaveRequests': {
    title: 'Leave requests', kind: 'table', limit: 200,
    columns: ['RequestID', 'Email', 'Name', 'FromDate', 'ToDate', 'Days', 'Type', 'Status',
      'ManagerEmail', 'DecidedBy', 'DecisionNote']
  },
  'UsedTokens': {
    title: 'Used links', kind: 'table', limit: 50,
    columns: ['Nonce', 'CycleID', 'Action', 'ExpiresAt', 'UsedAt']
  }
};

function reviewActor_() {
  const email = callerEmail_();
  return email ? { email: email } : null;
}

function canReview_(role, name) {
  if (role === 'NONE') return false;
  if (role === 'ADMIN') return !!REVIEW_SPECS[name];
  if (name === S.START) return true;
  if (role === 'MANAGER') return !!(REVIEW_SPECS[name] && REVIEW_SPECS[name].manager);
  return false;
}

function reviewTabs_(ss, role) {
  return ss.getSheets().map(function (sh) {
    const name = sh.getName();
    if (!canReview_(role, name)) return null;
    return {
      name: name,
      hidden: sh.isSheetHidden(),
      allowed: true
    };
  }).filter(function (x) { return !!x; });
}

function getReviewContext() {
  try {
    const actor = reviewActor_();
    if (!actor) {
      return {
        ok: false,
        code: 'AUTH',
        error: 'Sign in with your Google account and open this sidebar from the sheet.'
      };
    }
    const role = roleOf_(actor.email);
    if (role === 'NONE') {
      return { ok: false, code: 'FORBIDDEN', error: 'Your account is not on the Allo Ops access list.' };
    }
    const ss = getSS_();
    const active = ss.getActiveSheet();
    return {
      ok: true,
      email: actor.email,
      role: role,
      admin: role === 'ADMIN',
      manager: role === 'ADMIN' || role === 'MANAGER',
      company: String(cfg_().COMPANY_NAME || 'Allo Innoware'),
      active: active ? active.getName() : '',
      tabs: reviewTabs_(ss, role)
    };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

function visibleCycleIds_(email) {
  const tasks = visibleTaskIds_(email);
  const out = {};
  cycles_().forEach(function (c) {
    if (tasks[c.taskId]) out[c.id] = true;
  });
  return out;
}

function filterReviewRows_(name, head, rows, role, email) {
  if (role !== 'MANAGER') return rows;

  const taskCol = head.indexOf('TaskID');
  if (taskCol >= 0) {
    const ids = visibleTaskIds_(email);
    return rows.filter(function (r) { return !!ids[String(r[taskCol] || '').trim()]; });
  }

  const cycleCol = head.indexOf('CycleID');
  if (cycleCol >= 0) {
    const ids = visibleCycleIds_(email);
    return rows.filter(function (r) { return !!ids[String(r[cycleCol] || '').trim()]; });
  }

  return rows;
}

function getSheetReview(name) {
  try {
    const actor = reviewActor_();
    if (!actor) {
      return { ok: false, code: 'AUTH', error: 'Sign in with your Google account.' };
    }

    const sheetName = String(name || '').trim();
    const spec = REVIEW_SPECS[sheetName];
    if (!spec) return { ok: false, error: 'This tab is not configured for review.' };

    const role = roleOf_(actor.email);
    if (!canReview_(role, sheetName)) {
      return { ok: false, code: 'FORBIDDEN', error: 'This tab is not available for your role.' };
    }

    const ss = getSS_();
    const sh = ss.getSheetByName(sheetName);
    if (!sh) return { ok: false, error: 'That tab no longer exists. Run setup to repair the sheet.' };

    const shared = {
      ok: true,
      name: sheetName,
      title: spec.title,
      hidden: sh.isSheetHidden(),
      role: role,
      admin: role === 'ADMIN',
      canOpen: role === 'ADMIN',
      tabs: reviewTabs_(ss, role)
    };

    if (spec.kind === 'text') {
      const height = Math.max(sh.getLastRow(), 1);
      const lines = sh.getRange(1, 1, height, 1).getDisplayValues();
      return Object.assign(shared, {
        kind: 'text',
        text: lines.map(function (r) { return r[0]; }).join('\n'),
        total: 0,
        shown: 0,
        headers: [],
        rows: [],
        summary: []
      });
    }

    if (spec.kind === 'dashboard') {
      const data = role === 'MANAGER' ? managerDashboard_(actor.email) : reviewDashboard_(sh);
      return Object.assign(shared, data);
    }

    const lastRow = sh.getLastRow();
    const lastCol = sh.getLastColumn();
    if (!lastRow || !lastCol) {
      return Object.assign(shared, {
        kind: 'table', headers: spec.columns || [], rows: [], total: 0, shown: 0, summary: []
      });
    }

    const head = sh.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
    const all = lastRow > 1 ? sh.getRange(2, 1, lastRow - 1, lastCol).getDisplayValues() : [];
    const filtered = filterReviewRows_(sheetName, head, all, role, actor.email);
    const total = filtered.length;
    const limit = spec.limit || 0;
    const count = limit ? Math.min(limit, total) : total;
    const values = spec.fromTop ? filtered.slice(0, count) : filtered.slice(Math.max(0, total - count));

    const wanted = spec.columns || head;
    const indexes = [];
    wanted.forEach(function (label) {
      const i = head.indexOf(label);
      if (i >= 0) indexes.push(i);
    });

    const headers = indexes.map(function (i) { return head[i]; });
    const rows = values.map(function (r) {
      return indexes.map(function (i) { return String(r[i] == null ? '' : r[i]); });
    }).filter(function (row) {
      return String(row[0] == null ? '' : row[0]).trim() !== '';
    });

    return Object.assign(shared, {
      kind: 'table',
      headers: headers,
      rows: rows,
      total: total,
      shown: rows.length,
      summary: reviewSummary_(sheetName, head, filtered)
    });
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

function reviewDashboard_(sh) {
  const summary = [];
  const pairs = [['A4', 'B4'], ['C4', 'D4'], ['E4', 'F4'], ['G4', 'H4'], ['I4', 'J4']];
  pairs.forEach(function (p) {
    const label = String(sh.getRange(p[0]).getDisplayValue() || '').trim();
    if (!label) return;
    const value = String(sh.getRange(p[1]).getDisplayValue() || '').trim();
    const tone = /missed|escalat/i.test(label) ? 'alert'
      : /ack pending/i.test(label) ? 'warn'
        : /on-time/i.test(label) ? 'good' : '';
    summary.push({ label: label, value: value, tone: tone });
  });

  let headers = [];
  let rows = [];
  if (sh.getLastRow() >= 7) {
    headers = sh.getRange(7, 1, 1, 9).getDisplayValues()[0];
    if (sh.getLastRow() >= 8) {
      rows = sh.getRange(8, 1, sh.getLastRow() - 7, 9).getDisplayValues().map(function (r) {
        return r.map(function (v) { return String(v == null ? '' : v); });
      });
    }
  }

  return {
    kind: 'dashboard',
    headers: headers,
    rows: rows,
    total: rows.length,
    shown: rows.length,
    summary: summary
  };
}

function managerDashboard_(email) {
  const visible = visibleTaskIds_(email);
  const tasks = taskMap_();
  const cycles = cycles_().filter(function (c) { return !!visible[c.taskId]; });
  const active = cycles.filter(function (c) { return ACTIVE_STATES.indexOf(c.status) >= 0; })
    .sort(function (a, b) { return (a.dueAt || 0) - (b.dueAt || 0); });
  const completed = cycles.filter(function (c) { return c.status === 'COMPLETED'; });
  const onTime = completed.filter(function (c) { return num_(c.lateMinutes, 0) <= 0; }).length;

  function count(status) {
    return active.filter(function (c) { return c.status === status; }).length;
  }
  const ackPending = active.filter(function (c) {
    return (c.status === 'MISSED' || c.status === 'ESCALATED') && !c.managerAckAt;
  }).length;
  const pct = completed.length ? Math.round(onTime * 100 / completed.length) + '%' : '—';

  const rows = active.slice(0, 100).map(function (c) {
    const t = tasks[c.taskId] || { employee: '', name: c.taskId };
    return [c.id, t.employee, t.name, fmtDT_(c.dueAt), c.status, overdueShort_(c), c.managerAckAt ? 'Yes' : 'No'];
  });

  return {
    kind: 'dashboard',
    headers: ['CycleID', 'Employee', 'Task', 'Due', 'Status', 'Overdue', 'Ack'],
    rows: rows,
    total: active.length,
    shown: rows.length,
    summary: [
      { label: 'Open', value: count('OPEN'), tone: '' },
      { label: 'Missed', value: count('MISSED'), tone: count('MISSED') ? 'alert' : '' },
      { label: 'Escalated', value: count('ESCALATED'), tone: count('ESCALATED') ? 'alert' : '' },
      { label: 'Ack pending', value: ackPending, tone: ackPending ? 'warn' : '' },
      { label: 'On-time', value: pct, tone: 'good' }
    ]
  };
}

function overdueShort_(c) {
  if (!c || !c.dueAt) return '';
  const mins = Math.max(0, Math.round((Date.now() - c.dueAt.getTime()) / 60000));
  if (mins < 60) return mins + 'm';
  const h = Math.floor(mins / 60);
  if (h < 24) return h + 'h ' + (mins % 60) + 'm';
  return Math.floor(h / 24) + 'd ' + (h % 24) + 'h';
}

function reviewSummary_(name, head, rows) {
  const out = [];
  const total = rows.length;

  function fullColumn(header) {
    const i = head.indexOf(header);
    if (i < 0 || !total) return [];
    return rows.map(function (r) { return [r[i]]; });
  }

  function tally(values) {
    const counts = {};
    values.forEach(function (r) {
      const k = String(r[0] == null ? '' : r[0]).trim().toUpperCase();
      if (k) counts[k] = (counts[k] || 0) + 1;
    });
    return counts;
  }

  if (name === 'TaskMaster') {
    const ids = fullColumn('TaskID');
    const active = fullColumn('Active');
    const freqs = fullColumn('Frequency');
    let tasks = 0;
    let on = 0;
    let off = 0;
    const freq = {};
    ids.forEach(function (r, i) {
      if (!String(r[0] == null ? '' : r[0]).trim()) return;
      tasks++;
      if (truthy_(active[i] && active[i][0])) on++; else off++;
      const f = String(freqs[i] && freqs[i][0] ? freqs[i][0] : '').trim().toUpperCase();
      if (f) freq[f] = (freq[f] || 0) + 1;
    });
    out.push({ label: 'Tasks', value: tasks, tone: '' });
    out.push({ label: 'Active', value: on, tone: 'good' });
    out.push({ label: 'Paused', value: off, tone: '' });
    if (freq.DAILY) out.push({ label: 'Daily', value: freq.DAILY, tone: '' });
    return out;
  }

  if (name === 'Holidays') {
    const dates = fullColumn('Date');
    const today = startOfDay_(new Date()).getTime();
    let upcoming = 0;
    dates.forEach(function (r) {
      const d = parseDate_(r[0]);
      if (d && startOfDay_(d).getTime() >= today) upcoming++;
    });
    out.push({ label: 'Dates', value: total, tone: '' });
    out.push({ label: 'Upcoming', value: upcoming, tone: '' });
    return out;
  }

  if (name === 'Config') {
    let demo = '';
    rows.forEach(function (r) {
      if (String(r[0]).trim() === 'DEMO_MODE') demo = String(r[1]).trim();
    });
    out.push({ label: 'Keys', value: total, tone: '' });
    if (demo) out.push({ label: 'Demo mode', value: demo, tone: /true/i.test(demo) ? 'warn' : 'good' });
    return out;
  }

  if (name === 'LeaveRequests') {
    const leaveStatus = tally(fullColumn('Status'));
    out.push({ label: 'Requests', value: total, tone: '' });
    out.push({ label: 'Pending', value: leaveStatus.PENDING || 0, tone: leaveStatus.PENDING ? 'warn' : '' });
    out.push({ label: 'Approved', value: leaveStatus.APPROVED || 0, tone: 'good' });
    out.push({ label: 'Rejected', value: leaveStatus.REJECTED || 0, tone: leaveStatus.REJECTED ? 'alert' : '' });
    return out;
  }

  if (name === 'AuditLog') {
    out.push({ label: 'Entries', value: total, tone: '' });
    if (total) {
      out.push({ label: 'Latest', value: rows[rows.length - 1][0], tone: '' });
    }
    return out;
  }

  if (name === 'UsedTokens') {
    out.push({ label: 'Consumed links', value: total, tone: '' });
    return out;
  }

  const status = tally(fullColumn('Status'));
  out.push({ label: 'Rows', value: total, tone: '' });

  if (name === 'AlertLedger') {
    out.push({ label: 'Sent', value: status.SENT || 0, tone: 'good' });
    out.push({ label: 'Pending', value: status.PENDING || 0, tone: status.PENDING ? 'warn' : '' });
    out.push({ label: 'Failed', value: status.FAILED || 0, tone: status.FAILED ? 'alert' : '' });
    return out;
  }

  out.push({ label: 'Open', value: status.OPEN || 0, tone: '' });
  out.push({ label: 'Missed', value: status.MISSED || 0, tone: status.MISSED ? 'alert' : '' });
  out.push({ label: 'Escalated', value: status.ESCALATED || 0, tone: status.ESCALATED ? 'alert' : '' });
  if (name === 'Cycles' && status.COMPLETED) {
    out.push({ label: 'Completed', value: status.COMPLETED, tone: 'good' });
  }
  return out;
}

function activateSheet(name) {
  try {
    const actor = reviewActor_();
    if (!actor) return { ok: false, code: 'AUTH', error: 'Sign in with your Google account.' };

    const sheetName = String(name || '').trim();
    const spec = REVIEW_SPECS[sheetName];
    if (!spec) return { ok: false, error: 'This tab is not configured for review.' };

    const role = roleOf_(actor.email);
    if (role !== 'ADMIN') {
      return { ok: false, code: 'FORBIDDEN', error: 'Raw sheet tabs are admin-only. Use the review sidebar for your scoped view.' };
    }
    if (!canReview_(role, sheetName)) {
      return { ok: false, code: 'FORBIDDEN', error: 'This tab is not available for your role.' };
    }

    const ss = getSS_();
    const sh = ss.getSheetByName(sheetName);
    if (!sh) return { ok: false, error: 'That tab no longer exists.' };
    if (sh.isSheetHidden()) {
      return { ok: false, error: 'This tab is hidden. Unhide it from the tab bar first.' };
    }

    ss.setActiveSheet(sh);
    return { ok: true, name: sheetName };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

function showReviewSidebar() {
  const ui = safeUi_();
  if (!ui) return;
  const html = HtmlService.createHtmlOutputFromFile('Review1')
    .setTitle('Review')
    .setWidth(460);
  ui.showSidebar(html);
}

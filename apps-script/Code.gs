/**
 * Allo Innoware — Recurring Task Tracking, Pending Reports & Escalation
 * FILE 1 of 9 — schema, setup, shared utilities, menu.
 *
 * Container-bound script. Paste, then run setup() once.
 */

const S = {
  CONFIG: 'Config',
  TASKS: 'TaskMaster',
  CYCLES: 'Cycles',
  PENDING: 'Pending',
  REVIEW: 'ManagerReview',
  DASH: 'ManagerDashboard',
  AUDIT: 'AuditLog',
  ALERTS: 'AlertLedger',
  HOLIDAYS: 'Holidays',
  TOKENS: 'UsedTokens',
  PEOPLE: 'People',
  LEAVE: 'LeaveRequests',
  START: 'START HERE'
};

const H = {
  CONFIG: ['Key', 'Value', 'Notes'],
  TASKS: ['TaskID', 'TaskName', 'EmployeeName', 'EmployeeEmail', 'Frequency', 'AnchorDate', 'DueTime',
    'GraceMinutes', 'RequiresTicket', 'TicketPattern', 'ProofLabel', 'EscalationRule', 'Active',
    'OwnerManager', 'Notes'],
  CYCLES: ['CycleID', 'TaskID', 'CycleNo', 'ScheduledDue', 'DueAt', 'Status', 'CreatedAt', 'CompletedAt',
    'CompletedBy', 'TicketID', 'ProofNote', 'ProofURL', 'LateByMinutes', 'ManagerAlertAt', 'ManagerAckAt',
    'ManagerAckBy', 'EscalatedAt', 'EscalationAckAt', 'IdempotencyKey', 'LastUpdated', 'SubmissionID'],
  PENDING: ['CycleID', 'Task', 'Employee', 'ScheduledDue', 'Due', 'Status', 'Cycle', 'ProofRequired',
    'LastTicket', 'HoursOverdue', 'SOP', 'Action'],
  REVIEW: ['CycleID', 'Employee', 'Task', 'Due', 'Status', 'HoursOverdue', 'Reviewed', 'Comment', 'AckedAt'],
  AUDIT: ['Timestamp', 'Actor', 'Role', 'Action', 'Entity', 'EntityID', 'Before', 'After', 'RequestID', 'Source'],
  ALERTS: ['AlertKey', 'CycleID', 'Type', 'Channel', 'Recipients', 'Cc', 'Subject', 'Html', 'Status',
    'Attempts', 'SentAt', 'MessageRef', 'Error'],
  HOLIDAYS: ['Date', 'Description'],
  TOKENS: ['Nonce', 'CycleID', 'Action', 'ExpiresAt', 'UsedAt', 'UsedByIP'],
  PEOPLE: ['Email', 'Name', 'Role', 'ManagerEmail', 'Active', 'AddedAt', 'AddedBy', 'UpdatedAt', 'UpdatedBy', 'Notes'],
  LEAVE: ['RequestID', 'Email', 'Name', 'FromDate', 'ToDate', 'Days', 'Type', 'Reason', 'Status',
    'ManagerEmail', 'CreatedAt', 'DecidedBy', 'DecidedAt', 'DecisionNote', 'UpdatedAt']
};

/* 1-based column maps — keep in sync with H above. */
const CYC = {
  ID: 1, TASK: 2, NO: 3, SCHED: 4, DUE: 5, STATUS: 6, CREATED: 7, COMPLETED: 8, BY: 9,
  TICKET: 10, NOTE: 11, URL: 12, LATE: 13, MALERT: 14, MACK: 15, MACKBY: 16, ESC: 17,
  ESCACK: 18, KEY: 19, UPD: 20, SUB: 21
};
const TSK = {
  ID: 1, NAME: 2, EMP: 3, EMAIL: 4, FREQ: 5, ANCHOR: 6, TIME: 7, GRACE: 8, TICKET_REQ: 9,
  PATTERN: 10, PROOF: 11, ESC_RULE: 12, ACTIVE: 13, MANAGER: 14, NOTES: 15
};
const ALR = {
  KEY: 1, CYCLE: 2, TYPE: 3, CHANNEL: 4, TO: 5, CC: 6, SUBJECT: 7, HTML: 8, STATUS: 9,
  ATTEMPTS: 10, SENT: 11, REF: 12, ERROR: 13
};

const ACTIVE_STATES = ['OPEN', 'MISSED', 'ESCALATED'];

const CONFIG_DEFAULTS = [
  ['TIMEZONE', 'Asia/Kolkata', 'Must match File > Project Settings > time zone'],
  ['WORKDAYS', 'Mon,Tue,Wed,Thu,Fri', 'Days a task can fall due'],
  ['WORK_START', '09:30', 'Start of working window'],
  ['WORK_END', '18:30', 'End of working window'],
  ['QUIET_START', '22:00', 'No alert emails from this time'],
  ['QUIET_END', '08:00', '...until this time (queued, then sent)'],
  ['MANAGER_EMAIL', '', 'Receives missed-task alerts and the morning digest'],
  ['LEADERSHIP_EMAILS', '', 'Comma separated. Receives escalations'],
  ['ADMIN_EMAIL', '', 'Bootstrap admin during setup; ongoing roles live in People'],
  ['GRACE_MINUTES', '30', 'Default grace before a task is MISSED'],
  ['ESCALATION_HOURS', '24', 'MISSED -> leadership, for 7/15/30-day tasks'],
  ['DAILY_ESCALATION_TIME', '11:00', 'Daily tasks escalate at this time next working day'],
  ['NEXT_CYCLE_BASIS', 'HYBRID', 'max(due, completed) + cycle'],
  ['MAX_MANAGER_EMAILS_PER_CYCLE', '1', 'Anti-spam guard'],
  ['TICKET_PATTERN', '^[A-Z]{2,6}-\\d{4,8}$', 'Default ticket format'],
  ['RETENTION_MONTHS', '24', 'Archive window for old cycles'],
  ['TOKEN_TTL_HOURS', '72', 'Signed action-link lifetime'],
  ['ALLOW_IDENTITY_FALLBACK', 'TRUE', 'Demo safety: if the viewer email is hidden, act as the sheet owner. Set FALSE for production.'],
  ['DEMO_MODE', 'TRUE', 'Lets any sheet editor see and complete the demo tasks. MUST be FALSE for production.'],
  ['COMPANY_NAME', 'Allo Innoware', 'Used in email subjects and bodies']
];

let _CFG = null;
let _WD = null;
let _HOL = null;
let _SS = null;

/* ------------------------------------------------------------------ */
/* Sheet + identity helpers                                            */
/* ------------------------------------------------------------------ */

function getSS_() {
  if (_SS) return _SS;
  const props = PropertiesService.getScriptProperties();
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) {
    if (props.getProperty('SPREADSHEET_ID') !== active.getId()) {
      props.setProperty('SPREADSHEET_ID', active.getId());
    }
    _SS = active;
    return _SS;
  }
  // Web apps have no active spreadsheet; fall back to the id captured at setup.
  const id = props.getProperty('SPREADSHEET_ID');
  if (id) {
    _SS = SpreadsheetApp.openById(id);
    return _SS;
  }
  throw new Error('Open this script from the Google Sheet it belongs to, then run setup().');
}

function sheet_(name) {
  const sh = getSS_().getSheetByName(name);
  if (!sh) throw new Error('Missing tab "' + name + '". Run setup() first.');
  return sh;
}

function callerEmail_() {
  try {
    return String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
  } catch (e) {
    return '';
  }
}

function ownerEmail_() {
  const a = callerEmail_();
  if (a) return a;
  try {
    return String(Session.getEffectiveUser().getEmail() || '').trim().toLowerCase();
  } catch (e) {
    return '';
  }
}

/**
 * Resolves the acting identity. Returns fallback=true when the viewer's email is
 * hidden by Google (cross-domain editor) and the demo fallback is enabled.
 */
function actorEmail_() {
  const active = callerEmail_();
  if (active) return { email: active, fallback: false };
  if (truthy_(cfg_().ALLOW_IDENTITY_FALLBACK)) {
    try {
      const eff = String(Session.getEffectiveUser().getEmail() || '').trim().toLowerCase();
      if (eff) return { email: eff, fallback: true };
    } catch (e) { /* ignore */ }
  }
  return { email: '', fallback: false };
}

function safeUi_() {
  try {
    return SpreadsheetApp.getUi();
  } catch (e) {
    return null;
  }
}

function refreshCaches_() {
  _CFG = null;
  _WD = null;
  _HOL = null;
}

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */

function cfg_() {
  if (_CFG) return _CFG;
  const out = {};
  CONFIG_DEFAULTS.forEach(function (d) { out[d[0]] = d[1]; });
  try {
    const t = table_(S.CONFIG);
    t.rows.forEach(function (r) {
      const k = String(r[0] == null ? '' : r[0]).trim();
      if (k) out[k] = r[1];
    });
  } catch (e) { /* setup not run yet */ }
  _CFG = out;
  return out;
}

function tz_() {
  try { return String(cfg_().TIMEZONE || 'Asia/Kolkata'); } catch (e) { return 'Asia/Kolkata'; }
}

/* ------------------------------------------------------------------ */
/* Dates + working days                                                */
/* ------------------------------------------------------------------ */

function num_(v, fallback) {
  if (v === '' || v == null) return fallback;
  const n = Number(v);
  return isNaN(n) ? fallback : n;
}

function truthy_(v) {
  if (v === true) return true;
  const s = String(v == null ? '' : v).trim().toUpperCase();
  return s === 'TRUE' || s === 'YES' || s === '1' || s === 'Y';
}

function parseDate_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) return v;
  if (typeof v === 'number' && isFinite(v)) return new Date(v);
  if (typeof v === 'string' && v.trim()) {
    const d = new Date(v.trim());
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

function parseHHMM_(s, fallback) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s == null ? '' : s).trim());
  if (!m) return parseHHMM_(fallback || '18:00', '18:00');
  return { h: Math.min(23, Number(m[1])), m: Math.min(59, Number(m[2])) };
}

/**
 * Reads a DueTime cell as HH:MM. Writing "18:00" into a cell with an automatic
 * number format makes Sheets store it as a time value, which getValues() hands
 * back as a Date on 30 Dec 1899 (the Sheets epoch day). That string then broke
 * the HH:MM check in saveTask and rendered as "Sat Dec 30 1899 18:00:00".
 */
function hhmm_(v) {
  const pad = function (n) { return (n < 10 ? '0' : '') + n; };
  if (v instanceof Date && !isNaN(v.getTime())) return fmtTime_(v);
  if (typeof v === 'number' && isFinite(v)) {
    let frac = v % 1;
    if (frac < 0) frac += 1;
    const mins = Math.round(frac * 24 * 60) % (24 * 60);
    return pad(Math.floor(mins / 60)) + ':' + pad(mins % 60);
  }
  const s = String(v == null ? '' : v).trim();
  if (!s) return '';
  const m = /^(\d{1,2}):(\d{2})/.exec(s);
  if (m) return pad(Math.min(23, Number(m[1]))) + ':' + m[2];
  const d = parseDate_(s);
  return d ? fmtTime_(d) : '';
}

function startOfDay_(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays_(d, n) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

function atTime_(d, hhmm) {
  const t = parseHHMM_(hhmm, '18:00');
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), t.h, t.m, 0, 0);
}

function isoDate_(d) {
  return Utilities.formatDate(d, tz_(), 'yyyy-MM-dd');
}

function fmtDate_(d) {
  if (!d) return '';
  return Utilities.formatDate(d, tz_(), 'dd MMM yyyy');
}

function fmtDT_(d) {
  if (!d) return '';
  return Utilities.formatDate(d, tz_(), 'dd MMM yyyy HH:mm');
}

function fmtTime_(d) {
  if (!d) return '';
  return Utilities.formatDate(d, tz_(), 'HH:mm');
}

function workdaySet_() {
  if (_WD) return _WD;
  const map = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 };
  const out = {};
  String(cfg_().WORKDAYS || 'Mon,Tue,Wed,Thu,Fri').split(',').forEach(function (x) {
    const n = map[String(x).trim().slice(0, 3).toUpperCase()];
    if (n !== undefined) out[n] = true;
  });
  if (!Object.keys(out).length) [1, 2, 3, 4, 5].forEach(function (n) { out[n] = true; });
  _WD = out;
  return out;
}

function holidays_() {
  if (_HOL) return _HOL;
  const out = {};
  try {
    table_(S.HOLIDAYS).rows.forEach(function (r) {
      const d = parseDate_(r[0]);
      if (d) out[isoDate_(d)] = true;
    });
  } catch (e) { /* ignore */ }
  _HOL = out;
  return out;
}

function isWorkday_(d, hols) {
  const h = hols || holidays_();
  return workdaySet_()[d.getDay()] === true && !h[isoDate_(d)];
}

function nextWorkdayOnOrAfter_(d, hols) {
  let x = startOfDay_(d);
  let guard = 0;
  while (!isWorkday_(x, hols) && guard++ < 60) x = addDays_(x, 1);
  return x;
}

function addWorkdays_(d, n, hols) {
  let x = startOfDay_(d);
  let added = 0;
  let guard = 0;
  while (added < n && guard++ < 400) {
    x = addDays_(x, 1);
    if (isWorkday_(x, hols)) added++;
  }
  return x;
}

function inQuietHours_() {
  try {
    const c = cfg_();
    const now = new Date();
    const mins = now.getHours() * 60 + now.getMinutes();
    const toMins = function (t) {
      const p = parseHHMM_(t, '00:00');
      return p.h * 60 + p.m;
    };
    const s = toMins(c.QUIET_START);
    const e = toMins(c.QUIET_END);
    if (s === e) return false;
    return s < e ? (mins >= s && mins < e) : (mins >= s || mins < e);
  } catch (e) {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Table helpers                                                       */
/* ------------------------------------------------------------------ */

function table_(name) {
  const sh = sheet_(name);
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (lastRow < 1 || lastCol < 1) return { sh: sh, head: [], col: {}, rows: [] };
  const values = sh.getRange(1, 1, lastRow, lastCol).getValues();
  const head = values[0].map(function (v) { return String(v).trim(); });
  const col = {};
  head.forEach(function (h, i) { if (h) col[h] = i; });
  return { sh: sh, head: head, col: col, rows: values.slice(1) };
}

function appendRows_(name, rows) {
  if (!rows || !rows.length) return;
  const sh = sheet_(name);
  const start = sh.getLastRow() + 1;
  sh.getRange(start, 1, rows.length, rows[0].length).setValues(rows);
}

function setCells_(name, rowIndex, fields) {
  const sh = sheet_(name);
  Object.keys(fields).forEach(function (k) {
    sh.getRange(rowIndex, Number(k)).setValue(fields[k]);
  });
}

function audit_(actor, role, action, entity, entityId, before, after, requestId, source) {
  try {
    sheet_(S.AUDIT).appendRow([
      new Date(), actor || 'system', role || 'SYSTEM', action || '', entity || '',
      entityId || '', String(before == null ? '' : before).slice(0, 400),
      String(after == null ? '' : after).slice(0, 400), requestId || '', source || 'script'
    ]);
  } catch (e) {
    console.error('audit failed: ' + e.message);
  }
}

function auditRows_(rows) {
  if (!rows || !rows.length) return;
  appendRows_(S.AUDIT, rows);
}

/* ------------------------------------------------------------------ */
/* Setup                                                               */
/* ------------------------------------------------------------------ */

function setWebAppUrlManual() {
  if (!requireAdmin_()) {
    adminDenied_('Only an admin can set the web app URL.');
    return;
  }
  const ui = safeUi_();
  if (!ui) return;
  const res = ui.prompt('Web app URL',
    'Paste the /exec URL from Deploy > Manage deployments. It must end in /exec.', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  const url = String(res.getResponseText() || '').trim();
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec/.test(url)) {
    ui.alert('That does not look like a web app /exec URL. Copy it from Deploy > Manage deployments.');
    return;
  }
  PropertiesService.getScriptProperties().setProperty('WEBAPP_URL', url);
  audit_('system', 'SYSTEM', 'WEBAPP_URL_SET', 'Config', '', '', url, '', 'menu');
  ui.alert('Saved', 'Alert emails will now carry signed one-click links.', ui.ButtonSet.OK);
}

function setup() {
  if (people_().length && !requireAdmin_()) {
    adminDenied_('Only an admin can run setup on an initialized sheet.');
    return;
  }
  const ss = getSS_();
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', ss.getId());
  Object.keys(H).forEach(function (key) {
    ensureSheet_(ss, S[key], H[key]);
  });
  ensureSheet_(ss, S.START, ['Instructions']);
  ensureSheet_(ss, S.DASH, ['Dashboard']);

  seedConfig_();
  refreshCaches_();
  seedDemoTasks_();
  seedPeople_();

  writeStartHere_();
  formatAll_(ss);
  repairTaskMaster_();
  refreshDashboard_();
  reconcileCycles_();
  refreshPending_();
  refreshReview_();

  protectAll_();
  orderAndHide_(ss);

  let triggerMsg = 'Triggers installed.';
  try {
    installTriggers_();
  } catch (e) {
    triggerMsg = 'Triggers NOT installed (' + e.message + '). Run installTriggers() manually.';
  }

  const ui = safeUi_();
  if (ui) {
    ui.alert('Setup complete',
      'Tabs are ready, demo tasks are seeded and the automation is live.\n\n' +
      'Next: Extensions > Apps Script > Deploy > New deployment > Web app\n' +
      '(Execute as: Me, Who has access: Anyone). Then run "Allo Ops > Admin > Set web app URL".\n\n' +
      triggerMsg, ui.ButtonSet.OK);
  }
}

function ensureSheet_(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#EAECF0');
    sh.setFrozenRows(1);
  }
  return sh;
}

function seedConfig_() {
  const sh = sheet_(S.CONFIG);
  const existing = {};
  const last = sh.getLastRow();
  if (last > 1) {
    sh.getRange(2, 1, last - 1, 1).getValues().forEach(function (r) {
      if (r[0]) existing[String(r[0]).trim()] = true;
    });
  }
  const toAdd = [];
  CONFIG_DEFAULTS.forEach(function (d) {
    if (!existing[d[0]]) toAdd.push(d);
  });
  if (toAdd.length) {
    const start = sh.getLastRow() + 1;
    sh.getRange(start, 1, toAdd.length, 3).setValues(toAdd);
  }
  // Fill role emails from the owner only when empty, so a re-run never wipes real values.
  const owner = ownerEmail_();
  fillIfBlank_(sh, 'MANAGER_EMAIL', owner);
  fillIfBlank_(sh, 'LEADERSHIP_EMAILS', owner);
  fillIfBlank_(sh, 'ADMIN_EMAIL', owner);
}

function fillIfBlank_(sh, key, value) {
  const last = sh.getLastRow();
  if (last < 2) return;
  const values = sh.getRange(2, 1, last - 1, 2).getValues();
  for (let i = 0; i < values.length; i++) {
    if (String(values[i][0]).trim() === key && !String(values[i][1] || '').trim()) {
      sh.getRange(i + 2, 2).setValue(value);
      return;
    }
  }
}

function seedDemoTasks_() {
  const sh = sheet_(S.TASKS);
  if (sh.getLastRow() > 1) return;
  const owner = ownerEmail_();
  const manager = String(cfg_().MANAGER_EMAIL || owner);
  const today = startOfDay_(new Date());
  const rows = [
    ['T-DAILY-01', 'Daily Operations Update', 'Employee A', owner, 'DAILY', today, '18:00', 30, false, '',
      'WhatsApp update summary', 'NEXT_WORKDAY', true, manager,
      'Post the EOD update in the operations WhatsApp group, then record a one-line summary here.'],
    ['T-P7-01', 'Portal Task A', 'Employee B', owner, '7', today, '17:00', 60, true, '',
      'Ticket ID', 'HOURS', true, manager, 'Raise/update the ticket on the portal and paste the ticket ID.'],
    ['T-P15-01', 'Portal Task B', 'Employee C', owner, '15', today, '17:00', 60, true, '',
      'Ticket ID', 'HOURS', true, manager, 'Raise/update the ticket on the portal and paste the ticket ID.'],
    ['T-P30-01', 'Portal Task C', 'Employee D', owner, '30', today, '17:00', 60, true, '',
      'Ticket ID', 'HOURS', true, manager, 'Raise/update the ticket on the portal and paste the ticket ID.']
  ];
  appendRows_(S.TASKS, rows);
}

function writeStartHere_() {
  const sh = sheet_(S.START);
  sh.clear();
  sh.setColumnWidth(1, 760);
  const lines = [
    'ALLO INNOWARE — HOW TO USE THE ALLO OPS PANELS',
    '',
    'A walkthrough for HR: what each panel is for, who sees what, and what to check every day.',
    '',
    'WHAT THE SYSTEM DOES',
    'Every recurring task has an owner, a frequency, a due time and a grace period. When one falls due,',
    'the owner gets an email and the task appears in their panel. They close it once, the manager is told',
    'the same day, and anything still open is escalated. The spreadsheet is the record of what happened;',
    'the panels are where things happen. No one ever types into a grid cell.',
    '',
    'WHAT TO TELL EVERYONE FIRST',
    '1. Open the sheet and use the "Allo Ops" menu at the top of the page. Every panel lives there.',
    '2. Work from the side panel only. Typing into a tab is blocked and is undone within seconds.',
    '3. If a panel looks empty or out of date, reload the page before assuming something is broken.',
    '',
    'OPENING A PANEL',
    'My tasks & leave         staff: Tasks, Review status, Sheets, Leave',
    'My tasks & reviews       managers and admins: the same list plus Review, Team leave, Admin',
    'Assign a task            managers who are not admins: the form for their own team',
    'Manage tasks & settings  admins: every task, holidays and the SLA settings',
    'Admin panel — people     admins: add people and set their role and reporting line',
    'Review a tab             managers and admins: a read-only window into any tab',
    'The menu only shows the items the signed-in account is allowed to use.',
    '',
    'EMPLOYEE PANEL — TAB BY TAB',
    'Tasks          Only work assigned to the signed-in person, with frequency, due date and time and',
    '               grace. To finish a cycle: type the ticket ID (or a short note when no ticket is',
    '               required) and press Mark complete. That is the only place a cycle is closed.',
    '               A ticket can be used once: the next cycle needs the ticket for that cycle.',
    'Review status  The last 50 cycles and whether a manager has reviewed them:',
    '               OPEN not done yet, AWAITING done and waiting for the manager,',
    '               LATE done after the grace period, REVIEWED acknowledged (the time is shown).',
    'Sheets         The tabs that relate to that person, each with an Open ↗ button.',
    'Leave          Apply for leave, watch the status, and withdraw a request that is still pending.',
    '',
    'MANAGER PANEL — TAB BY TAB',
    'Review         The team’s cycles grouped into overdue, active and acknowledged. Each card has',
    '               Acknowledge (confirms the manager has seen it and stops the reminder) and',
    '               Send reminder (nudges the employee straight away).',
    'Sheets         The team’s dashboard, review queue, tasks, cycles and leave.',
    'Leave          The manager’s own leave, exactly like an employee.',
    'Team leave     Approve or reject requests from the people below them in the reporting line.',
    'Admin          Create or edit tasks for their own team only.',
    '',
    'ASSIGN OR EDIT A TASK (MANAGER AND ADMIN)',
    'Task ID is a short unique code such as OPS-143. Frequency is DAILY, 7, 15 or 30 (days).',
    'Due time is written as HH:MM, for example 18:00. Grace is how many minutes after the due time the',
    'cycle is still on time. Tick Requires ticket when the employee must quote a ticket ID.',
    'Tick Active, otherwise the task is saved paused and produces nothing. Pause and Resume on the task',
    'card change the same setting later. Editing a task updates every future cycle; past ones stay as',
    'they were recorded.',
    '',
    'ADMIN PANEL',
    'People: add a person by their Google account email, then set EMPLOYEE, MANAGER or ADMIN. Managers',
    'also get a reporting-line email; that line is what "their team" means in every panel.',
    'Only an admin can grant ADMIN, and the last active admin cannot be demoted or removed.',
    'Manage tasks & settings: task definitions, holidays and SLA settings, saved straight to the sheet.',
    'Admin submenu: setup and repair, triggers, demo toggle, web app URL and the test tools.',
    '',
    'SHEETS TAB AND THE OPEN ↗ BUTTON',
    'The panel only lists the rows a role is allowed to see. A single spreadsheet tab cannot be shown to',
    'one person, so Open ↗ reveals the whole shared tab — read-only, but company-wide. Use it to look up',
    'a record; use the panel for that person’s own numbers. Admins get Hide tabs, which hides every data',
    'tab again before the sheet is shared or shown on a screen.',
    '',
    'REVIEW STATUS MEANINGS',
    'OPEN       live, not completed yet',
    'AWAITING   completed by the employee, not yet acknowledged by the manager',
    'LATE       completed, but after the due time plus grace',
    'REVIEWED   acknowledged by the manager, with the time it happened',
    'If AWAITING keeps climbing, managers are not pressing Acknowledge — that is not missed work.',
    '',
    'LEAVE, END TO END',
    '1. The employee applies in Leave with a first day, last day and reason.',
    '2. The request appears under Team leave for the manager above them in the reporting line.',
    '3. The manager approves or rejects it, and the employee sees the decision in their own Leave tab.',
    '4. Approved dates are kept in LeaveRequests and can be read from Sheets > Leave.',
    'A pending request can be withdrawn by whoever raised it. An approved one is a record.',
    '',
    'THE MORNING ROUND (HR, ABOUT FIVE MINUTES)',
    '1. Open the panel, choose Review, and look at Missed and Escalated first.',
    '2. Any card still open past its due time: check whether the employee is on approved leave.',
    '3. Ask the managers to clear their AWAITING cards so the review trail stays honest.',
    '4. Read Sheets > Dashboard for yesterday’s on-time percentage before the stand-up.',
    '',
    'WHO SEES WHAT',
    'Employee  Tasks and Review status (own), Sheets (own rows), Leave (own)',
    'Manager   Review and Sheets (team), Leave, Team leave, Admin (team tasks)',
    'Admin     Everything, plus People, settings, holidays and the repair tools',
    'Nobody can edit a grid cell, whatever their role. My tasks always shows only the rows assigned to',
    'the signed-in email; signing in as somebody else never widens the list.',
    '',
    'DEFAULT SLA (IST, EDITABLE IN SETTINGS)',
    'Daily task        due 18:00, grace 30m -> manager alert 18:30 -> escalation next working day 11:00',
    '7/15/30-day task  due 17:00, grace 60m -> manager alert 18:00 -> escalation 24h later',
    'These are only the starting values. Each task carries its own due time and grace.',
    '',
    'GO LIVE CHECKLIST',
    '1. Deploy as Web app: Execute as Me, Who has access Anyone.',
    '2. Run "Allo Ops > Admin > Set web app URL" so alert emails carry signed links.',
    '3. Open "Admin panel — people" and add the real team with their Google account emails and roles.',
    '4. Add the real tasks from "Manage tasks & settings" and tick Active on each one.',
    '5. Share the sheet with hr.ops.allo@gmail.com as Editor.',
    '6. Set DEMO_MODE=FALSE and ALLOW_IDENTITY_FALLBACK=FALSE before real use.',
    '',
    'IF SOMETHING LOOKS WRONG',
    'A task shows PAUSED            open it and press Resume, or tick Active and save it again.',
    'A due time shows as a date    run "Allo Ops > Admin > Repair TaskMaster rows" once.',
    'The data tabs have vanished    that is Hide tabs doing its job; Open ↗ brings one back.',
    'A ticket was refused          that ticket was already used; each cycle needs its own. The',
    '                              attempt is in AuditLog as PROOF_DUPLICATE_BLOCKED.',
    'A grid edit was refused       expected: edit in the panel instead. Nothing was lost.',
    'No email arrived              check AlertLedger in Review a tab for a failed row, then ask an admin.',
    'A person sees nothing         their email in People probably differs from the Google account used.',
    '',
    'WORDS USED IN THE PANELS',
    'Cycle      one occurrence of a recurring task, with its own due time and status.',
    'Grace      minutes after the due time before a cycle is counted late.',
    'Acknowledge  the manager confirming they have seen a completed cycle.',
    'Escalation the email sent upwards when a cycle is still open after its grace period.',
    'Tick       the scheduled check that creates cycles, sends alerts and escalates.',
    '',
    'TABS BEHIND THE PANELS',
    'Every data tab is read-only and starts hidden. The panel is the view you should use.',
    'TaskMaster       task definitions and owners (edit in Manage tasks)',
    'People           roles and reporting lines (use the Admin panel)',
    'LeaveRequests    leave history and decisions (apply in Leave)',
    'Cycles           the ledger: one row per cycle instance',
    'Pending          team-scoped pending report',
    'ManagerReview    team-scoped review report (acknowledge in the panel)',
    'ManagerDashboard team-scoped KPIs',
    'AlertLedger      email outbox and dedupe keys (protected)',
    'AuditLog         append-only trail of every change (protected)',
    'Config           SLA, recipients and timezone (use settings)',
    'Holidays         non-working dates, one per row',
    'UsedTokens       single-use web-app links already consumed',
    '',
    'TEST TOOLS are admin-only and create disposable rows. They send real email.'
  ];
  sh.getRange(1, 1, lines.length, 1).setValues(lines.map(function (l) { return [l]; }));
  sh.getRange(1, 1).setFontSize(14).setFontWeight('bold');
  const headers = ['WHAT THE SYSTEM DOES', 'WHAT TO TELL EVERYONE FIRST', 'OPENING A PANEL',
    'EMPLOYEE PANEL — TAB BY TAB', 'MANAGER PANEL — TAB BY TAB',
    'ASSIGN OR EDIT A TASK (MANAGER AND ADMIN)', 'ADMIN PANEL',
    'SHEETS TAB AND THE OPEN ↗ BUTTON', 'REVIEW STATUS MEANINGS', 'LEAVE, END TO END',
    'THE MORNING ROUND (HR, ABOUT FIVE MINUTES)', 'WHO SEES WHAT',
    'DEFAULT SLA (IST, EDITABLE IN SETTINGS)', 'GO LIVE CHECKLIST', 'IF SOMETHING LOOKS WRONG',
    'WORDS USED IN THE PANELS', 'TABS BEHIND THE PANELS'];
  lines.forEach(function (line, i) {
    if (headers.indexOf(line) >= 0) sh.getRange(i + 1, 1).setFontWeight('bold').setFontSize(11);
  });
  sh.setHiddenGridlines(true);
}

/**
 * Rewrites the START HERE tab without re-running setup, so the walkthrough can be
 * refreshed after an update without re-seeding demo data.
 */
function refreshStartHere() {
  if (!requireAdmin_()) {
    adminDenied_('Only an admin can rebuild START HERE.');
    return;
  }
  try {
    writeStartHere_();
    const ui = safeUi_();
    if (ui) ui.alert('START HERE rebuilt', 'The walkthrough has been rewritten on the START HERE tab.',
      ui.ButtonSet.OK);
  } catch (e) {
    const ui = safeUi_();
    if (ui) ui.alert('Could not rebuild START HERE', e.message || String(e), ui.ButtonSet.OK);
  }
}

function repairTaskMaster_() {
  const sh = sheet_(S.TASKS);
  const maxRows = sh.getMaxRows();
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return 0;

  const ids = sh.getRange(2, 1, lastRow - 1, 1).getDisplayValues();
  let lastDataRow = 1;
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0] || '').trim()) lastDataRow = i + 2;
  }

  // Older setups inserted checkboxes into every blank row, which writes FALSE
  // values and inflates the sheet. Clear everything below the last real task
  // row so getLastRow() drops back to the actual task count.
  if (lastDataRow < maxRows) {
    const width = Math.max(sh.getLastColumn(), 15);
    const blank = sh.getRange(lastDataRow + 1, 1, maxRows - lastDataRow, width);
    blank.clearContent();
    if (typeof blank.clearDataValidations === 'function') blank.clearDataValidations();
  }

  const taskRows = Math.max(lastDataRow - 1, 0);
  if (taskRows > 0) {
    // Normalise the two checkbox columns first. A value saved without the
    // checkbox rule is stored as text ("TRUE"/"FALSE") and keeps rendering as
    // text even after the rule is added, so convert it to a real boolean.
    const ticketRange = sh.getRange(2, TSK.TICKET_REQ, taskRows, 1);
    const activeRange = sh.getRange(2, TSK.ACTIVE, taskRows, 1);
    const ticketVals = ticketRange.getValues().map(function (r) { return [truthy_(r[0])]; });
    const activeVals = activeRange.getValues().map(function (r) { return [truthy_(r[0])]; });

    const frequency = SpreadsheetApp.newDataValidation()
      .requireValueInList(['DAILY', '7', '15', '30'], true).build();
    const escalation = SpreadsheetApp.newDataValidation()
      .requireValueInList(['NEXT_WORKDAY', 'HOURS'], true).build();
    sh.getRange(2, TSK.FREQ, taskRows, 1).setDataValidation(frequency);
    ticketRange.insertCheckboxes();
    sh.getRange(2, TSK.ESC_RULE, taskRows, 1).setDataValidation(escalation);
    activeRange.insertCheckboxes();
    // Write the booleans after the rule so the checkbox renders checked/unchecked
    // rather than as the words TRUE/FALSE.
    ticketRange.setValues(ticketVals);
    activeRange.setValues(activeVals);

    // Same problem for DueTime: the old value is a time-typed cell, so force the
    // column to plain text and rewrite it as the canonical "HH:MM" string.
    const timeRange = sh.getRange(2, TSK.TIME, taskRows, 1);
    const timeVals = timeRange.getValues().map(function (r) { return [hhmm_(r[0]) || '18:00']; });
    timeRange.setNumberFormat('@');
    timeRange.setValues(timeVals);
  }

  refreshCaches_();
  return taskRows;
}

/**
 * Applies the checkbox + dropdown rules to one TaskMaster row. New rows are
 * appended below the range repairTaskMaster_ formatted, which is why a task
 * created from the sidebar used to show TRUE/FALSE text and could not be
 * resumed.
 */
function formatTaskRow_(sh, row) {
  if (!sh || !row || row < 2) return;

  const ticket = sh.getRange(row, TSK.TICKET_REQ);
  const active = sh.getRange(row, TSK.ACTIVE);
  const ticketOn = truthy_(ticket.getValue());
  const activeOn = truthy_(active.getValue());

  const frequency = SpreadsheetApp.newDataValidation()
    .requireValueInList(['DAILY', '7', '15', '30'], true).build();
  const escalation = SpreadsheetApp.newDataValidation()
    .requireValueInList(['NEXT_WORKDAY', 'HOURS'], true).build();

  sh.getRange(row, TSK.FREQ).setDataValidation(frequency);
  ticket.insertCheckboxes();
  sh.getRange(row, TSK.ESC_RULE).setDataValidation(escalation);
  active.insertCheckboxes();
  ticket.setValue(ticketOn);
  active.setValue(activeOn);

  // Keep DueTime as text so a saved "18:00" never turns into a 1899 time value.
  const time = sh.getRange(row, TSK.TIME);
  time.setNumberFormat('@');
  time.setValue(hhmm_(time.getValue()) || '18:00');
}

function repairTaskMaster() {
  if (!requireAdmin_()) {
    adminDenied_('Only an admin can repair TaskMaster.');
    return;
  }
  const ui = safeUi_();
  const sh = sheet_(S.TASKS);
  const before = sh.getLastRow();
  if (ui) {
    const ok = ui.alert('Repair TaskMaster?',
      'This clears every cell below the last row that has a TaskID, then reapplies the checkbox validation.\n\n' +
      'Current last row: ' + before + '. Use this once on a sheet that shows hundreds of blank task rows.',
      ui.ButtonSet.YES_NO);
    if (ok !== ui.Button.YES) return;
  }
  try {
    const count = repairTaskMaster_();
    const after = sh.getLastRow();
    if (ui) {
      ui.alert('TaskMaster repaired',
        count + ' task row(s) remain.\nLast row: ' + before + ' -> ' + after + '.\n\n' +
        (after > count + 1 ? 'Some content below the tasks is still keeping the sheet long.' : 'Blank rows cleared; checkboxes were applied to task rows only.'),
        ui.ButtonSet.OK);
    }
  } catch (e) {
    if (ui) ui.alert('TaskMaster repair failed', e.message || String(e), ui.ButtonSet.OK);
    else throw e;
  }
}

function formatAll_(ss) {
  ['CONFIG', 'TASKS', 'CYCLES', 'PENDING', 'REVIEW', 'AUDIT', 'ALERTS', 'HOLIDAYS', 'TOKENS', 'PEOPLE', 'LEAVE'].forEach(function (k) {
    const sh = ss.getSheetByName(S[k]);
    if (!sh) return;
    sh.getRange(1, 1, 1, H[k].length).setFontWeight('bold').setBackground('#EAECF0');
    sh.setFrozenRows(1);
  });

  const cycles = ss.getSheetByName(S.CYCLES);
  cycles.getRange('D:E').setNumberFormat('dd mmm yyyy hh:mm');
  cycles.getRange('G:H').setNumberFormat('dd mmm yyyy hh:mm');
  cycles.getRange('N:O').setNumberFormat('dd mmm yyyy hh:mm');
  cycles.getRange('Q:R').setNumberFormat('dd mmm yyyy hh:mm');
  cycles.getRange('S:S').setNumberFormat('@');
  cycles.getRange('J:L').setNumberFormat('@');

  const tasks = ss.getSheetByName(S.TASKS);
  tasks.getRange('F:F').setNumberFormat('dd mmm yyyy');
  tasks.getRange('G:G').setNumberFormat('@');
  // TaskMaster validation is deliberately NOT applied here. Validation across
  // blank cells can materialize values and inflate getLastRow().
  // repairTaskMaster_() applies every rule to the real task rows only.

  const pend = ss.getSheetByName(S.PENDING);
  pend.getRange('D:E').setNumberFormat('dd mmm yyyy hh:mm');
  pend.setColumnWidth(2, 220);
  pend.setColumnWidth(11, 360);

  const review = ss.getSheetByName(S.REVIEW);
  review.getRange('D:D').setNumberFormat('dd mmm yyyy hh:mm');
  review.setColumnWidth(3, 220);
  review.setColumnWidth(8, 260);

  const people = ss.getSheetByName(S.PEOPLE);
  if (people) {
    people.setColumnWidth(1, 250);
    people.setColumnWidth(2, 180);
    people.setColumnWidth(3, 100);
    people.setColumnWidth(4, 250);
  }

  const leave = ss.getSheetByName(S.LEAVE);
  if (leave) {
    leave.getRange('D:E').setNumberFormat('dd mmm yyyy');
    leave.getRange('K:K').setNumberFormat('dd mmm yyyy hh:mm');
    leave.getRange('M:M').setNumberFormat('dd mmm yyyy hh:mm');
    leave.getRange('O:O').setNumberFormat('dd mmm yyyy hh:mm');
    leave.setColumnWidth(1, 160);
    leave.setColumnWidth(2, 230);
    leave.setColumnWidth(8, 320);
  }

  statusRules_(ss.getSheetByName(S.CYCLES), 'F2:F5000');
  statusRules_(ss.getSheetByName(S.PENDING), 'F2:F500');
  statusRules_(ss.getSheetByName(S.REVIEW), 'E2:E500');
}

function statusRules_(sh, a1) {
  const rules = [
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('OPEN')
      .setBackground('#FFFAEB').setFontColor('#B54708').setRanges([sh.getRange(a1)]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('MISSED')
      .setBackground('#FEF3F2').setFontColor('#B42318').setRanges([sh.getRange(a1)]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('ESCALATED')
      .setBackground('#B42318').setFontColor('#FFFFFF').setRanges([sh.getRange(a1)]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('COMPLETED')
      .setBackground('#ECFDF3').setFontColor('#067647').setRanges([sh.getRange(a1)]).build()
  ];
  sh.setConditionalFormatRules(rules);
}

function protectAll_() {
  // Owner-only tabs: employees never need to write these from their own account.
  const admins = people_().filter(function (p) { return p.active && p.role === 'ADMIN'; })
    .map(function (p) { return p.email; });
  const managers = people_().filter(function (p) {
    return p.active && (p.role === 'MANAGER' || p.role === 'ADMIN');
  }).map(function (p) { return p.email; });
  [S.CONFIG, S.HOLIDAYS, S.TOKENS, S.PEOPLE].forEach(function (name) {
    protect_(sheet_(name), 'Admin-managed configuration. Use the Allo Ops side panels.', admins, false);
  });
  // Managers assign and edit their team's tasks from the Manage sidebar, so they
  // need write access to TaskMaster. Manual grid edits are still reverted by the
  // onEdit trigger and logged in AuditLog.
  protect_(sheet_(S.TASKS), 'Task definitions. Use Allo Ops > Manage tasks, not the grid.',
    managers, false);

  // Script-written tabs are warning-only on purpose: a bound script writes with the
  // signed-in user's authority, so a hard restriction would block an employee's own
  // completion. Manual edits are still reverted and logged as SHEET_EDIT_BLOCKED.
  [S.CYCLES, S.ALERTS, S.AUDIT, S.PENDING, S.REVIEW, S.START, S.DASH, S.LEAVE].forEach(function (name) {
    protect_(sheet_(name), 'Read only — every action is done from the Allo Ops side panels.',
      [], true);
  });
}

function protect_(sh, description, extraEditors, warningOnly) {
  const existing = sh.getProtections(SpreadsheetApp.ProtectionType.SHEET);
  const p = existing.length ? existing[0] : sh.protect();
  p.setDescription(description);
  try {
    p.removeEditors(p.getEditors().map(function (u) { return u.getEmail(); }));
  } catch (e) { /* ignore */ }
  const valid = (extraEditors || []).filter(function (e) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e); });
  if (valid.length) {
    try { p.addEditors(valid); } catch (e) { /* ignore */ }
  }
  p.setWarningOnly(!!warningOnly);
  return p;
}

function orderAndHide_(ss) {
  const order = [S.START, S.PENDING, S.REVIEW, S.DASH, S.TASKS, S.HOLIDAYS, S.CONFIG, S.PEOPLE,
    S.LEAVE, S.CYCLES, S.ALERTS, S.AUDIT, S.TOKENS];
  // Spreadsheet has no setSheetOrder(); activate then moveActiveSheet() is the supported reorder.
  order.forEach(function (name, i) {
    const sh = ss.getSheetByName(name);
    if (!sh) return;
    if (sh.isSheetHidden()) sh.showSheet();
    ss.setActiveSheet(sh);
    ss.moveActiveSheet(i + 1);
  });
  const start = ss.getSheetByName(S.START);
  if (start) {
    if (start.isSheetHidden()) start.showSheet();
    ss.setActiveSheet(start);
  }
  // Only START HERE stays visible. Every data tab holds other people's rows and
  // Sheets cannot show a tab to one person only, so leaving them visible let any
  // employee read the whole company ledger. The side panels read the same data
  // through role-scoped, read-only tables; protections and onEdit still revert
  // any direct grid write.
  [S.PENDING, S.REVIEW, S.DASH, S.TASKS, S.HOLIDAYS, S.CONFIG, S.PEOPLE,
    S.LEAVE, S.CYCLES, S.ALERTS, S.AUDIT, S.TOKENS].forEach(function (name) {
    const sh = ss.getSheetByName(name);
    if (!sh || sh.getSheetId() === ss.getActiveSheet().getSheetId()) return;
    try { sh.hideSheet(); } catch (e) { /* already hidden or not permitted */ }
  });
}

function installTriggers_() {
  const names = ['tick', 'morningDigest', 'weeklyLeadershipDigest', 'retentionSweep', 'onSheetEdit',
    'onManagerReviewEdit'];
  // The last name is a legacy handler we remove if an earlier version installed it.
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (names.indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('tick').timeBased().everyMinutes(15).create();
  ScriptApp.newTrigger('morningDigest').timeBased().atHour(9).nearMinute(30).everyDays(1).create();
  ScriptApp.newTrigger('weeklyLeadershipDigest').timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(9).create();
  ScriptApp.newTrigger('retentionSweep').timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(9).nearMinute(15).create();
  ScriptApp.newTrigger('onSheetEdit').forSpreadsheet(getSS_()).onEdit().create();
}

/* ------------------------------------------------------------------ */
/* Menu                                                                */
/* ------------------------------------------------------------------ */

function toggleDemoMode() {
  if (!requireAdmin_()) {
    adminDenied_('Only an admin can change demo mode.');
    return;
  }
  const ui = safeUi_();
  const sh = sheet_(S.CONFIG);
  const t = table_(S.CONFIG);

  // Find the columns by header, then fall back to the documented A/B layout.
  function headerCol(name, fallback) {
    if (t.col[name] != null) return t.col[name];
    const want = String(name).toLowerCase();
    for (let i = 0; i < t.head.length; i++) {
      if (String(t.head[i] || '').trim().toLowerCase() === want) return i;
    }
    return fallback;
  }
  const keyCol = headerCol('Key', 0);
  let valCol = headerCol('Value', keyCol + 1);
  if (valCol === keyCol) valCol = keyCol + 1;

  // Look in the expected key column first, then anywhere in the row. This
  // tolerates a Config tab with a title row or keys moved to another column.
  let row = -1;
  let valAt = valCol;
  for (let i = 0; i < t.rows.length && row < 0; i++) {
    for (let j = 0; j < t.rows[i].length; j++) {
      if (String(t.rows[i][j] == null ? '' : t.rows[i][j]).trim() === 'DEMO_MODE') {
        row = i + 2;
        valAt = (j === keyCol) ? valCol : j + 1;
        break;
      }
    }
  }

  let before;
  if (row < 0) {
    // Repair a Config tab whose first row is not the schema header.
    row = Math.max(sh.getLastRow() + 1, 2);
    sh.getRange(row, keyCol + 1).setValue('DEMO_MODE');
    sh.getRange(row, valCol + 1).setValue('TRUE');
    before = 'TRUE';
  } else {
    before = String(t.rows[row - 2][valAt] == null ? '' : t.rows[row - 2][valAt]).trim().toUpperCase();
  }

  const turnOn = before !== 'TRUE';

  if (ui) {
    const current = turnOn ? 'OFF' : 'ON';
    const message = 'Demo mode is currently ' + current + '.\n\n' + (turnOn
      ? 'Turn it ON? Any sheet editor will see and be able to complete the seeded demo tasks, even if they are not assigned to them. Use this only for evaluation.'
      : 'Turn it OFF? Employees will see only tasks assigned to their own email. If the demo rows are still assigned to you, other accounts will see an empty list.\n\nFor production, also set ALLOW_IDENTITY_FALLBACK=FALSE.');
    if (ui.alert(turnOn ? 'Turn demo mode ON?' : 'Turn demo mode OFF?', message, ui.ButtonSet.YES_NO) !== ui.Button.YES) {
      return;
    }
  }

  sh.getRange(row, valAt + 1).setValue(turnOn ? 'TRUE' : 'FALSE');
  refreshCaches_();

  const actor = callerEmail_() || 'system';
  audit_(actor, actor === 'system' ? 'SYSTEM' : 'ADMIN', turnOn ? 'DEMO_MODE_ON' : 'DEMO_MODE_OFF',
    'Config', 'DEMO_MODE', before, turnOn ? 'TRUE' : 'FALSE', '', 'menu');

  if (ui) {
    ui.alert(turnOn ? 'Demo mode is now ON' : 'Demo mode is now OFF',
      turnOn
        ? 'Seeded demo tasks are now visible to any sheet editor. Turn this off before production.'
        : 'Employees now see only their own assigned tasks.',
      ui.ButtonSet.OK);
  }
}

function onOpen() {
  const ui = safeUi_();
  if (!ui) return;

  const email = callerEmail_();
  const role = roleOf_(email);
  const admin = role === 'ADMIN';
  const manager = admin || role === 'MANAGER';

  const menu = ui.createMenu('Allo Ops')
    .addItem(manager ? 'My tasks & reviews' : 'My tasks & leave', 'showSidebar');

  if (manager) {
    menu.addItem('Review a tab', 'showReviewSidebar')
      .addItem(admin ? 'Manage tasks & settings' : 'Assign a task', 'showManageSidebar');
  }

  if (admin) {
    menu.addSeparator()
      .addItem('Admin panel — people', 'showAdminSidebar')
      .addItem('Run automation now', 'runTickNow')
      .addSeparator()
      .addSubMenu(ui.createMenu('Admin')
        .addItem('Setup / repair sheet', 'setup')
        .addItem('Install triggers', 'adminInstallTriggers')
        .addItem('Repair TaskMaster rows', 'repairTaskMaster')
        .addItem('Rebuild START HERE', 'refreshStartHere')
        .addSeparator()
        .addItem('Toggle demo mode', 'toggleDemoMode')
        .addSeparator()
        .addItem('Set web app URL', 'captureWebAppUrl')
        .addItem('Set web app URL manually', 'setWebAppUrlManual')
        .addItem('Rebuild dashboard', 'adminRefreshDashboard'))
      .addSubMenu(ui.createMenu('Test tools')
        .addItem('Create task due in 2 minutes', 'devCreateTestTask')
        .addItem('Create overdue + escalation case', 'devSeedEscalationTest')
        .addItem('Run tick 3x and show counts', 'devRunTickThrice')
        .addItem('Force oldest open cycle overdue', 'devForceOverdue'));
  } else if (!people_().length) {
    // Migration path: before People has rows there is no admin record yet. This
    // menu disappears as soon as setup seeds the first admin.
    menu.addSubMenu(ui.createMenu('Admin')
      .addItem('Setup / repair sheet', 'setup')
      .addItem('Install triggers', 'adminInstallTriggers'));
  }

  menu.addToUi();
}

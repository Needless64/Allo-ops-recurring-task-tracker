/**
 * Allo Innoware — manager/admin "Manage" sidebar.
 * FILE 9 of 9 — task assignment, holidays and settings.
 *
 * Tasks, holidays and config are edited here because every sheet tab is
 * read-only. Managers see only their own team's tasks; holidays and settings
 * are admin-only. Every change is audited.
 */

function showManageSidebar() {
  const ui = safeUi_();
  if (!ui) return;
  const role = roleOf_(callerEmail_());
  if (role !== 'ADMIN' && role !== 'MANAGER') {
    ui.alert('Managers only', 'Only a manager or admin can assign tasks.', ui.ButtonSet.OK);
    return;
  }
  const html = HtmlService.createHtmlOutputFromFile('Manage1')
    .setTitle(role === 'ADMIN' ? 'Manage' : 'Team tasks')
    .setWidth(520);
  ui.showSidebar(html);
}

/**
 * The workspace sidebar's "Assign task" / "New task" button must not call
 * showSidebar: Sheets currently drops a second showSidebar() call while a
 * sidebar is open, so the task manager never appeared. A modal dialog opens
 * alongside the sidebar and gives the same panel.
 */
function openManageDialog() {
  try {
    const ui = safeUi_();
    if (!ui) return { ok: false, error: 'Open the Google Sheet first, then use the Allo Ops menu.' };

    const role = roleOf_(callerEmail_());
    if (role !== 'ADMIN' && role !== 'MANAGER') {
      return { ok: false, code: 'FORBIDDEN', error: 'Only a manager or admin can assign tasks.' };
    }

    const html = HtmlService.createHtmlOutputFromFile('Manage1')
      .setWidth(680)
      .setHeight(760);
    ui.showModalDialog(html, role === 'ADMIN' ? 'Manage tasks & settings' : 'Team tasks');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

/** People a manager may assign work to: themselves plus their reporting line. */
function manageTeam_(actor, role) {
  const out = {};
  const self = personFor_(actor);
  out[actor] = { email: actor, name: (self && self.name) || actor.split('@')[0] };

  if (role === 'ADMIN') {
    people_().filter(function (p) { return p.active; }).forEach(function (p) {
      out[p.email] = { email: p.email, name: p.name || p.email.split('@')[0] };
    });
  } else {
    const managed = managedEmails_(actor);
    Object.keys(managed).forEach(function (e) {
      const p = personFor_(e);
      out[e] = { email: e, name: (p && p.name) || e.split('@')[0] };
    });
    // Keep a legacy task assignee usable even before People has a row for them.
    tasks_().forEach(function (t) {
      if (t.ownerManager === actor && t.email && !out[t.email]) {
        out[t.email] = { email: t.email, name: t.employee || t.email.split('@')[0] };
      }
    });
  }

  return Object.keys(out).map(function (k) { return out[k]; }).sort(function (a, b) {
    return a.name.localeCompare(b.name);
  });
}

function getManageContext() {
  try {
    const me = callerEmail_();
    const role = roleOf_(me);
    if (role !== 'ADMIN' && role !== 'MANAGER') {
      return { ok: false, code: 'FORBIDDEN', error: 'This area is available to managers and admins.' };
    }

    const allTasks = tasks_();
    const tasks = allTasks.filter(function (t) {
      return role === 'ADMIN' || canManageTask_(me, t);
    }).map(function (t) {
      return {
        id: t.id, name: t.name, employee: t.employee, email: t.email,
        frequency: t.frequency, anchorIso: t.anchorDate ? isoDate_(t.anchorDate) : '',
        dueTime: t.dueTime, grace: t.grace, requiresTicket: t.requiresTicket,
        ticketPattern: t.ticketPattern, proofLabel: t.proofLabel,
        escalationRule: t.escalationRule, active: t.active,
        ownerManager: t.ownerManager, notes: t.notes
      };
    });

    const holidays = [];
    const config = [];
    if (role === 'ADMIN') {
      try {
        const ht = table_(S.HOLIDAYS);
        ht.rows.forEach(function (r) {
          const d = parseDate_(r[0]);
          if (d) holidays.push({ date: isoDate_(d), description: String(r[1] || '').trim() });
        });
      } catch (e) { /* not set up yet */ }
      holidays.sort(function (a, b) { return a.date.localeCompare(b.date); });

      try {
        const ct = table_(S.CONFIG);
        ct.rows.forEach(function (r) {
          const key = String(r[0] == null ? '' : r[0]).trim();
          if (!key) return;
          config.push({
            key: key,
            value: String(r[1] == null ? '' : r[1]).trim(),
            notes: String(r[2] || '').trim()
          });
        });
      } catch (e) { /* not set up yet */ }
    }

    return {
      ok: true,
      email: me,
      role: role,
      admin: role === 'ADMIN',
      manager: true,
      company: String(cfg_().COMPANY_NAME || 'Allo Innoware'),
      tasks: tasks,
      team: manageTeam_(me, role),
      holidays: holidays,
      config: config
    };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

function saveTask(data) {
  try {
    const actor = callerEmail_();
    const role = roleOf_(actor);
    if (role !== 'ADMIN' && role !== 'MANAGER') {
      return { ok: false, code: 'FORBIDDEN', error: 'Only a manager or admin can assign tasks.' };
    }

    const input = data || {};
    const id = String(input.id || '').trim();
    const name = safeText_(input.name, 120);
    const employee = safeText_(input.employee, 80);
    const email = String(input.email || '').trim().toLowerCase();
    const frequency = String(input.frequency || '').trim().toUpperCase();
    const anchor = parseDate_(input.anchorIso);
    const dueTime = hhmm_(input.dueTime);
    const grace = Math.round(num_(input.grace, 30));
    const requiresTicket = !!input.requiresTicket;
    const ticketPattern = String(input.ticketPattern || '').trim();
    const proofLabel = safeText_(input.proofLabel, 40) ||
      (requiresTicket ? 'Ticket ID' : 'Proof summary');
    const escalationRule = String(input.escalationRule || '').trim().toUpperCase();
    const activeRequested = input.active !== false && String(input.active).toLowerCase() !== 'false';
    let ownerManager = String(input.ownerManager || '').trim().toLowerCase();
    const notes = safeText_(input.notes, 500);

    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{2,39}$/.test(id)) {
      return { ok: false, error: 'Task ID must be 3–40 letters, numbers, dashes or underscores.' };
    }
    if (!name) return { ok: false, error: 'Enter a task name.' };
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: 'Enter a valid employee email.' };
    if (['DAILY', '7', '15', '30'].indexOf(frequency) < 0) {
      return { ok: false, error: 'Frequency must be DAILY, 7, 15 or 30.' };
    }
    if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(dueTime)) {
      return { ok: false, error: 'Due time must be HH:MM, for example 18:00.' };
    }
    if (grace < 0 || grace > 240) return { ok: false, error: 'Grace must be between 0 and 240 minutes.' };
    if (escalationRule !== 'NEXT_WORKDAY' && escalationRule !== 'HOURS') {
      return { ok: false, error: 'Escalation rule must be NEXT_WORKDAY or HOURS.' };
    }
    if (ownerManager && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(ownerManager)) {
      return { ok: false, error: 'Owner manager is not a valid email.' };
    }
    if (ticketPattern) {
      try { new RegExp(ticketPattern); } catch (e) {
        return { ok: false, error: 'Ticket pattern is not a valid regular expression.' };
      }
    }

    if (role === 'MANAGER') {
      const allowed = {};
      manageTeam_(actor, role).forEach(function (p) { allowed[p.email] = true; });
      if (!allowed[email]) {
        return { ok: false, error: 'You can assign tasks only to people in your team.' };
      }
    }

    const sh = sheet_(S.TASKS);
    const t = table_(S.TASKS);
    const c = t.col;
    const idKey = id.toLowerCase();
    // `originalId` is the ID the form was opened with, so this function can tell
    // an edit (same task, update its row) from a create (new task, must not
    // overwrite whatever already owns that ID).
    const originalKey = String(input.originalId || '').trim().toLowerCase();
    const allTasks = tasks_();
    let existing = null;
    let rowIndex = 0;
    if (originalKey) {
      for (let i = 0; i < t.rows.length; i++) {
        if (String(t.rows[i][c.TaskID] || '').trim().toLowerCase() === originalKey) {
          rowIndex = i + 2;
          existing = allTasks.filter(function (x) { return x.rowIndex === rowIndex; })[0] || null;
          break;
        }
      }
    }
    // One row per TaskID, case-insensitively: creating a task under an ID that
    // already exists is refused instead of quietly rewriting that task, and so
    // is renaming a task onto an ID someone else holds.
    const clash = allTasks.filter(function (x) {
      return x.id.toLowerCase() === idKey && (!existing || x.rowIndex !== existing.rowIndex);
    })[0] || null;
    if (clash) {
      const owner = clash.employee || clash.email;
      audit_(actor, role, 'TASK_DUPLICATE_BLOCKED', 'Task', id, '',
        JSON.stringify({ keptTaskId: clash.id, keptTaskName: clash.name, keptEmployee: owner }), '', 'manage-panel');
      return {
        ok: false,
        code: 'DUPLICATE_TASK_ID',
        error: 'Task ID "' + id + '" is already used by "' + (clash.name || owner) + '"' +
          (owner ? ' (' + owner + ')' : '') + '. Open that task to edit it, or use a different Task ID.'
      };
    }
    // Keep the stored spelling: Cycles.TaskID joins back on the original ID, so
    // rewriting "Daily12" as "daily12" would orphan every cycle of that task.
    const canonicalId = existing ? existing.id : id;
    // A brand-new task always starts running. Pausing is a deliberate action on
    // an existing task, never a side effect of creating one.
    const isNew = !rowIndex;
    const active = isNew ? true : activeRequested;

    if (role === 'MANAGER') {
      if (existing && !canManageTask_(actor, existing)) {
        return { ok: false, error: 'That task belongs to another manager’s team.' };
      }
      ownerManager = existing ? (existing.ownerManager || actor) : actor;
    }

    const values = [
      canonicalId, name, employee || email.split('@')[0], email, frequency,
      anchor ? startOfDay_(anchor) : startOfDay_(new Date()), dueTime, grace,
      requiresTicket, ticketPattern, proofLabel, escalationRule, active, ownerManager, notes
    ];
    if (isNew) {
      appendRows_(S.TASKS, [values]);
      rowIndex = sh.getLastRow();
    } else {
      sh.getRange(rowIndex, 1, 1, H.TASKS.length).setValues([values]);
    }
    // Appended rows sit below the range setup formatted, so apply the checkbox
    // and dropdown rules to this exact row or Active renders as text FALSE.
    try { formatTaskRow_(sh, rowIndex); } catch (e) { /* saved; next repair fixes formatting */ }
    // Write the two checkbox values once more after the formatting pass, so the
    // row's on/paused state can never differ from what was saved.
    try {
      sh.getRange(rowIndex, TSK.ACTIVE).setValue(active);
      sh.getRange(rowIndex, TSK.TICKET_REQ).setValue(requiresTicket);
    } catch (e) { /* saved; next repair fixes formatting */ }

    audit_(actor, role, isNew ? 'TASK_ADDED' : 'TASK_UPDATED', 'Task', canonicalId, '',
      JSON.stringify({ frequency: frequency, dueTime: dueTime, active: active, email: email }), '', 'manage-panel');

    refreshCaches_();
    try { reconcileCycles_(); } catch (e) { /* a validation error surfaces on the next tick */ }
    try { refreshPending_(); refreshReview_(); refreshDashboard_(); } catch (e) { /* best effort */ }

    return getManageContext();
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

function saveHoliday(data) {
  try {
    const actor = callerEmail_();
    if (!isAdmin_(actor)) return { ok: false, code: 'FORBIDDEN', error: 'Only an admin can edit holidays.' };

    const input = data || {};
    const date = parseDate_(input.date);
    const description = safeText_(input.description, 120);
    if (!date) return { ok: false, error: 'Choose a valid date.' };
    if (!description) return { ok: false, error: 'Add a short description.' };

    const iso = isoDate_(startOfDay_(date));
    const sh = sheet_(S.HOLIDAYS);
    const t = table_(S.HOLIDAYS);
    let rowIndex = 0;
    for (let i = 0; i < t.rows.length; i++) {
      const d = parseDate_(t.rows[i][0]);
      if (d && isoDate_(startOfDay_(d)) === iso) { rowIndex = i + 2; break; }
    }
    if (rowIndex) sh.getRange(rowIndex, 1, 1, 2).setValues([[date, description]]);
    else appendRows_(S.HOLIDAYS, [[date, description]]);

    audit_(actor, 'ADMIN', rowIndex ? 'HOLIDAY_UPDATED' : 'HOLIDAY_ADDED', 'Holiday', iso, '',
      description, '', 'manage-panel');
    refreshCaches_();
    return getManageContext();
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

function deleteHoliday(dateIso) {
  try {
    const actor = callerEmail_();
    if (!isAdmin_(actor)) return { ok: false, code: 'FORBIDDEN', error: 'Only an admin can edit holidays.' };

    const iso = String(dateIso || '').trim();
    const sh = sheet_(S.HOLIDAYS);
    const t = table_(S.HOLIDAYS);
    let rowIndex = 0;
    for (let i = 0; i < t.rows.length; i++) {
      const d = parseDate_(t.rows[i][0]);
      if (d && isoDate_(startOfDay_(d)) === iso) { rowIndex = i + 2; break; }
    }
    if (!rowIndex) return { ok: false, error: 'That holiday no longer exists.' };

    sh.getRange(rowIndex, 1, 1, 2).clearContent();
    audit_(actor, 'ADMIN', 'HOLIDAY_DELETED', 'Holiday', iso, '', '', '', 'manage-panel');
    refreshCaches_();
    return getManageContext();
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

function saveConfigValue(data) {
  try {
    const actor = callerEmail_();
    if (!isAdmin_(actor)) return { ok: false, code: 'FORBIDDEN', error: 'Only an admin can change settings.' };

    const input = data || {};
    const key = String(input.key || '').trim();
    let value = safeText_(input.value, 300);

    const t = table_(S.CONFIG);
    let col = t.col.Value;
    if (col == null) col = 1;
    let rowIndex = 0;
    for (let i = 0; i < t.rows.length; i++) {
      if (String(t.rows[i][0] == null ? '' : t.rows[i][0]).trim() === key) { rowIndex = i + 2; break; }
    }
    if (!rowIndex) return { ok: false, error: 'That setting no longer exists.' };

    const numeric = ['GRACE_MINUTES', 'ESCALATION_HOURS', 'MAX_MANAGER_EMAILS_PER_CYCLE',
      'RETENTION_MONTHS', 'TOKEN_TTL_HOURS'];
    const times = ['WORK_START', 'WORK_END', 'QUIET_START', 'QUIET_END', 'DAILY_ESCALATION_TIME'];
    const emails = ['ADMIN_EMAIL', 'MANAGER_EMAIL'];

    if (numeric.indexOf(key) >= 0) {
      if (!/^\d+$/.test(value)) return { ok: false, error: key + ' must be a whole number.' };
    } else if (times.indexOf(key) >= 0) {
      if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(value)) {
        return { ok: false, error: key + ' must be HH:MM, for example 09:30.' };
      }
    } else if (key === 'DEMO_MODE' || key === 'ALLOW_IDENTITY_FALLBACK') {
      value = value.toUpperCase();
      if (value !== 'TRUE' && value !== 'FALSE') return { ok: false, error: key + ' must be TRUE or FALSE.' };
    } else if (emails.indexOf(key) >= 0) {
      if (value && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) {
        return { ok: false, error: 'Enter a valid email address.' };
      }
    } else if (key === 'LEADERSHIP_EMAILS') {
      const bad = value.split(',').map(function (s) { return s.trim(); }).filter(function (s) {
        return s && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);
      });
      if (bad.length) return { ok: false, error: 'Not a valid email: ' + bad[0] };
    } else if (key === 'TIMEZONE' && !value) {
      return { ok: false, error: 'Time zone cannot be empty.' };
    }

    const before = String(t.rows[rowIndex - 2][col] == null ? '' : t.rows[rowIndex - 2][col]).trim();
    sheet_(S.CONFIG).getRange(rowIndex, col + 1).setValue(value);
    audit_(actor, 'ADMIN', 'CONFIG_UPDATED', 'Config', key, before, value, '', 'manage-panel');
    refreshCaches_();
    return getManageContext();
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

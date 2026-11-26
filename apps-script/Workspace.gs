/**
 * Allo Innoware — role-aware workspace.
 *
 * FILE 8 of 9 — one sidebar for every role:
 *   EMPLOYEE  own tasks, own read-only sheet rows, apply/withdraw leave
 *   MANAGER   own tasks, team review queue with acknowledgement + reminders,
 *             team read-only sheet rows, team leave approvals
 *   ADMIN     everything above plus company-wide sheet rows, cycles and leave
 */

function myTaskItems_(email) {
  const want = String(email || '').trim().toLowerCase();
  // Every role, admins included, sees only the work addressed to its own email.
  // Company-wide work belongs to Review and Sheets. An earlier demo fallback
  // widened this list to every task, which is how one account could read all.
  const tasks = tasks_().filter(function (t) { return t.active && t.email === want; });

  if (!tasks.length) {
    return {
      items: [],
      demoMode: false,
      message: 'No tasks are assigned to this account yet.'
    };
  }

  const byTask = {};
  tasks.forEach(function (t) { byTask[t.id] = t; });

  const all = cycles_();
  const lastTicket = {};
  all.forEach(function (c) {
    if (c.status !== 'COMPLETED' || !c.ticketId) return;
    const cur = lastTicket[c.taskId];
    if (!cur || c.cycleNo > cur.cycleNo) lastTicket[c.taskId] = { cycleNo: c.cycleNo, ticket: c.ticketId };
  });

  const now = new Date();
  const items = all.filter(function (c) {
    return ACTIVE_STATES.indexOf(c.status) >= 0 && byTask[c.taskId];
  }).map(function (c) {
    const t = byTask[c.taskId];
    const lateMin = Math.max(0, Math.round((now.getTime() - c.dueAt.getTime()) / 60000));
    return {
      cycleId: c.id,
      taskId: t.id,
      taskName: t.name,
      employee: t.employee,
      employeeEmail: t.email,
      canComplete: t.email === want,
      cycleNo: c.cycleNo,
      status: c.status,
      dueIso: c.scheduledDue ? c.scheduledDue.toISOString() : '',
      dueAtIso: c.dueAt ? c.dueAt.toISOString() : '',
      dueLabel: fmtDT_(c.scheduledDue),
      graceLabel: fmtDT_(c.dueAt),
      overdueMinutes: lateMin,
      requiresTicket: t.requiresTicket,
      proofLabel: t.proofLabel,
      lastTicket: (lastTicket[t.id] && lastTicket[t.id].ticket) || '',
      notes: t.notes
    };
  }).sort(function (a, b) {
    return new Date(a.dueAtIso) - new Date(b.dueAtIso);
  });

  return { items: items, demoMode: false, message: '' };
}

function reviewQueue_(email, role) {
  if (role !== 'MANAGER' && role !== 'ADMIN') return [];

  const tasks = taskMap_();
  const visible = visibleTaskIds_(email);
  const all = cycles_();
  const now = Date.now();

  const lastTicket = {};
  all.forEach(function (c) {
    if (c.status !== 'COMPLETED' || !c.ticketId) return;
    const cur = lastTicket[c.taskId];
    if (!cur || c.cycleNo > cur.cycleNo) lastTicket[c.taskId] = { cycleNo: c.cycleNo, ticket: c.ticketId };
  });

  return all.filter(function (c) {
    return ACTIVE_STATES.indexOf(c.status) >= 0 && visible[c.taskId] && tasks[c.taskId];
  }).map(function (c) {
    const t = tasks[c.taskId];
    const lateMin = Math.max(0, Math.round((now - c.dueAt.getTime()) / 60000));
    return {
      cycleId: c.id,
      taskId: t.id,
      taskName: t.name,
      employee: t.employee || t.email,
      employeeEmail: t.email,
      cycleNo: c.cycleNo,
      status: c.status,
      dueIso: c.scheduledDue ? c.scheduledDue.toISOString() : '',
      dueLabel: fmtDT_(c.scheduledDue),
      graceLabel: fmtDT_(c.dueAt),
      overdueLabel: lateMin > 0 ? overdueShort_(c) : '',
      overdue: lateMin > 0,
      ackedAt: c.managerAckAt ? c.managerAckAt.toISOString() : '',
      ackedLabel: c.managerAckAt ? fmtDT_(c.managerAckAt) : '',
      requiresTicket: t.requiresTicket,
      proofLabel: t.proofLabel,
      lastTicket: (lastTicket[t.id] && lastTicket[t.id].ticket) || '',
      notes: t.notes
    };
  }).sort(function (a, b) {
    return new Date(a.dueIso) - new Date(b.dueIso);
  });
}

function reviewStatusFor_(email) {
  const mine = tasks_().filter(function (t) { return t.email === email; });
  if (!mine.length) return [];

  const byId = {};
  mine.forEach(function (t) { byId[t.id] = t; });

  return cycles_()
    .filter(function (c) { return !!byId[c.taskId]; })
    .sort(function (a, b) {
      const ad = a.scheduledDue ? a.scheduledDue.getTime() : 0;
      const bd = b.scheduledDue ? b.scheduledDue.getTime() : 0;
      return bd - ad;
    })
    .slice(0, 50)
    .map(function (c) {
      const status = String(c.status || '').toUpperCase();
      const reviewed = !!c.managerAckAt;
      let state = 'OPEN';
      if (reviewed) state = 'REVIEWED';
      else if (status === 'COMPLETED') state = 'AWAITING';
      else if (status === 'MISSED' || status === 'ESCALATED') state = 'LATE';

      return {
        cycleId: c.id,
        taskName: byId[c.taskId].name,
        cycleNo: c.cycleNo,
        status: status,
        dueLabel: fmtDT_(c.scheduledDue),
        completedLabel: c.completedAt ? fmtDT_(c.completedAt) : '',
        reviewed: reviewed,
        reviewedLabel: reviewed ? fmtDT_(c.managerAckAt) : '',
        reviewState: state,
        ticket: c.ticketId || ''
      };
    });
}

function getWorkspace() {
  try {
    const actor = actorEmail_();
    const email = actor.email;
    if (!email) {
      return {
        ok: false,
        code: 'AUTH',
        error: 'Your Google account could not be identified. Open the sheet with your work account.'
      };
    }

    const role = roleOf_(email);
    if (role === 'NONE') {
      return {
        ok: false,
        code: 'FORBIDDEN',
        error: 'Your account is not on the Allo Ops access list. Ask an admin to add you.'
      };
    }

    const built = myTaskItems_(email);
    const review = reviewQueue_(email, role);
    const leave = leaveContext_(email, role);
    const person = personFor_(email);

    return {
      ok: true,
      email: email,
      name: (person && person.name) || email.split('@')[0],
      role: role,
      admin: role === 'ADMIN',
      manager: role === 'ADMIN' || role === 'MANAGER',
      company: String(cfg_().COMPANY_NAME || 'Allo Innoware'),
      identityFallback: actor.fallback,
      demoMode: built.demoMode,
      tasks: built.items,
      taskMessage: built.message,
      review: review,
      reviewStatus: role === 'EMPLOYEE' ? reviewStatusFor_(email) : [],
      leave: leave,
      counts: {
        tasks: built.items.length,
        review: review.length,
        reviewPending: review.filter(function (r) {
          return !r.ackedAt && (r.overdue || r.status === 'MISSED' || r.status === 'ESCALATED');
        }).length,
        leavePending: leave.mine.filter(function (r) { return r.status === 'PENDING'; }).length,
        approvals: leave.approvals.length
      }
    };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

/* ------------------------------------------------------------------ */
/* Read-only sheet views for the sidebar                               */
/* ------------------------------------------------------------------ */

function sheetTask_(t) {
  return {
    id: t.id,
    name: t.name,
    employee: t.employee,
    email: t.email,
    frequency: t.frequency,
    dueTime: t.dueTime,
    graceMinutes: t.graceMinutes,
    requiresTicket: !!t.requiresTicket,
    proofLabel: t.proofLabel,
    active: !!t.active,
    ownerManager: t.ownerManager,
    notes: t.notes
  };
}

function sheetCycle_(c, t) {
  const active = ACTIVE_STATES.indexOf(c.status) >= 0;
  const late = active && c.dueAt ? Math.max(0, Math.round((Date.now() - c.dueAt.getTime()) / 60000)) : 0;
  return {
    id: c.id,
    taskId: c.taskId,
    taskName: (t && t.name) || c.taskId,
    employee: (t && (t.employee || t.email)) || '',
    email: (t && t.email) || '',
    cycleNo: c.cycleNo,
    status: c.status,
    dueIso: c.scheduledDue ? c.scheduledDue.toISOString() : '',
    dueLabel: fmtDT_(c.scheduledDue),
    graceLabel: fmtDT_(c.dueAt),
    completedLabel: c.completedAt ? fmtDT_(c.completedAt) : '',
    ticket: c.ticketId || '',
    proof: c.note || '',
    proofUrl: c.proofUrl || '',
    ackLabel: c.managerAckAt ? fmtDT_(c.managerAckAt) : '',
    active: active,
    overdue: late > 0,
    overdueLabel: late > 0 ? overdueShort_(c) : ''
  };
}

function getSheetBundle() {
  try {
    const actor = actorEmail_();
    const email = actor.email;
    if (!email) {
      return { ok: false, code: 'AUTH', error: 'Your Google account could not be identified. Open the sheet with your work account.' };
    }

    const role = roleOf_(email);
    if (role === 'NONE') {
      return { ok: false, code: 'FORBIDDEN', error: 'Your account is not on the Allo Ops access list. Ask an admin to add you.' };
    }

    const allTasks = tasks_();
    let scoped;
    if (role === 'ADMIN') {
      scoped = allTasks.slice();
    } else if (role === 'MANAGER') {
      const visible = visibleTaskIds_(email);
      scoped = allTasks.filter(function (t) { return !!visible[t.id]; });
    } else {
      scoped = allTasks.filter(function (t) { return t.email === email; });
    }
    scoped.sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });

    const byId = {};
    scoped.forEach(function (t) { byId[t.id] = t; });

    const allCycles = cycles_().filter(function (c) { return !!byId[c.taskId]; })
      .sort(function (a, b) {
        const ad = a.scheduledDue ? a.scheduledDue.getTime() : 0;
        const bd = b.scheduledDue ? b.scheduledDue.getTime() : 0;
        return bd - ad;
      })
      .map(function (c) { return sheetCycle_(c, byId[c.taskId]); });

    const active = allCycles.filter(function (c) { return ACTIVE_STATES.indexOf(c.status) >= 0; });

    let allLeave = leaveRows_();
    if (role === 'EMPLOYEE') {
      allLeave = allLeave.filter(function (r) { return r.email === email; });
    } else if (role === 'MANAGER') {
      allLeave = allLeave.filter(function (r) { return r.email === email || r.managerEmail === email; });
    }
    allLeave.sort(function (a, b) {
      return (b.createdAt ? b.createdAt.getTime() : 0) - (a.createdAt ? a.createdAt.getTime() : 0);
    });
    const leave = allLeave.map(leaveView_);

    return {
      ok: true,
      role: role,
      email: email,
      generatedLabel: fmtDT_(new Date()),
      tasks: scoped.map(sheetTask_),
      cycles: allCycles.slice(0, 200),
      leave: leave.slice(0, 200),
      totalCycles: allCycles.length,
      totalLeave: leave.length,
      stats: {
        active: active.length,
        overdue: active.filter(function (c) { return c.overdue; }).length,
        unacked: active.filter(function (c) {
          return !c.ackLabel && (c.overdue || c.status === 'MISSED' || c.status === 'ESCALATED');
        }).length,
        completed: allCycles.filter(function (c) { return c.status === 'COMPLETED'; }).length,
        leavePending: leave.filter(function (r) { return r.status === 'PENDING'; }).length
      }
    };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

/* ------------------------------------------------------------------ */
/* Sheet navigation                                                    */
/* ------------------------------------------------------------------ */

/**
 * Opens the real spreadsheet tab behind one row of the Sheets panel. The tab
 * stays read-only (protectAll_ + onEdit revert); this only saves the user from
 * hunting through the tab menu after orderAndHide_ hid everything.
 */
function openWorkspaceSheet(kind) {
  try {
    const email = actorEmail_().email;
    const role = roleOf_(email);
    if (role === 'NONE') {
      return { ok: false, code: 'FORBIDDEN', error: 'Your account is not on the Allo Ops access list.' };
    }

    const k = String(kind || '').trim().toLowerCase();
    const manager = role === 'ADMIN' || role === 'MANAGER';
    const allowed = manager
      ? ['dashboard', 'review', 'tasks', 'cycles', 'leave']
      : ['tasks', 'cycles', 'leave'];
    if (allowed.indexOf(k) < 0) {
      return { ok: false, code: 'FORBIDDEN', error: 'That page is not part of your Sheets view.' };
    }

    const names = {
      dashboard: S.DASH, review: S.REVIEW, tasks: S.TASKS, cycles: S.CYCLES, leave: S.LEAVE
    };
    const name = names[k];
    const ss = getSS_();
    const sh = ss.getSheetByName(name);
    if (!sh) return { ok: false, error: 'Missing tab "' + name + '". Run setup first.' };

    if (sh.isSheetHidden()) sh.showSheet();
    ss.setActiveSheet(sh);
    SpreadsheetApp.flush();
    return { ok: true, sheet: name, kind: k };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

/** Puts every data tab back behind START HERE. The admin-only undo for the
 *  Open buttons, so a raw tab does not stay visible for the rest of the team. */
function hideWorkspaceTabs() {
  try {
    const me = callerEmail_();
    if (!isAdmin_(me)) {
      return { ok: false, code: 'FORBIDDEN', error: 'Only an admin can hide the data tabs.' };
    }

    const ss = getSS_();
    const start = ss.getSheetByName(S.START);
    if (start) {
      if (start.isSheetHidden()) start.showSheet();
      ss.setActiveSheet(start);
    }

    [S.PENDING, S.REVIEW, S.DASH, S.TASKS, S.HOLIDAYS, S.CONFIG, S.PEOPLE,
      S.LEAVE, S.CYCLES, S.ALERTS, S.AUDIT, S.TOKENS].forEach(function (name) {
      const sh = ss.getSheetByName(name);
      if (!sh || (start && sh.getSheetId() === start.getSheetId())) return;
      try { sh.hideSheet(); } catch (e) { /* already hidden or not permitted */ }
    });

    SpreadsheetApp.flush();
    return { ok: true, message: 'Data tabs hidden again.' };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

/* ------------------------------------------------------------------ */
/* Manager actions from the sidebar                                    */
/* ------------------------------------------------------------------ */

function ackCycleFromSidebar(cycleId) {
  try {
    const email = callerEmail_();
    if (!isManager_(email)) return { ok: false, error: 'Only a manager can acknowledge a review.' };
    const res = ackCycle_(String(cycleId || '').trim(), 'manager', email, false);
    if (!res.ok) return res;
    return {
      ok: true,
      already: !!res.already,
      atLabel: fmtDT_(res.at || new Date()),
      message: res.already ? 'Already acknowledged.' : 'Review acknowledged.'
    };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

function sendCycleReminder(cycleId) {
  try {
    const email = callerEmail_();
    if (!isManager_(email)) return { ok: false, error: 'Only a manager can send a reminder.' };

    const cycle = getCycle_(String(cycleId || '').trim());
    if (!cycle) return { ok: false, error: 'That task cycle no longer exists.' };
    const task = taskMap_()[cycle.taskId];
    if (!task) return { ok: false, error: 'The task definition is missing.' };
    if (!canManageTask_(email, task)) return { ok: false, error: 'That task is outside your team.' };
    if (cycle.status === 'COMPLETED') return { ok: false, error: 'This task is already complete.' };
    if (!task.email) return { ok: false, error: 'This task has no assigned email.' };

    const cache = CacheService.getScriptCache();
    const key = 'REMIND:' + cycle.id;
    if (cache.get(key)) {
      return { ok: false, error: 'A reminder was already sent in the last 10 minutes.' };
    }

    const subject = '[Allo Ops] Reminder: ' + task.name;
    const html = emailShell_(subject,
      '<p>This task is still pending. Please complete it from <b>Allo Ops &gt; My tasks &amp; leave</b>.</p>',
      kvTable_([['Task', task.name], ['Due', fmtDT_(cycle.scheduledDue)],
        ['Grace ends', fmtDT_(cycle.dueAt)], ['Required', task.proofLabel],
        ['Status', cycle.status]]), '');

    MailApp.sendEmail({
      to: task.email,
      subject: subject,
      htmlBody: html,
      name: String(cfg_().COMPANY_NAME || 'Allo') + ' Ops'
    });

    cache.put(key, '1', 600);
    audit_(email, roleOf_(email), 'REMINDER_SENT', 'Cycle', cycle.id, '',
      'to=' + task.email, '', 'sidebar');
    return { ok: true, message: 'Reminder emailed to ' + task.email + '.' };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

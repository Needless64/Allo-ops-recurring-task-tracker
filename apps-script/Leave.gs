/**
 * Allo Innoware — leave requests and the role-aware workspace.
 *
 * FILE 7 of 9 — employees apply for leave, managers approve their own team,
 * admins see every request, and every role gets a role-scoped "My Tasks".
 * All writes come from the sidebar; the sheets stay read-only.
 */

const LEAVE_TYPES = ['Casual', 'Sick', 'Unpaid', 'Other'];
const LEAVE_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN'];

/* ------------------------------------------------------------------ */
/* Leave ledger                                                        */
/* ------------------------------------------------------------------ */

function leaveRows_() {
  try {
    const t = table_(S.LEAVE);
    const c = t.col;
    function get(r, name, fallback) {
      return c[name] == null ? r[fallback] : r[c[name]];
    }
    return t.rows.map(function (r, i) {
      const from = parseDate_(get(r, 'FromDate', 3));
      const to = parseDate_(get(r, 'ToDate', 4));
      const created = parseDate_(get(r, 'CreatedAt', 10));
      const decided = parseDate_(get(r, 'DecidedAt', 12));
      return {
        rowIndex: i + 2,
        id: String(get(r, 'RequestID', 0) || '').trim(),
        email: String(get(r, 'Email', 1) || '').trim().toLowerCase(),
        name: String(get(r, 'Name', 2) || '').trim(),
        from: from,
        to: to,
        days: num_(get(r, 'Days', 5), 0),
        type: String(get(r, 'Type', 6) || 'Other').trim(),
        reason: String(get(r, 'Reason', 7) || '').trim(),
        status: String(get(r, 'Status', 8) || 'PENDING').trim().toUpperCase(),
        managerEmail: String(get(r, 'ManagerEmail', 9) || '').trim().toLowerCase(),
        createdAt: created,
        decidedBy: String(get(r, 'DecidedBy', 11) || '').trim(),
        decidedAt: decided,
        decisionNote: String(get(r, 'DecisionNote', 13) || '').trim(),
        updatedAt: parseDate_(get(r, 'UpdatedAt', 14))
      };
    }).filter(function (x) { return !!x.id; });
  } catch (e) {
    return [];
  }
}

function leaveManagerFor_(email) {
  const e = String(email || '').trim().toLowerCase();
  try {
    const p = personFor_(e);
    if (p && p.managerEmail && p.managerEmail !== e) return p.managerEmail;
  } catch (err) { /* pre-setup */ }
  const fallback = String(cfg_().MANAGER_EMAIL || '').trim().toLowerCase();
  return fallback && fallback !== e ? fallback : '';
}

function leaveView_(r) {
  return {
    id: r.id,
    email: r.email,
    name: r.name || r.email.split('@')[0],
    fromIso: r.from ? isoDate_(r.from) : '',
    toIso: r.to ? isoDate_(r.to) : '',
    fromLabel: r.from ? fmtDate_(r.from) : '',
    toLabel: r.to ? fmtDate_(r.to) : '',
    days: r.days,
    type: r.type,
    reason: r.reason,
    status: r.status,
    managerEmail: r.managerEmail,
    createdIso: r.createdAt ? r.createdAt.toISOString() : '',
    decidedBy: r.decidedBy,
    decidedLabel: r.decidedAt ? fmtDT_(r.decidedAt) : '',
    decisionNote: r.decisionNote
  };
}

function leaveContext_(email, role) {
  const e = String(email || '').trim().toLowerCase();
  const all = leaveRows_();
  const newest = function (a, b) {
    return (b.createdAt ? b.createdAt.getTime() : 0) - (a.createdAt ? a.createdAt.getTime() : 0);
  };

  const mine = all.filter(function (r) { return r.email === e; })
    .sort(newest).slice(0, 40).map(leaveView_);

  let approvals = [];
  let decided = [];
  if (role === 'ADMIN') {
    approvals = all.filter(function (r) { return r.status === 'PENDING' && r.email !== e; })
      .sort(newest).map(leaveView_);
    decided = all.filter(function (r) { return r.status !== 'PENDING' && r.status !== 'WITHDRAWN'; })
      .sort(newest).slice(0, 15).map(leaveView_);
  } else if (role === 'MANAGER') {
    const team = all.filter(function (r) {
      return r.email !== e && (r.managerEmail === e || leaveManagerFor_(r.email) === e);
    });
    approvals = team.filter(function (r) { return r.status === 'PENDING'; })
      .sort(newest).map(leaveView_);
    decided = team.filter(function (r) { return r.status !== 'PENDING' && r.status !== 'WITHDRAWN'; })
      .sort(newest).slice(0, 15).map(leaveView_);
  }

  return {
    mine: mine,
    approvals: approvals,
    decided: decided,
    managerEmail: leaveManagerFor_(e)
  };
}

/* ------------------------------------------------------------------ */
/* Leave actions                                                       */
/* ------------------------------------------------------------------ */

function applyLeave(data) {
  try {
    const actor = callerEmail_();
    if (!actor) return { ok: false, error: 'Your Google account could not be identified.' };
    const role = roleOf_(actor);
    if (role === 'NONE') {
      return { ok: false, error: 'Your account is not on the Allo Ops access list. Ask an admin to add you.' };
    }

    const input = data || {};
    const fromRaw = parseDate_(input.fromIso);
    const toRaw = parseDate_(input.toIso);
    const from = fromRaw ? startOfDay_(fromRaw) : null;
    const to = toRaw ? startOfDay_(toRaw) : null;
    const type = String(input.type || '').trim();
    const reason = safeText_(String(input.reason || ''), 300);
    const today = startOfDay_(new Date());

    if (!from || !to) return { ok: false, error: 'Choose both the first and last day of leave.' };
    if (to.getTime() < from.getTime()) return { ok: false, error: 'The last day cannot be before the first day.' };
    if (to.getTime() < today.getTime()) return { ok: false, error: 'Leave cannot end in the past.' };
    if (LEAVE_TYPES.indexOf(type) < 0) return { ok: false, error: 'Choose a valid leave type.' };
    if (reason.length < 3) return { ok: false, error: 'Add a short reason (at least 3 characters).' };

    const days = Math.round((to.getTime() - from.getTime()) / 86400000) + 1;
    if (days > 90) return { ok: false, error: 'A single request cannot be longer than 90 days.' };

    const clash = leaveRows_().filter(function (r) {
      if (r.email !== actor || (r.status !== 'PENDING' && r.status !== 'APPROVED')) return false;
      return r.from && r.to && from.getTime() <= r.to.getTime() && to.getTime() >= r.from.getTime();
    })[0];
    if (clash) {
      return { ok: false, error: 'This overlaps your existing request (' + clash.id + ', ' + clash.status.toLowerCase() + ').' };
    }

    const person = personFor_(actor);
    const managerEmail = leaveManagerFor_(actor);
    const now = new Date();
    const id = 'L-' + Utilities.formatDate(now, tz_(), 'yyyyMMdd') + '-' +
      Utilities.getUuid().replace(/-/g, '').slice(0, 5).toUpperCase();

    appendRows_(S.LEAVE, [[
      id, actor, (person && person.name) || actor.split('@')[0], from, to, days, type, reason,
      'PENDING', managerEmail, now, '', '', '', now
    ]]);

    audit_(actor, role, 'LEAVE_APPLIED', 'Leave', id, '',
      JSON.stringify({ from: isoDate_(from), to: isoDate_(to), type: type, days: days }), '', 'sidebar');

    if (managerEmail) {
      try {
        const subject = '[Allo Ops] Leave request: ' + ((person && person.name) || actor);
        const html = emailShell_(subject,
          '<p>' + escHtml_(actor) + ' has applied for leave. Review it from <b>Allo Ops &gt; My tasks &amp; reviews</b>.</p>',
          kvTable_([['From', fmtDate_(from)], ['To', fmtDate_(to)], ['Days', String(days)],
            ['Type', type], ['Reason', reason], ['Request', id]]), '');
        MailApp.sendEmail({ to: managerEmail, subject: subject, htmlBody: html,
          name: String(cfg_().COMPANY_NAME || 'Allo') + ' Ops' });
      } catch (e) {
        audit_(actor, role, 'LEAVE_EMAIL_FAILED', 'Leave', id, '', String(e.message || e).slice(0, 200), '', 'sidebar');
      }
    }

    return { ok: true, id: id, message: 'Request sent' + (managerEmail ? ' to ' + managerEmail : '') + '.' };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

function cancelLeave(requestId) {
  try {
    const actor = callerEmail_();
    if (!actor) return { ok: false, error: 'Your Google account could not be identified.' };
    const id = String(requestId || '').trim();
    const row = leaveRows_().filter(function (r) { return r.id === id; })[0];
    if (!row) return { ok: false, error: 'That leave request no longer exists.' };
    if (row.email !== actor) return { ok: false, error: 'You can withdraw only your own request.' };
    if (row.status !== 'PENDING') return { ok: false, error: 'Only a pending request can be withdrawn.' };

    const sh = sheet_(S.LEAVE);
    sh.getRange(row.rowIndex, 9).setValue('WITHDRAWN');
    sh.getRange(row.rowIndex, 15).setValue(new Date());
    audit_(actor, roleOf_(actor), 'LEAVE_WITHDRAWN', 'Leave', id, 'PENDING', 'WITHDRAWN', '', 'sidebar');
    return { ok: true, message: 'Request withdrawn.' };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

function decideLeave(requestId, decision, note) {
  try {
    const actor = callerEmail_();
    if (!actor) return { ok: false, error: 'Your Google account could not be identified.' };
    const role = roleOf_(actor);
    if (role !== 'ADMIN' && role !== 'MANAGER') {
      return { ok: false, error: 'Only a manager or admin can decide leave.' };
    }

    const id = String(requestId || '').trim();
    const row = leaveRows_().filter(function (r) { return r.id === id; })[0];
    if (!row) return { ok: false, error: 'That leave request no longer exists.' };
    if (row.email === actor) return { ok: false, error: 'You cannot decide your own leave request.' };
    if (row.status !== 'PENDING') return { ok: false, error: 'This request is already ' + row.status.toLowerCase() + '.' };

    if (role === 'MANAGER' && row.managerEmail !== actor && leaveManagerFor_(row.email) !== actor) {
      return { ok: false, error: 'This request belongs to another manager’s team.' };
    }

    const verdict = String(decision || '').trim().toUpperCase();
    if (verdict !== 'APPROVED' && verdict !== 'REJECTED') {
      return { ok: false, error: 'Choose approve or reject.' };
    }
    const comment = safeText_(String(note || ''), 300);
    if (verdict === 'REJECTED' && comment.length < 3) {
      return { ok: false, error: 'Add a short reason for rejecting.' };
    }

    const now = new Date();
    const sh = sheet_(S.LEAVE);
    sh.getRange(row.rowIndex, 9).setValue(verdict);
    sh.getRange(row.rowIndex, 12).setValue(actor);
    sh.getRange(row.rowIndex, 13).setValue(now);
    sh.getRange(row.rowIndex, 14).setValue(comment);
    sh.getRange(row.rowIndex, 15).setValue(now);

    audit_(actor, role, 'LEAVE_' + verdict, 'Leave', id, 'PENDING',
      JSON.stringify({ decision: verdict, note: comment }), '', 'sidebar');

    try {
      const subject = '[Allo Ops] Leave ' + verdict.toLowerCase() + ': ' + fmtDate_(row.from);
      const html = emailShell_(subject,
        '<p>Your leave request <b>' + escHtml_(id) + '</b> was <b>' + verdict.toLowerCase() + '</b> by ' +
          escHtml_(actor) + '.</p>',
        kvTable_([['From', fmtDate_(row.from)], ['To', fmtDate_(row.to)], ['Days', String(row.days)],
          ['Type', row.type], ['Note', comment || '—']]), '');
      MailApp.sendEmail({ to: row.email, subject: subject, htmlBody: html,
        name: String(cfg_().COMPANY_NAME || 'Allo') + ' Ops' });
    } catch (e) {
      audit_(actor, role, 'LEAVE_EMAIL_FAILED', 'Leave', id, '', String(e.message || e).slice(0, 200), '', 'sidebar');
    }

    return { ok: true, message: 'Request ' + verdict.toLowerCase() + '.' };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

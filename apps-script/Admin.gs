/**
 * Allo Innoware — role-based access control and the admin side panel.
 *
 * FILE 6 of 9 — People directory, role checks, manager scoping, admin endpoints.
 * The People sheet is the source of truth after setup. Config emails remain
 * delivery addresses only; they do not grant access.
 */

const ROLES = ['ADMIN', 'MANAGER', 'EMPLOYEE'];

/* ------------------------------------------------------------------ */
/* People directory                                                    */
/* ------------------------------------------------------------------ */

function people_() {
  try {
    const t = table_(S.PEOPLE);
    const c = t.col;
    return t.rows.map(function (r, i) {
      const get = function (name, fallback) {
        return c[name] == null ? r[fallback] : r[c[name]];
      };
      return {
        rowIndex: i + 2,
        email: String(get('Email', 0) || '').trim().toLowerCase(),
        name: String(get('Name', 1) || '').trim(),
        role: String(get('Role', 2) || '').trim().toUpperCase(),
        managerEmail: String(get('ManagerEmail', 3) || '').trim().toLowerCase(),
        active: truthy_(get('Active', 4)),
        addedAt: get('AddedAt', 5),
        addedBy: String(get('AddedBy', 6) || '').trim(),
        updatedAt: get('UpdatedAt', 7),
        updatedBy: String(get('UpdatedBy', 8) || '').trim(),
        notes: String(get('Notes', 9) || '').trim()
      };
    }).filter(function (p) { return !!p.email; });
  } catch (e) {
    return [];
  }
}

function peopleSheetExists_() {
  try {
    return !!getSS_().getSheetByName(S.PEOPLE);
  } catch (e) {
    return false;
  }
}

function personFor_(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return null;
  const all = people_();
  for (let i = 0; i < all.length; i++) {
    if (all[i].email === e) return all[i];
  }
  return null;
}

function activeAdmins_() {
  return people_().filter(function (p) { return p.active && p.role === 'ADMIN'; });
}

function activeManagers_() {
  return people_().filter(function (p) {
    return p.active && (p.role === 'ADMIN' || p.role === 'MANAGER');
  });
}

/**
 * Resolve the app role. People is authoritative once it has rows. The legacy
 * fallback only exists so an existing sheet can be migrated by running setup.
 */
function roleOf_(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return 'NONE';

  const all = people_();
  if (all.length) {
    const p = personFor_(e);
    if (!p || !p.active) return 'NONE';
    return ROLES.indexOf(p.role) >= 0 ? p.role : 'EMPLOYEE';
  }

  const admin = String(cfg_().ADMIN_EMAIL || '').trim().toLowerCase();
  if (admin && e === admin) return 'ADMIN';
  const manager = String(cfg_().MANAGER_EMAIL || '').trim().toLowerCase();
  if (manager && e === manager) return 'MANAGER';
  try {
    if (tasks_().some(function (t) { return t.ownerManager === e; })) return 'MANAGER';
    if (tasks_().some(function (t) { return t.email === e; })) return 'EMPLOYEE';
  } catch (err) { /* pre-setup */ }
  return 'NONE';
}

function isAdmin_(email) {
  return roleOf_(email) === 'ADMIN';
}

function isManager_(email) {
  const role = roleOf_(email);
  return role === 'ADMIN' || role === 'MANAGER';
}

function requireAdmin_() {
  // The Apps Script editor can hide the active email; fall back to the
  // effective user there, never for a normal signed-in sheet user.
  return isAdmin_(callerEmail_()) || isAdmin_(ownerEmail_());
}

function adminDenied_(message) {
  const ui = safeUi_();
  if (ui) ui.alert('Admin only', message || 'Only an admin can do this.', ui.ButtonSet.OK);
  return false;
}

/* ------------------------------------------------------------------ */
/* Bootstrap                                                           */
/* ------------------------------------------------------------------ */

function seedPeople_() {
  const sh = sheet_(S.PEOPLE);
  if (sh.getLastRow() > 1) return;

  const seen = {};
  const rows = [];
  const owner = String(cfg_().ADMIN_EMAIL || ownerEmail_() || '').trim().toLowerCase();
  const manager = String(cfg_().MANAGER_EMAIL || '').trim().toLowerCase();

  function add(email, name, role, managerEmail) {
    const e = String(email || '').trim().toLowerCase();
    if (!e || seen[e]) return;
    seen[e] = true;
    rows.push([e, name || e.split('@')[0], role, managerEmail || '', true,
      new Date(), 'setup', new Date(), 'setup', 'Seeded during setup; edit in Admin panel.']);
  }

  if (owner) add(owner, 'Owner', 'ADMIN', '');
  if (manager) add(manager, manager.split('@')[0], 'MANAGER', '');

  try {
    tasks_().forEach(function (t) {
      if (t.ownerManager) add(t.ownerManager, t.ownerManager.split('@')[0], 'MANAGER', '');
      if (t.email) add(t.email, t.employee || t.email.split('@')[0], 'EMPLOYEE',
        t.ownerManager || manager);
    });
  } catch (e) { /* TaskMaster may be empty on a first run */ }

  if (rows.length) {
    sh.getRange(2, 1, rows.length, H.PEOPLE.length).setValues(rows);
    sh.getRange(2, 1, rows.length, H.PEOPLE.length).setVerticalAlignment('top');
  }
}

/* ------------------------------------------------------------------ */
/* Manager scope                                                       */
/* ------------------------------------------------------------------ */

function managedEmails_(manager) {
  const m = String(manager || '').trim().toLowerCase();
  const out = {};
  if (!m) return out;
  people_().forEach(function (p) {
    if (p.active && p.managerEmail === m && p.role !== 'ADMIN') out[p.email] = true;
  });
  tasks_().forEach(function (t) {
    if (t.ownerManager === m && t.email) out[t.email] = true;
  });
  return out;
}

function canManageTask_(manager, task) {
  const m = String(manager || '').trim().toLowerCase();
  if (!m || !task) return false;
  if (isAdmin_(m)) return true;
  if (task.ownerManager === m) return true;
  return !!managedEmails_(m)[String(task.email || '').toLowerCase()];
}

function visibleTaskIds_(email) {
  const e = String(email || '').trim().toLowerCase();
  const role = roleOf_(e);
  const out = {};
  if (role === 'NONE') return out;
  const tasks = tasks_();
  if (role === 'ADMIN') {
    tasks.forEach(function (t) { out[t.id] = true; });
    return out;
  }
  if (role === 'MANAGER') {
    const managed = managedEmails_(e);
    tasks.forEach(function (t) {
      if (t.ownerManager === e || managed[String(t.email || '').toLowerCase()]) out[t.id] = true;
    });
    return out;
  }
  tasks.forEach(function (t) { if (t.email === e) out[t.id] = true; });
  return out;
}

/* ------------------------------------------------------------------ */
/* Admin panel                                                         */
/* ------------------------------------------------------------------ */

function getAdminContext() {
  try {
    const me = callerEmail_();
    if (!isAdmin_(me)) {
      return { ok: false, code: 'FORBIDDEN', error: 'This area is available to admins only.' };
    }

    const all = people_().slice().sort(function (a, b) {
      const rank = { ADMIN: 0, MANAGER: 1, EMPLOYEE: 2 };
      const d = (rank[a.role] == null ? 9 : rank[a.role]) - (rank[b.role] == null ? 9 : rank[b.role]);
      return d || a.email.localeCompare(b.email);
    });

    const managers = all.filter(function (p) {
      return p.active && (p.role === 'ADMIN' || p.role === 'MANAGER');
    }).map(function (p) {
      return { email: p.email, name: p.name, role: p.role };
    });

    const active = all.filter(function (p) { return p.active; });
    const visible = all.map(function (p) {
      return {
        email: p.email, name: p.name, role: p.role, managerEmail: p.managerEmail,
        active: p.active, notes: p.notes
      };
    });
    return {
      ok: true,
      email: me,
      company: String(cfg_().COMPANY_NAME || 'Allo Innoware'),
      roles: ROLES,
      people: visible,
      managers: managers,
      stats: {
        admins: active.filter(function (p) { return p.role === 'ADMIN'; }).length,
        managers: active.filter(function (p) { return p.role === 'MANAGER'; }).length,
        employees: active.filter(function (p) { return p.role === 'EMPLOYEE'; }).length,
        inactive: all.length - active.length
      }
    };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

function savePerson(data) {
  try {
    const actor = callerEmail_();
    if (!isAdmin_(actor)) {
      return { ok: false, code: 'FORBIDDEN', error: 'Only an admin can change access.' };
    }

    const input = data || {};
    const email = String(input.email || '').trim().toLowerCase();
    const name = String(input.name || '').trim().slice(0, 120);
    const role = String(input.role || '').trim().toUpperCase();
    const managerEmail = String(input.managerEmail || '').trim().toLowerCase();
    const active = input.active !== false && String(input.active).toLowerCase() !== 'false';

    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return { ok: false, error: 'Enter a valid email address.' };
    }
    if (ROLES.indexOf(role) < 0) {
      return { ok: false, error: 'Choose a valid role.' };
    }
    if (managerEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(managerEmail)) {
      return { ok: false, error: 'The manager email is not valid.' };
    }
    if (managerEmail === email) {
      return { ok: false, error: 'A person cannot be their own manager.' };
    }

    const sh = sheet_(S.PEOPLE);

    // Pre-setup the panel can be opened through the Config fallback. Persist
    // the acting admin before the first person is written, otherwise the very
    // first access edit would leave the People directory with no admin.
    if (!people_().length && isAdmin_(actor)) {
      sh.getRange(sh.getLastRow() + 1, 1, 1, H.PEOPLE.length).setValues([[
        actor, actor.split('@')[0], 'ADMIN', '', true, new Date(), 'bootstrap', new Date(), actor,
        'Bootstrap admin created by the access panel.'
      ]]);
    }

    const existing = personFor_(email);
    const admins = activeAdmins_().length;
    if (existing && existing.active && existing.role === 'ADMIN' && (role !== 'ADMIN' || !active) && admins <= 1) {
      return { ok: false, error: 'You cannot remove or demote the last active admin.' };
    }

    const before = existing ? {
      email: existing.email, name: existing.name, role: existing.role,
      managerEmail: existing.managerEmail, active: existing.active
    } : null;

    const values = [
      email,
      name || email.split('@')[0],
      role,
      managerEmail,
      active,
      existing ? existing.addedAt || new Date() : new Date(),
      existing ? existing.addedBy || actor : actor,
      new Date(),
      actor,
      String(input.notes || '').trim().slice(0, 400)
    ];

    if (existing) {
      sh.getRange(existing.rowIndex, 1, 1, H.PEOPLE.length).setValues([values]);
    } else {
      sh.getRange(sh.getLastRow() + 1, 1, 1, H.PEOPLE.length).setValues([values]);
    }

    audit_(actor, 'ADMIN', existing ? 'ROLE_UPDATED' : 'ROLE_ADDED', 'Person', email,
      before ? JSON.stringify(before) : '', JSON.stringify({
        email: email, name: values[1], role: role, managerEmail: managerEmail, active: active
      }), '', 'admin-panel');

    refreshCaches_();
    try { protectAll_(); } catch (e) { /* protection update is best-effort */ }
    return getAdminContext();
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

function showAdminSidebar() {
  const ui = safeUi_();
  if (!ui) return;
  if (!isAdmin_(callerEmail_())) {
    ui.alert('Admin only', 'Only an admin can open the access panel.', ui.ButtonSet.OK);
    return;
  }
  const html = HtmlService.createHtmlOutputFromFile('Admin1')
    .setTitle('Access control')
    .setWidth(500);
  ui.showSidebar(html);
}

/**
 * Opened from the workspace sidebar. See openManageDialog(): a second
 * showSidebar() call is dropped while a sidebar is open, so use a dialog.
 */
function openAdminDialog() {
  try {
    const ui = safeUi_();
    if (!ui) return { ok: false, error: 'Open the Google Sheet first, then use the Allo Ops menu.' };
    if (!isAdmin_(callerEmail_())) {
      return { ok: false, code: 'FORBIDDEN', error: 'Only an admin can open the access panel.' };
    }

    const html = HtmlService.createHtmlOutputFromFile('Admin1')
      .setWidth(680)
      .setHeight(760);
    ui.showModalDialog(html, 'Access control');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

/* ------------------------------------------------------------------ */
/* Admin-only menu wrappers                                            */
/* ------------------------------------------------------------------ */

function adminInstallTriggers() {
  if (!requireAdmin_()) {
    adminDenied_('Only an admin can install triggers.');
    return;
  }
  installTriggers_();
  toast_('Triggers installed.', 'Admin');
}

function adminRefreshDashboard() {
  if (!requireAdmin_()) {
    adminDenied_('Only an admin can rebuild the dashboard.');
    return;
  }
  refreshDashboard_();
  toast_('Dashboard rebuilt.', 'Admin');
}

function devRequireAdmin_() {
  if (requireAdmin_()) return true;
  adminDenied_('Test tools are available to admins only.');
  return false;
}

/**
 * Allo Innoware — Recurring Task Tracking, Pending Reports & Escalation
 * FILE 3 of 9 — identity, signed links, web app, sidebar, read-only sheet guard.
 */

/* ------------------------------------------------------------------ */
/* Roles                                                               */
/* ------------------------------------------------------------------ */

function isLeadership_(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return false;
  const list = String(cfg_().LEADERSHIP_EMAILS || '').split(',')
    .map(function (s) { return s.trim().toLowerCase(); }).filter(function (s) { return !!s; });
  return list.indexOf(e) >= 0;
}

function toast_(message, title) {
  try {
    SpreadsheetApp.getActive().toast(message, title || '', 6);
  } catch (e) { /* ignore */ }
}

/* ------------------------------------------------------------------ */
/* Signed action links (HMAC + expiry + single use)                    */
/* ------------------------------------------------------------------ */

function tokenSecret_() {
  const props = PropertiesService.getScriptProperties();
  let s = props.getProperty('TOKEN_SECRET');
  if (!s) {
    s = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty('TOKEN_SECRET', s);
  }
  return s;
}

function signToken_(cycleId, action) {
  const ttl = num_(cfg_().TOKEN_TTL_HOURS, 72);
  const exp = Date.now() + ttl * 3600000;
  const nonce = Utilities.getUuid().replace(/-/g, '');
  const payload = [cycleId, action, exp, nonce].join('|');
  const encoded = Utilities.base64EncodeWebSafe(payload);
  const sig = Utilities.base64EncodeWebSafe(
    Utilities.computeHmacSha256Signature(encoded, tokenSecret_()));
  return encoded + '.' + sig;
}

function safeEqual_(a, b) {
  a = String(a || '');
  b = String(b || '');
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function verifyToken_(token) {
  try {
    const t = String(token || '');
    const parts = t.split('.');
    if (parts.length !== 2) return { ok: false, reason: 'malformed' };

    const expected = Utilities.base64EncodeWebSafe(
      Utilities.computeHmacSha256Signature(parts[0], tokenSecret_()));
    if (!safeEqual_(expected, parts[1])) return { ok: false, reason: 'signature' };

    const payload = Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString();
    const f = payload.split('|');
    if (f.length !== 4) return { ok: false, reason: 'payload' };

    const cycleId = f[0];
    const action = f[1];
    const exp = Number(f[2]);
    const nonce = f[3];
    if (!cycleId || !action || !nonce) return { ok: false, reason: 'payload' };
    if (!exp || exp < Date.now()) return { ok: false, reason: 'expired' };

    const tokens = table_(S.TOKENS);
    const c = tokens.col;
    for (let i = 0; i < tokens.rows.length; i++) {
      if (String(tokens.rows[i][c.Nonce]) === nonce) return { ok: false, reason: 'used' };
    }
    return { ok: true, cycleId: cycleId, action: action, exp: exp, nonce: nonce };
  } catch (e) {
    return { ok: false, reason: 'error' };
  }
}

function markTokenUsed_(v) {
  try {
    appendRows_(S.TOKENS, [[v.nonce, v.cycleId, v.action, new Date(v.exp), new Date(), 'webapp']]);
  } catch (e) { /* ignore */ }
}

function webAppUrl_() {
  const props = PropertiesService.getScriptProperties();
  let url = props.getProperty('WEBAPP_URL');
  if (url) return url;
  try {
    url = ScriptApp.getService().getUrl();
    if (url) return url;
  } catch (e) { /* not deployed */ }
  return '';
}

function actionUrl_(cycleId, action) {
  const base = webAppUrl_();
  if (!base) return '';
  return base + '?t=' + encodeURIComponent(signToken_(cycleId, action));
}

function captureWebAppUrl() {
  if (!requireAdmin_()) {
    adminDenied_('Only an admin can set the web app URL.');
    return;
  }
  const ui = safeUi_();
  try {
    const url = ScriptApp.getService().getUrl();
    if (!url) throw new Error('No deployment found.');
    PropertiesService.getScriptProperties().setProperty('WEBAPP_URL', url);
    audit_('system', 'SYSTEM', 'WEBAPP_URL_SET', 'Config', '', '', url, '', 'menu');
    if (ui) ui.alert('Web app URL saved', url + '\n\nAlert emails will now include one-click action links.', ui.ButtonSet.OK);
  } catch (e) {
    if (ui) {
      ui.alert('Deploy first',
        'Deploy > New deployment > Web app\nExecute as: Me\nWho has access: Anyone\n\n' +
        'Then run this again.\n\nDetails: ' + e.message, ui.ButtonSet.OK);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Web app                                                             */
/* ------------------------------------------------------------------ */

function doGet(e) {
  const token = e && e.parameter ? e.parameter.t : '';
  const v = verifyToken_(token);

  if (!v.ok) {
    audit_('anonymous', 'NONE', 'TOKEN_DENIED', 'Token', '', v.reason || '', '', '', 'webapp');
    return htmlPage_('Link not usable',
      '<p>This link is invalid, expired, or has already been used.</p>' +
      '<p>Open the Google Sheet and use <b>ManagerReview</b> to acknowledge the item instead.</p>');
  }

  let result;
  if (v.action === 'ACK') {
    result = ackCycle_(v.cycleId, 'manager', 'signed email link', true);
  } else if (v.action === 'LEAD_ACK') {
    result = ackCycle_(v.cycleId, 'leadership', 'signed email link', true);
  } else {
    return htmlPage_('Unknown action', '<p>This link does not match a supported action.</p>');
  }

  markTokenUsed_(v);

  if (!result.ok) {
    return htmlPage_('Could not acknowledge', '<p>' + escHtml_(result.error || 'Please try again.') + '</p>');
  }
  const when = result.at ? fmtDT_(result.at) : '';
  return htmlPage_(result.already ? 'Already acknowledged' : 'Acknowledged',
    '<p>Your review has been recorded' + (when ? ' at <b>' + escHtml_(when) + '</b>' : '') + '.</p>' +
    '<p style="color:#667085">Acknowledging records your review; it does not close the task. ' +
    'Completion by the employee stops further escalation.</p>');
}

function htmlPage_(title, bodyHtml) {
  const html = '<!DOCTYPE html><html><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + escHtml_(title) + '</title></head>' +
    '<body style="margin:0;background:#F2F4F7;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif">' +
    '<div style="max-width:520px;margin:48px auto;background:#fff;border:1px solid #EAECF0;border-radius:12px;' +
    'padding:28px;color:#101828">' +
    '<div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#667085;margin-bottom:8px">' +
    escHtml_(cfg_().COMPANY_NAME || 'Allo Innoware') + ' Ops</div>' +
    '<h1 style="font-size:20px;margin:0 0 12px">' + escHtml_(title) + '</h1>' +
    '<div style="font-size:14px;line-height:1.55">' + bodyHtml + '</div>' +
    '</div></body></html>';
  return HtmlService.createHtmlOutput(html)
    .setTitle(title)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/* ------------------------------------------------------------------ */
/* Sidebar                                                             */
/* ------------------------------------------------------------------ */

function showSidebar() {
  const html = HtmlService.createHtmlOutputFromFile('Sidebar')
    .setTitle('Allo Ops workspace')
    .setWidth(420);
  safeUi_().showSidebar(html);
}

function getMyTasks() {
  try {
    const ws = getWorkspace();
    if (!ws.ok) return ws;
    return {
      ok: true,
      email: ws.email,
      identityFallback: ws.identityFallback,
      demoMode: ws.demoMode,
      items: ws.tasks,
      message: ws.taskMessage,
      serverNowIso: new Date().toISOString()
    };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

function submitCompletion(cycleId, ticketId, note, proofUrl, submissionId) {
  try {
    const actor = callerEmail_();
    if (!actor) return { ok: false, error: 'Your Google account could not be identified.' };
    if (roleOf_(actor) === 'NONE') {
      return { ok: false, error: 'Your account is not on the Allo Ops access list.' };
    }
    const cycle = getCycle_(cycleId);
    if (!cycle) return { ok: false, error: 'That task cycle no longer exists.' };
    const task = taskMap_()[cycle.taskId];
    if (!task) return { ok: false, error: 'The task definition for this cycle is missing.' };
    if (String(task.email || '').toLowerCase() !== actor.toLowerCase()) {
      return { ok: false, error: 'You can complete only your own assigned tasks.' };
    }
    return completeCycle_(cycleId, {
      ticketId: ticketId,
      note: note,
      proofUrl: proofUrl,
      submissionId: submissionId
    });
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

/* ------------------------------------------------------------------ */
/* Read-only sheets                                                    */
/* ------------------------------------------------------------------ */

/**
 * Every managed tab is read-only for every role, admin included. Manual edits
 * are restored and audited; all changes go through the Allo Ops side panels.
 * The installable trigger runs with the installer's authority, so it can put
 * cells back even on a protected sheet.
 */
function onSheetEdit(e) {
  try {
    if (!e || !e.range) return;
    const sh = e.range.getSheet();
    const name = sh.getName();
    const managed = Object.keys(S).map(function (k) { return S[k]; });
    if (managed.indexOf(name) < 0) return;

    const range = e.range;
    const actor = actorEmail_();
    const before = e.oldValue === undefined ? '' : String(e.oldValue == null ? '' : e.oldValue).slice(0, 200);
    const after = e.value === undefined ? '' : String(e.value == null ? '' : e.value).slice(0, 200);
    const a1 = range.getA1Notation();
    const multi = range.getNumRows() > 1 || range.getNumColumns() > 1;

    audit_(actor.email || 'unknown', roleOf_(actor.email), 'SHEET_EDIT_BLOCKED', name, a1,
      before, after, '', 'sheet');

    let restored = false;
    if (!multi) {
      try {
        if (e.oldValue === undefined) range.clearContent();
        else range.setValue(e.oldValue);
        restored = true;
      } catch (err) { /* event has no old value, or the range is protected */ }
    } else if ([S.PENDING, S.REVIEW, S.DASH, S.START].indexOf(name) >= 0) {
      // Generated reports can be rebuilt without touching source data.
      try {
        if (name === S.REVIEW) refreshReview_();
        else if (name === S.PENDING) refreshPending_();
        else if (name === S.DASH) refreshDashboard_();
        else writeStartHere_();
        restored = true;
      } catch (err) { /* ignore */ }
    }

    toast_(restored
      ? 'This sheet is read only. Use the Allo Ops side panels.'
      : 'Editing is disabled. Use the side panels, or undo the change with Ctrl+Z.',
      'Read only');
  } catch (err) {
    console.error('onSheetEdit failed: ' + (err.message || err));
  }
}

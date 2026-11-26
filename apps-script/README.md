# Allo Innoware — Recurring Task Tracking, Pending Reports & Escalation

Google Sheets + Apps Script prototype. One sheet, one employee action point, same-day manager alerts,
leadership escalation, and replay-safe automation.

## Files

| File | Purpose |
|---|---|
| `Code.gs` | Schema, setup, config, date/workday maths, protections, menu |
| `Engine.gs` | Cycle maths, completion, missed detection, escalation, outbox, digests, views |
| `Web.gs` | Identity, signed single-use links, web app, sidebar endpoints, read-only sheet guard |
| `Dev.gs` | Test tools used for Tests 4, 6 and 8 |
| `Review.gs` | Role-scoped review data and manager dashboard |
| `Admin.gs` | People directory, roles, manager scoping and admin panel endpoints |
| `Leave.gs` | Leave requests, manager decisions and the role-aware workspace payload |
| `Workspace.gs` | Review queue, sidebar acknowledgement and reminder emails |
| `Manage.gs` | Task assignment for managers/admins, plus admin holidays and settings |
| `Sidebar.html` | Role-aware workspace: my tasks, review, leave, team leave, admin |
| `Review1.html` | Compact review sidebar with a tab selector and search (named `Review1` so it does not collide with `Review.gs`) |
| `Admin1.html` | Admin-only access-control sidebar |
| `Manage1.html` | Task assignment, holidays and settings sidebar |
| `appsscript.json` | Timezone, least-privilege scopes, web-app config |

## Setup (about 10 minutes)

1. Create a blank Google Sheet named `Allo — Recurring Ops`.
2. **Extensions → Apps Script**.
3. Rename the default file to `Code.gs` and paste its contents. Then create the other script files
   (`+ → Script`) named `Engine.gs`, `Web.gs`, `Dev.gs`, `Review.gs`, `Admin.gs`, `Leave.gs`,
   `Workspace.gs` and `Manage.gs`, and paste each. Create HTML files named `Sidebar`, `Review1`,
   `Admin1` and `Manage1`, and paste the matching `.html` files.
4. **Project Settings → Time zone = Asia/Kolkata.** Optional: tick *Show `appsscript.json`* and replace
   the manifest with the supplied one (sets scopes and the web-app config).
5. Save, choose function `setup`, **Run**. Approve the permission prompt. This creates all tabs, seeds four
   demo tasks assigned to your own account, protects the state tabs, hides the ledger, and installs triggers.
6. **Deploy → New deployment → Web app**
   - Execute as: **Me**
   - Who has access: **Anyone** (if your domain blocks it: *Anyone with a Google account*)
   - Deploy, copy the `/exec` URL.
7. In the sheet: **Allo Ops → Admin → Set web app URL**. This is what puts signed Acknowledge buttons in alert emails. If that reports no deployment, use **Set web app URL manually** and paste the `/exec` link.
8. Reload the sheet. **Allo Ops → My tasks & leave** (employees) or **My tasks & reviews**
   (managers/admins) opens the role-aware workspace. Managers also see **Review a tab** and **Assign a task**;
   admins also see **Admin panel — people** and **Manage tasks & settings**.

> `setup` seeds the first ADMIN from `Config.ADMIN_EMAIL` (or the owner when that is blank). After that,
> only an existing admin can create another admin. The four demo tasks are assigned to your own account;
> use **Admin panel** to add real people, then **Manage tasks & settings** (or a manager's
> **Assign a task**) to assign their work. Nothing is edited directly in a tab.

## Configure the real team

Open **Allo Ops → Admin panel — people**. Add each person by their Google account email, choose `ADMIN`,
`MANAGER` or `EMPLOYEE`, and set the employee's Manager. Deactivating a person blocks their app access
without deleting their task rows. Only an admin can open this panel or grant `ADMIN`; the last active admin
cannot be removed or demoted. The panel writes every change to `AuditLog` as `ROLE_ADDED` or
`ROLE_UPDATED`.

The `People` tab is the source of truth for roles after setup. `Config` emails are delivery addresses only;
they do not grant access. If an existing sheet has no `People` rows, run `setup` once to migrate it from
`TaskMaster` and `Config`.

Managers can assign recurring tasks to their own team from the workspace's **Assign task** button or
**Allo Ops → Assign a task**. The form writes to `TaskMaster` through the server, so the manager never edits
a tab; assignment is rejected for anyone outside their reporting line. Admins can assign to anyone, create
holidays and change `Config` from **Manage tasks & settings**.

A `TaskID` is unique in `TaskMaster`, compared case-insensitively. Creating a task under an ID that
already exists is refused: the form shows `Task ID "X" is already used by "…"` and the attempt is written
to `AuditLog` as `TASK_DUPLICATE_BLOCKED`. The existing row is never rewritten, and the stored spelling is
kept, because `Cycles.TaskID` joins back on it. Two rows with one ID would leave `taskMap_` using only one
definition while `reconcileCycles_` raised a cycle for each. Rows that already collide are cleared by
**Allo Ops → Admin → Remove duplicate task IDs**, which keeps the first row per ID, writes the deleted
row's contents to `AuditLog` as `TASK_DUPLICATE_REMOVED`, and cancels `OPEN` cycles that repeat a
`CycleID` as `CYCLE_DUPLICATE_CANCELLED`.

A task created from the panel always starts active, so its first cycle is raised immediately. **Active** is
an edit-time setting: untick it, or press **Pause** on the task card, to stop an existing task producing
cycles.

`Config` (protected):

| Key | Set it to |
|---|---|
| `MANAGER_EMAIL` | the ops manager's work email |
| `LEADERSHIP_EMAILS` | comma-separated founder/COO emails |
| `ADMIN_EMAIL` | bootstrap admin for the first `setup`; roles after that are in `People` |
| `DAILY_ESCALATION_TIME` | default `11:00` next working day |
| `ESCALATION_HOURS` | default `24` for 7/15/30-day tasks |
| `QUIET_START` / `QUIET_END` | `22:00` / `08:00` — alerts queue, then send at 08:00 |
| `TICKET_PATTERN` | default `^[A-Z]{2,6}-\d{4,8}$` |
| `DEMO_MODE` | `TRUE` while evaluating, `FALSE` once real staff are in `TaskMaster` |
| `ALLOW_IDENTITY_FALLBACK` | `TRUE` for the demo, `FALSE` for production |

**Demo toggle:** **Allo Ops → Admin → Toggle demo mode** flips `DEMO_MODE` after showing the current state
and asking for confirmation, then writes a `DEMO_MODE_ON` / `DEMO_MODE_OFF` entry to `AuditLog`. The menu
label is intentionally generic, so it cannot show a stale state. If the `DEMO_MODE` row is missing, the
toggle repairs it instead of failing. Turning demo mode off does not reassign tasks; ensure real employees
are in `TaskMaster` first.

`TaskMaster`: one row per recurring task. `Frequency` is `DAILY`, `7`, `15` or `30`;
`RequiresTicket` TRUE for portal tasks, FALSE for daily WhatsApp updates; `AnchorDate` is the first due date.
Use **Manage tasks & settings** (admin) or **Assign a task** (manager) instead of typing in the tab — the
sheet is read-only. Saving a new active task creates its first cycle immediately. Add real holidays through
the Manage panel's **Holidays** tab.

If `TaskMaster` reports hundreds of blank rows from an older setup, run
**Allo Ops → Admin → Repair TaskMaster rows** once. It asks for confirmation, clears every cell below the
last row that has a `TaskID`, removes stale validation from those blank rows, and reapplies the checkbox and
dropdown rules only to real task rows. The alert reports the last row before and after, so `1000 -> 5` means
it worked. Run it again after adding a new task row to extend the validation.

## START HERE (the HR walkthrough)

`START HERE` is written by `writeStartHere_()` and is meant for the person running the process, not for a
developer. It walks through, in order: what the system does, the three rules to tell staff, how to open each
panel, the employee panel tab by tab, the manager panel tab by tab, how to assign a task, the admin panel,
the `Sheets` tab and `Open ↗`, what each review status means, the leave flow end to end, the five-minute
morning round, who sees what, the default SLA, the go-live checklist, symptoms and fixes, a glossary, and a
list of the tabs behind the panels.

Rewrite it with **Allo Ops → Admin → Rebuild START HERE**. That runs `writeStartHere_()` alone, so the
walkthrough can be refreshed without re-running `setup` and without re-seeding demo data. Editing the tab by
hand is pointless: it is protected, and a manual edit makes `onEdit` rebuild it.

## Review sidebar

> The menu lives in `Code.gs`. Adding `Review.gs` / `Review1.html` alone will **not** add the menu items.
> Replace `Code.gs` with the current version, save, then reload the sheet.

The main workspace is **Allo Ops → My tasks & leave** for employees and **My tasks & reviews** for managers
and admins. It switches sections by role:

- **Employee:** **Tasks** (only the cycles assigned to their own email), **Review status** (each cycle plus
  whether the manager has reviewed it and when), **Sheets** (own task, cycle and leave rows, read-only), and
  **Leave** to apply, check status or withdraw. No Review, Team leave or Admin tab.
- **Manager:** **Review** (team cycles, Acknowledge and Send reminder), **Sheets** (Manager dashboard, Review,
  Tasks, Cycles and Leave, read-only), **Leave** (own requests), **Team leave** (approve/reject the reporting
  line), and **Admin** (the task manager for their team, opened as a dialog). No Tasks tab: a manager's queue
  is Review.
- **Admin:** **Tasks**, **Review**, **Sheets** (company-wide), **Leave**, **Team leave**, and **Admin**
  (people, tasks, holidays, settings, setup and test tools).

**Sheets** is a list of the role's pages with a read-only table for the selected one. Employees see only their
own task, cycle and leave rows; managers see their reporting line; admins see everything. The tables are
capped at the latest 200 cycles and leave rows; the footer shows the totals and the generation time.

Each row has **Open ↗**, which activates the matching tab (unhiding it if needed) after checking the role.
The real tab is still read-only and can contain every employee's rows, so it is a jump-to-grid convenience
rather than the scoped view; the sidebar table remains the role-scoped one. **Hide tabs** (admin) puts every
data tab back behind `START HERE`. `Config`, `People`, `Holidays`, `AlertLedger`, `AuditLog` and `UsedTokens`
stay hidden and are reachable only through the side panels or the Review-a-tab browser.

**Allo Ops → Review a tab** (managers/admins) opens the read-only tab browser. A dropdown switches between
tabs without changing the sheet. Each view has a summary row, a search box, and a table of the latest rows
(150 for `Cycles` and `AuditLog`, 100 for `AlertLedger`, 50 for `UsedTokens`). `TaskMaster` is read from the
top so the active tasks always appear. `ManagerDashboard` renders its KPIs and task table; `START HERE`
renders as text.

Role scope in the review sidebar:

- **Employee:** no menu entry; their work is in the workspace, filtered to their own email.
- **Manager:** `START HERE`, `Holidays`, `Cycles`, `Pending`, `ManagerReview`, `ManagerDashboard`,
  `TaskMaster` — all task rows filtered to tasks where they are `OwnerManager`, or where the employee's
  Manager is them.
- **Admin:** every review tab, plus the Admin / Manage panels.

The grid is read-only for every role and a direct edit is still reverted. Google Sheets has no per-user tab
visibility and no row-level security: **Open ↗** can show a company-wide tab, any editor can unhide one from
the sheet menu, and a visible tab is readable by everyone with file access. The reliable boundary is the
sidebar, where every endpoint recomputes the caller's scope on the server.

## Test script (matches the brief)

Run **Allo Ops → My tasks & leave** (employee) or **My tasks & reviews** (manager/admin). Use **Tasks** for
completion, **Review status** (employee) to see acknowledgements, and **Sheets** to inspect a scoped table.

**Test 1 — recurring cycle.** Complete `Portal Task A` (7-day) with a ticket like `OPS-10234`.
`Cycles` gets `COMPLETED` plus a new `OPEN` row for cycle #2. The receipt shows the next due date.
Next due = `max(scheduled due, completed at) + 7 days`, so early completion cannot compress the cadence
and late completion cannot make the next cycle instantly overdue.

**Test 2 — single-point completion.** The card has one ticket field and one button. Submit once; only
`Cycles` changes. The sidebar never asks for a name — identity comes from the session.

**Test 3 — daily task.** `Daily Operations Update` has no ticket field. Post the WhatsApp update, type a
one-line summary (10+ characters), press Mark complete. The summary, identity and timestamp are stored.

**Test 4 — same-day manager alert.** Menu → **Test tools → Create task due in 2 minutes**. Wait for the
minute to pass, then **Run automation now**. The row flips to `MISSED` and the manager receives the email
the same day (`ManagerAlertAt` proves the timestamp).

**Test 5 — manager acknowledgement.** Click **Acknowledge** in that email. The page confirms; `ManagerAckAt`
and `ManagerAckBy` fill in and the dashboard's *Ack pending* drops. The link is single-use and expires in 72h.
The second path is **Acknowledge** on the Review tab of the manager's workspace — only a manager with that
task in scope can do it. The grid is read-only, so ticking `ManagerReview` is not an action path.

**Test 6 — leadership escalation.** Menu → **Test tools → Create overdue + escalation case**. It creates a
cycle 30 hours in the past and runs the tick: `MISSED` → `ESCALATED`, leadership emailed, manager Cc'd.
Acknowledging does **not** prevent this; only completion does.

**Test 7 — timing logic.** Walk through the `Config` values and the two rows below. The design rationale:
one manager email per cycle plus a 09:30 digest avoids alert fatigue; escalation is keyed to the manager's
next working window (daily) or 24h (longer cycles); quiet hours prevent 23:00 pings.

| Stage | Daily | 7 / 15 / 30-day |
|---|---|---|
| Due | 18:00 | 17:00 |
| Grace | 30 min | 60 min |
| Manager email | 18:30 same day | 18:00 same day |
| Employee reminder | 20:00 if still open | 19:00 if still open |
| Leadership escalation | next working day 11:00 | due + 24h |

**Duplicate proof.** `TicketID` is the evidence for one cycle: `completeCycle_` scans `Cycles` for the same
ticket (any task, any earlier cycle) and refuses the save. The refusal is audited with the ticket and the
cycle that already owns it, so "we tried it and it was blocked" is a row in `AuditLog`, not a claim.

**Test 8 — no duplicate work.** Menu → **Test tools → Run tick 3x and show counts**. Expect
`delta cycles 0`, `delta alerts 0`, `delta sent 0`. Cycle creation is keyed by `TaskID|due date` and guarded
by a script lock and the one-live-cycle invariant; emails are keyed in `AlertLedger` before sending.

Extra negative tests worth showing: a second account tries to complete someone else's task (blocked);
bad ticket format (inline error); a ticket ID that was already recorded on an earlier cycle is refused with
`Ticket OPS-10234 was already used for …` and the attempt is written to `AuditLog` as
`PROOF_DUPLICATE_BLOCKED`; double submit (blocked, "already completed"); expired/used ack link
(`Link not usable`); manual edit of any tab is reverted and logged as `SHEET_EDIT_BLOCKED`; a manager tries
to assign a task outside their team (rejected); an employee tries to open the admin panel (rejected).

## How the state machine works

```
OPEN --grace passes--> MISSED --escalation deadline--> ESCALATED
  \                        \                              /
   `-------- COMPLETED (records LateByMinutes) ---------'
```

- Only one live cycle (`OPEN` / `MISSED` / `ESCALATED`) per task. Completion closes it and immediately
  creates the next one, so nothing is ever missing or double-counted.
- `DueAt` = scheduled due + grace; that is the moment the manager alert fires.
- Completing from `MISSED` or `ESCALATED` is allowed and recorded as late, which keeps the audit honest.

## Security model, and its honest limits

- **Scopes:** `spreadsheets`, `script.container.ui`, `script.send_mail`, `script.scriptapp`,
  `userinfo.email`. No Drive, no Gmail read, no external fetch. The Sheets scope is the read/write file
  scope because a web app has no "active spreadsheet" context and must open the bound file by id to record
  an acknowledgement; `spreadsheets.currentonly` would fail there.
- **Role-based access:** `People` controls app roles. After setup, an email without an active `People` row
  gets no workspace and no review tabs. Employees can complete only their own assigned tasks and see only
  their own leave; managers can review, assign and decide leave only inside their reporting line; admins see
  everything.
- **Read-only sheets:** direct grid edits are blocked on every managed tab — hard protection on
  `TaskMaster` and `Config`, warnings plus the `onEdit` restore on the script-owned tabs. The trigger
  restores the previous value and appends `SHEET_EDIT_BLOCKED` to `AuditLog` for every role, admin included.
  All writes go through sidebar endpoints, so `Config`, `TaskMaster`, `Holidays`, `People` and
  `LeaveRequests` stay trustworthy even with Editor sharing. Admins and managers are editors of `TaskMaster`
  only because the sidebar writes with their authority; the grid edit is still reverted. A multi-cell paste
  cannot be restored cell-by-cell, so undo it with Ctrl+Z; generated report tabs rebuild themselves. Every
  state change is appended to `AuditLog` with actor, role, before/after and request id.
- **Signed links:** HMAC-SHA256 over `cycleId|action|expiry|nonce`, 72h TTL, single-use (recorded in
  `UsedTokens`), constant-time comparison. A forwarded email stops working after the first click.
- **Input handling:** length caps, control-character strip, ticket regex, `https`-only links, and a
  formula-injection guard on stored text. Email templates HTML-escape every sheet value.
- **Fail closed:** invalid `MANAGER_EMAIL` / `LEADERSHIP_EMAILS` pauses all alerting and writes
  `CONFIG_INVALID` to the audit log instead of spamming.
- **Demo switch:** `DEMO_MODE` and its admin toggle remain in `Config`, but the workspace no longer widens
  **Tasks** from it. That list is always the rows assigned to the signed-in email, so an admin with no
  assigned work sees an empty list rather than the company's. Set it to `FALSE` with real staff.
- **Limits to state plainly:** employees need **Editor** access for the bound script to write to the
  internal ledger on their behalf. A hard protection would also block their own completion, so script-owned
  tabs use warnings plus `SHEET_EDIT_BLOCKED` reversal rather than an unbreakable lock. Sheets has no
  row-level security and no per-user tab visibility: the data tabs start hidden, but Open ↗ or any editor can
  show them, and a visible tab is readable by everyone with file access. The role boundary is enforced by every
  sidebar endpoint and by the menu, not by hiding cells from an editor.
  A manager's scoped view is rebuilt server-side from their `People` reporting line and
  `TaskMaster.OwnerManager`. If you need a hard file-level boundary, give employees a separate spreadsheet
  or a web app deployed as owner. Acknowledging from email is intentionally token-based. Data is encrypted
  in transit and at rest by Google, but this is not end-to-end encryption against Google.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| "Missing tab … Run setup()" | Run `setup` once from the Apps Script editor. |
| Sidebar says account not identified | Open the sheet with the Google account listed in `TaskMaster.EmployeeEmail`. For evaluation an admin can add that account in **Admin panel**. |
| Account is on the access list but has no tasks | Add the person as `EMPLOYEE` in **Admin panel**, then assign tasks to that exact email from **Manage tasks & settings** or the manager's **Assign a task**. |
| Manager sees another team's rows | Set the employee's Manager in **Admin panel**, or set the task's OwnerManager in **Manage tasks**; the scope is the union of both. |
| Manager cannot assign to someone | The employee needs a `People` row with that manager set, or an existing task with that `OwnerManager`. |
| A sheet edit disappeared | Expected: tabs are read-only. Use the side panels; check `AuditLog` for `SHEET_EDIT_BLOCKED`. |
| Task shows Paused or `TRUE`/`FALSE` text instead of checkboxes | New tasks are created active and their row is formatted on save. For older rows run **Allo Ops → Admin → Repair TaskMaster rows**, or re-save the task from **Manage tasks**; the value is normalised and the checkbox rule is applied. |
| No email arrives | Check `AlertLedger` status; consumer Gmail is capped at 100 sends/day; check spam. |
| Two rows show the same task | Duplicate `TaskID` in `TaskMaster` from before uniqueness was enforced. Run **Admin → Remove duplicate task IDs**; it keeps the first row and cancels the repeated `OPEN` cycles. |
| "Task ID … is already used by …" | Expected. IDs are unique and a create never overwrites the existing task: edit that task, or pick another ID. The refusal is logged as `TASK_DUPLICATE_BLOCKED`. |
| Ack button missing from email | Deploy the web app, then **Admin → Set web app URL** (or paste it with **Set web app URL manually**), then send a new alert. |
| Google shows "unverified app" while authorising | Expected for a self-owned script: **Advanced → Go to (project)**. A Workspace admin may need to allow the deployment. |
| Neither manager nor leadership configured | `setup` fills all three with the owner; replace them in `Config`. |
| Triggers stopped | **Admin → Install triggers**; re-authorize if the account changed. |

## Before submitting

- Share the sheet with `hr.ops.allo@gmail.com` as **Editor**.
- Replace demo emails with the real team, or say clearly in the submission that they are demo rows.
- Record a 3–5 minute walkthrough: pending card → complete → manager email → acknowledge → escalation →
  triple-tick proof.
- Export `Code.gs`, `Engine.gs`, `Web.gs`, `Dev.gs`, `Review.gs`, `Admin.gs`, `Leave.gs`, `Workspace.gs`,
  `Manage.gs`, `Sidebar.html`, `Review1.html`, `Admin1.html`, `Manage1.html` alongside the sheet link.

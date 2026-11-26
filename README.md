# Allo Ops — Recurring Task Tracker

One Google Sheet plus Apps Script. Every recurring task has an owner, a frequency and a due time.
The side panel is where people work; the sheet is the record of what happened.

This repository holds the whole prototype:

| Path | What it is |
|---|---|
| `apps-script/` | The Apps Script project — paste these files into the script editor |
| `PLAN.md` | The implementation plan and the reasoning behind it |
| `apps-script/README.md` | Developer-level detail: setup, security model, test script |

If you only want to know **how to run the process**, read this page. If you are deploying or
changing the code, read `apps-script/README.md` afterwards.

---

## The idea in three sentences

A recurring task becomes a **cycle** when it falls due. The employee closes that cycle once, from
their panel, and the manager is told the same day. Anything still open after its grace period is
escalated, and nothing is ever edited directly in a spreadsheet cell.

---

## Who sees what

| Signed in as | Side panel tabs | Menu items |
|---|---|---|
| **Employee** | Tasks, Review status, Sheets, Leave | My tasks & leave |
| **Manager** | Review, Sheets, Leave, Team leave, Admin | My tasks & reviews, Review a tab, Assign a task |
| **Admin** | Tasks, Review, Sheets, Leave, Team leave, Admin | My tasks & reviews, Review a tab, Manage tasks & settings, Admin panel — people |

Managers do **not** get a Tasks tab — their queue is Review. Admins get everything.

Nobody types into a grid, whatever their role. A direct edit is reverted within seconds and
logged as `SHEET_EDIT_BLOCKED`.

---

## Opening a panel

1. Open the spreadsheet.
2. Use the **Allo Ops** menu at the top of the page.
3. Pick the item that matches the role. The menu only shows what that account is allowed to use.

If a panel looks empty or stale, reload the page before assuming something is broken.

---

## The employee panel

Opened from **Allo Ops → My tasks & leave**. Four tabs.

### 1. Tasks
Only the work assigned to the signed-in email — never anyone else's. Each card shows the task,
its frequency, the due date and time, and the grace period.

To finish a cycle:
- Type the ticket ID (for tasks that require one), or a short note when no ticket is needed.
- Press **Mark complete**.

That is the only place a cycle closes. A receipt shows the next due date.

### 2. Review status
The last 50 cycles and whether a manager has looked at them. This answers "was my work reviewed?"
without asking anyone. The four labels are explained further down.

### 3. Sheets
A short list of the pages that relate to that person — Tasks, Cycles, Leave — with a read-only
table for whichever one is selected. Only their own rows appear.

Each row has **Open ↗**, which jumps to the real spreadsheet tab. Use it to look something up;
use the panel for the person's own numbers.

### 4. Leave
Apply with a first day, last day, type and reason. The request shows its status here, and a
request that is still pending can be withdrawn.

---

## The manager panel

Opened from **Allo Ops → My tasks & reviews**. Five tabs.

### 1. Review
A chip switches between **Needs attention** (overdue, missed or escalated and not yet
acknowledged) and **All active**. Overdue cards sort to the top, and **Assign task** opens the
form for this manager's team. Each card has:
- **Acknowledge** — confirms the manager has seen the completed work and stops the reminder.
- **Send reminder** — nudges the employee immediately.

The number on the Review tab is how many cycles need attention right now.

### 2. Sheets
The team's pages: Dashboard, Review queue, Tasks, Cycles and Leave — each read-only, each with
**Open ↗**. "Team" means the people who report to them **plus** any task they own as manager.

### 3. Leave
The manager's own leave, exactly like an employee's.

### 4. Team leave
Approve or reject requests from the people below them in the reporting line. Nobody outside that
line appears here.

### 5. Admin
Titled **Team admin** for managers. It opens the task manager, scoped to their own team: create a
task, edit it, pause or resume it, set the owner manager. Holidays and settings stay with an admin.

---

## The admin panel

Admins see everything, plus two panels no one else gets.

### People & roles
Add a person by their Google account email, then set **EMPLOYEE**, **MANAGER** or **ADMIN**. A
manager also gets a reporting-line email — that line is what "their team" means everywhere else.

- Only an admin can grant `ADMIN`.
- The last active admin cannot be demoted or removed.
- Deactivating a person blocks their access without deleting their task history.
- Every change is written to `AuditLog`.

### Tasks & settings
Create or edit any task, add holidays, and change the SLA values — all saved through the panel,
never by typing in a tab.

### The Admin submenu
Setup and repair, install triggers, repair `TaskMaster` rows, rebuild `START HERE`, toggle demo
mode, set the web app URL, rebuild the dashboard. Test tools sit here too; they send real email.

---

## What the status labels mean

| Label | Meaning |
|---|---|
| **OPEN** | Live, not completed yet |
| **AWAITING** | Completed by the employee, not yet acknowledged by the manager |
| **LATE** | Still not done after the due time plus grace |
| **REVIEWED** | Acknowledged by the manager, with the time it happened |

If **AWAITING** keeps climbing, managers are not pressing Acknowledge. That is a review backlog,
not missed work — worth saying out loud in the stand-up.

---

## Leave, end to end

1. The employee applies in **Leave** with dates, a type and a reason.
2. The request appears under **Team leave** for the manager above them.
3. The manager approves or rejects it.
4. The employee sees the decision in their own **Leave** tab.

A pending request can be withdrawn by whoever raised it. An approved one is a record.

---

## HR's five-minute morning round

1. Open the panel, choose **Review**, look at **overdue** first.
2. For anything still open past its due time, check whether that person is on approved leave.
3. Ask managers to clear their **AWAITING** cards so the review trail stays honest.
4. Read **Sheets → Dashboard** for yesterday's on-time percentage before the stand-up.

---

## Does it cover what we asked for?

Yes, with two caveats that are properties of Google Sheets rather than gaps in the build.

| Asked for | Where it lives | Status |
|---|---|---|
| Employee sees their tasks | Tasks tab, filtered to the signed-in email | Covered |
| Employee sees review status (reviewed or not) | Review status tab, four labels | Covered |
| Employee sees only their own sheets, with a way to open them | Sheets tab, own rows, **Open ↗** per row | Covered |
| Employee can apply for leave | Leave tab, with withdraw | Covered |
| Manager review queue | Review tab, acknowledge and remind | Covered |
| Manager sees their own sheets and can jump to them | Sheets tab, team scope, **Open ↗** per row | Covered |
| Manager's own leave | Leave tab | Covered |
| Manager approves team leave | Team leave tab | Covered |
| Manager gets an Admin area | Admin tab (team admin) | Covered |
| Nobody edits the pages | Grid edits reverted, `SHEET_EDIT_BLOCKED` logged | Covered, see caveat 1 |
| Admin sees everything | All six tabs, company-wide sheets | Covered |
| Only admins can grant ADMIN | Admin panel, server-side check | Covered |
| Last active admin protected | Demote/remove refused | Covered |
| Manager scope = reporting line + owned tasks | Union of `People.ManagerEmail` and `TaskMaster.OwnerManager` | Covered |
| All edits happen through the side panels | Every write goes through a panel endpoint | Covered |
| Production settings | `DEMO_MODE=FALSE`, `ALLOW_IDENTITY_FALLBACK=FALSE` | Config values, set before go-live |
| No new OAuth scopes | `spreadsheets`, `script.container.ui`, `script.send_mail`, `script.scriptapp`, `userinfo.email` | Covered |

### Caveat 1 — "no editing" means "reverted", not "impossible"
Employees need Editor access for the script to write on their behalf, and an editor can always try.
A single-cell edit is restored on the spot. A multi-cell paste cannot be restored cell by cell, so
it needs one Ctrl+Z. Generated report tabs rebuild themselves on the next run.

### Caveat 2 — **Open ↗** shows the whole shared tab
One spreadsheet cannot show a different tab list per person. The panel table is scoped; the raw tab
behind **Open ↗** is not, so it can contain other employees' rows — read-only, but visible.
Use the panel for a person's own numbers, and **Hide tabs** (admin) to put every data tab back
before sharing the screen. A hard per-person boundary would need a separate spreadsheet per team
or a web app deployed as the owner.

---

## Go-live checklist

1. Deploy as a web app: **Execute as Me**, **Who has access Anyone**.
2. **Allo Ops → Admin → Set web app URL**, so alert emails carry signed links.
3. **Admin panel — people**: add the real team with their Google account emails, roles and managers.
4. **Manage tasks & settings**: add the real tasks and tick **Active** on each.
5. Run **Allo Ops → Admin → Rebuild START HERE** to refresh the in-sheet walkthrough.
6. Set `DEMO_MODE=FALSE` and `ALLOW_IDENTITY_FALLBACK=FALSE`.
7. Share the sheet with `hr.ops.allo@gmail.com` as **Editor**.

The `START HERE` tab carries the same walkthrough inside the spreadsheet, so the person running
the process does not need this repository.

---

## If something looks wrong

| Symptom | Fix |
|---|---|
| A task shows **PAUSED** | Open it and press **Resume**, or tick Active and save again |
| A due time shows as a date (`Sat Dec 30 1899`) | Run **Allo Ops → Admin → Repair TaskMaster rows** once |
| The data tabs have vanished | That is **Hide tabs**; **Open ↗** brings one back |
| A grid edit was refused | Expected — edit in the panel instead, nothing was lost |
| A person sees nothing | Their email in `People` differs from the Google account they signed in with |
| No email arrived | Check `AlertLedger` under **Review a tab**, then ask an admin |

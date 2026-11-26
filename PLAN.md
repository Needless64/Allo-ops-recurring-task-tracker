# Allo Innoware — Recurring Task Tracking, Pending Reports & Escalation
## Implementation Plan v1 (build-ready)

**Goal:** one Google Sheet + Apps Script prototype that proves the full chain:
task becomes due → employee acts once → completion recorded → pending detected → manager alerted same day → manager acknowledges → leadership escalated → no duplicates on re-run.

**Design stance**
- Google Sheets is the system of record; Apps Script is the only writer to state columns. Humans write through one UI or one checkbox — never by editing ledger rows.
- Every write is **idempotent** (deterministic keys), **identity-bound** (session email), and **audited** (append-only log).
- Emails are **evidence-linked**: each alert carries a signed, single-use action link, so "did the manager review it?" is machine-answerable, not a vibe.

---

## 1. Architecture at a glance

```
                 ┌──────────────────────────────────────────┐
 Employee        │  Sidebar "My Tasks" (HtmlService)        │
 (phone/desktop) │  overdue · due today · upcoming          │
                 │  [Ticket ID] [note] [Mark complete]      │
                 └───────────────┬──────────────────────────┘
                                 │ google.script.run (session identity)
┌────────────────────────────────▼─────────────────────────┐
│ Apps Script service layer                                 │
│  completeCycle() · acknowledgeCycle() · reconcileCycles() │
│  dispatchAlerts() · flushOutbox() · doGet() (signed link) │
│  LockService (all state writes) · AuditLog (append-only)  │
└───────┬───────────────────────┬───────────────────┬───────┘
        │                       │                   │
   ┌────▼─────┐          ┌──────▼──────┐     ┌──────▼───────┐
   │ Sheets   │          │ MailApp /   │     │ Config +     │
   │ Cycles,  │          │ GmailApp    │     │ Script       │
   │ Pending, │          │ (Outbox     │     │ Properties   │
   │ Manager  │          │  pattern)   │     │ (HMAC key)   │
   └──────────┘          └─────────────┘     └──────────────┘
```

Triggers:
| Trigger | Cadence | Function |
|---|---|---|
| Time-driven | every 15 min, 08:00–22:00 IST | `tick()` → reconcile → alerts → escalations → flush outbox |
| Time-driven | daily 09:30 IST | `morningDigest()` (manager + leadership digest, one email each) |
| Time-driven | weekly Mon 09:15 | `retentionSweep()` (report > 24 months, prune expired tokens) |
| Installable onOpen | menu | `onOpen()` — "My Tasks", "Run tick now", "Open manager review" |
| On edit (Manager Review tab only) | — | `onManagerReviewEdit()` → acknowledgement |
| Web app | GET | `doGet(e)` — signed ACK / CANCEL links |

---

## 2. Sheet structure (10 tabs; ledger, log and config tabs hidden/protected)

### 2.1 `Config` (protected; key/value)
| Key | Example | Purpose |
|---|---|---|
| `TIMEZONE` | `Asia/Kolkata` | single source for all date maths |
| `WORKDAYS` | `Mon,Tue,Wed,Thu,Fri` | valid due slots |
| `WORK_START` / `WORK_END` | `09:30` / `18:30` | working-hours bounds for reminders/escalation slots |
| `MANAGER_EMAIL` | `manager@allo…` | alert recipient |
| `LEADERSHIP_EMAILS` | `founder@…,coo@…` | escalation recipients |
| `ADMIN_EMAIL` | `ops-admin@…` | fail-closed notifications |
| `GRACE_MINUTES` | `30` | due → missed |
| `ESCALATION_HOURS` | `24` | missed → leadership (non-daily) |
| `DAILY_ESCALATION_TIME` | `11:00 next working day` | daily escalation slot |
| `NEXT_CYCLE_BASIS` | `HYBRID` | see §3.2 |
| `MAX_MANAGER_EMAILS_PER_CYCLE` | `1` | anti-spam guard |
| `TICKET_PATTERN` | `^[A-Z]{2,6}-\d{4,8}$` | per-task override allowed |
| `RETENTION_MONTHS` | `24` | archive window |

Secrets (HMAC key, web-app base URL) live in **Script Properties**, never in the sheet.

### 2.2 `TaskMaster` (protected)
| Col | Field | Notes |
|---|---|---|
| A | `TaskID` | PK, `T-DAILY-01`, `T-P7-01`… |
| B | `TaskName` | e.g. Daily Operations Update |
| C | `EmployeeName` | display |
| D | `EmployeeEmail` | identity key — must be the Google account |
| E | `Frequency` | `DAILY` \| `7` \| `15` \| `30` |
| F | `AnchorDate` | first due date (date only) |
| G | `DueTime` | `18:00` |
| H | `GraceMinutes` | 30 daily, 60 ticket tasks |
| I | `RequiresTicket` | TRUE/FALSE |
| J | `TicketPattern` | optional regex override |
| K | `ProofLabel` | "Ticket ID" / "WhatsApp update summary" |
| L | `EscalationRule` | `NEXT_WORKDAY` \| `HOURS` |
| M | `Active` | TRUE/FALSE (deactivate, never delete) |
| N | `OwnerManager` | escalation Cc |
| O | `Notes` | SOP text shown in the card |

### 2.3 `Cycles` — the ledger (protected; one row per cycle instance)
| Col | Field | Written by |
|---|---|---|
| A | `CycleID` | `T-DAILY-01-C0007` |
| B | `TaskID` | service |
| C | `CycleNo` | service (monotonic per task) |
| D | `ScheduledDue` | service (date + DueTime) |
| E | `DueAt` | `ScheduledDue + grace` |
| F | `Status` | `OPEN · COMPLETED · MISSED · ESCALATED · CANCELLED` |
| G | `CreatedAt` | service |
| H | `CompletedAt` | employee submit |
| I | `CompletedBy` | **session email**, not typed |
| J | `TicketID` | employee submit |
| K | `ProofNote` | employee submit (required for daily) |
| L | `ProofURL` | optional, https allowlist |
| M | `LateByMinutes` | computed at completion |
| N | `ManagerAlertAt` | service |
| O | `ManagerAckAt` | manager (checkbox or signed link) |
| P | `ManagerAckBy` | session identity / token label |
| Q | `EscalatedAt` | service |
| R | `EscalationAckAt` | leadership link |
| S | `IdempotencyKey` | `TaskID\|YYYY-MM-DD` — **unique** |
| T | `LastUpdated` | service |
| U | `SubmissionID` | client UUID, replay-guard |

**Invariant:** at most **one** `OPEN`/`MISSED`/`ESCALATED` row per `TaskID`. This is what makes Test 8 pass by construction.

### 2.4 `Pending` — pending-task view (materialised, 12 columns)
`CycleID · Task · Employee · ScheduledDue · Due (with grace) · Status · CycleNo · Proof required · Last ticket · Hours overdue · SOP note · Action`
Refreshed by `tick()`. This tab is the manager/leadership mirror of "who owes what now" and holds task-level data only. It is **warning-protected**, not hidden per person, because Sheets has no row-level security and a hard protection would also block an employee's own scripted completion. The employee's own pending report is the same data rendered in the sidebar and filtered server-side by session email. If the evaluator specifically wants a sheet-only employee experience, `makeEmployeeTabs()` generates one protected `Mine_<Employee>` tab per person from this view (optional; 3–4 employees, poor scaling, stated trade-off).

### 2.5 `ManagerReview` (manager edit access only)
`CycleID · Employee · Task · Due · Status · HoursOverdue · Reviewed ☐ · Comment · AckedAt`
Checkbox column G is the second acknowledgement path; `onManagerReviewEdit` validates the editor is `MANAGER_EMAIL` or `OwnerManager`, then writes `ManagerAckAt/By` + audit. Employees have no access to this tab.

### 2.6 `ManagerDashboard` (formula-only, read-only)
KPI strip: Open, Missed, Escalated, On-time %, Ack pending. Table: per employee open/overdue/escalated counts, oldest overdue age. Conditional formatting: overdue red, due-today amber, escalated dark red.

### 2.7 `AuditLog` (append-only, protected)
`Timestamp · Actor · Role · Action · Entity · EntityID · Before · After · RequestID · Source`
Every state change appends one row. No update/delete API is exposed anywhere in the script; protection + `onEdit` guard block manual tampering.

### 2.8 `AlertLedger` — dedupe + outbox (protected, hidden)
`AlertKey (unique) · CycleID · Type · Channel · Recipients · Status PENDING|SENT|FAILED|SUPPRESSED · Attempts · SentAt · MessageRef · Error`
`AlertKey` = `MGR_ALERT:<CycleID>` · `LEAD_ESC:<CycleID>` · `EMP_REM:<CycleID>` · `MGR_DIGEST:<YYYY-MM-DD>` · `LEAD_DIGEST:<YYYY-Www>`. A unique key is the entire anti-duplicate-email mechanism.

### 2.9 `Holidays` + `UsedTokens`
Holidays: `Date · Description`. UsedTokens: `Nonce · CycleID · Action · ExpiresAt · UsedAt · UsedByIP` (single-use signed links).

---

## 3. Recurring cycle logic

### 3.1 Lifecycle
```
            ┌──────────── completed before/after due ─────────────┐
            │                                                    ▼
   (created) OPEN ──grace passes, still open──▶ MISSED ──▶ COMPLETED (late, LateByMinutes>0)
                                              │
                                              └── escalation deadline, still open ──▶ ESCALATED ──▶ COMPLETED (very late)
```
Completion is always allowed from `MISSED`/`ESCALATED` — the record shows it was late.

### 3.2 Next due date — `HYBRID` basis (default, and the one to defend in the interview)
```
base = max( ScheduledDue , CompletedAt )        // never earlier than the calendar cadence,
                                                // never earlier than one full cycle after completion
DAILY : next = base + 1 working day  (skip weekends/holidays)
N-day : next = base + N days
next = atTime(next, task.DueTime) ; while (next <= now) next += cycle   // catch-up guard
```
Why not simply `CompletedAt + N`? It lets a task completed at 09:00 be due next cycle at 09:00, silently drifting earlier each cycle and squeezing the employee. Why not simply `ScheduledDue + N`? A 30-day task completed on day 45 would immediately be re-due. The `max()` keeps cadence stable and still honours "next cycle starts after this one is completed".

### 3.3 `reconcileCycles()`
```
lock(30s) else exit
tasks = active tasks ; cycles = index by TaskID (open cycle, last completed, seen keys)
for each task:
    if an OPEN/MISSED/ESCALATED cycle exists → skip          // invariant, no pile-up
    next = computeNextDue(task, last, now)
    key  = TaskID|YYYY-MM-DD(next)
    if key in seen → skip                                    // replay-safe
    append Cycle{status:OPEN, cycleNo:last+1, key}
refresh Pending view
```
Called by `tick()` every 15 minutes **and** immediately inside `completeCycle()`, so the next cycle is tracked the second the current one closes (Test 1 shows both).

---

## 4. Completion — single point of entry

`completeCycle(cycleId, {ticketId, note, proofUrl, submissionId})`:

1. `LockService` acquire, else return "busy, retry".
2. Resolve caller: `Session.getActiveUser().getEmail()`. Must equal `TaskMaster.EmployeeEmail`; manager override requires a reason and is logged as `MANAGER_OVERRIDE`.
3. Reject if `Status = COMPLETED` → "Already completed by <email> at <time>" (double-submit guard, Test 8).
4. Validate: ticket matches pattern when `RequiresTicket`; note ≥ 10 chars for daily; URL must be `https` and on the Drive/WhatsApp allowlist; strip control chars; cap 200 chars; prefix `'` if value starts with `= + - @` (formula-injection guard). Ticket **existence** cannot be checked without portal API access — the prototype validates format and relies on the manager spot-check in `ManagerReview`; if the portal exposes an API, add one verification call here and store `VerifiedAt`.
5. Write `COMPLETED, CompletedAt=now, CompletedBy=email, TicketID, ProofNote, LateByMinutes`.
6. Append audit (`requestId = submissionId`); suppress unsent alerts for this cycle (`SUPPRESSED`).
7. Create next cycle (§3.2), append audit.
8. Return receipt `{nextDue, cycleNo}` → UI shows "Done · next due 02 Dec 18:00".

The employee never opens a second tab and never types their name — identity comes from the session.

---

## 5. Daily task without a ticket ID — proposed method

**Recommended: one-tap completion + one-line proof, inside the same card.**
- Proof type = "WhatsApp update summary": employee posts the update in the group as usual, then pastes a 10–40 word summary (e.g. "EOD update posted: 6 orders dispatched, 1 delay flagged") and optionally a screenshot link.
- Why this and not heavier proof: screenshots/paste-the-message-link add friction that kills adoption; a timestamped, identity-bound, audited one-liner is enough for an ops manager to chase, and it stays inside the single-point rule.
- Optional stronger tier (mention as roadmap, not built): a `daily code` the employee quotes in the WhatsApp message (`#EOD-25NOV`) plus a Sheets→WhatsApp webhook; or a WhatsApp Business API bot that logs a ✅ reaction. Both add infrastructure and cost, and neither is needed to prove the flow.
- Anti-gaming: completion stores server time, session email, and the summary; the manager sees the summary in `ManagerReview`, and repeated identical summaries are flagged (nice-to-have).

---

## 6. SLA / escalation timing (Test 7)

Defaults (all IST, all configurable in `Config`):

| Stage | Daily task | 7 / 15 / 30-day task |
|---|---|---|
| Due | 18:00 same working day | 17:00 on cycle due date |
| Grace | 30 min | 60 min |
| **T1** — mark `MISSED`, manager email #1 (same day) | 18:30 | 18:00 |
| Employee reminder (in-app + email) | 20:00 (only if still open) | 19:00 |
| **T2** — escalation deadline | next working day 11:00 | T1 + 24 h |
| Leadership email (Cc manager) | at T2 | at T2 |
| Manager acknowledgement window | until T2 | until T2 |
| Repeat leadership nag | none per cycle; rolled into Monday digest | none per cycle |

Reasoning to state in the submission:
- **Same-day alert** is satisfied by construction: due times sit before 19:00, so T1 is always today.
- **One manager email per cycle** (`MAX_MANAGER_EMAILS_PER_CYCLE = 1`) plus a 09:30 consolidated digest. Alert fatigue is the main failure mode of these systems; per-task reminders get filtered within a week.
- **Ack ≠ fix.** Acknowledgement records review; escalation fires on *completion state* at T2. A manager who acks and then fixes the task stops escalation naturally. This closes the loophole "manager clicks Reviewed, nothing happens".
- **Escalation deadline** = end of the manager's working window (next morning) for daily work, 24 h for longer cycles, because a 30-day task missed today still has a full day of buffer before leadership needs to intervene.
- **Quiet hours** 22:00–08:00: `tick()` will not send; it queues, and the 08:00 run releases. Nothing pings a founder at 23:00.

---

## 7. Manager acknowledgement (Test 5) — two paths, one writer

1. **In-sheet:** checkbox in `ManagerReview` → `onManagerReviewEdit` verifies identity + role → writes `ManagerAckAt/By`, audit row.
2. **From email:** "Acknowledge" button links to the web app with a signed token. `doGet` verifies HMAC, expiry (72 h), action binding, single use → writes ack → returns a clean confirmation page.
   Token payload: `cycleId|ACK|exp|nonce`; signature `HMAC-SHA256` with a Script Property secret; comparison is constant-time; every failure logged and denied. Forwarded email stops working after first click or expiry.
3. The dashboard shows `Ack pending` for every missed cycle without an ack — so "did the manager review it?" is a column, not a conversation.

---

## 8. Employee UI (crisp, phone-first)

Apps Script `HtmlService` sidebar (400 px; full-width on mobile via `viewport` meta), served from `onOpen` and from the `Pending` Action column.

**Layout**
```
┌ MY TASKS ────────────────────── 4 pending ┐
│ [Overdue 2] [Due today 1] [Upcoming 1]     │  ← segmented control
├───────────────────────────────────────────┤
│ ● OVERDUE · 2h 10m                        │
│ Portal Task B            Cycle #12        │
│ Due 24 Nov 17:00 · every 15 days          │
│ Proof: Ticket ID                          │
│ ┌───────────────────────────────────────┐ │
│ │ e.g. OPS-10234                        │ │
│ └───────────────────────────────────────┘ │
│ [ note (optional) ]                       │
│ [   Mark complete   ]                     │
│ SOP: raise ticket under Ops › Billing     │
└───────────────────────────────────────────┘
```

**Design tokens** — 4 px base grid, spacing 4/8/12/16/24; system font stack; radius 10 px; single accent `#1F6FEB`; status: overdue `#B42318` on `#FEF3F2`, due-today `#B54708` on `#FFFAEB`, done `#067647` on `#ECFDF3`; text `#101828` / muted `#475467`; contrast ≥ 4.5:1; tap targets 44 px; focus ring 2 px offset; `aria-live="polite"` toast; inline error text under the field; disabled submit while in flight with a spinner and a 5 s timeout message.

**States:** loading skeleton → empty ("Nothing pending — next task due 02 Dec") → in-flight → success (green receipt + next due date, card slides to Done) → error (retry, message preserved). No page reloads, no modal chains.

**Manager**: `ManagerDashboard` uses the same palette for KPI chips and conditional formatting; `ManagerReview` is a plain grid with one checkbox — deliberately boring.

---

## 9. End-to-end security model

"End-to-end secured" here means every hop is authenticated, authorised, validated and audited — with no third-party data egress. (Honest scope note for the submission: Sheets data is encrypted in transit and at rest by Google, but this is not end-to-end encryption against Google itself.)

| Layer | Control |
|---|---|
| **Identity** | `Session.getActiveUser().getEmail()` for employee + manager; typed names never trusted. Fallback path logs `IDENTITY_FALLBACK` and requires manager confirmation. |
| **Authorisation** | `Config`, `TaskMaster`, `Holidays`, `UsedTokens` owner-only. Script-owned tabs (`Cycles`, `AlertLedger`, `AuditLog`, `Pending`, `Review`) are warning-protected and every manual edit is logged as `MANUAL_EDIT` — a hard lock would also block an employee's own bound-script completion. `ManagerReview` is editable only by the manager. |
| **Scopes** | `spreadsheets` (full file scope: the web app has no active-spreadsheet context and must open the bound file by id), `script.send_mail`, `script.scriptapp`, `script.container.ui`, `userinfo.email`. No Drive, no Gmail-read, no external fetch — no broad consent screen beyond the file itself. |
| **Web app** | HMAC-SHA256 signed, action-bound, 72 h TTL, single-use nonce, constant-time compare, deny-by-default, failure logged with IP. Deployed "execute as me / anyone with link" is acceptable **only** because the token is the credential; no endpoint accepts an unsigned action. |
| **Input** | Length caps, control-char strip, regex ticket format, `https`-only proof URLs, formula-injection prefix guard (`= + - @`). |
| **Output** | All names/notes HTML-escaped before entering email templates; no `eval`, no dynamic HTML from sheet cells. |
| **Secrets** | HMAC key + web-app URL in Script Properties; never in a cell, never in the repo, never in email. |
| **Email** | Work email only; no ticket contents or customer data in the body; subject includes CycleID for traceability. |
| **Audit** | Append-only `AuditLog` with actor, role, before/after, requestId; manual edits blocked; monthly export for review. |
| **Retention** | Weekly sweep reports cycles older than 24 months for manual archive (audit trail is never deleted automatically) and prunes expired `UsedTokens`. |
| **Fail-closed** | Config validation on every tick; invalid config or 3 consecutive send failures → stop alerts, email `ADMIN_EMAIL`. Never spam on a broken config. |
| **Abuse/quota** | Gmail quota guard: cap sends per run, batch digests, backoff on `FAILED`; `LockService` prevents concurrent double-processing. |

---

## 10. Idempotency and "no duplicate alerts" (Test 8)

| Risk | Guard |
|---|---|
| Two ticks create two cycles | unique `IdempotencyKey = TaskID\|date` + one-active-cycle invariant + 30 s script lock |
| Same task completed twice (double click / two devices) | `Status=COMPLETED` check + client `SubmissionID` + audit replay lookup |
| Duplicate manager email | `AlertKey=MGR_ALERT:<CycleID>` unique; outbox row written before send |
| Duplicate escalation | `AlertKey=LEAD_ESC:<CycleID>` unique; digest rollup afterwards |
| Stale alert after completion | `flushOutbox` re-checks cycle status and marks `SUPPRESSED` |
| Duplicate ack | first write wins, second is a no-op audit note |
| Trigger re-entry | `tryLock` → skipped run is a no-op, next run catches up (reconcile is idempotent) |

Demo for Test 8: run `tick()` **three times** back-to-back, then run `reconcileCycles()` manually — screenshot identical row counts in `Cycles` and `AlertLedger`, and the mail thread showing exactly one manager email.

---

## 11. Test plan mapped to the brief

| # | Brief | How to demonstrate | Evidence to capture |
|---|---|---|---|
| 1 | Recurring cycle | Complete `T-P7-01` (7-day) from the sidebar → cycle closes, `Cycles` gets `COMPLETED` + new `OPEN` row with next due = max(due, completion)+7 | before/after `Cycles` screenshots + receipt showing next due |
| 2 | Single-point completion | Show Pending card → enter `OPS-10234` → submit → `Cycles` updated once; no second sheet touched | screen recording, one edited row |
| 3 | Daily task | Daily card requires summary, no ticket → completes with note; TicketID field hidden by `RequiresTicket` | sidebar with daily card + completed row |
| 4 | Same-day manager alert | Create `T-DAILY-TEST` due 2 min in the future, grace 0, don't complete → run `tick()` → manager email same day | email timestamp + `ManagerAlertAt` |
| 5 | Manager ack | Click signed ACK link in that email → `ManagerAckAt/By` populated; dashboard `Ack pending` drops; also show checkbox path | confirmation page + row + KPI |
| 6 | Leadership escalation | Set `DAILY_ESCALATION_TIME` to +5 min on a test task, no ack, no completion → run `tick()` → leadership email Cc manager | email + `Status=ESCALATED`, `EscalatedAt` |
| 7 | Timing logic | Walk the §6 table; show `Config` values and a timeline table of T1/T2; explain ack≠fix and one-email rule | doc slide + Config screenshot |
| 8 | No duplicates | Triple-run `tick()`; show counts unchanged, single email, no new rows | row counts before/after + mail search |

Extra negative tests worth showing (cheap, high signal): wrong employee tries to complete (blocked), bad ticket format (inline error), double-submit (blocked), expired ack token (denied), manual edit of `Cycles` (protected), config broken (fail-closed admin email).

---

## 12. Build order (≈ 2 working days)

| Phase | Work | Gate |
|---|---|---|
| P0 (1 h) | Create sheet, `START HERE` tab, all tabs/headers/named ranges, protections, `Config` values, Script Properties secret | protections verified with a second account |
| P1 (3 h) | `TaskMaster` seed (4 required + 3 extra: 2 daily, 1 late-completion case), `readTaskMaster`, `computeNextDue`, `reconcileCycles`, seed run | cycles seeded, no duplicates after 2 runs |
| P2 (3 h) | `completeCycle`, `Pending` materialiser, sidebar HTML/CSS/JS, `onOpen` menu | Test 1 + 2 + 3 pass by hand |
| P3 (3 h) | `tick`, missed detection, `AlertLedger`, `flushOutbox`, manager email template | Test 4 passes, same-day |
| P4 (2 h) | Signed tokens, `doGet`, ack from email + checkbox path, dashboard KPIs | Test 5 passes |
| P5 (2 h) | Escalation deadlines, leadership email, digests, quiet hours, fail-closed | Tests 6 + 7 pass |
| P6 (2 h) | Idempotency sweep, negative tests, retention stub, README, demo recording | Test 8 passes, all screenshots in `TestLog` |
| P7 (1 h) | Share Editor access to `hr.ops.allo@gmail.com`, submission email | link + script file + README + recording |

---

## 13. Risks and pre-emptive fixes

| Risk | Fix baked into the plan |
|---|---|
| Employees on personal Gmail ≠ employee email | `TaskMaster.EmployeeEmail` must be the Google account; `IDENTITY_FALLBACK` path + manager approval |
| 30-day task completed 5 days late → immediate re-due | `HYBRID` basis `max(due, completed)` |
| Instant re-overdue if a cycle is completed after the next slot | catch-up guard `while(next <= now) next += cycle` |
| Gmail 100/day quota (consumer) | one email per cycle + digests; cap + backoff; Workspace account recommended |
| Multiple triggers / manual runs | `LockService` + unique keys |
| Timezone drift | all maths through one `TIMEZONE` util; timestamps stored with explicit TZ |
| Sheet edited by hand to "fix" status | warning-protection + `MANUAL_EDIT` audit rows + service-only UI |
| Evaluator tests with a made-up employee account | provide a `Demo` task row pre-bound to their address, plus an "Impersonate for demo" menu item that is audit-logged and disabled by default |
| Over-engineering | 4 core tabs + 3 support tabs, no sidebar framework, no external API, no paid service |

---

## 14. Submission checklist (from §7 of the brief)

- [ ] Google Sheet shared **Editor** with `hr.ops.allo@gmail.com`
- [ ] `Code.gs` + `Sidebar.html` exported into the submission folder
- [ ] `START HERE` tab + one-page README: tabs, how to complete a task, SLA table, how to run each test
- [ ] `TestLog` tab: test #, steps, expected, actual, timestamp, screenshot link
- [ ] 3–5 min screen recording: pending → complete → manager email → ack → escalation → triple-run proof
- [ ] Daily-task method explained in one paragraph (WhatsApp summary + one tap)
- [ ] Contact details in the submission email

---

## 15. One-paragraph narrative for the interview

> The sheet is a ledger of cycle instances, not a task list, so "pending" is a query, not a person's memory. Employees touch exactly one control — a card in the sidebar — and their identity, timestamp and proof are written server-side, so there is no duplicate updating and no trust in typed names. A 15-minute idempotent tick closes cycles, opens the next one with a cadence-safe due date, and sends at most one manager email per cycle; acknowledgement is a signed single-use link, and escalation fires on completion state rather than on whether someone clicked. Re-running the automation any number of times changes nothing — which is the property that makes it safe to hand to an ops team.

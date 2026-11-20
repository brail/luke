---
name: ux-audit
description: >
  UX/UI audit of Luke on a disposable instance seeded with generated demo
  data: usability, visual quality and task efficiency, accessibility (WCAG
  2.2 AA) and perceived performance, per role and at desktop, tablet and phone
  widths. Run by luke-lead: the main session captures the evidence in a
  browser signed in with demo accounts; three read-only specialists assess it; an
  independent reviewer gates the report; design-author turns it into a
  refactoring plan, gated the same way. Writes only under .planning/ux-audit/.
  Never changes code. Optional argument: pages or flows to focus on.
argument-hint: '[pages or flows, e.g. "collection layout, calendar"]'
disable-model-invocation: true
---

# Luke UX audit

**Invocation arguments:** $ARGUMENTS

The arguments name the pages or flows to focus on. Without them, audit the default scope below.

## Ground rules

- **Who runs it.** luke-lead, when the owner asks for a run. Never started by the model on its own.
- **Target: a disposable instance with generated data** (owner, 2026-11-20). A production build
  (the CI images, or the UX program's study instance) on its own database, seeded with the demo
  generator's `realistic` profile (#280) and reset with it before every run, so runs are comparable.
  Never the RC (a production clone kept for migration and release validation), never production,
  never the owner's development database, and never a local `pnpm dev` (dev-mode bundles make every
  performance figure meaningless). The owner starts the instance (guided steps); if it is not
  running or not freshly seeded, stop and ask. Because the instance is disposable, saving, approving
  or deleting during a run is harmless: tasks run to completion.
- **Nothing to install.** Use the `chrome-devtools` MCP server already configured (`navigate_page`,
  `emulate`, `resize_page`, `take_screenshot`, `take_snapshot`, `lighthouse_audit`,
  `performance_start_trace`/`performance_stop_trace`, `performance_analyze_insight`,
  `list_network_requests`, `press_key`, `click`). Lighthouse's accessibility audits run axe-core
  rules. If a tool is missing, stop and tell the owner; never `npm`/`npx`/`pnpm add` anything.
- **Nothing leaves the machine.** The data is invented, but traces and statistics still go out by
  default. Before Phase 1, confirm the chrome-devtools server the session uses runs with `--no-performance-crux` (otherwise a trace sends the traced URLs to Google's CrUX
  API) and `--no-usage-statistics` (or `CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS` set), from a
  pinned package version. The plugin's own `.mcp.json` lives in the plugin cache, is overwritten by
  plugin updates and starts `chrome-devtools-mcp@latest`, so it does not count: the owner adds a
  durable user- or project-scope `mcpServers` entry with a pinned version and both flags, and
  disables the plugin's server for the run (both would load and expose the same tools). Call only
  the pinned server's tools, and check which server the tools come from before Phase 1. If the entry
  is missing, stop and give the owner the entry to add; changing it is the owner's action.
- **Sign-in.** Only the demo accounts the generator creates (one per role); their credentials come
  from the generator's output and exist only on the disposable instance. Never a real account.
- **Evidence stays in the planning folder.** Everything goes under `.planning/ux-audit/<YYYY-MM-DD>/`
  (gitignored): screenshots, snapshots, Lighthouse reports, traces, insights, network lists,
  reports. Issues carry findings in words.
- **Files and concurrent sessions.** This skill writes only under `.planning/ux-audit/`, and follows
  `.claude/skills/luke-shared/audit-protocol.md` §7 and §7.2: append every file it writes to the
  session ledger, and leave alone a file another live session wrote. Specialists and reviewers are
  read-only roles (`.claude/agents/`); they return text, and the main session writes their files.
- **Luke's own rules are the yardstick, not generic taste.** A recommendation that breaks `CLAUDE.md`
  ("Frontend — apps/web": shadcn/ui only, Tailwind utilities, CSS-variable colours, `cn()`,
  permission-aware controls, `ConfirmDialog`, one tooltip per control, Italian UI strings kept
  extractable for i18n) is wrong, unless it is explicitly framed as a proposal to change that rule,
  for the owner to decide.

## Default scope

Pages under `apps/web/src/app/`, plus the app shell:

1. App shell: sidebar, header with the brand and season selectors, user menu. It switches to its
   mobile layout below 768 px (`max-width: 767px`, `apps/web/src/hooks/useMobile.tsx`).
2. Login, password reset and email verification (signed out).
3. Dashboard (home widgets).
4. Collection layout: the table, filters, the row editor, an existing revision and the dialog that creates one.
5. Calendar: month view and the event dialog.
6. Merchandising plan and its spec sheet dialog (`SpecsheetModal`).
7. Pricing calculator.
8. Product control.
9. Sales statistics.
10. Settings › Users (list, pending approval, section access) and one configuration
    form (mail or LDAP).
11. One `admin/*` list page (for example brands: table, soft-deleted rows, dialog).
12. Maintenance › audit log (a dense read-only table).
13. Notifications and profile.

Widths: **1440 px** (desktop), **820 px** (tablet portrait, desktop shell), **390 px**
(phone, mobile shell; required, owner 2026-11-19), plus one **320 px** pass on three pages for
reflow (WCAG 1.4.10). A tablet narrower than 768 px (for example 744) gets the mobile shell, which
the 390 px pass covers.

`emulate` replaces every emulation setting on each call. So: set viewport and any CPU throttling in
**one** `emulate` call (for example `viewport: '390x844x3,mobile,touch'`, `cpuThrottlingRate: 4`);
**clear** emulation (an `emulate` call with no viewport and no throttling) before going back to
desktop with `resize_page`, and before any trace or Lighthouse run that must not be throttled.
Record each width and throttling setting in `index.md`.

Out of scope: dark mode. The `.dark` tokens exist in `globals.css` but the app offers no way to turn
them on (#114, shelved).

## Tasks

Five named tasks, the baseline for task efficiency, each walked to completion as the role that
does it (the instance is disposable): add a collection layout row (editor); move a calendar deadline,
once in the edit dialog and once by drag-and-drop (editor); price an item in the pricing calculator
(any role); approve a pending user (admin); find who changed a given setting in the audit log
(admin). Log each as steps, screens, clicks and dead ends.

## Phase 1 — Capture (main session)

Create `.planning/ux-audit/<date>/` with `screenshots/`, `snapshots/`, `lighthouse/`, `traces/`,
`insights/`, `network/`, `keyboard/`, `tasks/` and an `index.md` that lists every file with page, role, viewport and URL path, plus the
network the run used (office LAN or VPN) and any CPU throttling.

- **`admin`, full matrix.** Every page in scope at 1440, 820 and 390: a viewport screenshot, and a
  full-page one for pages that scroll (long tables become illegible when downscaled, so keep both).
  File name `<role>-<page>-<width>[-full].png`. Accessibility-tree snapshot at 1440 and 390.
  `lighthouse_audit` with `device: desktop` and `device: mobile`, with `outputDirPath` set to the
  run's `lighthouse/` folder.
- **Reflow, `admin`, 320 px.** Login, the collection layout table and one configuration form:
  viewport and full-page screenshots, named `admin-<page>-320[-full].png`.
- **`editor` and `viewer`, differences only.** Pages where the role sees something different
  (disabled controls and their tooltips, hidden sections, read-only screens), at 1440 and 390:
  screenshots, plus the `viewer` keyboard walk below; no Lighthouse.
- **Performance, `admin`.** Per page, a trace with reload (default `autoStop`). On the collection
  table, the calendar and the merchandising plan, a second trace after `navigate_page`, with
  `reload: false` and `autoStop: false`, around one named interaction (apply a filter, open the
  row editor and edit a cell), so INP-related insights exist. One phone-profile trace with
  the phone viewport and `cpuThrottlingRate: 4` in one `emulate` call, cleared afterwards. Save the
  trace summary (LCP, CLS and the insight list) from whichever call returns it —
  `performance_start_trace` when it stops by itself, `performance_stop_trace` otherwise — to `traces/`, one
  file per page and trace, so every page has metrics; save each `performance_analyze_insight` text
  you expand to `insights/`; no raw trace files. Save `list_network_requests` per page to `network/`
  (for bundle and request weight).
- **Keyboard.** Three keyboard-only walks with `press_key`: the collection layout as `editor` (move
  through the table, open the row editor, edit and save a row); pending user approval as `admin`, to
  the end; and one permission-gated page as `viewer`, to reach
  the disabled controls' reasons (`PermissionButton`/`PermissionTooltip`) without a pointer. Check
  focus order, visible focus, traps and focus hidden under sticky headers. One log per walk in
  `keyboard/`.
- **Tasks.** The five tasks above, one log per task in `tasks/` (steps, screens, clicks, dead ends).

## Phase 2 — Assessment (specialists, in parallel)

Launch three subagents at once, each with `run_in_background: true`, giving each the run folder,
the focus and this file's "Ground rules":
- `ux-designer` → usability, visual quality, task efficiency, design-token inventory.
- `accessibility-auditor` → WCAG 2.2 AA.
- `performance-auditor` → perceived performance.

Write each returned report to `usability.md`, `accessibility.md`, `performance.md` in the run
folder. Spot-check three claims per report against the evidence before using it.

## Phase 3 — Synthesis

Merge the three into `report.md`: summary (3–5 lines), strengths, prioritized problems (area,
severity 1–4, page, role, viewport, evidence file or `path:line`, fix), task-efficiency results,
objective metrics, quick wins against structural work. Remove duplicates and reconcile severities.

## Phase 4 — Report gate

Run `plan-reviewer` on `report.md` (its default model reviews the main session's work). Ask it to
check, besides its usual contract:
- every statement rests on a screenshot, snapshot, metric or `path:line`;
- usability, visual quality, accessibility, performance, phone width and every role are covered;
- no critical page or flow is missing;
- severities are justified and consistent;
- no recommendation contradicts `CLAUDE.md` frontend rules unless framed as a rule change.

CHANGES REQUIRED → apply the findings, then `verifier` checks them. A failed verification follows
`CLAUDE.md`, "Escalation"; a report that did not pass is never used.

## Phase 5 — Refactoring plan

Run `design-author` with `report.md` and these requirements: trace every intervention to a report
problem; group by technical cause (design tokens, component consolidation, accessibility, layout and
responsive, debt); foundations first; impact, effort, regression risk and dependencies per
intervention; verifiable completion criteria (the same captures and audits re-run, visual
comparison); respect `CLAUDE.md` frontend rules. Write the result to `refactor-plan.md`.

## Phase 6 — Plan gate

The plan changes user-visible behaviour and has several viable designs, so it is a Codex case
(`CLAUDE.md`, "Collaboration with Codex"). Follow that section as written: the budget probe and its
recorded lines, what to do on each probe answer, the substitute reviewer (`plan-reviewer` with
`model: opus`, since the plan's author runs on Fable) and how Codex is run. CHANGES REQUIRED → apply,
then `verifier`, as in Phase 4.

## Closing

Tell the owner, in Italian: the main problems, the task-efficiency baseline, the plan's phases and
quick wins, the gate outcomes, and the run folder. Implementation is a separate decision. Issues, if
any, are opened by luke-lead with generic text and no screenshots.

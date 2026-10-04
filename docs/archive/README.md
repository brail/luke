# Documentation Archive

The documents in this directory are frozen historical records, kept for
reference and not current guidance. Their contents are preserved; a body written
in Italian was translated into English under ADR-030, with the original in git
history. Records retired from the tree are listed at the end.

| Document | Historical scope |
|----------|------------------|
| [Collection Genome planning](collection-genome-planning.md) | Feasibility analysis that mapped the Collection Genome model onto the calendar and collection domains, written before the work and since implemented. |
| [TARIC classifier proposal](luke-taric-classifier.md) | Proposed customs classification module (CN/TARIC code and duty lookup for NAV products), never implemented; preserved as a project proposal whose future is undecided. |

## Retired records

Retired from the tree under ADR-030; git history keeps each one at the commit
named here.

| Record | Last path | Read with |
|--------|-----------|-----------|
| Initial setup snapshot and roadmap — initial monorepo setup and planned work, with later corrections | `docs/archive/SETUP_STATUS.md` | `git show b6e7e7a4:docs/archive/SETUP_STATUS.md` |
| What-If Engine and domain integration task — original implementation plan for a deterministic seasonal-planning solver and its domain integration | `docs/archive/TASK_v2_what_if_engine.md` | `git show bb02e680:docs/archive/TASK_v2_what_if_engine.md` |
| What-If Calendar Solver archive — design, data model, API, UI and source snapshot kept when the solver was removed in July 2026 | `docs/archive/what-if-calendar-solver.md` | `git show bb02e680:docs/archive/what-if-calendar-solver.md` |

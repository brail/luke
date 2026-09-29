// ruleid: luke-no-untracked-planning-citation
// An all-day value is stored at UTC midnight (X25 §6.3).
export const a = 1;

// ruleid: luke-no-untracked-planning-citation
// Contract merged from the review round (P8 §2).
export const b = 2;

// ok: luke-no-untracked-planning-citation
// Recorded in docs/LUKE_MONOREPO_AUDIT_2026-08-30.md, Appendix X §X.10.
export const c = 3;

// ok: luke-no-untracked-planning-citation
// Stored at UTC midnight: a calendar date read in any other form is another day somewhere.
export const d = 4;

# Security mode — advisory-driven response

Companion to `.claude/skills/luke-deps/SKILL.md`, read in full by `security` mode
before it acts. Moved out of the skill to keep it under the 500-line budget.

`/luke-deps security`. Advisory-driven only — the smallest change that clears
the finding.

1. `pnpm security:deps` (osv-scanner).
2. For each finding: is it a direct dependency or transitive? `pnpm why <pkg>`.
3. Direct → bump it. Transitive → `pnpm update -r <pkg>` when its consumers'
   ranges already admit the fix and the lockfile diff touches only that
   package; otherwise an `overrides` range in `pnpm-workspace.yaml` with the
   GHSA or CVE id and reason in a comment (`SKILL.md` §6 rules apply). No
   fixed version and `pnpm why -r <pkg> --prod` empty → a time-limited entry
   in `osv-scanner.toml`, as its header requires. No fixed version and code
   that runs in production → the owner decides; never an ignore.
4. Check the finding is not being _caused_ by an existing override.
5. Re-run `pnpm security:deps` to confirm it is gone — the exit code, not a
   reading of the diff. Exit 0 can come from a filter: read the
   `Filtered … from output` line.
6. Verify at the level the matrix demands. A security bump is still a bump:
   `603662a` was a hotfix, and it still needed proof.

Note the branch rule: `.github/dependabot.yml` targets the default branch only,
and a graduated `develop-X.Y` is dead — never backport an advisory fix onto one
(`lessons.md`, "Branch management"). A fix on the train does not reach the
`latest` images: when the advisory reaches production, ask the owner whether
`main` gets a hotfix too (precedent `603662a`), and record the answer.

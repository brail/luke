# Review report — the shape of `/luke-deps` review output

Companion to `.claude/skills/luke-deps/SKILL.md` §5. Fill every section; write
`none` rather than dropping one.

```
## Luke Dependency Review
Scope: <workspace filter or 'monorepo'>
Date: <today>
pnpm <version> · Node <version> · minimumReleaseAge: <value or unset>

### Summary
| Bucket | Count | Proposed cycles |
|---|---|---|
| A within-major | N | 1 |
| B major        | N | N |
| C toolchain    | N | 1 |
| D advisory     | N | ... |
| E deprecated   | N | ... |
| F held         | N | 0 |

### Plan
Cycle 1 — <bucket>: <packages, current -> target>
  Risk: <matrix hits, or 'none in table'>
  Verify: L0-L<n> + <targeted proof>
  Commit: <conventional commit subject>
Cycle 2 — ...

### Held
| Package | Current -> Latest | Why held | Unblocks when |
|---|---|---|---|

### Advisories
| ID | Package | Fixed in | Reachable? | Override needed |
|---|---|---|---|---|

### Version alignment
<the alignment result of `pnpm check:drift` (`SKILL.md` §6), or 'aligned'>

### Promotion to rule
<protocol §3 — mandatory>
```

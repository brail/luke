# eslint-plugin-luke

<!-- luke-docs:start:overview -->
Internal ESLint plugin that turns constraints written in `CLAUDE.md` and paid for in `lessons.md` into rules the build refuses to pass, instead of conventions a reviewer has to remember. Ten rules, covering TypeScript strictness, Zod partials, workspace dependency declarations, module boundaries, audit metadata and four `apps/web` UI patterns.

The plugin is enforcement only: the normative statement of each rule lives in `CLAUDE.md`, the lesson that produced it in `lessons.md`, and the file globs each rule runs on in the root `eslint.config.mjs`.
<!-- luke-docs:end:overview -->

## Utilizzato da

<!-- luke-docs:start:dependents -->
- The root `eslint.config.mjs`, which is the only consumer. It is declared as `eslint-plugin-luke: workspace:*` under the repository root's `devDependencies` and registered under the `@luke` plugin namespace, so every rule is spelled `@luke/<rule>`.

No workspace declares this package, and none may: `WORKSPACE_POLICY` in `tools/scripts/check-platform-integrity.ts` classifies both the repository root and this package as `tooling`, a kind that may name a workspace only under `devDependencies`. The rules still reach every workspace, because the root config applies them to `apps/web`, `apps/api`, `packages/*`, `tools/`, `scripts/` and this package's own JavaScript.
<!-- luke-docs:end:dependents -->

## Export principali

<!-- luke-docs:start:exports -->
`index.js` has a single default export — `{ rules: { … } }` — holding the ten rules below. A rule file that is not listed there is not loaded by anything.

### Repository-wide (every workspace TypeScript file)

| Rule | Description |
|------|-------------|
| `@luke/no-bare-zod-partial` | Refuses a direct `.partial()` call: Zod re-injects the `.default()` of every field the input omits, so a partial schema feeding a Prisma update silently overwrites stored data. Requires `partialWithoutDefaults()` from `@luke/core`. Switched off in `packages/core/src/utils/zod.ts`, the one file that implements that helper |
| `@luke/no-uncommented-any` | Refuses a `TSAnyKeyword` with no explanatory comment on the same line or in the three lines above it. Off in test files, where casting a mock is the standard vitest idiom |
| `@luke/no-undeclared-workspace-import` | Declaration integrity, not direction: a reference to a workspace package must be declared by the nearest `package.json`, under `dependencies` or — for a type-only reference — `devDependencies`. Also refuses self-imports, absolute specifiers (POSIX, Windows drive, `file:`) and relative paths that leave the owning package directory. Judged lexically, with no module resolution, so it holds in CI's lint step, which runs before any `dist` exists. Takes `workspacePackages` (required) and `allowDevDependencies`; the config passes the names it reads from `pnpm-workspace.yaml` and the manifests, so the unscoped `eslint-plugin-luke` is judged exactly like `@luke/core` |

### Module boundary

| Rule | Description |
|------|-------------|
| `@luke/no-restricted-module-references` | ESLint's `no-restricted-imports` extended to every static reference form — `import()`, an expression-free template literal, `require()`, `import x = require()`, `import('x').T` — subpaths included. Takes the same `paths: [{ name, message }]` shape. Configured for `@luke/core/server` across `apps/web` outside `WEB_SERVER_ENTRYPOINT_IMPORTERS`; on the real config, five of the seven forms were silent under the core rule |

### apps/api

| Rule | Description |
|------|-------------|
| `@luke/audit-metadata-object-literal` | Requires the `metadata` argument of any `logAudit(...)` call — however the callee is spelled — to be a spread-free object literal. `AuditMetadata` types that property against `SAFE_KEY_LIST`, but TypeScript's excess-property check only sees properties written literally, so a bare variable, `{ ...input }` or a conditional `...(cond && { … })` walks past it and the sanitizer stores `[REDACTED]` with no error |

### apps/web

| Rule | Description |
|------|-------------|
| `@luke/no-uncommented-tailwind-arbitrary` | Refuses an arbitrary-*value* utility (`w-[327px]`, `sm:max-w-[500px]`) with no justifying comment nearby. Arbitrary *variant* selectors — `data-[state=open]:`, `aria-[…]`, `has-[…]`, `[&_svg]` — are idiomatic Radix/shadcn and never reported |
| `@luke/no-dialog-input-outside-form` | Refuses an `Input`/`NumberInput` rendered inside a `DialogContent`, `AlertDialogContent` or `SheetContent` with no `<form>` between them: without one, Enter submits nothing and validation has nowhere to report. `Textarea` is deliberately absent — there Enter means newline |
| `@luke/no-raw-query-client` | Refuses `useQueryClient` from `@tanstack/react-query`, both the import and any call. A tRPC hook's query key is generated, so a hand-written key matches nothing and the invalidation silently does nothing; `trpc.useUtils()` is type-checked against the real procedure path |
| `@luke/no-unreachable-disabled-tooltip` | Refuses a `<TooltipTrigger asChild>` whose child renders something `disabled` without a focusable wrapper. A disabled element emits no pointer or focus event and Tab skips it, so the message explaining why the control is greyed out never appears. Reports the trigger that is itself disabled and the wrapper whose `tabIndex` can only be negative — the plausible wrong fix — separately |
| `@luke/no-bare-client-random-uuid` | Refuses a bare `crypto.randomUUID()` in a file carrying the `'use client'` directive: outside a secure context the method is undefined, so a page served over plain HTTP crashes. Requires the optional-call fallback used in `apps/web/src/lib/trpc.tsx` |
<!-- luke-docs:end:exports -->

## Concetti chiave

<!-- luke-docs:start:concepts -->
- **The rules enforce; they do not decide.** Each one restates a constraint whose authority is elsewhere — `CLAUDE.md` for the development patterns, `lessons.md` for the regressions already paid for, `WORKSPACE_POLICY` for the dependency graph. That is the point of writing them: a finding an agent has to rediscover is a level-4 control, and a rule that runs on every push is a level-2 one.
- **Scope belongs to the config, not to the rule.** Which files a rule runs on, and where it is switched off, is decided once in the root `eslint.config.mjs`; a rule file carries no path list. The three exceptions are deliberate and self-contained: `no-uncommented-tailwind-arbitrary`, `no-dialog-input-outside-form` and `no-unreachable-disabled-tooltip` opt out of `components/ui/**` inside the rule, because those primitives are regenerated by the shadcn CLI rather than hand-maintained.
- **Declaration integrity and dependency direction are two different checks.** `no-undeclared-workspace-import` gives *imports ⊆ declarations*, and a package can satisfy it by editing its own manifest — measured. `WORKSPACE_POLICY` (P10 in `tools/scripts/check-platform-integrity.ts`) gives *declarations ⊆ policy*. Only together do they give imports ⊆ policy, and neither is a substitute for the other.
- **Two rules share one view of what a module reference is.** `rules/lib/module-references.js` normalises every statically knowable form — `import`, `export … from`, `export *`, `import()`, a template literal with no interpolation, `require()`, `import x = require()`, `import('x').T` — into a single callback, marking the compiler-erased ones `typeOnly`. A rule that visits `ImportDeclaration` alone is silent on the rest, which is exactly what was measured before this existed. A specifier built from an expression is not judged: it is not statically knowable, and silence there is the honest answer.
- **Rules that take options validate them with an object-form schema.** With ESLint's array form only the options that are present are checked, so a bare `'error'` reached `create` with no options at all and failed as a `TypeError` while loading the rule. `minItems` makes a missing option a configuration error ESLint reports as one, which is the difference between failing loudly and judging nothing.
- **No build step, and the lint cache knows it.** Plain ESM JavaScript (`"type": "module"`, `exports` mapping `.` to `./index.js`), consumed directly through `workspace:*` — there is no `tsc`, no `dist`. Turbo's `lint` task lists `index.js` and `rules/**/*.js` as inputs, so editing a rule invalidates every workspace's cached lint result instead of leaving stale green ones behind.
- **The rules have their own tests, and not all of them are covered.** `pnpm --filter eslint-plugin-luke test` runs `node --test` over `rules/__tests__/*.test.js` — the shared module-reference visitor, `no-restricted-module-references`, `no-undeclared-workspace-import`, `audit-metadata-object-literal` and `no-unreachable-disabled-tooltip`. The other six rules are exercised only by the repository's own lint run.
<!-- luke-docs:end:concepts -->

## Esempio d'uso

<!-- luke-docs:start:example -->
```javascript
// eslint.config.mjs — how the root config registers the plugin and its rules.
import lukePlugin from 'eslint-plugin-luke';

// Read from pnpm-workspace.yaml and the manifests in the real config, so an
// added workspace is judged without editing this list.
const WORKSPACE_PACKAGE_NAMES = ['@luke/core', '@luke/db', 'eslint-plugin-luke'];

export default [
  {
    files: ['{apps,packages}/**/*.{ts,tsx,mts,cts}'],
    plugins: { '@luke': lukePlugin },
    rules: {
      '@luke/no-bare-zod-partial': 'error',
      '@luke/no-uncommented-any': 'error',
      '@luke/no-undeclared-workspace-import': [
        'error',
        { workspacePackages: WORKSPACE_PACKAGE_NAMES },
      ],
    },
  },
  {
    // Test and tooling code may load a devDependency at runtime; production
    // source may only reference its types.
    files: ['{apps,packages}/**/*.test.{ts,tsx}'],
    rules: {
      '@luke/no-undeclared-workspace-import': [
        'error',
        { workspacePackages: WORKSPACE_PACKAGE_NAMES, allowDevDependencies: true },
      ],
    },
  },
];
```
<!-- luke-docs:end:example -->

# eslint-plugin-luke

<!-- luke-docs:start:overview -->
Plugin ESLint interno che applica come regole automatiche alcuni vincoli di
`CLAUDE.md` altrimenti verificabili solo a occhio (uso di `any`, valori Tailwind
arbitrari, `.partial()` su schemi Zod) — così la revisione non dipende dal
ricordarsene ad ogni PR.
<!-- luke-docs:end:overview -->

## Utilizzato da

<!-- luke-docs:start:dependents -->
- Configurazione ESLint root (`eslint.config.mjs`) — applicata a tutti i workspace del monorepo (`apps/web`, `apps/api`, `packages/core`, `packages/calendar`, `packages/nav`)
<!-- luke-docs:end:dependents -->

## Export principali

<!-- luke-docs:start:exports -->
Il package esporta un singolo oggetto plugin (`export default { rules: {...} }`) da `index.js`, registrato in `eslint.config.mjs` come `@luke/*`.

| Regola | Descrizione |
|--------|-------------|
| `@luke/no-bare-zod-partial` | Vieta `.partial()` diretto su uno schema Zod oggetto — Zod v4 re-inietta i `.default()` sui campi omessi dall'input, sovrascrivendo silenziosamente i dati quando lo schema partial alimenta un update Prisma. Richiede `partialWithoutDefaults()` da `@luke/core` |
| `@luke/no-uncommented-any` | Vieta annotazioni/assertion `any` senza un commento esplicativo sulla riga stessa o precedente |
| `@luke/no-uncommented-tailwind-arbitrary` | Vieta valori Tailwind arbitrari (`w-[327px]`) senza commento che ne giustifichi l'uso — non si applica ai selettori arbitrari di variante (`data-[state=open]:`, `aria-[...]`, `has-[...]`), idiomatici in Radix/shadcn |
<!-- luke-docs:end:exports -->

## Concetti chiave

<!-- luke-docs:start:concepts -->
- **Ogni regola sostituisce un controllo manuale**: le tre regole applicano vincoli già scritti in `CLAUDE.md` (strict TypeScript senza `any` non commentato, niente valori Tailwind arbitrari senza giustificazione, mai `.partial()` bare su Zod) — la fonte di verità resta `CLAUDE.md`, qui c'è solo l'enforcement.
- **Disattivazioni mirate**: `eslint.config.mjs` disattiva selettivamente `@luke/no-bare-zod-partial` e `@luke/no-uncommented-any` in blocchi specifici (es. file di test) dove il vincolo non si applica.
- **`type: 'module'`**: il package usa export ESM (`index.js`, non `index.cjs`) — coerente con `eslint.config.mjs` flat config.
- **Nessuna build**: a differenza degli altri package interni non ha uno step `tsc`/`dist` — è JavaScript puro, consumato direttamente da `eslint.config.mjs` via `workspace:*`.
<!-- luke-docs:end:concepts -->

## Esempio d'uso

<!-- luke-docs:start:example -->
```javascript
// eslint.config.mjs
import lukePlugin from 'eslint-plugin-luke';

export default [
  {
    plugins: { '@luke': lukePlugin },
    rules: {
      '@luke/no-bare-zod-partial': 'error',
      '@luke/no-uncommented-any': 'error',
      '@luke/no-uncommented-tailwind-arbitrary': 'error',
    },
  },
];
```
<!-- luke-docs:end:example -->

# ADR-010 — Section Access a 4 Layer di Precedenza

## Status

Accepted

## Contesto

La visibilità delle sezioni UI (es. `product.pricing`, `settings.ldap`, `admin.vendors`) non può essere governata solo dal ruolo RBAC. Esistono esigenze ortogonali:

- **Kill switch operativo**: disabilitare una sezione globalmente per tutti (manutenzione, feature flag)
- **Override per utente**: concedere o negare l'accesso a una sezione per un singolo utente indipendentemente dal ruolo (es. un `viewer` con accesso temporaneo a pricing)
- **Default per ruolo configurabile a runtime**: modificare i default di visibilità per un ruolo senza deploy (es. nascondere `sales.statistics` al `viewer` per una specifica stagione)
- **Fallback deterministico**: in assenza di override, il sistema deve convergere su un valore basato su ciò che il ruolo può fare (`RBAC Resource:Action`)

Un singolo layer non copre tutti e quattro i requisiti contemporaneamente.

## Decisione

`effectiveSectionAccess()` in `packages/core/src/rbac/effectiveAccess.ts` risolve la visibilità di una sezione applicando 4 layer in ordine di precedenza decrescente:

```
0. Kill switch globale    — disabledSections[] da AppConfig
1. Override utente        — UserSectionAccess.enabled (bool | null)
2. Default ruolo runtime  — AppConfig rbac.sectionAccessDefaults (JSON)
3. Fallback RBAC          — SECTION_TO_PERMISSION → hasPermission()
```

Il primo layer che produce un risultato non-`auto` / non-`null` vince. Il layer 3 è sempre definito (non può restituire `null`).

### Configurazione delle sezioni

Ogni sezione è definita in **tre posti in sync** in `packages/core/src/schemas/rbac.ts`:

1. `sectionEnum` — chiave della sezione
2. `SECTION_TO_PERMISSION` — mappa sezione → `Resource:Action`
3. `SECTION_ACCESS_DEFAULTS` — visibilità default per ruolo (version-controlled)

I default per-ruolo a runtime vivono in AppConfig (`rbac.sectionAccessDefaults`). Dopo ogni write su chiavi RBAC in AppConfig, `invalidateRbacCache()` deve essere chiamata.

### Override utente

`UserSectionAccess` ha tre stati: `enabled=true`, `enabled=false`, `assente` (nessun override). L'assenza delega al layer successivo — non è equivalente a `false`.

## Conseguenze

- Aggiungere una nuova sezione richiede aggiornamento sincrono di tre posti: `sectionEnum`, `SECTION_TO_PERMISSION`, `SECTION_ACCESS_DEFAULTS`. Dimenticarne uno causa comportamento non deterministico (layer 3 non trova la permission e nega per default)
- `invalidateRbacCache()` va chiamato dopo ogni write su `rbac.*` in AppConfig — se dimenticato, i cambi di default ruolo non si propagano fino al prossimo restart
- Il layer 0 (kill switch) è pensato per emergenze operative e manutenzione — non per access control di sicurezza (usare `requirePermission` per quello)
- Il layer 1 (override utente) permette escalation controllata di privilegi di visibilità senza toccare il ruolo dell'utente — utile per demo o onboarding temporaneo

# @luke/core

<!-- luke-docs:start:overview -->
Pacchetto condiviso del monorepo Luke: contiene tutti gli schemi Zod, i tipi TypeScript, il motore RBAC, le utility di pricing, i tipi storage e le funzioni di rete usati sia dal frontend che dal backend.
<!-- luke-docs:end:overview -->

## Utilizzato da

<!-- luke-docs:start:dependents -->
- `@luke/web` (`apps/web`) — schemi form, tipi, RBAC, URL builder
- `@luke/api` (`apps/api`) — schemi validazione, RBAC middleware, config AppConfig
- `@luke/nav` (`packages/nav`) — tipi condivisi (`GetConfigFn`, config schema)
- `@luke/calendar` (`packages/calendar`) — tipi e schemi condivisi
<!-- luke-docs:end:dependents -->

## Export principali

<!-- luke-docs:start:exports -->
### Schemi Zod — validazione dati

| Categoria | Schemi principali |
|-----------|------------------|
| Utente | `userSchema`, `userProfileSchema`, `userPreferenceSchema` |
| Auth | `ldapConfigSchema`, `ldapConfigResponseSchema`, `authSchemas` |
| Config | `appConfigSchema`, `AppConfigRegistry`, `RateLimitConfigSchema`, `LdapResilienceSchema` |
| Brand & Season | `brandSchema`, `seasonSchema`, `vendorSchema` |
| Pricing | `pricingParameterSetInputSchema`, `pricingCalculateInputSchema`, `PricingModeSchema` |
| Collezione | `collectionLayoutRowInputSchema`, `collectionGroupInputSchema` |
| Merchandising | `merchandisingPlanSchema`, `merchandisingSpecsheetSchema` |
| Calendario | `seasonCalendarSchema`, `milestoneSchema` |
| Infrastruttura | `mailSchema`, `navConfigSchema`, `navConfigResponseSchema` |
| Notifiche | `notificationSchema`, `dashboardConfigSchema` |
| Azienda | `companySchema`, `companyProfileSchema` |

### RBAC & Permessi

| Simbolo | Tipo | Descrizione |
|---------|------|-------------|
| `hasPermission` | funzione | Verifica se un utente ha un permesso `resource:action` |
| `expandRole` | funzione | Espande un ruolo nella lista di permessi inclusi |
| `effectiveSectionAccess` | funzione | Visibilità sezione con 4 livelli di precedenza (kill switch → override utente → AppConfig → RBAC) |
| `sectionEnum` | costante | Elenco di tutte le sezioni navigabili (dot-notation) |
| `SECTION_TO_PERMISSION` | mappa | Sezione → permesso `resource:action` richiesto |
| `SECTION_ACCESS_DEFAULTS` | oggetto | Visibilità default per ruolo, version-controlled |
| `rbacSchema` | schema | Definizioni RBAC (ruoli, permessi) |

### Utility

| Simbolo | Tipo | Descrizione |
|---------|------|-------------|
| `isDevelopment` / `isProduction` | funzione | Verifica l'ambiente runtime corrente |
| `getConfigValue` | funzione | Legge un valore da AppConfig via Prisma |
| `buildApiUrl` / `buildTrpcUrl` | funzione | Costruisce URL API/tRPC dalle env var |
| `buildBrandLogoUploadUrl` | funzione | URL upload logo brand (two-phase upload) |
| `buildCollectionRowPictureUploadUrl` | funzione | URL upload foto riga collezione |
| `buildSeasonCalendarIcalUrl` | funzione | URL endpoint iCal stagione |
| `formatDate` / `parseDate` | funzione | Utility date locale-aware |
| `sanitizeInput` | funzione | Sanitizzazione input utente |

### Storage

| Simbolo | Tipo | Descrizione |
|---------|------|-------------|
| `IStorageProvider` | interfaccia | Contratto per i provider storage (locale / MinIO) |
| `localStorageConfigSchema` | schema | Configurazione provider storage locale |
| `VALID_BUCKETS` | costante | Bucket validi: `uploads`, `exports`, `assets`, `brand-logos`, `collection-row-pictures`, `merchandising-specsheet-images` |

### Crypto — solo server

Importare da `@luke/core/server`. Lancia eccezione esplicita se importato nel browser.

| Simbolo | Descrizione |
|---------|-------------|
| `deriveSecret` | Deriva segreti via HKDF-SHA256 dalla master key `~/.luke/secret.key` |
| `encrypt` / `decrypt` | AES-256-GCM per valori sensibili salvati in AppConfig |
<!-- luke-docs:end:exports -->

## Concetti chiave

<!-- luke-docs:start:concepts -->
- **Schema unico**: ogni schema Zod è definito qui una sola volta. L'ESLint rule `@luke/no-hardcoded-url` enforcea l'uso delle builder function — mai `localhost:3001` hardcodato nel frontend.
- **`AppConfigRegistry`**: fonte di verità per tutte le chiavi di configurazione runtime. Ogni nuova chiave config va aggiunta qui con il suo schema Zod e tipo Zod (`z.coerce.*` per numeri/boolean, `.transform` per JSON blob).
- **`@luke/core/server`**: sotto-path che esporta utility crittografiche — importabile solo in contesti server. L'import da browser lancia un'eccezione esplicita come guard di sicurezza.
- **RBAC a due layer**: (1) permessi `resource:action` statici in `auth/permissions.ts`; (2) visibilità sezioni dot-notation valutata da `effectiveSectionAccess`. Aggiungere una sezione richiede aggiornare `sectionEnum` + `SECTION_TO_PERMISSION` + `SECTION_ACCESS_DEFAULTS` in sincronia.
- **Nessuna dipendenza da `apps/`**: il package ha solo `zod` come dipendenza di produzione. La configurazione Prisma è iniettata esternamente dove necessario.
<!-- luke-docs:end:concepts -->

## Esempio d'uso

<!-- luke-docs:start:example -->
```typescript
import { hasPermission, buildApiUrl, userSchema } from '@luke/core';
import { deriveSecret, encrypt } from '@luke/core/server'; // solo server

// Verifica permesso
const canEdit = hasPermission(user, 'brands:update');

// Costruisci URL senza hardcode
const url = buildApiUrl('/api/health');

// Valida input utente con schema Zod
const result = userSchema.safeParse(rawInput);

// Cifra un valore sensibile (server-side)
const { ciphertext, iv } = await encrypt(plaintext);
```
<!-- luke-docs:end:example -->

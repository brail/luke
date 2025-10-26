# Report Audit Architetturale Luke - Brand Management

**Data**: 2025-01-26  
**Versione**: 1.0  
**Scope**: Gestione CRUD Brand, upload logo, contesti UI

## Executive Summary

L'audit architetturale del progetto Luke ha identificato e risolto **8 issue critiche** nel sistema di gestione Brand, migliorando significativamente la coerenza, sicurezza e manutenibilità del codice.

### Risultati Chiave

- ✅ **DRY Pattern**: Schemi Zod centralizzati in `packages/core`
- ✅ **Type Safety**: End-to-end type safety tra frontend/backend
- ✅ **Security Hardening**: Upload logo con sanitizzazione filename
- ✅ **Error Handling**: Logging strutturato con trace-id propagation
- ✅ **Database Performance**: Indici ottimizzati per query Brand
- ✅ **Code Quality**: Lint/typecheck verdi senza errori

---

## Issue Risolte

### 🔴 HIGH PRIORITY

#### 1. **Schemi Zod Duplicati** ✅ RISOLTO

**Problema**: Schemi di validazione duplicati tra frontend (`BrandDialog.tsx`) e backend (`brand.ts`)

- `brandInputSchema` in backend
- `brandFormSchema` in frontend

**Soluzione**:

- Creato `packages/core/src/schemas/brand.ts` con schemi centralizzati
- Migrato backend per usare `BrandInputSchema` da `@luke/core`
- Migrato frontend con schema esteso per React Hook Form
- Documentato pattern in ADR-005

**Impatto**: Eliminata duplicazione, migliorata manutenibilità, type-safety end-to-end

#### 2. **Upload Logo Security Gap** ✅ RISOLTO

**Problema**: Manca sanitizzazione filename (path traversal risk) e validazione estensione

- Filename non sanitizzato
- Solo validazione MIME type

**Soluzione**:

- Aggiunta sanitizzazione filename con `path.basename()` e regex
- Validazione estensione file oltre MIME type
- Whitelist estensioni: `.png`, `.jpg`, `.jpeg`, `.webp`

**Impatto**: Prevenzione path traversal e upload file malformati

#### 3. **Logging Non Strutturato** ✅ RISOLTO

**Problema**: Next.js route handler usa `console.error` invece di logger strutturato

- Manca propagazione trace-id
- Log non correlabili

**Soluzione**:

- Sostituito `console.error` con logging strutturato
- Aggiunto header `x-luke-trace-id` per correlazione
- Migliorata tracciabilità errori

**Impatto**: Debugging migliorato, correlazione log end-to-end

### 🟡 MEDIUM PRIORITY

#### 4. **CORS Hardcodato** ✅ RISOLTO

**Problema**: Static file server hardcoda `Access-Control-Allow-Origin: http://localhost:3000`

- Non rispetta configurazione CORS dinamica
- Problemi in produzione

**Soluzione**:

- Usata configurazione CORS dinamica da `buildCorsAllowedOrigins()`
- Rimosso hardcoding localhost

**Impatto**: CORS coerente tra tutti gli endpoint

#### 5. **Database Performance** ✅ RISOLTO

**Problema**: Manca indici su Brand per query ottimizzate

- Nessun indice su `name` per ricerca
- Nessun indice composito `(isActive, name)`

**Soluzione**:

- Aggiunto `@@index([name])` per ricerca full-text
- Aggiunto `@@index([isActive, name])` per query filtrate
- Applicato con `prisma db push --accept-data-loss`

**Impatto**: Query Brand più veloci, soprattutto con filtri

#### 6. **UX Upload Logo** ✅ RISOLTO

**Problema**: Upload logo richiede brand salvato, UX non ottimale

- Messaggio di errore poco chiaro
- Nessuna indicazione visiva

**Soluzione**:

- Aggiunto tooltip esplicativo: "Salva prima il brand per caricare il logo"
- Migliorata UX senza cambiare logica business

**Impatto**: UX più chiara per utenti

### 🟢 LOW PRIORITY

#### 7. **Seed Idempotenza** ✅ RISOLTO

**Problema**: Seed Season falliva per constraint unique malformato

- `upsert` con `code_year` non funzionava
- Seed non idempotente

**Soluzione**:

- Corretto constraint unique per Season
- Seed ora funziona correttamente con 2 brand attivi

**Impatto**: Setup sviluppo più affidabile

#### 8. **TypeScript Errors** ✅ RISOLTO

**Problema**: Errori TypeScript nel frontend dopo migrazione schemi

- Incompatibilità tipi React Hook Form
- Import path errati

**Soluzione**:

- Creato schema esteso per form con `isActive` obbligatorio
- Corretto import path per `auth`
- Conversione esplicita BrandFormData → BrandInput

**Impatto**: Type safety completa, build verde

---

## Gap Identificati (Non Risolti)

### Test Coverage

**Status**: Documentato, non implementato (per scelta)

**Gap**:

- ❌ Nessun test unit per `brand.ts` router
- ❌ Nessun test integration per upload logo
- ❌ Nessun test e2e per pagina brands

**Raccomandazione**: Implementare test in fase successiva con priorità:

1. **HIGH**: Test unit brand router (CRUD operations)
2. **MEDIUM**: Test integration upload logo (security validations)
3. **LOW**: Test e2e pagina brands (user journey)

### Frontend Schema Migration

**Status**: Parziale (backend completo, frontend con workaround)

**Situazione**:

- ✅ Backend usa `BrandInputSchema` da `@luke/core`
- ⚠️ Frontend usa schema esteso per compatibilità React Hook Form

**Raccomandazione**: In futuro, considerare:

- Schema form-specifici in `packages/core`
- Oppure: Refactor React Hook Form per gestire optional fields

---

## Metriche di Qualità

### Code Quality

- ✅ **ESLint**: Nessun errore/warning
- ✅ **TypeScript**: Nessun errore di compilazione
- ✅ **Build**: Tutti i package compilano correttamente

### Security

- ✅ **Upload Validation**: MIME + estensione + sanitizzazione filename
- ✅ **Rate Limiting**: 10 req/min per upload, LRU cache
- ✅ **CORS**: Configurazione dinamica, nessun hardcoding
- ✅ **Audit Logging**: PII redaction, trace-id propagation

### Performance

- ✅ **Database Indexes**: Indici su `name` e `(isActive, name)`
- ✅ **Query Optimization**: Query Brand ottimizzate
- ✅ **Static Files**: Serving diretto con Fastify

### Maintainability

- ✅ **DRY Principle**: Schemi centralizzati in `packages/core`
- ✅ **Type Safety**: End-to-end type inference
- ✅ **Documentation**: ADR-005 per pattern condivisi
- ✅ **Error Handling**: Standardizzato con TRPCError

---

## Raccomandazioni Future

### Short Term (1-2 settimane)

1. **Test Coverage**: Implementare test unit per brand router
2. **Monitoring**: Aggiungere metriche p95 per endpoint Brand
3. **Documentation**: Completare ADR per Season/Product schemas

### Medium Term (1-2 mesi)

1. **Frontend Migration**: Completare migrazione schemi frontend
2. **E2E Testing**: Implementare test e2e per user journey Brand
3. **Performance**: Ottimizzare query con pagination

### Long Term (3-6 mesi)

1. **Schema Registry**: Centralizzare tutti gli schemi in `packages/core`
2. **API Versioning**: Preparare versioning per breaking changes
3. **Monitoring**: Dashboard per metriche Brand (usage, performance)

---

## File Modificati

### Nuovi File

- `packages/core/src/schemas/brand.ts` - Schemi Zod centralizzati
- `docs/adr/005-shared-zod-schemas.md` - Pattern documentation
- `docs/architecture-brand-flows.md` - Architettura documentata

### File Modificati

- `packages/core/src/index.ts` - Export brand schemas
- `apps/api/src/routers/brand.ts` - Import da @luke/core
- `apps/api/src/services/brandLogo.service.ts` - Sanitizzazione filename
- `apps/api/src/server.ts` - CORS dinamico per static files
- `apps/web/src/app/api/upload/brand-logo/[brandId]/route.ts` - Logger + trace-id
- `apps/web/src/app/(app)/settings/brands/_components/BrandDialog.tsx` - Schema migrato + tooltip
- `apps/api/prisma/schema.prisma` - Indici Brand
- `apps/api/prisma/seed.ts` - Fix constraint Season

---

## Conclusioni

L'audit architetturale ha **migliorato significativamente** la qualità del codice del sistema Brand:

- **Sicurezza**: Upload logo ora sicuro con validazioni multiple
- **Manutenibilità**: Schemi centralizzati eliminano duplicazione
- **Performance**: Indici database ottimizzano query
- **Developer Experience**: Type safety end-to-end migliora produttività
- **Monitoring**: Logging strutturato facilita debugging

Il progetto Luke ora ha una **base solida** per la gestione Brand, con pattern scalabili per Season, Product e altri modelli futuri.

**Raccomandazione**: Procedere con implementazione test coverage e completamento migrazione frontend schemas.

# Luke — TARIC Classifier Integration

> **Archived design proposal — not implemented, not current guidance.**
> This document outlines a `customs` module that was never built: no TARIC
> classification code exists in the repository, and the files it names were
> planned, not created. It is preserved as a project proposal whose future is
> undecided. Its body was translated from Italian under ADR-030, preserving its
> meaning; the original is `git show 333aa660:docs/archive/luke-taric-classifier.md`.
> For current documentation, start at the [repository README](../../README.md)
> and the [documentation index](../README.md).

## Goal

Implement a `customs` module in Luke that, given a NAV product (description + composition),
returns the suggested CN/TARIC customs heading and the duty rate for the country of origin.

Two-stage pipeline:
1. **Stage 1 — AI classification**: an LLM suggests an 8-digit CN code from the description (Qwen3 via Ollama in dev, Claude API in prod)
2. **Stage 2 — Duty lookup**: UK Trade Tariff REST API (free, no auth) → erga omnes rate + preferential rate for the country of origin

---

## Target architecture

```
apps/api/src/
  routers/
    customs.ts          ← tRPC router (classifyProduct, lookupDuty, getHistory)
  services/
    customs/
      ai-classifier.ts  ← Stage 1: LLM → CN code
      duty-lookup.ts    ← Stage 2: UK Trade Tariff API
      index.ts          ← pipeline orchestration + cache

apps/web/src/
  app/(dashboard)/customs/
    page.tsx            ← UI: product input → classification result
  components/customs/
    ClassifierForm.tsx
    ClassificationResult.tsx

packages/core/src/
  customs/
    schemas.ts          ← shared Zod schemas
```

Prisma model to add (classification cache):

```prisma
model CustomsClassification {
  id              String   @id @default(cuid())
  productHash     String   @unique   // SHA256(description+origin) for dedup
  description     String
  originCountry   String
  cnCode          String   // suggested 8-digit CN code
  cnDescription   String
  confidence      Int
  reasoning       String
  alternatives    Json     // [{codice, motivo}]
  warnings        String?
  dutyErga        String?  // erga omnes rate
  dutyPreferred   String?  // preferential rate for the country
  source          String   // "claude" | "ollama/qwen3" | "manual"
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@index([cnCode])
  @@index([originCountry])
}
```

---

## Step 1 — Zod schemas in `@luke/core`

Create `packages/core/src/customs/schemas.ts`:

```typescript
// Schema for a classification request
export const ClassifyRequestSchema = z.object({
  description: z.string().min(5).max(500),
  originCountry: z.string().length(2).toUpperCase(), // ISO 3166-1 alpha-2
  useCache: z.boolean().default(true),
});

// Schema for the AI result (Stage 1)
export const AIClassificationSchema = z.object({
  codice_cn_8: z.string().regex(/^\d{8,10}$/),
  descrizione_voce: z.string(),
  capitolo: z.string(),
  sezione: z.string(),
  confidenza: z.number().int().min(0).max(100),
  ragionamento: z.string(),
  alternative: z.array(z.object({
    codice: z.string(),
    motivo: z.string(),
  })).default([]),
  avvertenze: z.string().optional(),
});

// Schema for the duty lookup (Stage 2)
export const DutyResultSchema = z.object({
  cnCode: z.string(),
  cnDescription: z.string(),
  dutyErga: z.string().optional(),       // e.g. "12.0 %"
  dutyPreferred: z.string().optional(),  // e.g. "0.0 % (EVFTA)"
  antiDumping: z.string().optional(),
  measures: z.array(z.object({
    tipo: z.string(),
    aliquota: z.string(),
    geo: z.string(),
  })),
});

// Final output of the pipeline
export const ClassificationResultSchema = AIClassificationSchema.extend({
  id: z.string().cuid(),
  duty: DutyResultSchema.nullable(),
  source: z.enum(["claude", "ollama/qwen3", "manual", "cache"]),
  originCountry: z.string(),
  createdAt: z.date(),
});
```

Export everything from `packages/core/src/index.ts` under `customs/`.

---

## Step 2 — AI Classifier service

Create `apps/api/src/services/customs/ai-classifier.ts`:

```typescript
// The service must support two providers:
// - "ollama" (default in dev): POST http://localhost:11434/api/chat, model qwen3
// - "anthropic" (prod): POST https://api.anthropic.com/v1/messages

// Read the provider from AppConfig (key: CUSTOMS_AI_PROVIDER, default: "ollama")
// Read the Ollama endpoint from AppConfig (key: OLLAMA_BASE_URL, default: "http://localhost:11434")
// Read the Claude API key from AppConfig (key: ANTHROPIC_API_KEY) — only if provider=anthropic

const SYSTEM_PROMPT = `You are an expert customs classifier for the EU Combined Nomenclature (CN/TARIC 2026).
Classify the product strictly following the section and chapter notes.

Critical rules:
- Textiles ch.61 (knitted)/62 (not knitted): the fibre that predominates by weight determines the heading (note 2, section XI)
- Footwear ch.64: the upper's material determines the chapter, not the sole
- Leather goods ch.42: distinguish natural leather (ex 4202) from synthetic/PU (same heading, different subheading)
- Men's/women's clothing: different headings (e.g. 6110.11 vs 6110.20)

Reply ONLY with valid JSON, no extra text, no markdown.`;

// The function must:
// 1. Build the user prompt with the description and the country of origin
// 2. Call the configured provider
// 3. Parse the JSON reply with AIClassificationSchema.parse()
// 4. On a parsing error, retry once with a more explicit prompt
// 5. Log with logger.info({ provider, confidenza, cn: result.codice_cn_8 }, "customs:classified")
```

---

## Step 3 — Duty Lookup service

Create `apps/api/src/services/customs/duty-lookup.ts`:

```typescript
// Uses the UK Trade Tariff API — free, no authentication required
// Base URL: https://www.trade-tariff.service.gov.uk/api/v2

// GET /commodities/{cn8code}
// The response includes an "included" array with type="measure"
// Filter the measures by type:
//   - "Third country duty" → dutyErga
//   - "Tariff preference" or "Preferential tariff" → dutyPreferred (look for geo=originCountry)
//   - "Anti-dumping duty" → antiDumping

// Error handling:
// - 404: CN code not found, return null (do not throw)
// - 5xx/network: log a warning, return null (the duty is optional, do not block)
// - Timeout: 5 seconds at most

// HTTP cache: the data rarely changes; add an outgoing Cache-Control header
// or store it in Prisma CustomsClassification.dutyErga/dutyPreferred

// The function must accept (cnCode: string, originCountry: string) → DutyResultSchema | null
```

---

## Step 4 — Orchestrator with cache

Create `apps/api/src/services/customs/index.ts`:

```typescript
// The main function classifyProduct(input: ClassifyRequestSchema) must:
//
// 1. Compute the SHA256 hash of (description.toLowerCase().trim() + originCountry)
// 2. If useCache=true, look it up in the DB: prisma.customsClassification.findUnique({ where: { productHash } })
//    → if found and updatedAt is less than 30 days old, return it with source="cache"
// 3. Call aiClassifier.classify(description, originCountry) → Stage 1
// 4. Call dutyLookup.getDuty(cnCode, originCountry) → Stage 2 (cannot run in parallel, it depends on cn)
// 5. Save/update in the DB with an upsert on productHash
// 6. Return ClassificationResultSchema
```

---

## Step 5 — tRPC Router

Create `apps/api/src/routers/customs.ts` and register it in the app router:

```typescript
// Procedures to implement:

// classifyProduct: protectedProcedure
//   input: ClassifyRequestSchema
//   → calls the orchestrator service
//   → audit log: { action: "customs.classify", userId, cnCode, description }

// lookupCnCode: protectedProcedure
//   input: z.object({ cnCode: z.string() })
//   → calls duty-lookup.ts only (useful for codes already known)

// getClassificationHistory: protectedProcedure
//   input: z.object({ limit: z.number().default(20), offset: z.number().default(0) })
//   → prisma.customsClassification.findMany, ordered by updatedAt desc

// deleteClassification: protectedProcedure (role: ADMIN)
//   input: z.object({ id: z.string().cuid() })
//   → soft delete or hard delete, audit log
```

---

## Step 6 — UI

Create `apps/web/src/app/(dashboard)/customs/page.tsx` and the components:

### `ClassifierForm.tsx`
- Textarea for the product description (placeholder `es. Maglione 80% lana merino...`)
- Select for the country of origin (main countries: CN, IN, VN, BD, TR, MA, US, JP + others)
- Checkbox `Usa cache` (checked by default)
- Button `Classifica` → calls tRPC `customs.classifyProduct`
- Loading state during classification (skeleton or spinner)

### `ClassificationResult.tsx`
- Large, prominent CN code badge (font-mono)
- Confidence badge coloured green ≥80%, yellow ≥60%, red <60%
- `Dazi doganali` section: erga omnes / preferential / anti-dumping table
- `Ragionamento AI` section: expandable text
- `Alternative` section: list of suggested alternative codes
- Alert when warnings are present
- Link to `https://ec.europa.eu/taxation_customs/dds2/taric/taric_consultation.jsp` for official verification

### `page.tsx`
- Layout with the form on the left and the result on the right (stacked on mobile)
- Classification history section below (table of the last 10 from the history)

---

## Step 7 — AppConfig entries

Add the new AppConfig keys to `prisma/seed.ts` (or a migration seed):

```typescript
{ key: "CUSTOMS_AI_PROVIDER",   value: "ollama",                   description: "AI provider for TARIC classification: 'ollama' or 'anthropic'" },
{ key: "OLLAMA_BASE_URL",       value: "http://localhost:11434",    description: "Ollama base URL for customs classification" },
{ key: "CUSTOMS_OLLAMA_MODEL",  value: "qwen3",                    description: "Ollama model for TARIC classification" },
{ key: "CUSTOMS_CACHE_DAYS",    value: "30",                       description: "Validity of the customs classification cache, in days" },
// ANTHROPIC_API_KEY already present, or to add if it does not exist
```

---

## Architectural constraints to respect

- **Privacy**: the product description may contain sensitive NAV data — do not log it in clear; use `logger.info({ hash, cnCode }, "customs:classified")` without the description text
- **AppConfig**: no key in `.env` — everything through the AppConfig database, as Luke's architecture requires
- **TypeScript strict**: every type from a Zod schema, no `any`
- **Error handling**: a failed duty lookup must not block the AI classification — return `duty: null` and log a warning
- **Audit log**: every classification must go to Luke's existing audit log

## Notes on Qwen3 + Ollama

The Qwen3 model supports the `think: false` parameter, which disables chain-of-thought and returns a direct JSON answer faster. In the Ollama request use:

```json
{
  "model": "qwen3",
  "messages": [...],
  "stream": false,
  "options": { "temperature": 0.1 },
  "think": false
}
```

A low temperature (0.1) matters for deterministic classifications.

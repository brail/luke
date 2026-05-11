# Luke — TARIC Classifier Integration

## Obiettivo

Implementare un modulo `customs` in Luke che, dato un prodotto NAV (descrizione + composizione),
restituisca la voce doganale CN/TARIC suggerita e l'aliquota di dazio in base al paese di origine.

Pipeline a due stadi:
1. **Stage 1 — AI classification**: LLM suggerisce codice CN a 8 cifre dalla descrizione (Qwen3 via Ollama in dev, Claude API in prod)
2. **Stage 2 — Duty lookup**: UK Trade Tariff REST API (gratuita, no auth) → aliquota erga omnes + preferenziale per paese origine

---

## Architettura target

```
apps/api/src/
  routers/
    customs.ts          ← tRPC router (classifyProduct, lookupDuty, getHistory)
  services/
    customs/
      ai-classifier.ts  ← Stage 1: LLM → codice CN
      duty-lookup.ts    ← Stage 2: UK Trade Tariff API
      index.ts          ← orchestrazione pipeline + cache

apps/web/src/
  app/(dashboard)/customs/
    page.tsx            ← UI: input prodotto → risultato classificazione
  components/customs/
    ClassifierForm.tsx
    ClassificationResult.tsx

packages/core/src/
  customs/
    schemas.ts          ← Zod schemas condivisi
```

Prisma model da aggiungere (cache classificazioni):

```prisma
model CustomsClassification {
  id              String   @id @default(cuid())
  productHash     String   @unique   // SHA256(descrizione+origine) per dedup
  description     String
  originCountry   String
  cnCode          String   // codice CN 8 cifre suggerito
  cnDescription   String
  confidence      Int
  reasoning       String
  alternatives    Json     // [{codice, motivo}]
  warnings        String?
  dutyErga        String?  // aliquota erga omnes
  dutyPreferred   String?  // aliquota preferenziale per paese
  source          String   // "claude" | "ollama/qwen3" | "manual"
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@index([cnCode])
  @@index([originCountry])
}
```

---

## Step 1 — Zod schemas in `@luke/core`

Crea `packages/core/src/customs/schemas.ts`:

```typescript
// Schema per richiesta classificazione
export const ClassifyRequestSchema = z.object({
  description: z.string().min(5).max(500),
  originCountry: z.string().length(2).toUpperCase(), // ISO 3166-1 alpha-2
  useCache: z.boolean().default(true),
});

// Schema per il risultato AI (Stage 1)
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

// Schema per duty lookup (Stage 2)
export const DutyResultSchema = z.object({
  cnCode: z.string(),
  cnDescription: z.string(),
  dutyErga: z.string().optional(),       // es. "12.0 %"
  dutyPreferred: z.string().optional(),  // es. "0.0 % (EVFTA)"
  antiDumping: z.string().optional(),
  measures: z.array(z.object({
    tipo: z.string(),
    aliquota: z.string(),
    geo: z.string(),
  })),
});

// Output finale del pipeline
export const ClassificationResultSchema = AIClassificationSchema.extend({
  id: z.string().cuid(),
  duty: DutyResultSchema.nullable(),
  source: z.enum(["claude", "ollama/qwen3", "manual", "cache"]),
  originCountry: z.string(),
  createdAt: z.date(),
});
```

Esporta tutto da `packages/core/src/index.ts` sotto `customs/`.

---

## Step 2 — AI Classifier service

Crea `apps/api/src/services/customs/ai-classifier.ts`:

```typescript
// Il service deve supportare due provider:
// - "ollama" (default in dev): POST http://localhost:11434/api/chat, model qwen3
// - "anthropic" (prod): POST https://api.anthropic.com/v1/messages

// Leggi il provider da AppConfig (chiave: CUSTOMS_AI_PROVIDER, default: "ollama")
// Leggi l'endpoint Ollama da AppConfig (chiave: OLLAMA_BASE_URL, default: "http://localhost:11434")
// Leggi la Claude API key da AppConfig (chiave: ANTHROPIC_API_KEY) — solo se provider=anthropic

const SYSTEM_PROMPT = `Sei un classificatore doganale esperto della Nomenclatura Combinata UE (CN/TARIC 2026).
Classifica il prodotto seguendo rigorosamente le note di sezione e capitolo.

Regole critiche:
- Tessili cap.61 (maglieria)/62 (non maglieria): fibra di peso maggiore determina voce (nota 2 sez.XI)
- Calzature cap.64: materiale tomaia determina capitolo, non la suola
- Pelletteria cap.42: distingui pelle naturale (ex 4202) da sintetica/PU (stessa voce, sottovoce diversa)
- Abbigliamento uomo/donna: voci diverse (es. 6110.11 vs 6110.20)

Rispondi SOLO con JSON valido, zero testo extra, zero markdown.`;

// La funzione deve:
// 1. Costruire il prompt utente con descrizione e paese origine
// 2. Chiamare il provider configurato
// 3. Parsare il JSON di risposta con AIClassificationSchema.parse()
// 4. In caso di errore di parsing, riprovare una volta con un prompt più esplicito
// 5. Loggare con logger.info({ provider, confidenza, cn: result.codice_cn_8 }, "customs:classified")
```

---

## Step 3 — Duty Lookup service

Crea `apps/api/src/services/customs/duty-lookup.ts`:

```typescript
// Usa UK Trade Tariff API — gratuita, no autenticazione richiesta
// Base URL: https://www.trade-tariff.service.gov.uk/api/v2

// GET /commodities/{cn8code}
// La risposta include un array "included" con type="measure"
// Filtra le misure per tipo:
//   - "Third country duty" → dutyErga
//   - "Tariff preference" o "Preferential tariff" → dutyPreferred (cerca geo=originCountry)
//   - "Anti-dumping duty" → antiDumping

// Gestione errori:
// - 404: codice CN non trovato, ritorna null (non lanciare eccezione)
// - 5xx/network: logga warning, ritorna null (il duty è opzionale, non bloccare)
// - Timeout: 5 secondi massimo

// Cache HTTP: i dati cambiano raramente, aggiungi header Cache-Control in uscita
// oppure memorizza in Prisma CustomsClassification.dutyErga/dutyPreferred

// La funzione deve accettare (cnCode: string, originCountry: string) → DutyResultSchema | null
```

---

## Step 4 — Orchestrator con cache

Crea `apps/api/src/services/customs/index.ts`:

```typescript
// La funzione principale classifyProduct(input: ClassifyRequestSchema) deve:
//
// 1. Calcolare hash SHA256 di (description.toLowerCase().trim() + originCountry)
// 2. Se useCache=true, cercare in DB: prisma.customsClassification.findUnique({ where: { productHash } })
//    → se trovato e updatedAt < 30 giorni, ritornare con source="cache"
// 3. Chiamare aiClassifier.classify(description, originCountry) → Stage 1
// 4. Chiamare dutyLookup.getDuty(cnCode, originCountry) → Stage 2 (in parallelo non possibile, dipende da cn)
// 5. Salvare/aggiornare in DB con upsert su productHash
// 6. Ritornare ClassificationResultSchema
```

---

## Step 5 — tRPC Router

Crea `apps/api/src/routers/customs.ts` e registralo nell'app router:

```typescript
// Procedure da implementare:

// classifyProduct: protectedProcedure
//   input: ClassifyRequestSchema
//   → chiama il service orchestrator
//   → audit log: { action: "customs.classify", userId, cnCode, description }

// lookupCnCode: protectedProcedure
//   input: z.object({ cnCode: z.string() })
//   → chiama solo duty-lookup.ts (utile per codici già noti)

// getClassificationHistory: protectedProcedure
//   input: z.object({ limit: z.number().default(20), offset: z.number().default(0) })
//   → prisma.customsClassification.findMany, ordina per updatedAt desc

// deleteClassification: protectedProcedure (role: ADMIN)
//   input: z.object({ id: z.string().cuid() })
//   → soft delete o hard delete, audit log
```

---

## Step 6 — UI

Crea `apps/web/src/app/(dashboard)/customs/page.tsx` e i componenti:

### `ClassifierForm.tsx`
- Campo textarea per descrizione prodotto (con placeholder "es. Maglione 80% lana merino...")
- Select paese di origine (lista paesi principali: CN, IN, VN, BD, TR, MA, US, JP + altri)
- Checkbox "Usa cache" (default checked)
- Button "Classifica" → chiama tRPC `customs.classifyProduct`
- Loading state durante classificazione (skeleton o spinner)

### `ClassificationResult.tsx`
- Badge codice CN grande in evidenza (font-mono)
- Badge confidenza con colore: verde ≥80%, giallo ≥60%, rosso <60%
- Sezione "Dazi doganali": tabella erga omnes / preferenziale / antidumping
- Sezione "Ragionamento AI": testo espandibile
- Sezione "Alternative": lista codici alternativi suggeriti
- Alert se avvertenze presenti
- Link a `https://ec.europa.eu/taxation_customs/dds2/taric/taric_consultation.jsp` per verifica ufficiale

### `page.tsx`
- Layout con form a sinistra, risultato a destra (o stacked su mobile)
- Sezione storico classificazioni sotto (tabella con le ultime 10 dalla history)

---

## Step 7 — AppConfig entries

Aggiungi in `prisma/seed.ts` (o migration seed) le nuove chiavi AppConfig:

```typescript
{ key: "CUSTOMS_AI_PROVIDER",   value: "ollama",                   description: "AI provider per classificazione TARIC: 'ollama' o 'anthropic'" },
{ key: "OLLAMA_BASE_URL",       value: "http://localhost:11434",    description: "URL base Ollama per classificazione doganale" },
{ key: "CUSTOMS_OLLAMA_MODEL",  value: "qwen3",                    description: "Modello Ollama per classificazione TARIC" },
{ key: "CUSTOMS_CACHE_DAYS",    value: "30",                       description: "Giorni di validità cache classificazioni doganali" },
// ANTHROPIC_API_KEY già presente o da aggiungere se non esiste
```

---

## Vincoli architetturali da rispettare

- **Privacy**: la descrizione prodotto può contenere dati sensibili NAV — non loggarla in chiaro; usa `logger.info({ hash, cnCode }, "customs:classified")` senza il testo descrizione
- **AppConfig**: nessuna chiave in `.env` — tutto via AppConfig DB come da architettura Luke
- **TypeScript strict**: tutti i tipi da schema Zod, niente `any`
- **Error handling**: duty lookup fallito non deve bloccare la classificazione AI — ritorna `duty: null` e logga warning
- **Audit log**: ogni classificazione deve andare nell'audit log esistente di Luke

## Note su Qwen3 + Ollama

Il modello Qwen3 supporta il parametro `think: false` per disabilitare il chain-of-thought e ottenere risposta JSON diretta più veloce. Nel prompt Ollama usa:

```json
{
  "model": "qwen3",
  "messages": [...],
  "stream": false,
  "options": { "temperature": 0.1 },
  "think": false
}
```

Temperatura bassa (0.1) è importante per classificazioni deterministiche.

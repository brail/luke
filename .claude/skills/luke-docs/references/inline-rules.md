# luke-docs — Regole commenti inline (modalità `inline`)

Lingua: **inglese** per tutti i commenti inline (JSDoc, tRPC, Prisma `///`).
Termini di dominio canonici italiani (es. "stagione", "campionario", "reso") restano as-is.

## Logica di merge (vale per tutte le fasi)

**Prima di scrivere qualsiasi commento, leggi quello esistente (se presente):**

| Situazione | Comportamento |
|-----------|--------------|
| Commento accurato e completo | Lascia invariato — non toccare |
| Commento accurato ma incompleto | Integra il contenuto mancante, preserva il testo esistente |
| Commento driftato dalla firma reale | Riscrivi, segnala nel report come "aggiornato" |
| Commento assente | Crea da zero |

---

## JSDoc su export TypeScript (`packages/`)

Template per **funzione esportata**:

```typescript
/**
 * {Descrizione in una frase di cosa fa. Verbo attivo: "Calculates", "Returns", "Validates".}
 *
 * @param paramName - {Descrizione solo se non autoesplicativa}
 * @returns {Descrizione del valore restituito}
 * @throws {TipoErrore} {Condizione}
 *
 * @example
 * const result = myFunction({ id: 'abc' });
 */
export function myFunction(...) { ... }
```

Template per **tipo / interface esportata**:

```typescript
/**
 * {Descrizione del concetto di dominio che rappresenta, non la sua forma.}
 * Esempio: "Immutable snapshot of a CollectionLayout at revision time."
 */
export type MyType = { ... }
```

Template per **costante / enum esportata**:

```typescript
/**
 * {Valori ammessi per {campo}. Usato in {contesto}.}
 */
export const MY_ENUM = ['A', 'B', 'C'] as const
```

**Regole JSDoc:**

- Non aggiungere JSDoc a funzioni interne non esportate (a meno che siano complesse e prive di qualsiasi commento)
- Non aggiungere `@param` per parametri autoesplicativi (`id: string`, `enabled: boolean`)
- Non descrivere l'implementazione — descrivi il comportamento osservabile
- Non ripetere il nome della funzione nella descrizione ("MyFunction does X" → scrivi "Does X")

---

## Commenti procedure tRPC (`apps/api/src/routers/`)

```typescript
/**
 * {Cosa fa questa procedura in una frase.}
 *
 * @auth {Azione RBAC richiesta, es: "collection:read" | "admin" | "public"}
 * @input {Descrizione breve dell'input. Riferisci lo schema Zod se ha un nome.}
 * @output {Descrizione del payload restituito.}
 */
```

Il valore di `@auth` va verificato nel middleware reale (`requirePermission(...)`),
mai dedotto dal nome della procedura.

---

## Field docs Prisma (`///`)

Prisma usa il **triplo slash** `///` per i commenti che diventano parte dei generated types.
Mai `//` (doppio slash) — viene ignorato dagli strumenti.

```prisma
/// Layout of a collection: groups + rows with independent ordering.
model CollectionLayout {
  /// Unique identifier (UUID v4).
  id        String   @id @default(uuid())

  /// FK to Brand. Determines the owning brand of the layout.
  brandId   String

  /// Current FSM state (draft → published → archived).
  status    LayoutStatus @default(DRAFT)
}
```

**Regole Prisma:**

- Salta `id`, `createdAt`, `updatedAt` salvo semantica non standard
- Commenta **sempre**: FK (spiega cosa referenzia), enum field (spiega gli stati), campi con `@default` non ovvi, relazioni `@relation`
- Aggiungi `///` anche sopra la riga `model ModelName {` con una riga di descrizione del modello

---

## Cosa NON toccare in modalità `inline`

- `// TODO:`, `// FIXME:`, `// HACK:` — preserva invariati
- Blocchi di codice commentato — NON rimuovere; aggiungi `// luke-docs:flag stale-commented-code` sopra per revisione manuale
- Qualsiasi commento in `.planning/`, `CLAUDE.md`, `lessons.md`
- Commenti che spiegano il **perché** di una decisione (rationale architetturale) — hanno più valore dei commenti che spiegano il *cosa*
- Import commentati usati come riferimento rapido durante lo sviluppo (ma flaggali)

---

## Checklist qualità inline (verifica prima di chiudere)

- [ ] Nessun JSDoc descrive l'implementazione anziché il comportamento
- [ ] Tutte le procedure tRPC con `@auth` hanno il valore corretto (verificato nel middleware)
- [ ] I `///` Prisma sono sul field, non sul tipo inline
- [ ] Nessun commento è stato rimosso (solo aggiunti o modificati)
- [ ] I `luke-docs:flag` sono stati aggiunti dove previsto

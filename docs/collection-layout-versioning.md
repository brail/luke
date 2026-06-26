# Collection Layout Versioning

**Feature**: Registro qualità ISO 9001:2015 per le revisioni formali del Collection Layout  
**Release**: v1.9.0  
**Riferimento**: PI 8.3-01 rev5 "Progettazione"

---

## Overview

Il versioning del Collection Layout trasforma il CL da uno stato mutabile in un registro qualità immutabile con:

- Storico delle revisioni formali etichettate (rev0, rev1, …)
- Snapshot completo di ogni riga inclusa al momento della revisione
- Categorie ISO 9001:2015 per ogni tipo di revisione
- Time-travel: visualizzazione del CL nello stato di una revisione passata

---

## Modello Dati

```
CollectionLayout
 └── CollectionLayoutRevision (rev0, rev1, …)
       ├── CollectionGroupRevision         (snapshot gruppo)
       │    └── CollectionLayoutRowRevision (snapshot riga — con foto immutabile)
       │         └── CollectionRowQuotationRevision
       └── collectionLayoutRevisions[]      ←back-relation su User
```

### Campi chiave

| Modello | Campo | Note |
|---------|-------|------|
| `CollectionLayoutRevision` | `revisionNumber` | 0-indexed, unico per layout |
| `CollectionLayoutRevision` | `revisionTypeValue` | FK soft a `CollectionCatalogItem.value` (type=revisionType) |
| `CollectionLayoutRevision` | `cause` | `MANUAL` \| `MILESTONE` |
| `CollectionLayoutRowRevision` | `sourceRowId` | FK soft — la riga viva può essere cancellata |
| `CollectionLayoutRowRevision` | `pictureKey` | key nel bucket immutabile `collection-row-pictures-revisions` |
| `CollectionCatalogItem` | `iso9001Categories` | solo per `type=revisionType` |
| `CollectionCatalogItem` | `expectedMinProgress` | valore progress atteso — usato per warning nel drawer |

---

## Tipi di Revisione (ISO 9001:2015)

Configurati nell'admin catalog (`/admin/collection-catalog`, tab "Tipo revisione").  
Il seed `apps/api/prisma/seeds/collectionCatalog.ts` crea 6 voci di default:

| Valore | Label | Categorie ISO |
|--------|-------|---------------|
| `REVISIONE_PROGETTUALE` | Revisione Progettuale | PIANIFICAZIONE, RIESAME |
| `REVISIONE_COSTRUTTIVA` | Revisione Costruttiva | VERIFICA |
| `REVISIONE_MODELLERIA` | Revisione Modelleria | VERIFICA |
| `REVISIONE_PROTOTIPO` | Revisione Prototipo | VERIFICA, VALIDAZIONE |
| `APPROVAZIONE_CAMPIONARIO` | Approvazione Campionario | VALIDAZIONE |
| `REVISIONE_FINALE` | Revisione Finale | RIESAME, NORMALE |

---

## Flusso Operativo

### Creazione revisione

1. PM apre il CL e clicca "Crea revisione"
2. Seleziona tipo revisione (con categorie ISO visibili)
3. Seleziona le righe da includere (pre-selezionate quelle modificate dopo l'ultima revisione)
4. `CreateRevisionDrawer` chiama `trpc.collectionLayoutRevision.create`
5. Il service copia le foto nel bucket immutabile (`collection-row-pictures-revisions`) PRIMA della transazione
6. La transazione crea `CollectionLayoutRevision` + snapshot di gruppi e righe
7. Ogni riga inclusa riceve `lastRevisedAt = now()`

### Visualizzazione storico

URL: `/product/collection-layout/revisions?layoutId=<id>`

- Lista revisioni in ordine decrescente per `revisionNumber`
- Ogni voce mostra: numero, tipo, data, autore, numero righe

### Drill-down revisione

URL: `/product/collection-layout/revisions/<revisionId>`

- Metadati: tipo, data, autore, note
- Snapshot dei gruppi e righe incluse (lettura sola)

---

## Backward Lookup (Time-Travel)

La query `getLayoutAsOfRevision` usa `DISTINCT ON` per trovare lo stato di ogni riga al momento di una revisione:

```sql
SELECT DISTINCT ON (rr."sourceRowId")
  rr.*, ...
FROM collection_layout_row_revisions rr
JOIN collection_layout_revisions r ON rr."revisionId" = r.id
WHERE r."collectionLayoutId" = $1
  AND r."revisionNumber" <= $2
ORDER BY rr."sourceRowId", r."revisionNumber" DESC
```

L'indice `@@index([sourceRowId, revisionId])` su `CollectionLayoutRowRevision` è critico per la performance di questa query.

---

## Bucket Immutabile

Le foto vengono copiate dal bucket `collection-row-pictures` al bucket immutabile `collection-row-pictures-revisions` tramite `copyToImmutableBucket()` in `apps/api/src/storage/index.ts`.

**Dedup CAS via sha256**: prima di copiare, viene cercato un record `FileObject` esistente con lo stesso `checksumSha256`. Se trovato, viene riutilizzata la chiave esistente senza creare duplicati.

**File orfani**: se la transazione della revisione fallisce dopo il pre-copy, il file copiato rimane nel bucket senza riferimenti DB. Questo è accettabile perché:
- Il contenuto è identico (stesso sha256) — nessun dato perso
- In produzione MinIO, il bucket può avere retention policy `governance`/`compliance`

---

## RBAC

| Permesso | Ruolo | Operazione |
|----------|-------|------------|
| `collection_layout:revise` | editor, admin | Creare revisioni |
| `collection_layout:view_revisions` | editor, viewer, admin | Vedere storico e dettagli |

---

## Come Aggiungere un Nuovo Tipo di Revisione

1. Vai ad `/admin/collection-catalog`, tab "Tipo revisione"
2. Clicca "Aggiungi opzione"
3. Inserisci value (chiave univoca), label, seleziona categorie ISO
4. Opzionalmente imposta "Progress minimo atteso" per warning automatici

---

## Come Abilitare `cause=MILESTONE`

Attualmente, la creazione di revisioni con `cause=MILESTONE` è bloccata dal router (`BAD_REQUEST`). Il campo `milestoneId` è già nel schema. Per abilitarla:

1. Rimuovere il check `if (input.cause === 'MILESTONE')` nel router `collectionLayoutRevision.ts`
2. Collegare l'evento milestone (`GATE`, `DEADLINE`) alla creazione automatica della revisione

---

## Edge Case

| Caso | Comportamento |
|------|---------------|
| Riga viva cancellata dopo la revisione | `sourceRowId` è FK soft — il backward lookup funziona ugualmente |
| `wasDeleted=true` | La riga era già cancellata al momento della revisione — filtrata dal time-travel |
| Foto orfane nel bucket immutabile | Accettabile — stesso sha256, nessun danno (vedi sezione Bucket Immutabile) |
| Revisione con 0 righe | Permessa — crea uno snapshot vuoto dei gruppi |
| Doppio snapshot stessa riga nella stessa revisione | Bloccato da `@@unique([revisionId, sourceRowId])` |

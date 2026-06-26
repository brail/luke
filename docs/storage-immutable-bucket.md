# Storage — Bucket Immutabile

## collection-row-pictures-revisions

Bucket di destinazione per le foto delle righe del Collection Layout incluse nelle revisioni formali (registro qualità ISO 9001:2015).

### Chi scrive

`copyToImmutableBucket()` in `apps/api/src/storage/index.ts` — chiamata dal service `createRevision` PRIMA della transazione Prisma.

### Chi legge

- Service `getRevisionDetail` → per il drill-down della revisione
- Service `getLayoutAsOfRevision` → per il time-travel
- Frontend (future): visualizzazione foto nello snapshot

### Semantica CAS (Content-Addressable Storage)

Prima di copiare un file, viene cercato un `FileObject` esistente con stesso `bucket` e `checksumSha256`. Se trovato, la chiave esistente viene restituita senza copiare.

Questo garantisce che due righe con la stessa foto (es. foto copiata da una stagione all'altra) non creino duplicati nel bucket.

### File orfani

Se la transazione della revisione fallisce dopo `copyToImmutableBucket`:
- Il file è nel bucket ma non ha un record `CollectionLayoutRowRevision.pictureKey` che lo referenzia
- Non è un problema: il contenuto è identico a file già presenti (stesso sha256)
- In produzione, il bucket può avere un lifecycle rule per pulire file non referenziati dopo N giorni

### MinIO: Configurazione retention policy (produzione)

Per rendere il bucket veramente immutabile in MinIO:

```sh
# Abilita versioning (requisito per Object Lock)
mc versioning enable ALIAS/collection-row-pictures-revisions

# Abilita Object Lock con modalità governance (ammette override con permissions admin)
mc retention set --default governance 365d ALIAS/collection-row-pictures-revisions
```

Per compliance totale (nessun override):
```sh
mc retention set --default compliance 3650d ALIAS/collection-row-pictures-revisions
```

**IMPORTANTE**: Con retention `compliance`, nemmeno l'admin può cancellare i file prima della scadenza. Valutare in base ai requisiti legali del cliente.

### Permessi applicativi

L'applicazione NON ha `s3:DeleteObject` su questo bucket in produzione. Il service non implementa delete per i file del bucket immutabile.

---

## Relazione con il versioning del CL

Vedi [docs/collection-layout-versioning.md](./collection-layout-versioning.md) per il flusso completo.

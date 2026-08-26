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

### Configurazione retention policy (produzione)

Object Lock (versioning + retention WORM) è una feature S3 standard, non specifica di un vendor — si configura via API S3 (`PutBucketVersioning` + `PutObjectLockConfiguration`/`PutObjectRetention`), non tramite lo storage provider applicativo (`IStorageProvider` non espone bucket policy/retention — è fuori dal suo scope, va fatto a livello di storage backend).

Lo stack Docker gira SeaweedFS, che supporta Object Lock (modalità GOVERNANCE e COMPLIANCE, Legal Hold) dalla release 3.94 in poi. **Non verificato in questo progetto** — prima di affidarsi a `compliance` per un requisito legale reale, verificare contro la versione SeaweedFS effettivamente deployata: al momento della scrittura risultano report aperti upstream di delete che riescono comunque in modalità `compliance` in alcune build (seaweedfs/seaweedfs#8350). Con MinIO (se ancora in uso per un'installazione esistente) lo stesso setup si faceva con `mc versioning enable` + `mc retention set --default compliance ...`; con SeaweedFS l'equivalente passa dalla API S3 standard (`aws s3api put-object-lock-configuration` / `put-object-retention`), non da un CLI `mc`-style.

**IMPORTANTE**: con retention in modalità compliance, nemmeno l'admin dovrebbe poter cancellare i file prima della scadenza — ma vedi il caveat sopra prima di considerarlo garantito. Valutare in base ai requisiti legali del cliente, e testare esplicitamente il comportamento di delete contro la build effettivamente in produzione prima di considerare il bucket davvero immutabile.

### Permessi applicativi

L'applicazione NON ha `s3:DeleteObject` su questo bucket in produzione. Il service non implementa delete per i file del bucket immutabile.

---

## Relazione con il versioning del CL

Vedi [docs/collection-layout-versioning.md](./collection-layout-versioning.md) per il flusso completo.

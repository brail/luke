# Collection Layout Versioning

- **Feature**: ISO 9001:2015 quality register for formal Collection Layout
  revisions
- **Release**: v1.9.0; reworked in v2.0.0 (whole-layout snapshots, automatic
  milestone revisions)
- **Reference**: PI 8.3-01 rev5 "Progettazione"

---

## Overview

Collection Layout versioning backs the mutable CL with an immutable quality
register, providing:

- A history of labelled formal revisions (rev0, rev1, …)
- A full snapshot of every row in the layout at revision time
- ISO 9001:2015 categories for each revision type in the catalog
- Time travel: viewing the CL as it stood at a past revision

---

## Data Model

```
CollectionLayout
 └── CollectionLayoutRevision (rev0, rev1, …)
       ├── CollectionGroupRevision         (group snapshot)
       │    └── CollectionLayoutRowRevision (row snapshot + photo key)
       │         └── CollectionRowQuotationRevision
       └── collectionLayoutRevisions[]      ← back-relation on User
```

### Key fields

| Model | Field | Notes |
|-------|-------|-------|
| `CollectionLayoutRevision` | `revisionNumber` | 0-indexed, unique per layout |
| `CollectionLayoutRevision` | `revisionTypeValue` | Free string: no FK and no server-side check against the catalog. Manual revisions take it from the `revisionType` catalog (`CollectionCatalogItem.value`); automatic ones use `MILESTONE_DATA` / `MILESTONE_FASE`, which are not catalog items |
| `CollectionLayoutRevision` | `cause` | `MANUAL` \| `MILESTONE` |
| `CollectionLayoutRowRevision` | `sourceRowId` | Soft FK — the live row can be deleted |
| `CollectionLayoutRowRevision` | `pictureKey` | Key in the immutable `collection-row-pictures-revisions` bucket. Automatic revisions created before 2026-09-26 hold the live row's key in `collection-row-pictures` instead (see Automatic Revisions) |
| `CollectionCatalogItem` | `iso9001Categories` | Only for `type=revisionType` |

---

## Revision Types (ISO 9001:2015)

Configured in the admin catalog (`/admin/collection-layout-configuration`,
"Tipo revisione" tab).

The seed `apps/api/prisma/seeds/collectionCatalog.ts` creates 6 default
entries:

| Value | Label | ISO categories |
|-------|-------|----------------|
| `REVISIONE_PROGETTUALE` | Revisione Progettuale | PIANIFICAZIONE, RIESAME |
| `REVISIONE_COSTRUTTIVA` | Revisione Costruttiva | VERIFICA |
| `REVISIONE_MODELLERIA` | Revisione Modelleria | VERIFICA |
| `REVISIONE_PROTOTIPO` | Revisione Prototipo | VERIFICA, VALIDAZIONE |
| `APPROVAZIONE_CAMPIONARIO` | Approvazione Campionario | VALIDAZIONE |
| `REVISIONE_FINALE` | Revisione Finale | RIESAME, NORMALE |

---

## Operational Flow

### Creating a revision

1. The PM opens the CL and clicks "Crea revisione"
2. Selects the revision type (its ISO categories are shown)
3. Optionally adds a note. There is no row selection: every revision
   snapshots every row of the layout
4. `CreateRevisionDialog` calls `trpc.collectionLayoutRevision.create`
5. The service copies the photos into the immutable bucket
   (`collection-row-pictures-revisions`) BEFORE the transaction, a bounded
   number at a time (`IMAGE_FETCH_CONCURRENCY`). A row whose photo object is
   gone from live storage is snapshotted without a photo and named in the
   revision's audit row (`missingPhotoRowIds`), provided storage served at
   least one other photo of the layout. When it served none, and on any other
   copy failure, the revision fails
6. The transaction creates the `CollectionLayoutRevision` plus the group and
   row snapshots
7. Every row still in the layout gets `lastRevisedAt = now()`

### History view

URL: `/product/collection-layout/revisions?layoutId=<id>`

- Revisions listed in descending `revisionNumber` order
- Each entry shows: number, type, date, author, row count

### Revision drill-down

URL: `/product/collection-layout/revisions/<revisionId>`

- Metadata: type, date, author, notes
- The layout as of that revision, reconstructed by
  `collectionLayoutRevision.getLayoutAsOf` (see Backward Lookup), read-only

---

## Backward Lookup (Time Travel)

The `getLayoutAsOfRevision` service function (exposed as the tRPC query
`collectionLayoutRevision.getLayoutAsOf`) uses `DISTINCT ON` to find the state
of each row at the time of a revision. Simplified — the actual query also
joins the group revisions and aggregates the quotations:

```sql
SELECT DISTINCT ON (rr."sourceRowId")
  rr.*, ...
FROM collection_layout_row_revisions rr
JOIN collection_layout_revisions r ON rr."revisionId" = r.id
WHERE r."collectionLayoutId" = $1
  AND r."revisionNumber" <= $2
ORDER BY rr."sourceRowId", r."revisionNumber" DESC
```

The `@@index([sourceRowId, revisionId])` index on
`CollectionLayoutRowRevision` is critical to this query's performance.

---

## Immutable Bucket

For manual revisions, photos are copied from the `collection-row-pictures`
bucket to the immutable `collection-row-pictures-revisions` bucket by
`copyToImmutableBucket()` in `apps/api/src/storage/index.ts`. Automatic
revisions do the same since 2026-09-26 (see Automatic Revisions below).

**CAS dedup via sha256**: before copying, the function looks for an existing
`FileObject` row in the immutable bucket with the same `checksumSha256`, among
the copies it made itself (`createdBy: 'system'`, confirmed). If one is found,
its key is reused instead of uploading a copy. It is a lookup, not a
guarantee: concurrent copies of identical content can each miss it (see
[docs/storage-immutable-bucket.md](./storage-immutable-bucket.md)).

**Orphan files**: if the revision transaction fails after the pre-copy, the
copied file stays in the bucket with its `FileObject` row, referenced by no
revision. A retried revision finds it through the checksum lookup and reuses it;
nothing removes it otherwise. Retention on this bucket is covered in
[docs/storage-immutable-bucket.md](./storage-immutable-bucket.md), including the
caveat about verifying it against the actual backend.

---

## RBAC

| Permission | Role | Operation |
|------------|------|-----------|
| `collection_layout:revise` | editor, admin | Create revisions manually |
| `collection_layout:view_revisions` | editor, viewer, admin | View history and details |

---

## Adding a New Revision Type

1. Go to `/admin/collection-layout-configuration`, "Tipo revisione" tab
2. Click "Aggiungi opzione"
3. Enter the value (unique key) and the label, and select the ISO categories

---

## Automatic Revisions (`cause=MILESTONE`)

`cause=MILESTONE` revisions exist, but never through the manual endpoint: its
input (`CreateRevisionRequestSchema`) has no `cause` or `milestoneId`, and the
router always passes `cause: 'MANUAL'`. Automatic revisions are created by
`apps/api/src/services/collectionLayoutAutoRevision.service.ts`, one revision
type per trigger:

1. `MILESTONE_DATA` — the deadline (`endAt ?? startAt`) of a non-cancelled,
   phase-linked calendar event has been reached (7-day lookback): an all-day
   deadline when its day ends in the business time zone
   (`app.defaultTimezone`), a timed one at its instant (`deadlineReachedAt`).
   Checked on the hourly tick of `apps/api/src/lib/milestoneDeadlineScheduler.ts`
2. `MILESTONE_FASE` — every row of the event's planning group has reached or
   passed the event's phase. Checked when `collectionLayout.rows.update`
   changes a row's phase

Both snapshot the whole layout with `milestoneId` set to the event, and
`@@unique([milestoneId, revisionTypeValue])` allows one revision per event and
type. They are credited to the oldest active admin (skipped when there is
none), and row photos are copied to the immutable bucket, as for a manual
revision, including a row whose photo object is gone. Any other failure (storage
or database unavailable) fails that event's snapshot: the date trigger logs it
and retries on its next hourly tick, so an event still failing when it leaves the
7-day lookback window gets no `MILESTONE_DATA` revision; the phase trigger logs
it and does not retry, and the group's next phase change snapshots the layout as
it is then.

**Known gap:** until 2026-09-26 automatic revisions stored keys of the live
`collection-row-pictures` bucket, while the revision page and the revision
exports resolve every `pictureKey` in the immutable
`collection-row-pictures-revisions` bucket. The automatic revisions created by
v2.0.0–v2.1.x therefore show no photo, and replacing a row's photo deletes the
live object they point to. `db:repair-auto-revision-photos`
(`apps/api/scripts/repair-auto-revision-photos.ts`, dry run unless `--apply`) copies each photo
still in live storage into the immutable bucket, repoints the revision rows in the same
transaction as one `COLLECTION_LAYOUT_REVISION_PHOTO_REPAIR` audit row per revision and key, and lists
the keys it cannot recover from current storage. It is the one traced exception to snapshot
immutability, and it has to run right after the deploy: every photo replaced before it runs is
lost for that revision.

---

## Edge Cases

| Case | Behaviour |
|------|-----------|
| Live row deleted after the revision | `sourceRowId` is a soft FK — the backward lookup still works |
| `wasDeleted=true` | Means the row was already deleted at revision time — filtered out of time travel. No write path sets it today: `createRevision` always writes `false`, so a row deleted between two revisions still appears, from its last snapshot, when the later revision is viewed |
| Row photo gone from live storage when the revision is taken | The row is snapshotted without a photo, named in the revision's audit row (`missingPhotoRowIds`) and in a warning. Includes a photo replaced while the snapshot runs: the old object is deleted once the row update commits |
| No row photo of the layout readable | The revision fails: a storage that serves none is more likely looking in the wrong place (an empty volume, a new bucket) than to have lost them all, so it is retried rather than recorded without photos |
| Row deleted while the revision is taken | Snapshotted as the layout was loaded; only its `lastRevisedAt` write is skipped |
| Orphan photos in the immutable bucket | Kept with their `FileObject` row and reused by a retried revision (see the Immutable Bucket section) |
| Revision with 0 rows (layout with no rows) | Allowed — the groups are snapshotted with no rows |
| Same row snapshotted twice in the same revision | Blocked by `@@unique([revisionId, sourceRowId])` |

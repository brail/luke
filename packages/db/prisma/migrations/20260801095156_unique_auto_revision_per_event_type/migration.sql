-- CreateIndex
CREATE UNIQUE INDEX "collection_layout_revisions_milestoneId_revisionTypeValue_key" ON "collection_layout_revisions"("milestoneId", "revisionTypeValue");

-- Voci di catalogo per i tipi di revisione automatica (AUTO_REVISION_TYPE_VALUES in @luke/core).
-- Presenti anche in `prisma/seeds/collectionCatalog.ts` per i DB creati da zero via seed, ma il
-- seed non gira al boot del container (`entrypoint.sh` esegue solo `prisma migrate deploy`): senza
-- questo INSERT le revisioni automatiche esisterebbero in produzione senza etichetta né categorie
-- ISO. Idempotente: ON CONFLICT sull'unique (type, value).
INSERT INTO "collection_catalog_items" ("id", "type", "value", "label", "iso9001Categories", "order", "isActive", "updatedAt")
VALUES
  (gen_random_uuid(), 'revisionType', 'MILESTONE_DATA', 'Milestone: data raggiunta', ARRAY['PIANIFICAZIONE', 'RIESAME'], 6, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'revisionType', 'MILESTONE_FASE', 'Milestone: fase completata', ARRAY['VERIFICA'], 7, true, CURRENT_TIMESTAMP)
ON CONFLICT ("type", "value") DO NOTHING;


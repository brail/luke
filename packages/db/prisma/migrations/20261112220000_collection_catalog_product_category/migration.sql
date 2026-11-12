-- #126: a collection layout row's category (`productCategory`) becomes a catalog-managed value, the
-- catalog type `productCategory` (`COLLECTION_CATALOG_TYPES` in `@luke/core`). Free text had split one
-- category into several spellings; this merges the spellings that differ only in case or surrounding
-- whitespace into the most frequent one (ties: first in "C" order, so upper case wins), turns a
-- whitespace-only value into `n/a`, and creates one active item per category, with `value` and
-- `label` both the category text, so everything that prints the stored value is unchanged. Typos that
-- differ in more than case were fixed by hand before this ran in production (owner, 2026-11-12).
--
-- Data only: no schema change. Safe to run twice: a second run finds every row already canonical and
-- every item present (`ON CONFLICT DO NOTHING` keeps an item an admin changed or deactivated).

-- 1. Rewrite each row to the canonical spelling of its group.
WITH trimmed AS (
  SELECT "id",
         COALESCE(NULLIF(regexp_replace("productCategory", '^\s+|\s+$', '', 'g'), ''), 'n/a') AS "spelling"
  FROM "collection_layout_rows"
),
canonical AS (
  SELECT DISTINCT ON (lower(s."spelling")) lower(s."spelling") AS "groupKey", s."spelling"
  FROM (SELECT "spelling", count(*) AS "rows" FROM trimmed GROUP BY "spelling") s
  ORDER BY lower(s."spelling"), s."rows" DESC, s."spelling" COLLATE "C"
)
UPDATE "collection_layout_rows" r
SET "productCategory" = c."spelling", "updatedAt" = CURRENT_TIMESTAMP
FROM trimmed t
JOIN canonical c ON c."groupKey" = lower(t."spelling")
WHERE r."id" = t."id" AND r."productCategory" <> c."spelling";

-- 2. One active catalog item per category, in alphabetical order.
INSERT INTO "collection_catalog_items" ("id", "type", "value", "label", "order", "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid()::TEXT, 'productCategory', d."value", d."value",
       (row_number() OVER (ORDER BY lower(d."value"), d."value" COLLATE "C"))::INTEGER - 1,
       true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (SELECT DISTINCT "productCategory" AS "value" FROM "collection_layout_rows") d
ON CONFLICT ("type", "value") DO NOTHING;

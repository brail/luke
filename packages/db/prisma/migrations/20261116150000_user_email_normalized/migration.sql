-- #228 (S13a): every user email in one form — trimmed, lowercase, printable ASCII without spaces —
-- and a CHECK that keeps it so.
--
-- Hand-written (docs/prisma-migration-workflow.md): a one-time rewrite of stored data plus a CHECK
-- constraint Prisma does not model. The rule is frozen here, independent of later code: the stored
-- form of an address is `lower(btrim(email))`, and only printable ASCII without spaces is admitted —
-- the application's `EmailSchema` (zod's ASCII email pattern) admits nothing else, so SQL `lower()`
-- and JavaScript `toLowerCase()` agree on every value this migration rewrites.
--
-- Nothing is guessed. Before any change, the migration stops (and changes nothing) when a stored
-- address holds anything but printable ASCII once trimmed, or when two users — active, inactive or
-- pending — would share an address once normalized (`users_email_key` is global). Find them with:
--   SELECT id, email FROM users WHERE btrim(email) !~ '^[!-~]+$';
--   SELECT lower(btrim(email)), array_agg(id) FROM users GROUP BY 1 HAVING count(*) > 1;
-- and fix them by hand before deploying.
--
-- Safe to run twice: a second run finds every address already normalized and the constraint there.

DO $$
DECLARE
  unsupported integer;
  duplicated integer;
BEGIN
  SELECT count(*) INTO unsupported FROM users WHERE btrim(email) !~ '^[!-~]+$';
  SELECT coalesce(sum(n), 0) INTO duplicated FROM (
    SELECT count(*) AS n FROM users GROUP BY lower(btrim(email)) HAVING count(*) > 1
  ) AS clashes;
  IF unsupported > 0 OR duplicated > 0 THEN
    RAISE EXCEPTION 'user email normalization refused: % address(es) outside printable ASCII, % user(s) sharing an address once normalized; fix them by hand (see this migration''s header)',
      unsupported, duplicated;
  END IF;
END $$;

UPDATE users SET email = lower(btrim(email)) WHERE email <> lower(btrim(email));

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_email_normalized') THEN
    ALTER TABLE users ADD CONSTRAINT users_email_normalized
      CHECK (email = lower(btrim(email)) AND email ~ '^[!-~]+$');
  END IF;
END $$;

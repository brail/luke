-- #229 (S13b): a LOCAL identity is filed under its user's current username, since local sign-in
-- finds it there. Before 3.1 a rename left it under the old name, locking the user out of local
-- sign-in; this one-time rewrite moves the identities it can move without a choice.
--
-- Hand-written (docs/prisma-migration-workflow.md), the rule frozen here: an identity is moved only
-- when ownership is unambiguous — its user has exactly one LOCAL identity, filed under another name,
-- and no LOCAL identity holds the user's current username. Its id and credential are kept. The move
-- repeats until nothing moves, so a chain (one identity waiting on a name another one is about to
-- leave) is followed link by link. Every other case (several LOCAL identities for one user, a name
-- held by an identity that cannot move, a swap or a cycle between users) is left as it is and
-- counted in a notice; find them with:
--   SELECT u.id, u.username, i."providerId" FROM identities i JOIN users u ON u.id = i."userId"
--   WHERE i.provider = 'LOCAL' AND i."providerId" <> u.username;
-- and resolve each by hand: the local-access tools (`localAccess.service.ts`) refuse them until then.
--
-- Safe to run twice: a second run finds nothing left to move.

DO $$
BEGIN
  LOOP
    UPDATE identities AS i
    SET "providerId" = u.username, "updatedAt" = now()
    FROM users AS u
    WHERE i."userId" = u.id
      AND i.provider = 'LOCAL'
      AND i."providerId" <> u.username
      AND (SELECT count(*) FROM identities AS o WHERE o."userId" = u.id AND o.provider = 'LOCAL') = 1
      AND NOT EXISTS (SELECT 1 FROM identities AS t WHERE t.provider = 'LOCAL' AND t."providerId" = u.username);
    EXIT WHEN NOT FOUND;
  END LOOP;
END $$;

DO $$
DECLARE
  left_behind integer;
BEGIN
  SELECT count(*) INTO left_behind
  FROM identities AS i JOIN users AS u ON u.id = i."userId"
  WHERE i.provider = 'LOCAL' AND i."providerId" <> u.username;
  IF left_behind > 0 THEN
    RAISE NOTICE 'LOCAL identities left under another name (ambiguous, resolve by hand): %', left_behind;
  END IF;
END $$;

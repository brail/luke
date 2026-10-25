# Upgrading from 3.0 to 3.1

Procedure for moving a stack from `3.0.x` to `3.1.0`: the RC stack with each candidate first, then
production with the stable tag. It runs on the Docker host that serves the Portainer stacks, with
a shell there. This guide grows with the 3.1 release train: every change that asks something of
the operator adds its step here.

What 3.1 changes for the operator so far:

- **The web image carries no public address.** The browser calls the API on the page's own
  origin, so the image no longer bakes a hostname or a scheme. The GitHub repository variables
  `PUBLIC_HOSTNAME` and `RC_PUBLIC_HOSTNAME` are no longer read by 3.1; delete them only once 3.1.0
  is on `main`, whose 3.0 workflow still reads them for a hotfix. The stack's
  `NEXTAUTH_URL` takes its scheme from the optional stack variable `PUBLIC_SCHEME` (default
  `http`): nothing to set while the site is served over plain HTTP (`OPERATIONS.md`, "Release
  build variables").
- **Credentials are always stored encrypted.** Every writer now encrypts the configuration keys
  that hold a credential, but a row an earlier release stored in plaintext stays so until it is
  rewritten: step 4 encrypts those rows once.
- **A collection row's picture belongs to the row.** Replacing or removing a picture now deletes
  the row's previous file: step 2 checks that no stored picture is shared or missing first.

## 1. Shell variables

Set these in one shell on the Docker host; every command below uses them.

```bash
STACK=luke; SUFFIX=          # production
# STACK=luke-rc; SUFFIX=-rc  # the RC stack
svc() { docker ps -q --filter "label=com.docker.compose.project=$STACK" --filter "label=com.docker.compose.service=$1$SUFFIX"; }
PG=$(svc postgres); API=$(svc api)
```

## 2. Before the update: picture keys (read-only)

Both queries must return no rows. A row they list keeps its picture on 3.1 only after a decision,
taken row by row before the update: usually clearing its `pictureKey`, which leaves the row
without a picture.

```bash
docker exec -i "$PG" psql -U luke -d luke <<'SQL'
-- a picture key held by more than one row
SELECT "pictureKey", count(*) FROM collection_layout_rows
WHERE "pictureKey" IS NOT NULL GROUP BY 1 HAVING count(*) > 1;
-- a picture key with no stored file
SELECT r.id, r."pictureKey" FROM collection_layout_rows r
LEFT JOIN file_objects f ON f.bucket = 'collection-row-pictures' AND f.key = r."pictureKey"
WHERE r."pictureKey" IS NOT NULL AND f.id IS NULL;
SQL
```

## 3. Backup and update

Take a backup and check that it completed (`Manutenzione` › `Backup & Restore`), then update the
stack as every release does (`README.md`, "Deployment"): its Git reference and `LUKE_VERSION`
together, then redeploy.

## 4. After the update: encrypt the stored credentials

Inside the API container, which holds the master key the rows are encrypted with. The dry run
lists the rows it would encrypt, by key; the second command encrypts them, one audit row per key.

```bash
docker exec "$API" node dist-scripts/scripts/encrypt-secret-config.js --dry-run
docker exec "$API" node dist-scripts/scripts/encrypt-secret-config.js
```

It prints keys and counts, never a value, and a second run finds nothing. It refuses, writing
nothing, when the container has no master key file or the key decrypts none of the rows already
encrypted. It exits 1 when a row needs attention: a value its schema refuses, a row changed while
it ran, or a write that failed; fix the row or re-run. Run it again after restoring a backup taken
before this step.

## 5. Rollback

- 3.1 adds database migrations: going back to 3.0 means restoring the database from the backup of
  step 3 as well as the stack's Git reference and `LUKE_VERSION`, as in
  [the 2.1.6 → 3.0 upgrade](upgrade-2.1-to-3.0.md#10-rollback). Between two 3.1 candidates, a
  later candidate's migrations stay applied (`docker-compose.rc.yml`, header).
- Keep the master key (`luke_api_data` volume): never decrypt the rows back to plaintext. A 3.0
  image may store a credential in plaintext again.
- Roll back the API and the web together.
- After the switch to HTTPS, a web image older than `3.1.0-rc.1` brings mixed content back: it
  bakes `http://<hostname>`.

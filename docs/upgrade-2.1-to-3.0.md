# Upgrading production from 2.1.6 to 3.0

Procedure for moving the production stack from `2.1.6` to `3.0.0`. It runs on the
Docker host that serves the Portainer stack, with a shell there and an
administrator account in the app. Follow it in order: every step relies on the one
before it.

Three changes in 3.0 make this more than a redeploy:

- **Storage.** 3.0 replaces MinIO with SeaweedFS and drops the `minio` value of
  `storage.type`. The new stack has no MinIO service, so the files stay in the
  old MinIO volume until they are copied across. A stored `storage.type = minio`
  makes every storage call fail with an error naming the key, never a silent
  fallback.
- **Data repairs.** Six migrations run at boot, and three one-shot scripts repair
  data that 2.1.x wrote: all-day event dates, the photos of automatic revisions
  and the image thumbnails. Two of them must run before users edit anything.
- **Networks.** 3.0 splits the stack over separate networks: `edge` for the web
  and the API, an internal `data` network for the API, Postgres and the storage.
  The reverse proxy reaches the web only over an external network, `luke-proxy`,
  that the two of them share (`OPERATIONS.md`, "Reverse proxy"). Step 4 creates
  it before the update; without it the proxy loses the web.

Users are kept out from the freeze (step 3) to the reopening (step 8) by
maintenance mode. On the rc.1 rehearsal the file copy took minutes for 542
files; plan an hour for the whole procedure.

The calendar digest can arrive twice on the day. 2.1.6 sends it during the 07:00
UTC hour; 3.0 sends it from 07:00 in each recipient's time zone once maintenance
ends, and its delivery record starts empty. If 2.1.6 has already sent that day's
digest, a 3.0 reopening later the same day sends it again: finish before 07:00
UTC, or accept one duplicate.

Users also see one change the procedure does not touch: calendar events are
visible by brand scope (the 3.0.0 notes in `CHANGELOG.md`).

## 1. Before the day

- The `3.0.0` images of `luke-api` and `luke-web` are on `ghcr.io/brail`.
- The MinIO credentials are at hand: `MINIO_ROOT_USER` and `MINIO_ROOT_PASSWORD`
  in the stack's environment in Portainer.
- Generate the SeaweedFS credentials: `openssl rand -hex 24`, twice, for
  `S3_ROOT_USER` and `S3_ROOT_PASSWORD`. Never put `$` in a stack value: compose
  interpolates it and the value arrives truncated.

## 2. Read-only checks on 2.1.6

On the day, work in one shell on the Docker host. Every command below uses these
variables; set them first:

```bash
STACK=luke   # Portainer's name for the stack
svc() { docker ps -q --filter "label=com.docker.compose.project=$STACK" --filter "label=com.docker.compose.service=$1"; }
PG=$(svc postgres); API=$(svc api)
NPM=nginx-proxy-manager   # the reverse proxy's container
MINIO_IMG=$(docker inspect --format '{{.Image}}' "$(svc minio)"); echo "$MINIO_IMG"
docker volume ls --filter name="${STACK}_minio_data"   # the volume holding today's files
docker network inspect "${STACK}_default" --format '{{range .Containers}}{{.Name}} {{end}}'
```

2.1.6 runs on the stack's default network, and the reverse proxy reaches the
web there: the last command lists it among the containers. It stays connected
until step 9, so a rollback finds the web again. In the proxy's admin page,
check that the production host forwards to `http://luke-web-1:3000`: step 4
relies on that container name.

Write `MINIO_IMG` down: step 5 starts a temporary MinIO from that image, which
stays on the host after the old container is gone, so nothing is pulled.

```bash
docker exec -i "$PG" psql -U luke -d luke <<'SQL'
SELECT count(*) AS events_out_of_range FROM calendar_events
WHERE "startAt" NOT BETWEEN '1900-01-01' AND '9999-12-31 23:59:59.999'
   OR "endAt" NOT BETWEEN '1900-01-01' AND '9999-12-31 23:59:59.999'
   OR "baselineStartAt" NOT BETWEEN '1900-01-01' AND '9999-12-31 23:59:59.999'
   OR "baselineEndAt" NOT BETWEEN '1900-01-01' AND '9999-12-31 23:59:59.999';
SELECT count(*) AS groups_out_of_range FROM planning_groups
WHERE "anchorDate" NOT BETWEEN '1900-01-01' AND '9999-12-31';
SELECT id, timezone FROM users WHERE timezone NOT IN (SELECT name FROM pg_timezone_names);
SELECT count(*) AS blank_vendor_nicknames FROM vendors WHERE btrim(nickname) = '';
SELECT value AS storage_type FROM app_configs WHERE key = 'storage.type';
SQL
```

- Both out-of-range counts must be **0**: otherwise a 3.0 migration fails and
  the API does not start. Correct those dates first (see "Calendar date range" in
  `apps/api/README.md`).
- Any user listed with an invalid time zone: correct it before the upgrade.
- Blank vendor nicknames show an empty label in 3.0. Note the count and fill them
  in afterwards.
- `storage_type` must be `minio` for this procedure as written. With `local`,
  skip step 5, and in step 6 copy with `--from=local` and no `--from-s3-*`
  options. 2.1.6 stores no other value: stop and investigate if you see one.

## 3. Freeze and back up

1. In the app, `Manutenzione → Modalità Manutenzione`: tick
   `Forza il logout di tutti i non-admin`, then `Attiva subito`. Only
   administrators can use the app from now on. The state lives in the database,
   so 3.0 starts in maintenance too.
2. Dump the database outside the app. The in-app backup is not the rollback: it is
   written to MinIO, which 3.0 no longer runs.

   ```bash
   DUMP="luke-2.1.6-$(date +%F-%H%M).dump"
   (umask 077; docker exec "$PG" pg_dump -U luke -d luke -F custom > "$DUMP")
   docker exec -i "$PG" pg_restore --list < "$DUMP" | head   # readable, not empty
   ```

   The file holds every user's data: keep it on the host, mode 600, until the
   upgrade is accepted.
3. Save the stack as it runs today: in Portainer, open the stack's editor and
   copy its whole content to `luke-2.1.6-stack.yml`, next to the dump and with
   the same mode 600. Production runs this text, not the repository's `v2.1.6`
   file, and step 10 puts it back. Both Luke images in it must be `2.1.6`:

   ```bash
   grep -n 'image: ghcr.io/brail/luke-' luke-2.1.6-stack.yml   # both end in :2.1.6
   ```

   If one reads `latest`, change it to `2.1.6` in the saved copy now: by the
   rollback `latest` is 3.0.0. The stack's environment variables in Portainer
   stay as they are until step 9; the rollback reads them too.

## 4. Update the stack

Create the network the reverse proxy will reach the web on, and connect the
proxy to it. Its proxy host keeps forwarding to `http://luke-web-1:3000`: the
same container name, reached over the new network once the update has run.

```bash
docker network create luke-proxy
docker network connect luke-proxy "$NPM"
docker network inspect luke-proxy --format '{{range .Containers}}{{.Name}} {{end}}'   # the proxy
```

In Portainer, open the stack's editor and replace its content with
`docker-compose.prod.yml` from the `v3.0.0` tag
(`https://raw.githubusercontent.com/brail/luke/v3.0.0/docker-compose.prod.yml`).
Then:

- add `LUKE_VERSION` = `3.0.0` to the environment: the file names no image
  version of its own, and the update is refused without it
  (`LUKE_VERSION not set`);
- add `S3_ROOT_USER` and `S3_ROOT_PASSWORD`, with the values from step 1; keep
  `MINIO_ROOT_USER` and `MINIO_ROOT_PASSWORD` until step 9. 3.0 no longer reads
  the stack variable `LUKE_TRUSTED_PROXY_CIDR`: the file sets the API's own from
  its `edge` subnet. Keep it until step 9 as well, since the rollback text reads it;
- update the stack, re-pulling the images. Recreating the containers takes the
  site down for a few tens of seconds; users are out anyway.

Expected:

- the proxy reaches the new web, and the web publishes no host port:

  ```bash
  docker exec "$NPM" curl -sI http://luke-web-1:3000 | head -1   # an HTTP status line
  docker port "$(svc web)"                                        # prints nothing
  ```

  The web may need a minute to start: repeat the first command until it answers.

- `docker logs "$(svc api)"` shows `prisma migrate deploy` applying the six new
  migrations, then the server starting; the container becomes healthy;
- the log also reports that the temporary-file cleanup failed with an error naming
  `storage.type` and `minio`: expected until step 6;
- images do not load, and uploads, exports with pictures and backups fail: also
  expected until step 6.

**Do not save `Impostazioni → Storage` now.** It shows `Filesystem locale`
because it cannot read `minio`. Saving it would point production at the API's
own disk.

## 5. Start a temporary MinIO

The new stack has no MinIO. A temporary container serves the old volume for the
copy. Two MinIO processes on one volume corrupt it, so remove any MinIO container
left over from the old stack first:

```bash
API=$(svc api); PG=$(svc postgres)   # the redeploy may have replaced them
docker ps -a --filter "label=com.docker.compose.project=$STACK" \
  --filter "label=com.docker.compose.service=minio" -q | xargs -r docker rm -f
docker ps -a --filter "label=com.docker.compose.project=$STACK" \
  --filter "label=com.docker.compose.service=minio-init" -q | xargs -r docker rm -f

read -rsp 'MinIO user: ' MINIO_ROOT_USER; echo; export MINIO_ROOT_USER
read -rsp 'MinIO password: ' MINIO_ROOT_PASSWORD; echo; export MINIO_ROOT_PASSWORD
docker run -d --name luke-minio-transition \
  --network "${STACK}_data" --network-alias minio \
  -v "${STACK}_minio_data:/data" \
  -e MINIO_ROOT_USER -e MINIO_ROOT_PASSWORD \
  "$MINIO_IMG" server /data
until docker exec "$API" wget -qO- http://minio:9000/minio/health/live >/dev/null 2>&1; do sleep 2; done
```

The last line waits until MinIO answers. `read -s` keeps the credentials out of
the shell history; `-e NAME` passes them from the environment without writing
them on the command line.

## 6. Copy first, switch second

Copy every file while `storage.type` is still `minio`: the copy script builds its
own providers from its options and never reads that key. Switching first would
leave the masters not yet copied looking missing, and the thumbnail worker would
spend its retries on them.

```bash
read -rsp 'S3_ROOT_USER: ' S3_ROOT_USER; echo; export S3_ROOT_USER
read -rsp 'S3_ROOT_PASSWORD: ' S3_ROOT_PASSWORD; echo; export S3_ROOT_PASSWORD
migrate() {
  docker exec -e MINIO_ROOT_USER -e MINIO_ROOT_PASSWORD -e S3_ROOT_USER -e S3_ROOT_PASSWORD "$API" sh -c '
    node dist-scripts/scripts/migrate-storage.js --from=s3 --to=s3 --fix-mime --include-backups \
      --from-s3-endpoint=minio --from-s3-port=9000 \
      --from-s3-access-key="$MINIO_ROOT_USER" --from-s3-secret-key="$MINIO_ROOT_PASSWORD" \
      --to-s3-endpoint=seaweedfs --to-s3-port=8333 \
      --to-s3-access-key="$S3_ROOT_USER" --to-s3-secret-key="$S3_ROOT_PASSWORD" "$@"' sh "$@"
}
migrate            # dry run: the summary lists what would be copied
migrate --apply    # "Migration completed: N files copied", no checksum errors
migrate            # dry run again: 0 files to copy
```

While it runs, the credentials are visible to anyone who can list the host's
processes: they sit in the script's arguments. `--include-backups` also copies the
in-app backups taken on 2.1.x, so they stay listed and restorable on 3.0.

Then switch, in `Impostazioni → Storage`:

- `Storage S3-compatibile`; endpoint `seaweedfs`, port `8333`, `HTTPS / TLS` off,
  region `us-east-1`;
- access key and secret key: the values of `S3_ROOT_USER` and `S3_ROOT_PASSWORD`;
- leave the public URL empty: 3.0 never hands the browser a storage address,
  every upload goes through the API. The page then warns that the public base
  URL is not set; ignore it. Leave the expiry times as they are;
- save, then `Testa connessione S3`: it tests the saved server.

Run `migrate` once more: still 0 files to copy.

## 7. Repairs, still in maintenance

Run each script dry first, read what it reports, then apply:

```bash
docker exec "$API" node dist-scripts/scripts/repair-auto-revision-photos.js
docker exec "$API" node dist-scripts/scripts/repair-auto-revision-photos.js --apply

docker exec -e TZ=Europe/Rome "$API" node dist-scripts/scripts/fix-allday-event-dates.js --dry-run
docker exec -e TZ=Europe/Rome "$API" node dist-scripts/scripts/fix-allday-event-dates.js

docker exec "$API" node dist-scripts/scripts/backfill-asset-derivatives.js --dry-run
docker exec "$API" node dist-scripts/scripts/backfill-asset-derivatives.js
```

- `repair-auto-revision-photos` copies into the immutable revisions bucket the
  photos that automatic revisions written by 2.0.0–2.1.x still point at in the
  live bucket. Every row photo replaced before it runs is one more lost photo:
  run it before users come back. It exits 0 only when nothing is left to repair.
- `fix-allday-event-dates` moves all-day events to the UTC midnight of the day a
  user in Rome picked. The image runs in UTC, hence `TZ=Europe/Rome`. Read the
  dry-run list: a row entered from another time zone is the one case it gets
  wrong. Applied, it also resyncs the affected Google calendars. Run it before
  users edit events.
- `backfill-asset-derivatives` generates the thumbnails of every image uploaded
  before 3.0. If it reports `No master waiting for derivatives: nothing to do.`,
  the thumbnail worker has already handled them since the boot, or given up on
  them (`FAILED`, attempts exhausted): the count below tells which, and the
  reset below covers the second case.

Then count the thumbnail states of the image masters:

```bash
docker exec -i "$PG" psql -U luke -d luke <<'SQL'
SELECT "derivativesStatus", count(*) FROM file_objects
WHERE "parentId" IS NULL
  AND bucket IN ('collection-row-pictures', 'brand-logos', 'company-assets', 'merchandising-specsheet-images')
GROUP BY 1;
SQL
```

Expect `READY` for nearly all of them; `FAILED` only for files that are not
decodable images. If a whole batch failed, read the API log for the cause, fix
it, then reset those rows and run the backfill again:

```sql
UPDATE file_objects SET "derivativesStatus" = 'PENDING', "derivativeAttempts" = 0
WHERE "parentId" IS NULL AND "derivativesStatus" = 'FAILED'
  AND bucket IN ('collection-row-pictures', 'brand-logos', 'company-assets', 'merchandising-specsheet-images');
```

## 8. Check and reopen

```bash
docker exec "$API" node dist-scripts/scripts/check-config-rows.js
```

It lists, by key only, the stored settings 3.0 no longer declares, such as
`storage.minio.*` and `storage.local.buckets`. Delete the ones under an allowed
prefix from `Manutenzione → Configurazioni`. For a key outside those prefixes,
decide what to do before deleting it with SQL. If it reports that `app.baseUrl`
is not stored, set it in `Impostazioni → Mail`: email links point at
`http://localhost:3000` until then.

It also lists, by key and message only, every stored value its setting refuses:
correct each from that setting's page. It exits 1 while any of these needs a
decision. Settings stored empty (`''`) are listed apart: that is how 2.1.6
recorded "not configured", and they are harmless.

Smoke test as an administrator: collection layout photos and thumbnails, a new
photo upload, a company logo upload (`Impostazioni → Azienda` → `Profilo` →
`Identità aziendale`), a PDF export with pictures, an in-app backup, the
calendar. The backup is written to SeaweedFS: its file there must have the size
the app recorded.

```bash
docker exec -i "$PG" psql -U luke -d luke -At <<'SQL'
SELECT filename, "sizeBytesEncrypted" FROM backup_records
WHERE status = 'COMPLETED' ORDER BY "createdAt" DESC LIMIT 1;
SQL
docker exec "$(svc seaweedfs)" sh -c 'echo "fs.ls -l /buckets/backups" | weed shell' | grep -F '<filename>'
```

Put the printed `filename` in place of `<filename>`: the listed size must equal
`sizeBytesEncrypted`.

Check the network once more: only the proxy and `luke-web-1` on `luke-proxy`.

```bash
docker network inspect luke-proxy --format '{{range .Containers}}{{.Name}} {{end}}'
```

From your workstation, not the host, with the app's tabs closed: the API must
count you, not a header you send. Between the two requests the counter drops
by one; run the same loop from a second machine, and its counter is its own.

```bash
for x in 1.1.1.1 2.2.2.2; do
  curl -s -o /dev/null -D - -H "X-Forwarded-For: $x" "http://<public hostname>/trpc/me.get" | grep -i x-ratelimit-remaining
done
```

Then `Manutenzione → Modalità Manutenzione` → `Termina`, and sign in once as a
user who is not an administrator.

## 9. Retire MinIO

```bash
migrate                                  # last dry run: 0 files to copy
docker rm -f luke-minio-transition
unset MINIO_ROOT_USER MINIO_ROOT_PASSWORD S3_ROOT_USER S3_ROOT_PASSWORD
```

After a period of normal use, remove `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`
and `LUKE_TRUSTED_PROXY_CIDR` from the stack's environment, and remove any
reverse-proxy host that forwards to MinIO (2.1.6's public storage URL): 3.0 has
no use for one, and it exposes the storage API. Then take the proxy off 2.1.6's
network and remove it, once nothing else is on it (in a new shell, set `STACK`
and `NPM` again as in step 2):

```bash
docker network disconnect "${STACK}_default" "$NPM"
docker network inspect "${STACK}_default" --format '{{range .Containers}}{{.Name}} {{end}}'   # must print nothing
docker network rm "${STACK}_default"
```

Deleting the volume `${STACK}_minio_data` is irreversible, and it is the owner's
call; until then it is the last copy of the files as 2.1.6 left them.

## 10. Rollback

Possible until users are back on 3.0 (step 8). Any later rollback loses what they
wrote on 3.0. Never touch the `${STACK}_api_data` volume: the master key lives
there.

In a new shell, set `STACK`, `svc`, `PG` and `NPM` again as in step 2, and `DUMP`
to the file written in step 3.

1. Remove the temporary MinIO, stop 3.0 and restore the dump:

   ```bash
   ls -l "$DUMP"                                   # the step 3 file, not empty
   docker rm -f luke-minio-transition 2>/dev/null
   docker ps -aq --filter name=luke-minio-transition   # must print nothing
   docker stop "$(svc api)" "$(svc web)"
   docker exec "$PG" psql -U luke -d luke -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'
   docker exec -i "$PG" pg_restore -U luke -d luke --no-owner --single-transaction < "$DUMP"
   ```

   The temporary MinIO must be gone before the next step: the 2.1.6 `minio`
   service starts on the same volume, and two MinIO processes on one volume
   corrupt it.
2. In Portainer, put back the stack text saved in step 3 (`luke-2.1.6-stack.yml`),
   not the repository's `v2.1.6` file, which production never ran. Its images
   are `2.1.6` (checked in step 3), and it does not read `LUKE_VERSION`. Update
   the stack. The web comes back on `${STACK}_default`, where the proxy still
   is; this lists both:

   ```bash
   docker network inspect "${STACK}_default" --format '{{range .Containers}}{{.Name}} {{end}}'
   ```

   MinIO comes back on its volume:
   the copy only read from it, apart from empty buckets its client may have
   created. The dump carries its own migration history, so the 2.1.6 API applies
   nothing at boot.
3. The 3.0 `seaweedfs` container may survive the update as an orphan, since the
   saved text does not declare it. It holds no 2.1.6 data:
   `svc seaweedfs | xargs -r docker rm -f`. The `luke-proxy` network can stay.
4. The dump was taken in maintenance, so 2.1.6 starts in maintenance:
   `Termina` once it is up.

# Clonare PROD su RC prima di una release

Procedura per far sì che il tag `vX.Y.Z-rc.N` venga validato contro dati reali di
produzione — non solo un database RC vuoto/stantio — **prima** di promuoverlo a
release stabile.

## Perché non un clone diretto del database

Un approccio "pull" ovvio sarebbe: rete condivisa tra gli stack Docker prod e RC,
un ruolo Postgres read-only su prod, e la master key di prod copiata sul volume
RC (così i valori cifrati in `AppConfig` restano leggibili). Scartato perché:

- la master key di prod (`~/.luke/secret.key`) non deve mai lasciare il suo
  volume — è la root of trust di tutta l'app (deriva `nextauth.secret`,
  `api.jwt`, `cookie.secret`, decifra ogni segreto in `AppConfig`). Copiarla su
  RC significa che compromettere RC ⊇ compromettere prod
- richiede una rete Docker condivisa tra i due stack, altrimenti isolati
- richiede una credenziale Postgres di prod residente in configurazione RC

Questo è esattamente ciò che fa oggi `scripts/refresh-rc-db.sh` (vedi commento
in testa al file) — tenuto in vita solo come fallback finché questo flusso non
è stato validato su `main`, poi da ritirare.

## L'alternativa: il sistema di backup/export/import esistente

`apps/api/src/lib/backup/` implementa già l'invariante che serve: un pacchetto
`.lukebak` portabile, la cui DEK è ri-wrappata con una passphrase (Argon2id)
invece che con la master key del server — decifrabile su qualunque istanza,
senza che nessuna master key attraversi il confine tra prod e RC.

`scripts/rc-prod-clone.ts` orchestra questo flusso via HTTP/tRPC — le stesse
API che userebbe un admin dalla dashboard, nessun accesso privilegiato in più:

1. Login su PROD (`auth.login`, credenziali chieste a runtime, mai salvate)
2. Crea un backup `DB` fresco (o riusa uno esistente con `--backup-id`)
3. `maintenance.backup.prepareExport` con una passphrase generata a caso dallo
   script (mai stampata, mai riusata) → scarica il pacchetto `.lukebak` dal
   link firmato a scadenza breve
4. Login su RC, upload del pacchetto su `/maintenance/backup/import`
5. `checkRestoreCompatibility` sullo schema:
   - **OLDER** → `runMigrationBridge`: applica le migration pendenti di questa
     release in un database temporaneo disposable, **senza toccare il database
     reale di RC** — è questo lo step che prova concretamente che le migration
     si applicano bene a dati veri di prod
   - **SAME** → si procede diretti al restore
   - **NEWER_OR_UNKNOWN** → blocco duro, nessun bypass (stessa regola che
     applica il prodotto stesso)
6. Conferma interattiva (skippabile con `--yes`) + `backup.restore` sul
   database reale di RC

Nessuna rete condivisa, nessuna credenziale Postgres di prod in RC, nessuna
master key che esce dal suo volume — attraversa il confine solo un file
cifrato + una passphrase generata ad-hoc, entrambi scartati a fine run.

## Prerequisiti

- Backup system disponibile su entrambe le istanze (prod e RC)
- Un account admin su **prod** con permessi `maintenance:read`,
  `maintenance:backup_create`, `maintenance:backup_export`
- Un account admin su **RC** con permessi `maintenance:read`,
  `maintenance:backup_restore`
- `@luke/api` e `@trpc/client` installati alla root (`pnpm install`)

## Uso

```bash
pnpm rc:clone --prod-url https://luke.example.com --rc-url http://rc.luke.febos.local
```

Opzioni:

| Flag | Default | Note |
|---|---|---|
| `--backup-id <id>` | crea un backup nuovo | riusa un backup PROD già completato |
| `--label <text>` | `rc-clone-<timestamp>` | etichetta del backup creato/importato |
| `--restore-files` | `false` | replica anche gli oggetti storage (bucket) |
| `--wipe-audit-log` | `false` | di default l'audit log corrente di RC viene preservato |
| `--yes` | `false` | salta la conferma interattiva pre-restore |

`--prod-url`/`--rc-url` sono sempre obbligatori (niente env var equivalenti:
`process.env.*` diretto è vietato fuori da `apps/api/scripts/**`, vedi
`.semgrep/rules/no-direct-env.yml`).

Username/password vengono chiesti in modo interattivo (password mai
echeggiata) — mai passarli come argomento CLI, finirebbero nella history della
shell.

## Limitazioni note

- I valori sensibili di `AppConfig` (password LDAP/SMTP) restano cifrati a
  livello colonna con la master key di **prod** (cifratura indipendente dalla
  DEK del backup, vedi `apps/api/src/lib/configManager.ts`). Dopo il restore,
  leggerli su RC lancia un errore a runtime nel punto d'uso (non al boot) —
  voluto: RC non può mai riusare in modo silente le credenziali reali di prod
  verso sistemi esterni. Da reimpostare a mano con valori RC-appropriati se
  serve LDAP/SMTP funzionante su RC.
- Il pacchetto `.lukebak` viene bufferizzato interamente in memoria in fase di
  upload (nessun client multipart streaming in scope). Accettabile per backup
  `DB`-only; da rivedere se mai esteso a `DB_AND_FILES`.

## Relazione con `refresh-rc-db.sh`

I due script coesistono temporaneamente. `refresh-rc-db.sh` resta il fallback
operativo finché questo flusso — che dipende dal sistema di backup, non ancora
su `main` — non è stato usato con successo in almeno una release reale.
Deprecare/rimuovere `refresh-rc-db.sh` è una decisione separata, da prendere
solo dopo quella validazione.

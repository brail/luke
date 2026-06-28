# apps/web — Frontend Luke

<!-- luke-docs:start:overview -->
Interfaccia utente web di Luke, costruita su Next.js con App Router, shadcn/ui e Tailwind CSS. Copre l'intera piattaforma gestionale — dal piano campionario alle statistiche di vendita — con RBAC granulare, temi light/dark e supporto Playwright per i test end-to-end.
<!-- luke-docs:end:overview -->

## Route principali

<!-- luke-docs:start:routes -->
Gruppo autenticato `(app)/`:

- `/dashboard` — Dashboard con widget configurabili per utente (KPI, avanzamento stagione, orologi, forex, ordini settimanali, attività personali)
- `/admin/brands` — Gestione brand
- `/admin/seasons` — Gestione stagioni
- `/admin/vendors` — Gestione fornitori
- `/admin/calendar-configuration` — Configurazione calendario milestones stagionale
- `/admin/collection-layout-configuration` — Configurazione colonne del layout collezione
- `/calendar` — Calendario milestones e scadenze stagionali (con sync Google Calendar)
- `/product/collection-layout` — Piano campionario (layout a righe e gruppi, revisioni, quote)
- `/product/merchandising-plan` — Piano merchandising con specsheet e immagini
- `/product/pricing` — Motore di calcolo prezzi (forward / inverse / margin)
- `/sales/statistics` — Statistiche portafoglio ordini (replica NAV in tempo reale)
- `/settings/users` — Gestione utenti e ruoli
- `/settings/mail` — Configurazione SMTP con test email
- `/settings/ldap` — Autenticazione LDAP enterprise con test connessione
- `/settings/storage` — Provider storage (locale / MinIO)
- `/settings/nav` — Connessione SQL Server NAV
- `/settings/nav-sync` — Controllo e log sincronizzazione NAV
- `/settings/google` — Integrazione Google Calendar (flusso OAuth 2.0)
- `/settings/company` — Profilo azienda
- `/maintenance/config` — Gestione chiavi AppConfig (configurazione runtime centralizzata)
- `/maintenance/import-export` — Import/export dati
- `/profile` — Profilo e preferenze utente

Gruppo pubblico `(public)/`:

- `/login` — Pagina di login (locale / LDAP)
- `/auth/reset` — Reset password via token email
- `/auth/verify` — Verifica indirizzo email
- `/auth/pending` — Schermata di attesa post-verifica
<!-- luke-docs:end:routes -->

## Dipendenze interne

<!-- luke-docs:start:internal-deps -->
- `@luke/core` — Schemi Zod, tipi condivisi, RBAC, URL builder, storage types
- `@luke/calendar` — Tipi e funzioni condivisi per il calendario milestones
<!-- luke-docs:end:internal-deps -->

## Variabili d'ambiente

<!-- luke-docs:start:env -->
| Variabile | Descrizione | Richiesta |
|-----------|-------------|-----------|
| `INTERNAL_API_URL` | URL interno per i Next.js rewrites verso l'API (es. `http://api:3001`) | Sì |
| `NEXT_PUBLIC_API_URL` | URL pubblico dell'API, baked nel bundle client (es. `http://localhost:3001`) | Sì |
| `NEXT_PUBLIC_FRONTEND_URL` | URL pubblico del frontend, usato per i link nelle email | Sì |
| `NEXTAUTH_URL` | URL canonico del frontend per NextAuth (es. `http://localhost:3000`) | Sì |
| `NEXTAUTH_SECRET` | Secret NextAuth — derivato automaticamente dalla master key `~/.luke/secret.key` | Sì |
| `COOKIE_SECURE` | `true` in produzione (HTTPS), `false` in sviluppo (HTTP) | No |

Tutte le altre configurazioni (SMTP, LDAP, storage, ecc.) vivono in AppConfig (database), non in variabili d'ambiente.
<!-- luke-docs:end:env -->

## Sviluppo locale

<!-- luke-docs:start:dev -->
```bash
# Dalla root del monorepo (avvia tutti i workspace via Turbo)
pnpm dev

# Solo il frontend
pnpm --filter @luke/web dev
```

Il frontend è disponibile su `http://localhost:3000`.
Richiede l'API attiva su `http://localhost:3001`.

Per i test E2E (Playwright):

```bash
pnpm --filter @luke/web test:e2e
```
<!-- luke-docs:end:dev -->

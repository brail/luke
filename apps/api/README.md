# Luke API

API server per Luke con tRPC, Prisma, autenticazione e sicurezza avanzata.

## Security Headers

L'API implementa una baseline completa di HTTP security headers tramite Helmet, configurata centralmente in `src/lib/helmet.ts`.

### Configurazione per Ambiente

| Header                      | Valore                                                        | Dev | Test | Prod |
| --------------------------- | ------------------------------------------------------------- | --- | ---- | ---- |
| `X-Content-Type-Options`    | `nosniff`                                                     | ✅  | ✅   | ✅   |
| `Referrer-Policy`           | `no-referrer`                                                 | ✅  | ✅   | ✅   |
| `X-DNS-Prefetch-Control`    | `off`                                                         | ✅  | ✅   | ✅   |
| `X-Frame-Options`           | `DENY`                                                        | ✅  | ✅   | ✅   |
| `Content-Security-Policy`   | `default-src 'none'; frame-ancestors 'none'; base-uri 'none'` | ❌  | ✅   | ✅   |
| `Strict-Transport-Security` | `max-age=15552000; includeSubDomains`                         | ❌  | ❌   | ✅   |

### Policy di Sicurezza

- **CSP**: Configurazione minimale per API JSON-only, disabilitata in development
- **HSTS**: Solo in produzione con 180 giorni di durata
- **Frame Protection**: Blocco completo embedding in iframe
- **Content Type**: Prevenzione MIME sniffing
- **Referrer**: Nessuna informazione referrer esposta
- **DNS Prefetch**: Disabilitato per prevenire leak DNS

### Test di Verifica

I security headers sono verificati automaticamente tramite test end-to-end:

```bash
pnpm -F @luke/api test security.headers.spec.ts
```

I test verificano:

- Presenza di tutti gli header base
- Configurazione CSP corretta per ambiente
- Assenza HSTS in test/development
- Snapshot invariabile della configurazione

## Sviluppo

```bash
# Installazione dipendenze
pnpm install

# Avvio in development
pnpm -F @luke/api dev

# Test
pnpm -F @luke/api test

# Build
pnpm -F @luke/api build
```

## Endpoints

- **Health**: `/api/health` - Status dell'API
- **Liveness**: `/livez` - Kubernetes liveness probe
- **Readiness**: `/readyz` - Kubernetes readiness probe
- **tRPC**: `/trpc` - Endpoint principale tRPC

## Configurazione

L'API supporta configurazione tramite:

- Variabili d'ambiente
- Database configuration (tramite tRPC)
- File di configurazione

Vedi `src/lib/config.ts` per dettagli.

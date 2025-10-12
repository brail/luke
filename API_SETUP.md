# Luke API - Setup e Utilizzo

## 🚀 Avvio Rapido

### 1. Installazione Dipendenze

```bash
pnpm install
```

### 2. Generazione Prisma Client

```bash
pnpm --filter @luke/api prisma:generate
```

### 3. Setup Database e Seed

```bash
pnpm --filter @luke/api seed
```

### 4. Avvio Server

```bash
pnpm --filter @luke/api dev
```

Il server sarà disponibile su `http://localhost:3001`

## 📊 Endpoint Disponibili

### Health Check

```bash
curl http://localhost:3001/api/health
```

### Root

```bash
curl http://localhost:3001/
```

## 🔗 tRPC Endpoints

### Users Router

#### Lista Utenti

```bash
curl "http://localhost:3001/trpc/users.list?input=%7B%7D"
```

#### Crea Utente

```bash
curl -X POST http://localhost:3001/trpc/users.create \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","username":"user","password":"password123","role":"viewer"}'
```

#### Ottieni Utente per ID

```bash
curl "http://localhost:3001/trpc/users.getById?input=%7B%22id%22%3A%22USER_ID%22%7D"
```

#### Aggiorna Utente

```bash
curl -X POST http://localhost:3001/trpc/users.update \
  -H "Content-Type: application/json" \
  -d '{"id":"USER_ID","email":"newemail@example.com","role":"editor"}'
```

#### Elimina Utente (Soft Delete)

```bash
curl -X POST http://localhost:3001/trpc/users.delete \
  -H "Content-Type: application/json" \
  -d '{"id":"USER_ID"}'
```

### Config Router

#### Lista Configurazioni

```bash
curl "http://localhost:3001/trpc/config.list?input=%7B%22decrypt%22%3Atrue%7D"
```

#### Ottieni Configurazione

```bash
curl "http://localhost:3001/trpc/config.get?input=%7B%22key%22%3A%22app.name%22%7D"
```

#### Imposta Configurazione

```bash
curl -X POST http://localhost:3001/trpc/config.set \
  -H "Content-Type: application/json" \
  -d '{"key":"app.name","value":"Luke","encrypt":false}'
```

#### Imposta Configurazione Cifrata

```bash
curl -X POST http://localhost:3001/trpc/config.set \
  -H "Content-Type: application/json" \
  -d '{"key":"secret.key","value":"secret-value","encrypt":true}'
```

#### Elimina Configurazione

```bash
curl -X POST http://localhost:3001/trpc/config.delete \
  -H "Content-Type: application/json" \
  -d '{"key":"config.key"}'
```

## 🔑 Credenziali Admin

Dopo il seed, è disponibile un utente admin:

- **Email**: `admin@luke.local`
- **Username**: `admin`
- **Password**: `changeme`
- **Ruolo**: `admin`

⚠️ **IMPORTANTE**: Cambia la password admin al primo login!

## 🗄️ Database

### Prisma Studio

Per visualizzare e modificare il database tramite UI:

```bash
pnpm --filter @luke/api prisma:studio
```

Disponibile su `http://localhost:5555`

### Reset Database

Per resettare completamente il database:

```bash
rm apps/api/prisma/dev.db*
pnpm --filter @luke/api seed
```

## 🔐 Sicurezza

### Master Key

La master key per la cifratura è salvata in `~/.luke/secret.key` (chmod 600).

### Password Hashing

Le password sono hashate con **argon2id** (time cost: 3, memory: 65536).

### Cifratura Configurazioni

I valori sensibili sono cifrati con **AES-256-GCM**.

## 🏗️ Architettura

### Modelli Database

- **User**: Utenti del sistema con ruoli RBAC
- **Identity**: Identità multi-provider (LOCAL, LDAP, OIDC)
- **LocalCredential**: Credenziali locali con hash password
- **AppConfig**: Configurazioni con supporto cifratura
- **AuditLog**: Log delle azioni (futuro)

### Router tRPC

- **users**: CRUD completo per gestione utenti
- **config**: Gestione configurazioni con cifratura

### Sicurezza

- **Helmet**: Security headers
- **CORS**: Cross-origin requests
- **Pino**: Logging strutturato
- **Graceful shutdown**: Chiusura pulita

## 🚧 Prossimi Passi

1. **Autenticazione JWT**: Middleware per proteggere endpoint
2. **Rate Limiting**: Protezione da abusi
3. **Audit Log**: Logging automatico delle azioni
4. **Validazione Input**: Middleware per validazione avanzata
5. **Testing**: Suite di test unitari e integrazione

## 🐛 Troubleshooting

### Errore "Master key deve essere di 32 bytes"

```bash
rm ~/.luke/secret.key
pnpm --filter @luke/api seed
```

### Errore "Database locked"

```bash
# Ferma il server e riavvia
pnpm --filter @luke/api dev
```

### Errore "Port 3001 already in use"

```bash
# Cambia porta o ferma processo esistente
PORT=3002 pnpm --filter @luke/api dev
```

## 📝 Note

- Il server usa **SQLite** per sviluppo, **PostgreSQL** per production
- Tutti gli endpoint sono **pubblici** (autenticazione da implementare)
- Le query tRPC usano **GET**, le mutation usano **POST**
- Il formato tRPC è compatibile con client TypeScript end-to-end

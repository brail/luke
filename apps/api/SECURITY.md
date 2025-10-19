# Security & Audit Documentation

## AuditLog System

### Overview

Il sistema AuditLog di Luke registra tutte le operazioni sensibili per garantire tracciabilità, compliance e sicurezza. Ogni azione viene loggata con metadati redatti per evitare esposizione di dati sensibili.

### Schema Database

```sql
CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  actorId TEXT,           -- ID utente che ha eseguito l'azione (NULL per eventi sistema)
  action TEXT NOT NULL,   -- Azione in SCREAMING_SNAKE_CASE
  targetType TEXT NOT NULL, -- Tipo risorsa (User, Config, Auth)
  targetId TEXT,          -- ID risorsa target (opzionale)
  result TEXT NOT NULL,   -- SUCCESS o FAILURE
  metadata JSON,          -- Metadati redatti
  traceId TEXT,           -- Correlazione con log Pino
  ip TEXT,                -- IP client
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Mappatura Azioni

| Azione                   | targetType       | targetId                | Descrizione                    |
| ------------------------ | ---------------- | ----------------------- | ------------------------------ |
| USER_CREATE              | User             | userId                  | Creazione utente               |
| USER_UPDATE              | User             | userId                  | Modifica profilo/ruolo         |
| USER_DELETE              | User             | userId                  | Soft delete (isActive=false)   |
| USER_HARD_DELETE         | User             | userId                  | Eliminazione definitiva        |
| USER_PASSWORD_CHANGE     | User             | userId                  | Cambio password self-service   |
| USER_UPDATE_PROFILE      | User             | userId                  | Aggiornamento profilo utente   |
| USER_UPDATE_TIMEZONE     | User             | userId                  | Cambio timezone utente         |
| USER_REVOKE_SESSIONS     | User             | userId                  | Revoca sessioni utente         |
| USER_REVOKE_ALL_SESSIONS | User             | userId                  | Revoca tutte le sessioni       |
| AUTH_LOGIN               | Auth             | userId                  | Login riuscito                 |
| AUTH_LOGIN_FAILED        | Auth             | null                    | Login fallito                  |
| AUTH_LOGOUT_ALL          | Auth             | userId                  | Logout da tutti i dispositivi  |
| CONFIG_UPSERT            | AppConfig/Config | configKey o 'auth.ldap' | Creazione/aggiornamento config |
| CONFIG_DELETE            | Config           | null                    | Eliminazione config            |
| CONFIG_VIEW_VALUE        | Config           | null                    | Visualizzazione valore raw     |

### Policy di Redazione

#### Campi MAI loggati in chiaro

- `password*`, `token*`, `secret*`, `key*`, `authorization`, `credentials`, `bindDN`, `bindPassword`, `apiKey`
- Pattern case-insensitive: `/password|token|secret|key|auth|credential|bind/i`

#### Campi sicuri (whitelist)

- `username`, `email`, `role`, `action`, `timestamp`, `provider`
- `success`, `reason`, `key`, `isEncrypted`, `locale`, `timezone`
- `firstName`, `lastName`, `isActive`, `strategy`, `userAgent`
- `createdAt`, `updatedAt`, `lastLoginAt`, `loginCount`

#### Approccio secure-by-default

- **Whitelist**: Solo campi esplicitamente sicuri sono preservati
- **Blacklist**: Pattern sensibili sono sempre redatti
- **Default**: Chiavi non whitelisted sono redatte come `[REDACTED]`
- **Profondità**: Max 5 livelli nested (DoS protection)

### Query Operative per SRE

#### Ultimi eventi sensibili

```sql
SELECT id, action, actorId, targetType, targetId, result, createdAt
FROM audit_logs
WHERE action IN (
  'USER_CREATE','USER_UPDATE','USER_DELETE','USER_HARD_DELETE',
  'USER_PASSWORD_CHANGE','AUTH_LOGIN','AUTH_LOGIN_FAILED',
  'CONFIG_UPSERT','CONFIG_DELETE'
)
ORDER BY createdAt DESC
LIMIT 50;
```

#### Audit leak detection (euristica)

```sql
SELECT id, action, targetType, createdAt
FROM audit_logs
WHERE metadata LIKE '%password%'
   OR metadata LIKE '%token%'
   OR metadata LIKE '%secret%'
   OR metadata LIKE '%authorization%'
   OR metadata LIKE '%bindPassword%'
   OR metadata LIKE '%apiKey%';
```

#### Login failures per IP (brute-force detection)

```sql
SELECT ip, COUNT(*) as attempts, MAX(createdAt) as last_attempt
FROM audit_logs
WHERE action = 'AUTH_LOGIN_FAILED'
  AND createdAt > datetime('now', '-1 hour')
GROUP BY ip
HAVING attempts > 5
ORDER BY attempts DESC;
```

#### Attività admin nelle ultime 24h

```sql
SELECT a.action, a.targetType, a.targetId, a.result, a.createdAt,
       u.username as actor_username, u.email as actor_email
FROM audit_logs a
LEFT JOIN users u ON a.actorId = u.id
WHERE a.createdAt > datetime('now', '-1 day')
  AND (a.action LIKE 'USER_%' OR a.action LIKE 'CONFIG_%')
ORDER BY a.createdAt DESC;
```

#### Eventi di sicurezza (login failures, revoke sessions)

```sql
SELECT action, targetType, actorId, ip, createdAt, metadata
FROM audit_logs
WHERE action IN ('AUTH_LOGIN_FAILED', 'USER_REVOKE_SESSIONS', 'USER_REVOKE_ALL_SESSIONS')
  AND createdAt > datetime('now', '-7 days')
ORDER BY createdAt DESC;
```

#### Configurazioni modificate

```sql
SELECT action, targetType, actorId, createdAt, metadata
FROM audit_logs
WHERE action LIKE 'CONFIG_%'
  AND createdAt > datetime('now', '-30 days')
ORDER BY createdAt DESC;
```

#### Audit modifiche LDAP aggregate

```sql
SELECT action, targetId, actorId, result, createdAt, metadata
FROM audit_logs
WHERE targetId = 'auth.ldap'
ORDER BY createdAt DESC;
```

### Tracciabilità Obbligatoria

#### Campi sempre presenti

- **`actorId`**: ID utente per azioni autenticate; `NULL` per eventi sistema/pubblici
- **`traceId`**: Correlazione con log Pino (header `X-Luke-Trace-Id`)
- **`ip`**: Indirizzo IP client (proxy-aware via Fastify `req.ip`)
- **`result`**: Esplicito `SUCCESS` o `FAILURE` per compliance

#### Correlazione con log

```bash
# Trova tutti i log per un traceId specifico
grep "traceId:abc123" /var/log/luke/api.log

# Correla audit log con application log
SELECT a.*, l.message
FROM audit_logs a
LEFT JOIN application_logs l ON a.traceId = l.traceId
WHERE a.traceId = 'abc123';
```

### Compliance & Retention

#### GDPR

- **AuditLog escluso** da "right to erasure" (legitimate interest art. 17.3.e)
- Dati di audit sono necessari per sicurezza e compliance
- Retention policy: da definire (raccomandato 7 anni per compliance)

#### Indici ottimizzati

```sql
-- Per query temporali
CREATE INDEX idx_audit_created_at ON audit_logs(createdAt DESC);

-- Per query per attore
CREATE INDEX idx_audit_actor_created ON audit_logs(actorId, createdAt DESC);

-- Per query per azione
CREATE INDEX idx_audit_action_created ON audit_logs(action, createdAt DESC);

-- Per query per tipo risorsa
CREATE INDEX idx_audit_target ON audit_logs(targetType, targetId);
```

### Monitoring & Alerting

#### Metriche chiave

- **Login failures per IP**: > 5 in 1 ora → alert
- **Admin actions**: Tutte le azioni admin → log
- **Config changes**: Modifiche configurazione → alert
- **Audit leak detection**: Query euristica → alert critico

#### Dashboard raccomandati

1. **Security Events**: Login failures, session revokes
2. **Admin Activity**: Tutte le azioni admin con dettagli
3. **Config Changes**: Timeline modifiche configurazione
4. **Audit Health**: Volume eventi, errori logging

### Troubleshooting

#### Audit log non vengono creati

1. Verifica connessione database
2. Controlla log applicazione per errori `logAudit`
3. Verifica middleware `withAuditLog` applicato
4. Testa con query diretta: `SELECT COUNT(*) FROM audit_logs;`

#### Performance issues

1. Verifica indici database
2. Monitora volume eventi (rate limiting se necessario)
3. Considera archiviazione eventi vecchi
4. Ottimizza query con `EXPLAIN QUERY PLAN`

#### Data leak detection

1. Esegui query leak detection regolarmente
2. Se trovi leak, investiga immediatamente
3. Considera rollback se necessario
4. Aggiorna policy redazione se necessario

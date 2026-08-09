# ADR-001: JWT HS256 con Derivazione HKDF-SHA256

## Status

**Accepted** - 2024-01-XX

## Context

Il progetto Luke richiede un sistema di autenticazione enterprise-grade con le seguenti caratteristiche:

- **Gestione segreti centralizzata**: Un singolo punto di controllo per tutti i segreti JWT
- **Rotazione semplice**: Possibilità di invalidare tutti i token con un'operazione
- **Sicurezza crittografica**: Algoritmi standard e best practices
- **Isolamento domini**: Separazione tra API backend e web sessions
- **Zero storage DB**: Nessun segreto salvato in database

Il sistema deve gestire due tipi di token:

1. **API JWT**: Per autenticazione backend (tRPC, Fastify)
2. **NextAuth JWT**: Per sessioni web (Next.js, cookies)

## Decision

Abbiamo adottato una strategia basata su **HS256 + HKDF-SHA256** con le seguenti caratteristiche:

### Algoritmo e Configurazione

- **Algoritmo**: HS256 (HMAC-SHA256) esplicito
- **Clock tolerance**: ±5 secondi (NTP skew, riduce finestra replay)
- **Claim standard**: `iss: 'urn:luke'`, `aud: 'luke.api'`, `exp`, `nbf`
- **TTL**: 8 ore per entrambi i tipi di token (sincronizzazione perfetta)

### Derivazione Segreti

- **Master Key**: File `~/.luke/secret.key` (32 bytes, permessi 0600)
- **Derivazione**: HKDF-SHA256 (RFC 5869) con parametri:
  - Salt: `'luke'`
  - Info domains: `'api.jwt'` e `'nextauth.secret'`
  - Length: 32 bytes (256 bits)
- **Formato output**: Base64URL per compatibilità

### Isolamento Domini

```typescript
// API Backend
const apiSecret = deriveSecret('api.jwt');

// Web Sessions
const nextAuthSecret = deriveSecret('nextauth.secret');

// Fastify Cookies
const cookieSecret = deriveSecret('cookie.secret');
```

### Rotazione Segreti

Per invalidare tutti i token:

1. Elimina `~/.luke/secret.key`
2. Riavvia applicazione → nuova master key generata
3. Tutti i token esistenti diventano invalidi

## Consequences

### ✅ Vantaggi

- **Rotazione semplice**: Un'operazione invalida tutti i token
- **Zero storage DB**: Nessun segreto in database
- **Determinismo**: Stesso host → stesso secret tra riavvii
- **Isolamento perfetto**: Compromissione NextAuth non compromette API
- **Enterprise-grade**: Algoritmi standard e best practices
- **Fail-fast**: Server termina se master key non accessibile

### ⚠️ Trade-off

- **Secret condiviso**: HS256 vs asimmetrico RS256 (accettabile per monorepo)
- **Invalidazione blocco**: Rotazione master key invalida TUTTI i token
- **Dipendenza file system**: Master key deve essere accessibile
- **Clock sync**: Richiede sincronizzazione orario tra client/server

### 🔧 Implicazioni Operative

- **Deploy**: Master key deve essere presente su tutti i server
- **Backup**: Master key NON deve essere in backup (sicurezza)
- **Monitoring**: Verificare accessibilità master key in health check
- **Development**: Master key creata automaticamente al primo avvio

## Implementazione

### File Chiave

- **Derivazione**: `packages/core/src/crypto/secrets.server.ts`
- **JWT Helper**: `apps/api/src/lib/jwt.ts`
- **Configurazione**: `README.md:107-119`

### Esempio Utilizzo

```typescript
// ✅ Corretto - Server-side
import { getApiJwtSecret } from '@luke/core/server';

const secret = getApiJwtSecret();
const token = jwt.sign(payload, secret, { algorithm: 'HS256' });
```

```typescript
// ❌ Errore - Client-side
import { getApiJwtSecret } from '@luke/core/server';
// Runtime error: "secrets.server.ts può essere importato solo server-side"
```

### Health Check

```typescript
// Verifica master key in readiness probe
export function validateMasterKey(): boolean {
  try {
    const masterKey = getMasterKey();
    return masterKey.length === 32;
  } catch {
    return false;
  }
}
```

## Alternative Considerate

### RS256 (Asimmetrico)

- ❌ Complessità gestione chiavi pubbliche/private
- ❌ Rotazione più complessa
- ❌ Performance inferiore per verifica

### Segreti in Database

- ❌ Rischio di compromissione DB
- ❌ Complessità rotazione
- ❌ Performance overhead

### Environment Variables

- ❌ Gestione manuale per ogni deploy
- ❌ Rischio di leakage in log/config
- ❌ Nessuna derivazione deterministica

## References

- [RFC 5869 - HKDF](https://tools.ietf.org/html/rfc5869)
- [JWT Best Practices](https://tools.ietf.org/html/rfc8725)
- [HMAC-SHA256](https://tools.ietf.org/html/rfc4868)
- Implementazione: `apps/api/src/lib/jwt.ts`
- Derivazione: `packages/core/src/crypto/secrets.server.ts`
- Documentazione: `README.md:107-119`

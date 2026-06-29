# ADR-009 — TokenVersion Multi-Layer Session Invalidation

## Status

Accepted

## Contesto

I JWT sono stateless per design: una volta emesso, un token è valido fino alla scadenza naturale (8h) anche se l'utente viene bannato, cambia password, o un admin revoca le sue sessioni. Questo crea una finestra di accesso incontrollato fino a 8 ore.

Il requisito era: invalidazione immediata (< 1s) in tutti questi scenari:
- Admin revoca sessioni di un utente
- Utente cambia password
- Hard logout (`auth.logoutAll`)
- Admin disabilita un account

Un approccio blocklist JWT introduce overhead su ogni request e complessità di cleanup. L'approccio session-token in DB richiede query per ogni chiamata autenticata.

## Decisione

Introduzione di `tokenVersion` — un contatore intero su `User` — verificato a 4 layer indipendenti.

### Meccanismo base

`tokenVersion` è baked nel JWT al momento dell'emissione. Ad ogni request protetta, il server confronta `jwt.tokenVersion` con `user.tokenVersion` dal DB (con cache 5min per-request). Se divergono → 401.

Per invalidare tutte le sessioni di un utente: `user.tokenVersion += 1`. Tutti i token emessi precedentemente diventano immediatamente invalidi.

### 4 Layer di verifica

| Layer | Dove | Trigger |
|-------|------|---------|
| **API Middleware** | `apps/api/src/lib/permissions.ts` | Ogni chiamata tRPC protetta |
| **NextAuth Callback** | `apps/web/src/app/api/auth/[...nextauth]` | Refresh JWT (ogni 4h) — ritorna `null` → logout automatico |
| **Next.js Middleware** | `apps/web/src/middleware.ts` | Navigazione tra pagine |
| **Client Hook** | `apps/web/src/hooks/use-session-verification.ts` | Polling ogni 10s + focus/visibility change |

### Invalidazione immediata

- **Cache API**: invalidata in < 1ms su write di `tokenVersion`
- **Client**: il polling ogni 10s garantisce redirect in < 10s dopo revoca
- **Navigazione**: il middleware Next.js blocca la navigazione server-side immediatamente

### Scenari che incrementano `tokenVersion`

- `me.revokeAllSessions` — utente revoca le proprie sessioni
- `users.admin.revokeUserSessions` — admin revoca sessioni di altri
- Cambio password (`auth.changePassword`)
- Hard logout (`auth.logoutAll`)

## Conseguenze

- Ogni operazione di revoca sessioni richiede un write su `User.tokenVersion` — non può essere dimenticato in nuovi endpoint di "logout" o "revoca"
- La cache 5min è un trade-off deliberato: riduce i DB hit su API ad alto traffico al costo di un ritardo massimo di 5min per la propagazione (accettabile perché il client-side hook copre il gap)
- Aggiungere un nuovo scenario di invalidazione richiede di incrementare `tokenVersion` — è sufficiente, non servono altre operazioni
- Il NextAuth callback deve rimanere sincronizzato con la logica API: se uno dei due smette di verificare `tokenVersion`, un layer cade silenziosamente

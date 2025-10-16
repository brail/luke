/**
 * Modulo per autenticazione LDAP
 * Gestisce connessione, ricerca utenti e mapping ruoli
 */
import type { PrismaClient, User } from '@prisma/client';
/**
 * Autentica un utente via LDAP
 * @param prisma - Client Prisma
 * @param username - Username dell'utente
 * @param password - Password dell'utente
 * @returns User object se autenticazione riuscita, null altrimenti
 */
export declare function authenticateViaLdap(prisma: PrismaClient, username: string, password: string): Promise<User | null>;
//# sourceMappingURL=ldapAuth.d.ts.map
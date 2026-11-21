import { Client } from 'pg';

// ok: luke-ldap-client-options
export const postgres = new Client({ connectionString: 'postgres://localhost/db' });

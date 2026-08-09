import { defineConfig } from 'prisma/config';

export default defineConfig({
  datasource: {
    url: process.env.DATABASE_URL,
    // Serve solo a `prisma migrate diff --from-migrations`, usato in CI per
    // rilevare il drift fra prisma/migrations e schema.prisma. Non impostata
    // in runtime applicativo: resta undefined e nessun comando la richiede.
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
});

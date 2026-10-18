import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma',
  datasource: {
    url: process.env.DATABASE_URL,
    // Used only by `prisma migrate diff --from-migrations`, which CI runs to
    // detect drift between prisma/migrations and the .prisma files. Not set in
    // the application runtime: it stays undefined and no command needs it.
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
});

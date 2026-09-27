declare function fp(plugin: unknown, options?: unknown): unknown;
declare const rateLimit: unknown;

interface App {
  register(plugin: unknown, options?: unknown): void;
}

export const leaky = fp(async (app: App) => {
  // ruleid: luke-fastify-plugin-leak
  app.register(rateLimit, { max: 30 });
});

export async function scoped(app: App) {
  // ok: luke-fastify-plugin-leak
  app.register(rateLimit, { max: 30 });
}

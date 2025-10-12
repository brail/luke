import Fastify from 'fastify';

const fastify = Fastify({
  logger: true,
});

// Declare a route
fastify.get('/', async (request, reply) => {
  return { message: 'Luke API is running!' };
});

// Run the server!
const start = async () => {
  try {
    await fastify.listen({ port: 3001, host: '0.0.0.0' });
    console.log('🚀 Luke API server listening on http://localhost:3001');
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();

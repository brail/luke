export default function Home() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-4xl mx-auto text-center p-8">
        <h1 className="text-6xl font-bold text-gray-900 mb-6">🚀 Luke Web</h1>
        <p className="text-xl text-gray-600 mb-8">
          Next.js 15 + shadcn/ui + TypeScript
        </p>
        <p className="text-lg text-gray-500 mb-12">
          Monorepo enterprise con pnpm + Turborepo
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-12">
          <div className="bg-white p-6 rounded-lg shadow-md">
            <h3 className="text-lg font-semibold mb-3">🌐 Frontend</h3>
            <p className="text-gray-600 mb-4">Next.js 15 con App Router</p>
            <a
              href="http://localhost:3000"
              className="inline-block px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
            >
              Vai al Frontend
            </a>
          </div>

          <div className="bg-white p-6 rounded-lg shadow-md">
            <h3 className="text-lg font-semibold mb-3">🚀 API</h3>
            <p className="text-gray-600 mb-4">Fastify 5 + tRPC + Prisma</p>
            <a
              href="http://localhost:3001"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 transition-colors"
            >
              Vai all&apos;API
            </a>
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow-md">
          <h3 className="text-lg font-semibold mb-4">✅ Setup Completato</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
            <div className="flex items-center">
              <span className="text-green-500 mr-2">✓</span>
              TypeScript strict mode
            </div>
            <div className="flex items-center">
              <span className="text-green-500 mr-2">✓</span>
              ESLint + Prettier + Husky
            </div>
            <div className="flex items-center">
              <span className="text-green-500 mr-2">✓</span>
              Turborepo caching
            </div>
            <div className="flex items-center">
              <span className="text-green-500 mr-2">✓</span>
              pnpm workspaces
            </div>
            <div className="flex items-center">
              <span className="text-green-500 mr-2">✓</span>
              Zod schemas in @luke/core
            </div>
            <div className="flex items-center">
              <span className="text-green-500 mr-2">✓</span>
              Tailwind CSS
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

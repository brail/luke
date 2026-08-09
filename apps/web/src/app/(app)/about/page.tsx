'use client';

import Image from 'next/image';

import webPkg from '../../../../package.json';
import { Badge } from '../../../components/ui/badge';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '../../../components/ui/card';
import { trpc } from '../../../lib/trpc';

const FRONTEND_DEPS: { label: string; key: string }[] = [
  { label: 'Next.js', key: 'next' },
  { label: 'React', key: 'react' },
  { label: 'NextAuth.js', key: 'next-auth' },
  { label: 'tRPC', key: '@trpc/client' },
  { label: 'React Query', key: '@tanstack/react-query' },
  { label: 'Zod', key: 'zod' },
  { label: 'Tailwind CSS', key: 'tailwindcss' },
  { label: 'Radix UI', key: '@radix-ui/react-dialog' },
];

const BACKEND_LABELS: Record<string, string> = {
  fastify: 'Fastify',
  '@trpc/server': 'tRPC',
  '@prisma/client': 'Prisma',
  zod: 'Zod',
  pino: 'Pino',
  argon2: 'Argon2',
  mssql: 'MSSQL (NAV)',
  nodemailer: 'Nodemailer',
  'next-auth': 'NextAuth.js',
};

const allWebDeps: Record<string, string> = {
  ...(webPkg.dependencies as Record<string, string>),
  ...(webPkg.devDependencies as Record<string, string>),
};

function strip(v: string) {
  return v.replace(/^[\^~>=<]+/, '');
}

export default function AboutPage() {
  const { data: backend } = trpc.system.about.useQuery();

  return (
    <div className="max-w-3xl mx-auto py-10 px-4 space-y-8">
      <div className="flex items-start gap-6">
        <Image
          src="/author.png"
          alt="Author"
          width={88}
          height={88}
          className="rounded-full object-cover shrink-0 border border-border"
        />
        <div className="space-y-2">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold">Luke</h1>
            <Badge variant="secondary" className="font-mono text-xs">
              v{process.env.NEXT_PUBLIC_APP_VERSION}
            </Badge>
            {process.env.NODE_ENV === 'development' && (
              <Badge variant="outline" className="text-xs">
                development
              </Badge>
            )}
          </div>
          <p className="text-muted-foreground leading-relaxed text-sm">
            Luke is an app to help people be happier working in the fashion
            industry, humbly vibecoded by me, Luca with Claude and Gpt. Buy me a
            coffee
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Frontend
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {FRONTEND_DEPS.map(({ label, key }) => {
              const version = allWebDeps[key];
              if (!version) return null;
              return (
                <div
                  key={key}
                  className="flex items-center justify-between text-sm"
                >
                  <span>{label}</span>
                  <span className="text-muted-foreground font-mono text-xs">
                    {strip(version)}
                  </span>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Backend
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {backend ? (
              <>
                <div className="flex items-center justify-between text-sm">
                  <span>Node.js</span>
                  <span className="text-muted-foreground font-mono text-xs">
                    {backend.nodeVersion}
                  </span>
                </div>
                {backend.deps.map((d: { name: string; version: string }) => (
                  <div
                    key={d.name}
                    className="flex items-center justify-between text-sm"
                  >
                    <span>{BACKEND_LABELS[d.name] ?? d.name}</span>
                    <span className="text-muted-foreground font-mono text-xs">
                      {d.version}
                    </span>
                  </div>
                ))}
              </>
            ) : (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <div className="h-4 w-24 rounded bg-muted animate-pulse" />
                    <div className="h-4 w-12 rounded bg-muted animate-pulse" />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

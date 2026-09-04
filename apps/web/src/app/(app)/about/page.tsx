'use client';

import Image from 'next/image';

import { Badge } from '../../../components/ui/badge';

export default function AboutPage() {
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
    </div>
  );
}

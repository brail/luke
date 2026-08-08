'use client';

import { Card, CardContent } from '../../../../../components/ui/card';

export function EmptyContextCard({ message }: { message: string }) {
  return (
    <Card>
      <CardContent>
        <p className="py-12 text-center text-muted-foreground">{message}</p>
      </CardContent>
    </Card>
  );
}

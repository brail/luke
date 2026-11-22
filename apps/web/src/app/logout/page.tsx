import Link from 'next/link';

import LogoLockup from '../../components/LogoLockup';
import { LogoutForm } from '../../components/system/LogoutForm';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';

/**
 * The sign-out confirmation, reachable as a plain address in every state (#238, ADR-048). A
 * sign-out request whose provenance cannot be verified lands here too, so it needs one more click.
 */
export default function LogoutPage() {
  return (
    <div className="flex h-screen items-center justify-center bg-muted/50">
      <Card className="w-full max-w-sm">
        <CardHeader className="space-y-1">
          <div className="mb-4 flex justify-center">
            <LogoLockup variant="stacked" />
          </div>
          <CardTitle className="text-center text-2xl">Uscire da Luke?</CardTitle>
          <CardDescription className="text-center">Verranno chiuse tutte le tue sessioni aperte.</CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center gap-3">
          <LogoutForm>
            <Button type="submit">Esci</Button>
          </LogoutForm>
          <Button variant="outline" asChild>
            <Link href="/dashboard">Annulla</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

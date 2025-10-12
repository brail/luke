import Link from 'next/link';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/ui/card';
import { Button } from '../components/ui/button';

/**
 * Home page con link navigazione verso tutte le sezioni
 * Design pulito e responsive con componenti shadcn/ui
 */
export default function Home() {
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-6">
          <h1 className="text-3xl font-bold text-center">Luke Web</h1>
          <p className="text-center text-muted-foreground mt-2">
            Piattaforma Enterprise Frontend
          </p>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-12">
        <div className="max-w-4xl mx-auto">
          {/* Welcome Section */}
          <div className="text-center mb-12">
            <h2 className="text-2xl font-semibold mb-4">
              Benvenuto nella piattaforma Luke
            </h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              Gestisci utenti, configurazioni e monitora il sistema attraverso
              un&apos;interfaccia moderna e intuitiva.
            </p>
          </div>

          {/* Navigation Cards */}
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            <Card className="hover:shadow-md transition-shadow">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  🔐 Login
                </CardTitle>
                <CardDescription>
                  Accedi al sistema con le tue credenziali
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Link href="/login">
                  <Button className="w-full">Accedi</Button>
                </Link>
              </CardContent>
            </Card>

            <Card className="hover:shadow-md transition-shadow">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  📊 Dashboard
                </CardTitle>
                <CardDescription>
                  Panoramica del sistema e informazioni utente
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Link href="/dashboard">
                  <Button className="w-full" variant="outline">
                    Vai alla Dashboard
                  </Button>
                </Link>
              </CardContent>
            </Card>

            <Card className="hover:shadow-md transition-shadow">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  👥 Utenti
                </CardTitle>
                <CardDescription>
                  Gestisci gli utenti del sistema
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Link href="/users">
                  <Button className="w-full" variant="outline">
                    Gestione Utenti
                  </Button>
                </Link>
              </CardContent>
            </Card>

            <Card className="hover:shadow-md transition-shadow">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  ⚙️ Configurazioni
                </CardTitle>
                <CardDescription>
                  Configura parametri e impostazioni sistema
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Link href="/settings/config">
                  <Button className="w-full" variant="outline">
                    Configurazioni
                  </Button>
                </Link>
              </CardContent>
            </Card>

            <Card className="hover:shadow-md transition-shadow">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  💾 Storage
                </CardTitle>
                <CardDescription>
                  Configura SMB/Samba e Google Drive
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Link href="/settings/storage">
                  <Button className="w-full" variant="outline">
                    Storage
                  </Button>
                </Link>
              </CardContent>
            </Card>

            <Card className="hover:shadow-md transition-shadow">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  📧 Mail
                </CardTitle>
                <CardDescription>
                  Configura server SMTP per email
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Link href="/settings/mail">
                  <Button className="w-full" variant="outline">
                    Mail
                  </Button>
                </Link>
              </CardContent>
            </Card>

            <Card className="hover:shadow-md transition-shadow">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  📥 Import/Export
                </CardTitle>
                <CardDescription>
                  Importa ed esporta dati del sistema
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Link href="/import-export">
                  <Button className="w-full" variant="outline">
                    Import/Export
                  </Button>
                </Link>
              </CardContent>
            </Card>

            <Card className="hover:shadow-md transition-shadow">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  🛡️ Sicurezza
                </CardTitle>
                <CardDescription>
                  Autenticazione config-driven e RBAC
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-sm text-muted-foreground">
                  <p>• JWT RS256</p>
                  <p>• Config in DB</p>
                  <p>• Segreti cifrati</p>
                </div>
              </CardContent>
            </Card>

            <Card className="hover:shadow-md transition-shadow">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  🔗 API
                </CardTitle>
                <CardDescription>tRPC + Fastify + Prisma</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-sm text-muted-foreground">
                  <p>• Type-safe</p>
                  <p>• Real-time</p>
                  <p>• SQLite/Postgres</p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Features Section */}
          <div className="mt-16 text-center">
            <h3 className="text-xl font-semibold mb-6">
              Caratteristiche Principali
            </h3>
            <div className="grid gap-4 md:grid-cols-3 text-sm text-muted-foreground">
              <div>
                <h4 className="font-medium text-foreground mb-2">
                  🔒 Sicurezza
                </h4>
                <p>Autenticazione robusta con JWT e crittografia AES-256-GCM</p>
              </div>
              <div>
                <h4 className="font-medium text-foreground mb-2">
                  ⚡ Performance
                </h4>
                <p>Next.js 15, React Query e ottimizzazioni SSR/CSR</p>
              </div>
              <div>
                <h4 className="font-medium text-foreground mb-2">🎨 UI/UX</h4>
                <p>Design moderno con shadcn/ui e Tailwind CSS</p>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t bg-card mt-16">
        <div className="container mx-auto px-4 py-6 text-center text-sm text-muted-foreground">
          <p>Luke Web - Piattaforma Enterprise Frontend</p>
          <p className="mt-1">Next.js 15 + Auth.js + tRPC + shadcn/ui</p>
        </div>
      </footer>
    </div>
  );
}

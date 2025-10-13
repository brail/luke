'use client';

import React, { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { Button } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
import { Label } from '../../../../components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../../components/ui/table';
import { PageHeader } from '../../../../components/PageHeader';
import { SectionCard } from '../../../../components/SectionCard';

/**
 * Pagina gestione configurazioni con lista e creazione via tRPC
 * Mostra tabella configurazioni e form per nuove configurazioni
 * Layout e header gestiti dal layout padre
 */
export default function ConfigPage() {
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [encrypt, setEncrypt] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Query tRPC per lista configurazioni
  const {
    data: configs,
    isLoading,
    error,
    refetch,
  } = (trpc as any).config.list.useQuery({});

  // Mutation tRPC per salvare configurazione
  const { mutateAsync: setConfig } = (trpc as any).config.set.useMutation();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!key.trim() || !value.trim()) return;

    setIsSubmitting(true);
    try {
      await setConfig({
        key: key.trim(),
        value: value.trim(),
        encrypt,
      });
      await refetch();
      setKey('');
      setValue('');
      setEncrypt(false);
    } catch (err) {
      console.error('Errore salvataggio configurazione:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Configurazioni Sistema"
        description="Gestisci le configurazioni del sistema"
      />

      {/* Form Nuova Configurazione */}
      <SectionCard
        title="Nuova Configurazione"
        description="Aggiungi una nuova configurazione al sistema"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="key">Chiave</Label>
              <Input
                id="key"
                placeholder="es. database.host"
                value={key}
                onChange={e => setKey(e.target.value)}
                required
                disabled={isSubmitting}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="value">Valore</Label>
              <Input
                id="value"
                placeholder="es. localhost:5432"
                value={value}
                onChange={e => setValue(e.target.value)}
                required
                disabled={isSubmitting}
              />
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <input
              type="checkbox"
              id="encrypt"
              checked={encrypt}
              onChange={e => setEncrypt(e.target.checked)}
              disabled={isSubmitting}
              className="rounded border-gray-300"
            />
            <Label htmlFor="encrypt" className="text-sm">
              Cifra il valore (AES-256-GCM)
            </Label>
          </div>
          <Button
            type="submit"
            disabled={isSubmitting || !key.trim() || !value.trim()}
          >
            {isSubmitting ? 'Salvataggio...' : 'Salva Configurazione'}
          </Button>
        </form>
      </SectionCard>

      {/* Tabella Configurazioni */}
      <SectionCard
        title="Configurazioni Esistenti"
        description="Lista completa delle configurazioni"
      >
        <div className="flex justify-end mb-4">
          <Button variant="outline" onClick={() => refetch()}>
            Aggiorna
          </Button>
        </div>
        {isLoading && (
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
            <p>Caricamento configurazioni...</p>
          </div>
        )}

        {error && (
          <div className="text-center py-8">
            <div className="text-destructive mb-2">
              Errore nel caricamento configurazioni
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              {error.message}
            </p>
            <Button variant="outline" onClick={() => refetch()}>
              Riprova
            </Button>
          </div>
        )}

        {configs && !isLoading && (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Chiave</TableHead>
                  <TableHead>Valore</TableHead>
                  <TableHead>Cifrato</TableHead>
                  <TableHead>Aggiornato</TableHead>
                  <TableHead>Azioni</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {configs.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="text-center py-8 text-muted-foreground"
                    >
                      Nessuna configurazione trovata
                    </TableCell>
                  </TableRow>
                ) : (
                  configs.map((config: any) => (
                    <TableRow key={config.key}>
                      <TableCell className="font-mono text-sm">
                        {config.key}
                      </TableCell>
                      <TableCell
                        className="max-w-xs truncate"
                        title={
                          config.isEncrypted ? 'Valore cifrato' : config.value
                        }
                      >
                        {config.isEncrypted ? '••••••' : config.value}
                      </TableCell>
                      <TableCell>
                        {config.isEncrypted ? (
                          <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-1 text-xs font-medium text-green-800">
                            ✅ Cifrato
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-1 text-xs font-medium text-gray-800">
                            — Normale
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        {config.updatedAt
                          ? new Date(config.updatedAt).toLocaleDateString(
                              'it-IT'
                            )
                          : 'N/A'}
                      </TableCell>
                      <TableCell>
                        <Button variant="outline" size="sm">
                          Modifica
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}

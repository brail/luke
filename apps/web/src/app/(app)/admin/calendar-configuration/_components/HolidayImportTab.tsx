'use client';

import { CalendarDays, Download, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { ConfirmDialog } from '../../../../../components/ConfirmDialog';
import { Badge } from '../../../../../components/ui/badge';
import { Button } from '../../../../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../../../components/ui/card';
import { Checkbox } from '../../../../../components/ui/checkbox';
import { Input } from '../../../../../components/ui/input';
import { Label } from '../../../../../components/ui/label';
import { usePermission } from '../../../../../hooks/usePermission';
import { trpc } from '../../../../../lib/trpc';
import { getTrpcErrorMessage } from '../../../../../lib/trpcErrorMessages';

const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = [CURRENT_YEAR - 1, CURRENT_YEAR, CURRENT_YEAR + 1, CURRENT_YEAR + 2];

export function HolidayImportTab() {
  const { can } = usePermission();
  const canUpdate = can('config:update');

  const [selectedYear, setSelectedYear] = useState(CURRENT_YEAR);
  const [selectedCountries, setSelectedCountries] = useState<string[]>([]);
  const [previewRows, setPreviewRows] = useState<
    Array<{ code: string; name: string; nameEn: string | null; date: string }> | null
  >(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [filterYear, setFilterYear] = useState<string>('');

  const { data: countries = [] } = trpc.holidays.listCountries.useQuery();
  const { data: holidays = [], refetch: refetchHolidays } = trpc.holidays.listHolidays.useQuery({
    year: filterYear ? parseInt(filterYear) : undefined,
  });

  const previewMutation = trpc.holidays.previewImport.useQuery(
    { countryCodes: selectedCountries, year: selectedYear },
    { enabled: false },
  );

  const confirmMutation = trpc.holidays.confirmImport.useMutation({
    onSuccess: data => {
      toast.success(`Importate ${data.imported} festività`);
      setPreviewRows(null);
      setSelectedCountries([]);
      void refetchHolidays();
    },
    onError: err => toast.error(getTrpcErrorMessage(err)),
  });

  const deleteMutation = trpc.holidays.deleteHoliday.useMutation({
    onSuccess: () => {
      toast.success('Festività eliminata');
      setDeleteTarget(null);
      void refetchHolidays();
    },
    onError: err => toast.error(getTrpcErrorMessage(err)),
  });

  function toggleCountry(code: string) {
    setSelectedCountries(prev =>
      prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code],
    );
    setPreviewRows(null);
  }

  async function handlePreview() {
    if (selectedCountries.length === 0) {
      toast.error('Seleziona almeno un paese');
      return;
    }
    const result = await previewMutation.refetch();
    setPreviewRows(result.data ?? []);
  }

  function handleConfirm() {
    if (!previewRows) return;
    confirmMutation.mutate({ countryCodes: selectedCountries, year: selectedYear });
  }

  return (
    <div className="space-y-6">
      {/* Import section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Download className="h-4 w-4" />
            Importa festività da Nager.Date
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Year selector */}
          <div className="flex items-center gap-3">
            <Label className="w-16 shrink-0">Anno</Label>
            <div className="flex gap-2">
              {YEAR_OPTIONS.map(y => (
                <Button
                  key={y}
                  variant={selectedYear === y ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => { setSelectedYear(y); setPreviewRows(null); }}
                >
                  {y}
                </Button>
              ))}
            </div>
          </div>

          {/* Country checkboxes */}
          <div className="flex items-start gap-3">
            <Label className="mt-1 w-16 shrink-0">Paesi</Label>
            <div className="flex flex-wrap gap-3">
              {countries.map(c => (
                <label key={c.code} className="flex cursor-pointer items-center gap-1.5">
                  <Checkbox
                    checked={selectedCountries.includes(c.code)}
                    onCheckedChange={() => toggleCountry(c.code)}
                    disabled={!canUpdate}
                  />
                  <span className="text-sm">
                    <span className="font-mono text-xs text-muted-foreground">{c.code}</span>{' '}
                    {c.name}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Preview button */}
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handlePreview}
              disabled={!canUpdate || selectedCountries.length === 0 || previewMutation.isFetching}
            >
              Anteprima
            </Button>
            {previewRows && (
              <Button
                size="sm"
                onClick={handleConfirm}
                disabled={confirmMutation.isPending || previewRows.length === 0}
              >
                {confirmMutation.isPending ? 'Importazione…' : `Importa ${previewRows.length} festività`}
              </Button>
            )}
          </div>

          {/* Preview table */}
          {previewRows && (
            <div className="rounded-md border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-4 py-2 text-left font-medium">Paese</th>
                    <th className="px-4 py-2 text-left font-medium">Data</th>
                    <th className="px-4 py-2 text-left font-medium">Nome locale</th>
                    <th className="px-4 py-2 text-left font-medium">Nome EN</th>
                  </tr>
                </thead>
                <tbody>
                  {previewRows.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">
                        Nessuna festività trovata
                      </td>
                    </tr>
                  ) : (
                    previewRows.map((row, i) => (
                      <tr key={i} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="px-4 py-2">
                          <Badge variant="outline">{row.code}</Badge>
                        </td>
                        <td className="px-4 py-2 tabular-nums">{row.date}</td>
                        <td className="px-4 py-2">{row.name}</td>
                        <td className="px-4 py-2 text-muted-foreground">{row.nameEn ?? '—'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Existing holidays */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarDays className="h-4 w-4" />
            Festività salvate
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <Input
              placeholder="Filtra per anno (es. 2025)"
              value={filterYear}
              onChange={e => setFilterYear(e.target.value)}
              className="w-48"
            />
          </div>

          <div className="rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-4 py-2 text-left font-medium">Paese</th>
                  <th className="px-4 py-2 text-left font-medium">Data inizio</th>
                  <th className="px-4 py-2 text-left font-medium">Data fine</th>
                  <th className="px-4 py-2 text-left font-medium">Nome locale</th>
                  <th className="px-4 py-2 text-left font-medium">Nome EN</th>
                  {canUpdate && <th className="px-4 py-2" />}
                </tr>
              </thead>
              <tbody>
                {holidays.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">
                      Nessuna festività importata
                    </td>
                  </tr>
                ) : (
                  holidays.map(h => (
                    <tr key={h.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="px-4 py-2">
                        <Badge variant="outline">{h.countryCode}</Badge>
                      </td>
                      <td className="px-4 py-2 tabular-nums">
                        {String(h.startDate).slice(0, 10)}
                      </td>
                      <td className="px-4 py-2 tabular-nums">
                        {String(h.endDate).slice(0, 10)}
                      </td>
                      <td className="px-4 py-2">{h.name}</td>
                      <td className="px-4 py-2 text-muted-foreground">{h.nameEn ?? '—'}</td>
                      {canUpdate && (
                        <td className="px-4 py-2 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                            onClick={() => setDeleteTarget(h.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={open => { if (!open) setDeleteTarget(null); }}
        title="Elimina festività"
        description="Sei sicuro di voler eliminare questa festività? L'operazione è irreversibile."
        confirmText="Elimina"
        cancelText="Annulla"
        variant="destructive"
        actionType="delete"
        onConfirm={() => { if (deleteTarget) deleteMutation.mutate({ id: deleteTarget }); }}
        isLoading={deleteMutation.isPending}
      />
    </div>
  );
}

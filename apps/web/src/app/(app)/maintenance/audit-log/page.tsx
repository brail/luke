'use client';

import { Download } from 'lucide-react';
import { Fragment, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { buildAuditLogExportUrl, getAuditActionLabel, type AuditLogResult } from '@luke/core';

import { ConfigTablePagination } from '../../../../components/config/ConfigTablePagination';
import { PageHeader } from '../../../../components/PageHeader';
import { SectionCard } from '../../../../components/SectionCard';
import { Badge } from '../../../../components/ui/badge';
import { Button } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
import { Label } from '../../../../components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../../components/ui/select';
import { Skeleton } from '../../../../components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../../components/ui/table';
import { useFormatDate } from '../../../../hooks/use-format-date';
import { usePermission } from '../../../../hooks/usePermission';
import { triggerUrlDownload } from '../../../../lib/download';
import { trpc } from '../../../../lib/trpc';

const RESULT_OPTIONS: { value: AuditLogResult; label: string }[] = [
  { value: 'SUCCESS', label: 'Successo' },
  { value: 'FAILURE', label: 'Fallito' },
];

const PAGE_SIZE = 50;
const ALL_VALUE = '__all__';
const TEXT_FILTER_DEBOUNCE_MS = 300;

interface AuditLogFilterState {
  actorId: string;
  action: string;
  targetType: string;
  result: AuditLogResult | '';
  dateFrom: string;
  dateTo: string;
}

const EMPTY_FILTERS: AuditLogFilterState = {
  actorId: '',
  action: '',
  targetType: '',
  result: '',
  dateFrom: '',
  dateTo: '',
};

export default function AuditLogPage() {
  const { can } = usePermission();
  const canRead = can('audit:read_all');
  const fmt = useFormatDate();

  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<AuditLogFilterState>(EMPTY_FILTERS);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  function updateFilter<K extends keyof AuditLogFilterState>(key: K, value: AuditLogFilterState[K]) {
    setFilters(f => ({ ...f, [key]: value }));
    setPage(1);
  }

  // "Azione"/"Entità" sono campi di testo libero: senza debounce ogni battitura cambierebbe la
  // query key e riavvierebbe la findMany+count lato server. I due Select/date invece committano
  // subito, non serve debounce su una selezione discreta.
  const [actionInput, setActionInput] = useState('');
  const [targetTypeInput, setTargetTypeInput] = useState('');

  useEffect(() => {
    const t = setTimeout(() => {
      setFilters(f => ({ ...f, action: actionInput }));
      setPage(1);
    }, TEXT_FILTER_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [actionInput]);

  useEffect(() => {
    const t = setTimeout(() => {
      setFilters(f => ({ ...f, targetType: targetTypeInput }));
      setPage(1);
    }, TEXT_FILTER_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [targetTypeInput]);

  const apiFilters = {
    actorId: filters.actorId || undefined,
    action: filters.action.trim() || undefined,
    targetType: filters.targetType.trim() || undefined,
    result: filters.result || undefined,
    dateFrom: filters.dateFrom ? new Date(filters.dateFrom).toISOString() : undefined,
    dateTo: filters.dateTo ? new Date(`${filters.dateTo}T23:59:59`).toISOString() : undefined,
  };

  const { data, isLoading } = trpc.auditLog.list.useQuery(
    { ...apiFilters, page, limit: PAGE_SIZE },
    { enabled: canRead }
  );
  const { data: usersData } = trpc.users.list.useQuery(
    { limit: 100, sortBy: 'lastName', sortOrder: 'asc' },
    { enabled: canRead, staleTime: 5 * 60 * 1000 }
  );

  const getExportLinkMutation = trpc.auditLog.getExportLink.useMutation();

  const handleDownload = async () => {
    try {
      const { token } = await getExportLinkMutation.mutateAsync(apiFilters);
      triggerUrlDownload(
        buildAuditLogExportUrl(token),
        `audit-log-${new Date().toISOString().slice(0, 10)}.csv`
      );
    } catch {
      toast.error('Download audit log fallito');
    }
  };

  if (!canRead) {
    return (
      <div className="space-y-6">
        <PageHeader title="Audit Log" />
        <SectionCard title="Accesso negato">
          <p className="text-sm text-muted-foreground">Non hai i permessi per consultare l&apos;audit log.</p>
        </SectionCard>
      </div>
    );
  }

  const items = data?.items ?? [];
  const total = data?.total ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit Log"
        description="Registro di tutte le operazioni di creazione, modifica ed eliminazione effettuate nel sistema."
        actions={
          <Button variant="outline" onClick={() => void handleDownload()} disabled={getExportLinkMutation.isPending}>
            <Download className="mr-2 h-4 w-4" />
            Scarica CSV
          </Button>
        }
      />

      <SectionCard title="Filtri">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-1.5">
            <Label>Autore</Label>
            <Select
              value={filters.actorId || ALL_VALUE}
              onValueChange={value => updateFilter('actorId', value === ALL_VALUE ? '' : value)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_VALUE}>Tutti gli utenti</SelectItem>
                {(usersData?.users ?? []).map(u => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.firstName} {u.lastName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Azione</Label>
            <Input
              placeholder="es. COLLECTION_ROW_UPDATE"
              value={actionInput}
              onChange={e => setActionInput(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Entità</Label>
            <Input
              placeholder="es. CollectionLayoutRow"
              value={targetTypeInput}
              onChange={e => setTargetTypeInput(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Esito</Label>
            <Select
              value={filters.result || ALL_VALUE}
              onValueChange={value => updateFilter('result', value === ALL_VALUE ? '' : (value as AuditLogResult))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_VALUE}>Tutti gli esiti</SelectItem>
                {RESULT_OPTIONS.map(o => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Dal</Label>
            <Input type="date" value={filters.dateFrom} onChange={e => updateFilter('dateFrom', e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label>Al</Label>
            <Input type="date" value={filters.dateTo} onChange={e => updateFilter('dateTo', e.target.value)} />
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Eventi" description={`${total} eventi trovati`}>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nessun evento trovato con i filtri selezionati.</p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data/Ora</TableHead>
                  <TableHead>Autore</TableHead>
                  <TableHead>Azione</TableHead>
                  <TableHead>Entità</TableHead>
                  <TableHead>Esito</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map(entry => (
                  <Fragment key={entry.id}>
                    <TableRow
                      className="cursor-pointer"
                      onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
                    >
                      <TableCell>{fmt.dateTime(entry.createdAt)}</TableCell>
                      <TableCell>{entry.actorName ?? 'Sistema'}</TableCell>
                      <TableCell>{getAuditActionLabel(entry.action)}</TableCell>
                      <TableCell>
                        {entry.targetType}
                        {entry.targetId ? ` #${entry.targetId.slice(0, 8)}` : ''}
                      </TableCell>
                      <TableCell>
                        <Badge variant={entry.result === 'SUCCESS' ? 'secondary' : 'destructive'}>
                          {entry.result === 'SUCCESS' ? 'Successo' : 'Fallito'}
                        </Badge>
                      </TableCell>
                    </TableRow>
                    {expandedId === entry.id && (
                      <TableRow>
                        <TableCell colSpan={5} className="bg-muted/30">
                          <pre className="whitespace-pre-wrap break-all text-xs">
                            {JSON.stringify(
                              { ip: entry.ip, actorEmail: entry.actorEmail, metadata: entry.metadata },
                              null,
                              2
                            )}
                          </pre>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
            <ConfigTablePagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
          </>
        )}
      </SectionCard>
    </div>
  );
}

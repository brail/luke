'use client';

import { PackageSearch, Star } from 'lucide-react';
import { useState } from 'react';

import type { RouterOutputs } from '@luke/api';

import { Badge } from '../../../../../components/ui/badge';
import { Button } from '../../../../../components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../../../components/ui/table';
import { cn } from '../../../../../lib/utils';

type MerchandisingRow = RouterOutputs['merchandisingPlan']['listRows'][number];
type MerchandisingPlan = RouterOutputs['merchandisingPlan']['getOrCreate'];

const GENDER_LABELS: Record<string, string> = {
  MAN: 'Uomo',
  WOMAN: 'Donna',
  UNISEX: 'Unisex',
  KID: 'Bambino',
};

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Bozza',
  CONFIRMED: 'Confermato',
};

function formatPrice(value: unknown): string {
  if (value === null || value === undefined) return '—';
  const num = Number(value);
  if (isNaN(num)) return '—';
  return `€ ${num.toFixed(2)}`;
}

interface Props {
  plan: MerchandisingPlan;
  rows: MerchandisingRow[];
  canUpdate: boolean;
  onAddRow: () => void;
  onRowClick: (row: MerchandisingRow) => void;
  onUpdateStatus: (status: 'DRAFT' | 'CONFIRMED') => void;
  isUpdatingStatus: boolean;
}

export function MerchandisingPlanTable({
  plan,
  rows,
  canUpdate,
  onAddRow,
  onRowClick,
  onUpdateStatus,
  isUpdatingStatus,
}: Props) {
  const [filterGender, setFilterGender] = useState<string>('');
  const [filterCategory, setFilterCategory] = useState<string>('');

  const categories = [...new Set(rows.map(r => r.productCategory))].sort();
  const genders = [...new Set(rows.map(r => r.gender))].sort();

  const filtered = rows.filter(r => {
    if (filterGender && r.gender !== filterGender) return false;
    if (filterCategory && r.productCategory !== filterCategory) return false;
    return true;
  });

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Badge
            variant={plan.status === 'CONFIRMED' ? 'default' : 'secondary'}
            className="text-xs"
          >
            {STATUS_LABELS[plan.status] ?? plan.status}
          </Badge>
          {canUpdate && (
            <Button
              variant="outline"
              size="sm"
              disabled={isUpdatingStatus}
              onClick={() =>
                onUpdateStatus(plan.status === 'DRAFT' ? 'CONFIRMED' : 'DRAFT')
              }
            >
              {plan.status === 'DRAFT' ? 'Conferma piano' : 'Torna a Bozza'}
            </Button>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Filtro gender */}
          <select
            className="text-sm border rounded-md px-2 py-1 bg-background"
            value={filterGender}
            onChange={e => setFilterGender(e.target.value)}
          >
            <option value="">Tutti i gender</option>
            {genders.map(g => (
              <option key={g} value={g}>
                {GENDER_LABELS[g] ?? g}
              </option>
            ))}
          </select>

          {/* Filtro categoria */}
          <select
            className="text-sm border rounded-md px-2 py-1 bg-background"
            value={filterCategory}
            onChange={e => setFilterCategory(e.target.value)}
          >
            <option value="">Tutte le categorie</option>
            {categories.map(c => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          {canUpdate && (
            <Button size="sm" onClick={onAddRow}>
              Aggiungi SKU
            </Button>
          )}
        </div>
      </div>

      {/* Tabella */}
      <div className="rounded-md border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">#</TableHead>
              <TableHead className="w-12">Foto</TableHead>
              <TableHead>Codice</TableHead>
              <TableHead>Descrizione</TableHead>
              <TableHead>Categoria</TableHead>
              <TableHead>Colore</TableHead>
              <TableHead>Gender</TableHead>
              <TableHead>Fornitore</TableHead>
              <TableHead>Pricing set</TableHead>
              <TableHead>FOB target</TableHead>
              <TableHead>Retail IT</TableHead>
              <TableHead>Specsheet</TableHead>
              <TableHead>Assegnato a</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={13} className="text-center py-10 text-muted-foreground">
                  <PackageSearch className="mx-auto mb-2 h-8 w-8 opacity-40" />
                  Nessuna riga trovata
                </TableCell>
              </TableRow>
            ) : (
              filtered.map(row => {
                const defaultImg = row.specsheet?.images?.[0];
                const hasComponents = (row.specsheet?._count?.components ?? 0) > 0;

                return (
                  <TableRow
                    key={row.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => onRowClick(row)}
                  >
                    <TableCell className="text-muted-foreground text-xs">{row.order + 1}</TableCell>
                    <TableCell>
                      {defaultImg ? (
                        <img
                          src={defaultImg.url}
                          alt={row.articleCode}
                          className="w-10 h-10 object-cover rounded-sm border"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-sm border bg-muted flex items-center justify-center">
                          <Star className="h-4 w-4 text-muted-foreground opacity-40" />
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{row.articleCode}</TableCell>
                    <TableCell className="max-w-[200px] truncate">{row.styleDescription}</TableCell>
                    <TableCell>{row.productCategory}</TableCell>
                    <TableCell>
                      <span className="font-mono text-xs">{row.colorCode}</span>
                      {row.colorDescription && (
                        <span className="ml-1 text-muted-foreground text-xs">
                          {row.colorDescription}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {GENDER_LABELS[row.gender] ?? row.gender}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">{row.specsheet?.supplierName ?? '—'}</TableCell>
                    <TableCell className="text-sm">{row.pricingParameterSet?.name ?? '—'}</TableCell>
                    <TableCell className="font-mono text-xs">{formatPrice(row.targetFobPrice)}</TableCell>
                    <TableCell className="font-mono text-xs">{formatPrice(row.retailTargetIt)}</TableCell>
                    <TableCell>
                      <Badge
                        variant={hasComponents ? 'default' : 'secondary'}
                        className={cn('text-xs', !hasComponents && 'opacity-60')}
                      >
                        {hasComponents ? 'Completa' : 'Vuota'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      {row.assignedUser
                        ? `${row.assignedUser.firstName} ${row.assignedUser.lastName}`.trim() ||
                          row.assignedUser.email
                        : '—'}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

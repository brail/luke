'use client';

import { ChevronDown, ChevronUp, FileDown, FileText } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import type { RouterOutputs } from '@luke/api';
import { calcMaxSupplierCost, generateRetailPriceRange } from '@luke/core';

import { Button } from '../../../../../components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../../../components/ui/table';
import { useAppContext } from '../../../../../contexts/AppContextProvider';
import { triggerDownload } from '../../../../../lib/download';
import { trpc } from '../../../../../lib/trpc';
import { getTrpcErrorMessage } from '../../../../../lib/trpcErrorMessages';

type PricingParameterSet = RouterOutputs['pricing']['parameterSets']['list'][number];

interface PricingGridProps {
  sets: PricingParameterSet[];
}

const RETAIL_PRICES = generateRetailPriceRange();

function commonValue<K extends keyof PricingParameterSet>(
  sets: PricingParameterSet[],
  key: K,
): PricingParameterSet[K] | null {
  const first = sets[0][key];
  return sets.every(s => s[key] === first) ? first : null;
}

export function PricingGrid({ sets }: PricingGridProps) {
  const { brand, season } = useAppContext();
  const [open, setOpen] = useState(false);

  const refSet = sets[0];

  const commonParams = useMemo(() => ({
    margin: commonValue(sets, 'optimalMargin'),
    exchangeRate: commonValue(sets, 'exchangeRate'),
    retailMultiplier: commonValue(sets, 'retailMultiplier'),
    transport: commonValue(sets, 'transportInsuranceCost'),
    italyCosts: commonValue(sets, 'italyAccessoryCosts'),
    tools: commonValue(sets, 'tools'),
  }), [sets]);

  const exportXlsxMutation = trpc.pricing.export.xlsx.useMutation({
    onSuccess: (r: { data: string; filename: string }) =>
      triggerDownload(r.data, r.filename, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
    onError: (err: unknown) => toast.error(getTrpcErrorMessage(err, { default: "Errore export XLSX" })),
  });

  const exportPdfMutation = trpc.pricing.export.pdf.useMutation({
    onSuccess: (r: { data: string; filename: string }) =>
      triggerDownload(r.data, r.filename, 'application/pdf'),
    onError: (err: unknown) => toast.error(getTrpcErrorMessage(err, { default: "Errore export PDF" })),
  });

  const canExport = !!(brand?.id && season?.id);

  function handleExport(format: 'xlsx' | 'pdf') {
    if (!brand?.id || !season?.id) return;
    const input = { brandId: brand.id, seasonId: season.id };
    if (format === 'xlsx') exportXlsxMutation.mutate(input);
    else exportPdfMutation.mutate(input);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <button
          type="button"
          className="flex items-center gap-2 text-sm font-medium hover:text-foreground/80 transition-colors"
          onClick={() => setOpen(v => !v)}
        >
          {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          {open ? 'Nascondi griglia' : 'Mostra griglia'}
        </button>

        {canExport && (
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 text-xs"
              onClick={() => handleExport('xlsx')}
              disabled={exportXlsxMutation.isPending}
            >
              <FileDown className="h-3.5 w-3.5" />
              XLSX
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 text-xs"
              onClick={() => handleExport('pdf')}
              disabled={exportPdfMutation.isPending}
            >
              <FileText className="h-3.5 w-3.5" />
              PDF
            </Button>
          </div>
        )}
      </div>

      {open && (
        <div className="text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 pb-1">
          {commonParams.margin !== null && <span>Margine {commonParams.margin}%</span>}
          {commonParams.exchangeRate !== null && <span>Cambio {commonParams.exchangeRate}</span>}
          {commonParams.retailMultiplier !== null && <span>Molt. retail ×{commonParams.retailMultiplier.toFixed(2)}</span>}
          {commonParams.transport !== null && <span>Trasp. {commonParams.transport.toFixed(2)} {refSet.purchaseCurrency}</span>}
          {commonParams.italyCosts !== null && <span>Acc. Italia {commonParams.italyCosts.toFixed(2)} {refSet.sellingCurrency}</span>}
          {commonParams.tools !== null && <span>Stampi {commonParams.tools.toFixed(2)} {refSet.purchaseCurrency}</span>}
        </div>
      )}

      {open && (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="text-xs font-semibold w-24 shrink-0">IT Retail</TableHead>
                <TableHead className="text-xs font-semibold w-24 shrink-0">IT Wholesale</TableHead>
                {sets.map(set => (
                  <TableHead key={set.id} className="text-xs font-semibold min-w-28">
                    <div>{set.name}</div>
                    <div className="font-normal text-muted-foreground">
                      {set.countryCode && `${set.countryCode} · `}Dazio {set.duty}%
                    </div>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {RETAIL_PRICES.map(retail => {
                const wholesale = retail / refSet.retailMultiplier;
                return (
                  <TableRow key={retail} className="hover:bg-muted/30">
                    <TableCell className="text-sm font-medium tabular-nums">{retail.toFixed(1)}</TableCell>
                    <TableCell className="text-sm tabular-nums text-muted-foreground">{wholesale.toFixed(1)}</TableCell>
                    {sets.map(set => {
                      const fob = calcMaxSupplierCost(retail, set);
                      return (
                        <TableCell
                          key={set.id}
                          className={`text-sm tabular-nums ${fob <= 0 ? 'text-muted-foreground/50' : ''}`}
                        >
                          {fob > 0 ? fob.toFixed(1) : '—'}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

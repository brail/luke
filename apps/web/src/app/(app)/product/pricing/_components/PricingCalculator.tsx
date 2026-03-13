'use client';

import { Lock, LockOpen, ChevronDown, ChevronUp } from 'lucide-react';
import { useState, useEffect } from 'react';
import { toast } from 'sonner';

import type { RouterOutputs } from '@luke/api';


import { Badge } from '../../../../../components/ui/badge';
import { Button } from '../../../../../components/ui/button';
import { Input } from '../../../../../components/ui/input';
import { Label } from '../../../../../components/ui/label';
import { trpc } from '../../../../../lib/trpc';

type PricingParameterSet = RouterOutputs['pricing']['parameterSets']['list'][number];

interface PricingCalculatorProps {
  parameterSet: PricingParameterSet | null;
}

type CalcMode = 'forward' | 'inverse' | 'margin';

interface CalcResult {
  mode: CalcMode;
  [key: string]: unknown;
}

function getMarginColor(margin: number, target: number): string {
  const diff = margin * 100 - target;
  if (diff >= 0) return 'bg-green-500';
  if (diff >= -2) return 'bg-green-400';
  if (diff >= -3) return 'bg-yellow-500';
  return 'bg-red-500';
}

function getMarginLabel(margin: number, target: number): string {
  const diff = (margin * 100 - target).toFixed(1);
  const pct = (margin * 100).toFixed(1);
  return `${pct}% (${Number(diff) >= 0 ? '+' : ''}${diff}pp vs target ${target}%)`;
}

function fmt(value: number, currency: string) {
  return new Intl.NumberFormat('it-IT', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function PricingCalculator({ parameterSet }: PricingCalculatorProps) {
  const [purchasePrice, setPurchasePrice] = useState<string>('');
  const [retailPrice, setRetailPrice] = useState<string>('');
  const [purchaseLocked, setPurchaseLocked] = useState(false);
  const [retailLocked, setRetailLocked] = useState(false);
  const [result, setResult] = useState<CalcResult | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  const calcMutation = trpc.pricing.calculate.useMutation({
    onSuccess: data => setResult(data as CalcResult),
    onError: err => toast.error(`Errore calcolo: ${err.message}`),
  });

  // Quando cambia il set parametri attivo, azzera il risultato
  useEffect(() => {
    setResult(null);
  }, [parameterSet?.id]);

  const resolveMode = (): { mode: CalcMode; valid: boolean } => {
    const hasPurchase = purchasePrice.trim() !== '' && !isNaN(Number(purchasePrice));
    const hasRetail = retailPrice.trim() !== '' && !isNaN(Number(retailPrice));

    // Se almeno un campo è bloccato → il valore è fisso, calcola il margine
    if (purchaseLocked || retailLocked) {
      return { mode: 'margin', valid: hasPurchase && hasRetail };
    }
    // Nessun lock: auto-detect dalla direzione del dato inserito
    if (hasPurchase && !hasRetail) return { mode: 'forward', valid: true };
    if (hasRetail && !hasPurchase) return { mode: 'inverse', valid: true };
    if (hasPurchase && hasRetail) return { mode: 'margin', valid: true };
    return { mode: 'forward', valid: false };
  };

  const handleCalculate = () => {
    if (!parameterSet) {
      toast.error('Seleziona prima un set di parametri');
      return;
    }
    const { mode, valid } = resolveMode();
    if (!valid) {
      toast.error(
        mode === 'margin'
          ? 'Inserisci entrambi i prezzi per calcolare il margine'
          : 'Inserisci almeno un prezzo per calcolare'
      );
      return;
    }

    const input = {
      mode,
      parameterSetId: parameterSet.id,
      purchasePrice: purchasePrice ? Number(purchasePrice) : undefined,
      retailPrice: retailPrice ? Number(retailPrice) : undefined,
    };

    calcMutation.mutate(input as Parameters<typeof calcMutation.mutate>[0]);
  };

  const buttonLabel = () => {
    const { mode } = resolveMode();
    if (mode === 'forward') return 'Calcola prezzo retail';
    if (mode === 'inverse') return 'Calcola prezzo massimo acquisto';
    return 'Calcola margine';
  };

  const companyMargin =
    result && typeof (result as Record<string, unknown>).companyMargin === 'number'
      ? ((result as Record<string, unknown>).companyMargin as number)
      : null;

  // Aggiorna il valore calcolato nel campo corrispondente
  if (result && !calcMutation.isPending) {
    if (result.mode === 'forward' && typeof (result as Record<string, unknown>).retailPrice === 'number') {
      const r = (result as Record<string, unknown>).retailPrice as number;
      if (retailPrice !== String(r)) setRetailPrice(String(r));
    }
    if (result.mode === 'inverse' && typeof (result as Record<string, unknown>).purchasePrice === 'number') {
      const p = (result as Record<string, unknown>).purchasePrice as number;
      if (purchasePrice !== String(p)) setPurchasePrice(String(p));
    }
  }

  return (
    <div className="space-y-4">
      {/* Griglia input */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Prezzo acquisto */}
        <div className="space-y-2">
          <Label htmlFor="purchase-price">
            Prezzo acquisto{' '}
            {parameterSet && (
              <span className="text-muted-foreground">({parameterSet.purchaseCurrency})</span>
            )}
          </Label>
          <div className="flex gap-2">
            <Input
              id="purchase-price"
              type="number"
              step="0.10"
              min="0"
              placeholder="0.00"
              value={purchasePrice}
              onChange={e => {
                setPurchasePrice(e.target.value);
                // Se c'è già un risultato e il retail non è bloccato, pulisce per ripartire puliti
                if (result && !retailLocked) setRetailPrice('');
                setResult(null);
              }}
              disabled={purchaseLocked}
              className={purchaseLocked ? 'bg-muted' : ''}
            />
            <Button
              variant="outline"
              size="icon"
              onClick={() => {
                if (!purchaseLocked && (!purchasePrice || isNaN(Number(purchasePrice)))) return;
                setPurchaseLocked(l => !l);
              }}
              title={purchaseLocked ? 'Sblocca' : 'Blocca'}
            >
              {purchaseLocked ? (
                <Lock className="h-4 w-4 text-primary" />
              ) : (
                <LockOpen className="h-4 w-4 text-muted-foreground" />
              )}
            </Button>
          </div>
        </div>

        {/* Prezzo retail */}
        <div className="space-y-2">
          <Label htmlFor="retail-price">
            Prezzo retail{' '}
            {parameterSet && (
              <span className="text-muted-foreground">({parameterSet.sellingCurrency})</span>
            )}
          </Label>
          <div className="flex gap-2">
            <Input
              id="retail-price"
              type="number"
              step="5.00"
              min="0"
              placeholder="0.00"
              value={retailPrice}
              onChange={e => {
                setRetailPrice(e.target.value);
                // Se c'è già un risultato e il purchase non è bloccato, pulisce per ripartire puliti
                if (result && !purchaseLocked) setPurchasePrice('');
                setResult(null);
              }}
              disabled={retailLocked}
              className={retailLocked ? 'bg-muted' : ''}
            />
            <Button
              variant="outline"
              size="icon"
              onClick={() => {
                if (!retailLocked && (!retailPrice || isNaN(Number(retailPrice)))) return;
                setRetailLocked(l => !l);
              }}
              title={retailLocked ? 'Sblocca' : 'Blocca'}
            >
              {retailLocked ? (
                <Lock className="h-4 w-4 text-primary" />
              ) : (
                <LockOpen className="h-4 w-4 text-muted-foreground" />
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* Bottone calcola */}
      <Button
        onClick={handleCalculate}
        disabled={calcMutation.isPending || !parameterSet}
        className="w-full sm:w-auto"
      >
        {calcMutation.isPending ? 'Calcolo in corso...' : buttonLabel()}
      </Button>

      {/* Indicatore margine */}
      {companyMargin !== null && parameterSet && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Margine aziendale</span>
            <Badge
              variant="outline"
              className={`text-white ${getMarginColor(companyMargin, parameterSet.optimalMargin)}`}
            >
              {getMarginLabel(companyMargin, parameterSet.optimalMargin)}
            </Badge>
          </div>
          <div className="h-2 w-full rounded-full bg-secondary overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${getMarginColor(companyMargin, parameterSet.optimalMargin)}`}
              style={{
                width: `${Math.min(100, Math.max(0, companyMargin * 100 / parameterSet.optimalMargin * 100))}%`,
              }}
            />
          </div>
        </div>
      )}

      {/* Card risultati */}
      {result && (
        <div className="border rounded-md">
          <button
            type="button"
            className="flex items-center justify-between w-full px-4 py-3 text-sm font-medium hover:bg-accent"
            onClick={() => setShowDetails(d => !d)}
          >
            <span>Dettagli calcolo</span>
            {showDetails ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </button>

          {showDetails && parameterSet && (
            <div className="px-4 pb-4 space-y-1 text-sm border-t">
              {result.mode === 'forward' && (
                <ResultRows result={result} parameterSet={parameterSet} mode="forward" />
              )}
              {result.mode === 'inverse' && (
                <ResultRows result={result} parameterSet={parameterSet} mode="inverse" />
              )}
              {result.mode === 'margin' && (
                <ResultRows result={result} parameterSet={parameterSet} mode="margin" />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ResultRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between py-1 border-b last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}

function ResultRows({
  result,
  parameterSet,
  mode,
}: {
  result: Record<string, unknown>;
  parameterSet: PricingParameterSet;
  mode: CalcMode;
}) {
  const pc = parameterSet.purchaseCurrency;
  const sc = parameterSet.sellingCurrency;

  if (mode === 'forward') {
    return (
      <>
        <ResultRow label="Prezzo acquisto" value={fmt(result.purchasePrice as number, pc)} />
        <ResultRow label="CQ" value={fmt(result.qualityControlCost as number, pc)} />
        <ResultRow label="+ Stampi → Totale" value={fmt(result.priceWithQC as number, pc)} />
        <ResultRow label="+ Trasporto" value={fmt(result.priceWithTransport as number, pc)} />
        <ResultRow label="+ Dazio" value={fmt(result.priceWithDuty as number, pc)} />
        <ResultRow label="Landed cost (in EUR)" value={fmt(result.landedCost as number, sc)} />
        <ResultRow label="× Molt. aziendale (×{result.companyMultiplier})" value={fmt(result.wholesalePrice as number, sc)} />
        <ResultRow label="× Molt. retail" value={fmt(result.retailPriceRaw as number, sc)} />
        <ResultRow label="Prezzo retail (arrotondato)" value={fmt(result.retailPrice as number, sc)} />
        <ResultRow label="Margine aziendale reale" value={`${((result.companyMargin as number) * 100).toFixed(2)}%`} />
      </>
    );
  }

  if (mode === 'inverse') {
    return (
      <>
        <ResultRow label="Prezzo retail" value={fmt(result.retailPrice as number, sc)} />
        <ResultRow label="÷ Molt. retail → Wholesale" value={fmt(result.wholesalePrice as number, sc)} />
        <ResultRow label="÷ Molt. aziendale → Landed" value={fmt(result.landedCost as number, sc)} />
        <ResultRow label="− Costi Italia" value={fmt(result.priceWithoutDuty as number, sc)} />
        <ResultRow label="− Dazio" value={fmt(result.priceWithoutTransport as number, pc)} />
        <ResultRow label="− Trasporto" value={fmt(result.purchasePriceRaw as number, pc)} />
        <ResultRow label="Prezzo acquisto max" value={fmt(result.purchasePrice as number, pc)} />
        <ResultRow label="Margine aziendale reale" value={`${((result.companyMargin as number) * 100).toFixed(2)}%`} />
      </>
    );
  }

  return (
    <>
      <ResultRow label="Prezzo acquisto" value={fmt(result.purchasePrice as number, pc)} />
      <ResultRow label="Landed cost" value={fmt(result.landedCost as number, sc)} />
      <ResultRow label="Prezzo retail" value={fmt(result.retailPrice as number, sc)} />
      <ResultRow label="Wholesale" value={fmt(result.wholesalePrice as number, sc)} />
      <ResultRow label="Margine aziendale reale" value={`${((result.companyMargin as number) * 100).toFixed(2)}%`} />
    </>
  );
}

'use client';

import { Lock, LockOpen, ChevronDown, ChevronUp } from 'lucide-react';
import { useState, useEffect } from 'react';
import { toast } from 'sonner';

import type { RouterOutputs } from '@luke/api';
import {
  classifyMargin,
  formatCompanyMultiplier,
  formatMarginPct,
  roundMarginPct,
  type PricingMode,
} from '@luke/core';

import { Badge } from '../../../../../components/ui/badge';
import { Button } from '../../../../../components/ui/button';
import { Input } from '../../../../../components/ui/input';
import { Label } from '../../../../../components/ui/label';
import { Progress } from '../../../../../components/ui/progress';
import { trpc } from '../../../../../lib/trpc';
import { getTrpcErrorMessage } from '../../../../../lib/trpcErrorMessages';
import { cn } from '../../../../../lib/utils';
import { MARGIN_STATUS_TEXT_CLASS } from '../../_shared/pricingCalc';

type PricingParameterSet =
  RouterOutputs['pricing']['parameterSets']['list'][number];

interface PricingCalculatorProps {
  parameterSet: PricingParameterSet | null;
}

type CalcResult = RouterOutputs['pricing']['calculate'];

/** What each mode's margin is computed on. */
const MARGIN_LABEL: Record<PricingMode, string> = {
  forward: 'Margine reale sul retail arrotondato',
  inverse: 'Margine reale sul prezzo acquisto max',
  margin: 'Margine aziendale reale',
};

/**
 * The gap is signed by the margin's status (just below target reads -0.0) and sized on the
 * percentage shown, so the two add up for a target with one decimal.
 */
function getMarginLabel(margin: number, target: number): string {
  const sign = classifyMargin(margin * 100, target) === 'green' ? '+' : '-';
  const gap = Math.abs(roundMarginPct(margin) - target).toFixed(1);
  return `${formatMarginPct(margin)} (${sign}${gap}pp vs target ${target}%)`;
}

function fmt(value: number, currency: string) {
  return new Intl.NumberFormat('it-IT', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/**
 * Interactive pricing calculator supporting three modes: forward (cost → price),
 * inverse (price → max cost), and margin (cost + price → margin).
 *
 * Results are fetched from `trpc.pricing.calculate` and displayed with a
 * colour-coded margin indicator. The lock icon freezes an intermediate field
 * for what-if analysis.
 *
 * @param parameterSet - Active parameter set driving the calculation coefficients;
 *   when null the calculator renders a disabled placeholder.
 */
export function PricingCalculator({ parameterSet }: PricingCalculatorProps) {
  const [purchasePrice, setPurchasePrice] = useState<string>('');
  const [retailPrice, setRetailPrice] = useState<string>('');
  const [purchaseLocked, setPurchaseLocked] = useState(false);
  const [retailLocked, setRetailLocked] = useState(false);
  const [result, setResult] = useState<CalcResult | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  const calcMutation = trpc.pricing.calculate.useMutation({
    onSuccess: setResult,
    onError: err => toast.error(`Errore calcolo: ${getTrpcErrorMessage(err)}`),
  });

  // When the active parameter set changes, clear the result
  useEffect(() => {
    setResult(null);
  }, [parameterSet?.id]);

  const resolveMode = (): { mode: PricingMode; valid: boolean } => {
    const hasPurchase =
      purchasePrice.trim() !== '' && !isNaN(Number(purchasePrice));
    const hasRetail = retailPrice.trim() !== '' && !isNaN(Number(retailPrice));

    // If at least one field is locked → value is fixed, calculate margin
    if (purchaseLocked || retailLocked) {
      return { mode: 'margin', valid: hasPurchase && hasRetail };
    }
    // No lock: auto-detect from direction of entered data
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
      brandId: parameterSet.brandId,
      seasonId: parameterSet.seasonId,
      purchasePrice: purchasePrice ? Number(purchasePrice) : undefined,
      retailPrice: retailPrice ? Number(retailPrice) : undefined,
    };

    calcMutation.mutate(input);
  };

  const buttonLabel = () => {
    const { mode } = resolveMode();
    if (mode === 'forward') return 'Calcola prezzo retail';
    if (mode === 'inverse') return 'Calcola prezzo massimo acquisto';
    return 'Calcola margine';
  };

  // Classified unrounded, as every margin view does.
  const marginStatusClass =
    result && parameterSet
      ? MARGIN_STATUS_TEXT_CLASS[
          classifyMargin(result.companyMargin * 100, parameterSet.optimalMargin)
        ]
      : null;

  // Update the computed value in the matching field
  if (result && !calcMutation.isPending) {
    if (result.mode === 'forward' && retailPrice !== String(result.retailPrice)) {
      setRetailPrice(String(result.retailPrice));
    }
    if (result.mode === 'inverse' && purchasePrice !== String(result.purchasePrice)) {
      setPurchasePrice(String(result.purchasePrice));
    }
  }

  return (
    <div className="space-y-4">
      {/* Input grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="purchase-price">
            Prezzo acquisto{' '}
            {parameterSet && (
              <span className="text-muted-foreground">
                ({parameterSet.purchaseCurrency})
              </span>
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
                // If there is already a result and retail is not locked, clear it to start fresh
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
                if (
                  !purchaseLocked &&
                  (!purchasePrice || isNaN(Number(purchasePrice)))
                )
                  return;
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

        <div className="space-y-2">
          <Label htmlFor="retail-price">
            Prezzo retail{' '}
            {parameterSet && (
              <span className="text-muted-foreground">
                ({parameterSet.sellingCurrency})
              </span>
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
                // If there is already a result and purchase is not locked, clear it to start fresh
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
                if (
                  !retailLocked &&
                  (!retailPrice || isNaN(Number(retailPrice)))
                )
                  return;
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

      <Button
        onClick={handleCalculate}
        disabled={calcMutation.isPending || !parameterSet}
        className="w-full sm:w-auto"
      >
        {calcMutation.isPending ? 'Calcolo in corso...' : buttonLabel()}
      </Button>

      {/* Margin indicator */}
      {result && parameterSet && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Margine aziendale</span>
            <Badge
              variant="outline"
              className={cn('border-current bg-current/10', marginStatusClass)}
            >
              {getMarginLabel(result.companyMargin, parameterSet.optimalMargin)}
            </Badge>
          </div>
          <Progress
            className={cn('h-2', marginStatusClass)}
            indicatorClassName="bg-current"
            value={Math.min(100, Math.max(0, ((result.companyMargin * 100) / parameterSet.optimalMargin) * 100))}
          />
        </div>
      )}

      {/* Results card */}
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

          {showDetails && (
            <div className="px-4 pb-4 space-y-1 text-sm border-t">
              <ResultRows result={result} />
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

function ResultRows({ result }: { result: CalcResult }) {
  const pc = result.purchaseCurrency;
  const sc = result.sellingCurrency;

  return (
    <>
      {result.mode === 'forward' && (
        <>
          <ResultRow label="Prezzo acquisto" value={fmt(result.purchasePrice, pc)} />
          <ResultRow label="CQ" value={fmt(result.qualityControlCost, pc)} />
          <ResultRow label="+ Stampi → Totale" value={fmt(result.priceWithQC, pc)} />
          <ResultRow label="+ Trasporto" value={fmt(result.priceWithTransport, pc)} />
          <ResultRow label="+ Dazio" value={fmt(result.priceWithDuty, pc)} />
          <ResultRow label={`Landed cost (in ${sc})`} value={fmt(result.landedCost, sc)} />
          <ResultRow
            label={`× Molt. aziendale (${formatCompanyMultiplier(result.companyMultiplier)})`}
            value={fmt(result.wholesalePrice, sc)}
          />
          <ResultRow label="× Molt. retail" value={fmt(result.retailPriceRaw, sc)} />
          <ResultRow label="Prezzo retail (arrotondato)" value={fmt(result.retailPrice, sc)} />
        </>
      )}
      {result.mode === 'inverse' && (
        <>
          <ResultRow label="Prezzo retail" value={fmt(result.retailPrice, sc)} />
          <ResultRow label="÷ Molt. retail → Wholesale" value={fmt(result.wholesalePrice, sc)} />
          <ResultRow label="÷ Molt. aziendale → Landed" value={fmt(result.landedCost, sc)} />
          <ResultRow label="− Costi Italia" value={fmt(result.priceWithoutAccessories, sc)} />
          <ResultRow label="− Dazio" value={fmt(result.priceWithoutDuty, sc)} />
          <ResultRow label="× Cambio − Trasporto" value={fmt(result.priceWithoutTransport, pc)} />
          <ResultRow label="− Stampi ÷ CQ" value={fmt(result.purchasePriceRaw, pc)} />
          <ResultRow label="Prezzo acquisto max" value={fmt(result.purchasePrice, pc)} />
        </>
      )}
      {result.mode === 'margin' && (
        <>
          <ResultRow label="Prezzo acquisto" value={fmt(result.purchasePrice, pc)} />
          <ResultRow label="Landed cost" value={fmt(result.landedCost, sc)} />
          <ResultRow label="Prezzo retail" value={fmt(result.retailPrice, sc)} />
          <ResultRow label="Wholesale" value={fmt(result.wholesalePrice, sc)} />
        </>
      )}
      <ResultRow label={MARGIN_LABEL[result.mode]} value={formatMarginPct(result.companyMargin)} />
    </>
  );
}

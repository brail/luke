'use client';

import { useMemo } from 'react';

import { COLLECTION_GENDER, type CollectionGender } from '@luke/core';

import { Tooltip, TooltipContent, TooltipTrigger } from '../../../../../components/ui/tooltip';
import { formatMoqCoverageRatio, type MoqCluster } from '../../../../../lib/moqCoverage';
import { trpc } from '../../../../../lib/trpc';

import { formatInteger, MOQ_STATUS_LABEL } from './ClusterMoqCharts';
import { QueryStateMessage } from './QueryStateMessage';

const GENDER_LABEL: Record<CollectionGender, string> = { MAN: 'Uomo', WOMAN: 'Donna' };
const genderLabels = new Map<string, string>(Object.entries(GENDER_LABEL));

// Chart geometry, in viewBox units (the approved prototype's): strategies across, positionings up.
const W = 240;
const H = 214;
const PAD_L = 52;
const PAD_R = 16;
const PAD_T = 30;
const PAD_B = 34;
const BASE_Y = H - PAD_B;
/** The lowest positioning sits this far above the baseline, so its circles clear the strategy labels. */
const LOWEST_LIFT = 22;
const R_MAX = 24;
/** Smallest radius of a non-empty value, so a tiny cluster still shows its status colour. */
const R_MIN = 3;
const AXIS_FONT = 10.5;
/** Rough width of one axis-label character at `AXIS_FONT`, to truncate labels to their column. */
const CHAR_WIDTH = 6;
const CATALOG_QUERY = { staleTime: 5 * 60 * 1000 };

const truncate = (text: string, room: number) => {
  const max = Math.max(1, Math.floor(room / CHAR_WIDTH));
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

/** The values present, in the given order first, then any other alphabetically. */
function ordered(present: Iterable<string>, order: readonly string[]): string[] {
  const values = new Set(present);
  return [
    ...order.filter(v => values.has(v)),
    ...[...values].filter(v => !order.includes(v)).sort((a, b) => a.localeCompare(b)),
  ];
}

interface Axis {
  values: string[];
  label: (value: string) => string;
}

/** The values present, in catalog order, labelled by the catalog: each type has its own values. */
function axis(catalog: readonly { value: string; label: string }[] | undefined, present: string[]): Axis {
  const labels = new Map((catalog ?? []).map(item => [item.value, item.label]));
  return { values: ordered(present, (catalog ?? []).map(item => item.value)), label: value => labels.get(value) ?? value };
}

/** What every chart of the page shares: the axes, their spacing and the one radius scale. */
interface Page {
  strategy: Axis;
  positioning: Axis;
  column: number;
  step: number;
  radius: (value: number) => number;
}

interface CategoryChart {
  key: string;
  name: string;
  clusters: MoqCluster[];
}

/**
 * Control › `Criticità cluster` › `Panoramica` (#168): every cluster at once, one section per gender
 * and one small chart per category. Strategy runs across in catalog order, price positioning up in
 * catalog order from the lowest; each cluster is a ring for B over a disc for A, coloured by status,
 * with its SKU count. One radius scale for the whole page, so clusters compare across charts.
 */
export function ClusterOverview({ clusters }: { clusters: MoqCluster[] }) {
  // `listAll`: a value retired from the catalog keeps its place and label on the axes.
  const strategyCatalog = trpc.collectionCatalog.listAll.useQuery({ type: 'strategy' }, CATALOG_QUERY);
  const positioningCatalog = trpc.collectionCatalog.listAll.useQuery({ type: 'pricePositioning' }, CATALOG_QUERY);

  const view = useMemo(() => {
    // A failed catalog read leaves the axes in alphabetical order rather than hiding the chart.
    const strategy = axis(strategyCatalog.data, clusters.map(c => c.strategy));
    const positioning = axis(positioningCatalog.data, clusters.map(c => c.pricePositioning));
    const column = (W - PAD_L - PAD_R) / (strategy.values.length || 1);
    const step = (BASE_Y - LOWEST_LIFT - PAD_T) / (positioning.values.length - 1 || 1);
    const max = clusters.reduce((m, c) => Math.max(m, c.forecastPairs, c.minimumPairs), 0) || 1;
    // Capped by the spacing, so the largest circle never covers the next column's or row's.
    const rMax = Math.min(R_MAX, column / 2, step / 2);
    const page: Page = { strategy, positioning, column, step, radius: v => Math.max(R_MIN, rMax * Math.sqrt(v / max)) };
    const sections = ordered(clusters.map(c => c.gender), COLLECTION_GENDER).map(gender => {
      // Ignoring case, as the clusters themselves are grouped.
      const charts = new Map<string, CategoryChart>();
      for (const c of clusters.filter(cl => cl.gender === gender)) {
        const key = c.category.toLowerCase();
        const chart = charts.get(key) ?? { key, name: c.category, clusters: [] };
        chart.clusters.push(c);
        charts.set(key, chart);
      }
      return {
        gender,
        label: genderLabels.get(gender) ?? gender,
        charts: [...charts.values()].sort((a, b) => a.name.localeCompare(b.name)),
      };
    });
    return { page, sections };
  }, [clusters, strategyCatalog.data, positioningCatalog.data]);

  if (strategyCatalog.isPending || positioningCatalog.isPending) {
    return <QueryStateMessage variant="loading" message="Caricamento…" />;
  }

  return (
    <div className="space-y-4">
      {(strategyCatalog.isError || positioningCatalog.isError) && (
        <p className="text-xs text-destructive">
          Catalogo di strategy e posizionamenti non disponibile: gli assi seguono l&apos;ordine alfabetico dei valori registrati.
        </p>
      )}
      <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <svg width="22" height="16" viewBox="0 0 22 16" aria-hidden="true" className="shrink-0">
          <circle cx="11" cy="8" r="4.5" className="fill-muted-foreground/40" />
          <circle cx="11" cy="8" r="7" strokeWidth={1.5} className="fill-transparent stroke-foreground" />
        </svg>
        Disco pieno = A, forecast (colore = stato) · anello = B, minimi richiesti · numero = SKU · altezza = posizionamento prezzo
      </p>
      {view.sections.map(section => (
        <section key={section.gender} aria-label={section.label} className="space-y-2 rounded-lg border p-3.5">
          <h4 className="text-sm font-semibold">{section.label}</h4>
          {/* 230px: the prototype's smallest chart column; auto-fill has no Tailwind scale value. */}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-x-3 gap-y-1">
            {section.charts.map(chart => (
              <figure key={chart.key} className="min-w-0">
                <CategoryChartSvg title={`${section.label} · ${chart.name}`} clusters={chart.clusters} page={view.page} />
                <figcaption className="mb-2.5 text-center text-sm font-semibold break-words">{chart.name}</figcaption>
              </figure>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function CategoryChartSvg({ title, clusters, page }: { title: string; clusters: MoqCluster[]; page: Page }) {
  const { strategy, positioning, column, step, radius } = page;
  const xOf = (s: string) => PAD_L + (strategy.values.indexOf(s) + 0.5) * column;
  const yOf = (p: string) => BASE_Y - LOWEST_LIFT - positioning.values.indexOf(p) * step;
  // The largest first, so smaller clusters stay on top where they overlap, and keep the pointer.
  const points = clusters
    .map(c => ({ c, disc: radius(c.forecastPairs), ring: c.minimumPairs > 0 ? radius(c.minimumPairs) : 0 }))
    .sort((a, b) => Math.max(b.disc, b.ring) - Math.max(a.disc, a.ring));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="group" aria-label={title} className="block h-auto w-full">
      {positioning.values.map(p => (
        <g key={p}>
          <line x1={PAD_L - 4} x2={W - PAD_R} y1={yOf(p)} y2={yOf(p)} className="stroke-border" />
          <text x={PAD_L - 8} y={yOf(p) + 3.5} textAnchor="end" fontSize={AXIS_FONT} data-axis="positioning" className="fill-muted-foreground">
            {truncate(positioning.label(p), PAD_L - 10)}
            <title>{positioning.label(p)}</title>
          </text>
        </g>
      ))}
      <line x1={PAD_L - 4} x2={W - PAD_R} y1={BASE_Y} y2={BASE_Y} strokeWidth={1.5} className="stroke-border" />
      {strategy.values.map(s => {
        const own = clusters.filter(c => c.strategy === s);
        return (
          <g key={s}>
            <text x={xOf(s)} y={BASE_Y + 15} textAnchor="middle" fontSize={AXIS_FONT} className="fill-muted-foreground">
              {truncate(strategy.label(s), column)}
              <title>{strategy.label(s)}</title>
            </text>
            {own.length > 0 && (
              <line
                x1={xOf(s)} x2={xOf(s)} y1={BASE_Y} y2={Math.min(...own.map(c => yOf(c.pricePositioning)))}
                strokeWidth={2} strokeLinecap="round" className="stroke-muted-foreground"
              />
            )}
          </g>
        );
      })}
      {points.map(({ c, disc, ring }) => (
        <ClusterPoint
          key={c.key} cluster={c} x={xOf(c.strategy)} y={yOf(c.pricePositioning)} disc={disc} ring={ring} title={title}
          strategy={strategy.label(c.strategy)} positioning={positioning.label(c.pricePositioning)}
        />
      ))}
    </svg>
  );
}

function ClusterPoint({ cluster: c, x, y, disc, ring, title, strategy, positioning }: {
  cluster: MoqCluster; x: number; y: number; disc: number; ring: number; title: string; strategy: string; positioning: string;
}) {
  const status = c.belowMoq ? MOQ_STATUS_LABEL.below : MOQ_STATUS_LABEL.covered;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <g
          role="img"
          tabIndex={0}
          aria-label={`${strategy}, ${positioning}: A ${formatInteger(c.forecastPairs)}, B ${formatInteger(c.minimumPairs)}, A/B ${formatMoqCoverageRatio(c)}, ${formatInteger(c.sku)} SKU, ${status}`}
          className="group outline-none"
        >
          <circle cx={x} cy={y} r={disc} className={c.belowMoq ? 'fill-status-critical/85' : 'fill-muted-foreground/75'} />
          {ring > 0 && <circle cx={x} cy={y} r={ring} strokeWidth={2} className="fill-none stroke-foreground" />}
          {/* Outside both circles: the keyboard focus mark. Its transparent fill makes the whole cluster hoverable. */}
          <circle
            cx={x} cy={y} r={Math.max(disc, ring) + 3} strokeWidth={2}
            className="fill-transparent stroke-transparent group-focus-visible:stroke-foreground"
          />
          <text
            x={x} y={y + 3.8} textAnchor="middle" fontSize={AXIS_FONT} fontWeight={700}
            paintOrder="stroke" strokeWidth={3} strokeLinejoin="round"
            className="fill-foreground stroke-card font-mono"
          >
            {formatInteger(c.sku)}
          </text>
        </g>
      </TooltipTrigger>
      <TooltipContent className="space-y-0.5 text-xs tabular-nums">
        <p className="font-medium">{title}</p>
        <p>{strategy} · {positioning}</p>
        <p>A (forecast) {formatInteger(c.forecastPairs)} paia</p>
        <p>B (minimi) {formatInteger(c.minimumPairs)} paia</p>
        <p>A/B {formatMoqCoverageRatio(c)} · {formatInteger(c.sku)} SKU</p>
        <p className={c.belowMoq ? 'font-semibold text-status-critical' : undefined}>{status}</p>
      </TooltipContent>
    </Tooltip>
  );
}

import type { AlertBandEmphasis } from '@luke/core';

import type { CSSProperties } from 'react';

/** Minimal shape shared by every band-ish payload the alert engine returns: the full `AlertBand`
 * from the per-row/per-layout criticality queries, and the trimmed `{ label, color, emphasis, count }`
 * aggregates from the saturation/bottleneck dashboards. */
export interface BandVisual {
  color: string;
  emphasis?: AlertBandEmphasis;
}

const HEX6 = /^#([0-9A-Fa-f]{6})$/;

/** Il colore è in una forma che questa feature sa rendere. Esportata perché l'editor delle bande
 * deve usare lo stesso predicato con cui `bandBadgeStyle` decide di degradare a `outline`:
 * altrimenti lo swatch accetterebbe un valore che il badge poi non sa colorare. */
export function isHexColor(color: string): boolean {
  return HEX6.test(color);
}

function parseHex(color: string): [number, number, number] | null {
  const match = HEX6.exec(color);
  if (!match) return null;
  const int = parseInt(match[1], 16);
  return [(int >> 16) & 0xff, (int >> 8) & 0xff, int & 0xff];
}

/**
 * WCAG relative luminance (sRGB), used only to pick a readable foreground over a solid fill —
 * the band color is an admin-entered hex from AppConfig, so a fixed `text-white` would be
 * unreadable the moment someone configures a yellow or light-green band.
 */
function relativeLuminance([r, g, b]: [number, number, number]): number {
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Foreground for text sitting on a solid `color` fill: near-black on light backgrounds, white on
 * dark ones. Threshold 0.45 rather than 0.5 — white text stays legible slightly further up the
 * luminance scale than black does going down. */
export function bandForeground(color: string): string {
  const rgb = parseHex(color);
  if (!rgb) return '#ffffff';
  return relativeLuminance(rgb) > 0.45 ? '#111827' : '#ffffff';
}

/**
 * Inline style for a band chip/badge at its configured emphasis. Inline rather than Tailwind
 * classes because the color is an admin-configured hex from AppConfig
 * (`collectionControl.alertThresholds`), not a design token — it cannot be a static class.
 *
 * Falls back to `outline` for a non-hex color: the tinted and solid variants need the parsed
 * channels (alpha tint, contrast pick), and an unreadable badge is worse than an unemphasized one.
 */
export function bandBadgeStyle({ color, emphasis = 'outline' }: BandVisual): CSSProperties {
  const rgb = parseHex(color);
  if (emphasis === 'solid') {
    return { backgroundColor: color, borderColor: color, color: bandForeground(color) };
  }
  if (emphasis === 'soft' && rgb) {
    return { backgroundColor: `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.15)`, borderColor: color, color };
  }
  return { backgroundColor: 'transparent', borderColor: color, color };
}

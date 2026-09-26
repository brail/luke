/**
 * Contract of `alertBandStyle`: a band colour is a hex written by an admin in AppConfig, not a
 * design token. The two things that can break silently are the legibility of the text on the solid
 * fill — a fixed `text-white` would vanish on a yellow band — and the behaviour on a value that is
 * not a valid hex, which arrives while the user is typing.
 */

import { describe, it, expect } from 'vitest';

import { bandBadgeStyle, bandForeground, isHexColor } from '../alertBandStyle';

describe('isHexColor', () => {
  it('accetta solo #RRGGBB', () => {
    expect(isHexColor('#B91C1C')).toBe(true);
    expect(isHexColor('#b91c1c')).toBe(true);
    // Forms the native colour field cannot render: the 3-digit shorthand, a half-typed value,
    // CSS names.
    expect(isHexColor('#FFF')).toBe(false);
    expect(isHexColor('#B91C1')).toBe(false);
    expect(isHexColor('red')).toBe(false);
    expect(isHexColor('')).toBe(false);
  });
});

describe('bandForeground', () => {
  it('testo scuro su fondo chiaro, chiaro su fondo scuro', () => {
    expect(bandForeground('#FFFFFF')).toBe('#111827');
    expect(bandForeground('#000000')).toBe('#ffffff');
  });

  it('yellow counts as a light background: the case a fixed `text-white` would make unreadable', () => {
    expect(bandForeground('#FFFF00')).toBe('#111827');
  });

  it('the dark red and green of the defaults stay on light text', () => {
    expect(bandForeground('#B91C1C')).toBe('#ffffff');
    expect(bandForeground('#15803D')).toBe('#ffffff');
  });

  it('an unparseable colour → white, not a crash', () => {
    expect(bandForeground('rosso')).toBe('#ffffff');
  });
});

describe('bandBadgeStyle', () => {
  it('outline: no fill, border and text in the band colour', () => {
    expect(bandBadgeStyle({ color: '#B91C1C', emphasis: 'outline' })).toEqual({
      backgroundColor: 'transparent',
      borderColor: '#B91C1C',
      color: '#B91C1C',
    });
  });

  it('outline is the default when the band declares no emphasis', () => {
    // Configs saved before the field existed arrive without it: they must render as
    // they did then, not disappear or fill.
    expect(bandBadgeStyle({ color: '#B91C1C' })).toMatchObject({ backgroundColor: 'transparent' });
  });

  it('soft: riempimento tinto trasparente, testo pieno', () => {
    const style = bandBadgeStyle({ color: '#B91C1C', emphasis: 'soft' });
    expect(style.backgroundColor).toBe('rgba(185, 28, 28, 0.15)');
    expect(style.color).toBe('#B91C1C');
  });

  it('solid: full fill and text chosen for contrast, not fixed', () => {
    expect(bandBadgeStyle({ color: '#15803D', emphasis: 'solid' })).toEqual({
      backgroundColor: '#15803D',
      borderColor: '#15803D',
      color: '#ffffff',
    });
    expect(bandBadgeStyle({ color: '#FFFF00', emphasis: 'solid' }).color).toBe('#111827');
  });

  it('soft on a non-hex colour degrades to outline instead of producing an invisible badge', () => {
    // `soft` needs channels to build alpha: without them, better no emphasis than
    // wrong fill.
    expect(bandBadgeStyle({ color: 'rosso', emphasis: 'soft' })).toEqual({
      backgroundColor: 'transparent',
      borderColor: 'rosso',
      color: 'rosso',
    });
  });
});

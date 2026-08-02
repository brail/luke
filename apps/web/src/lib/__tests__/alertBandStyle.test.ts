/**
 * Contratto di `alertBandStyle`: il colore di una banda è un hex scritto da un admin in AppConfig,
 * non un design token. Le due cose che possono rompersi in silenzio sono la leggibilità del testo
 * sul riempimento pieno — un `text-white` fisso sparirebbe su una banda gialla — e il
 * comportamento su un valore che non è un hex valido, che arriva mentre l'utente digita.
 */

import { describe, it, expect } from 'vitest';

import { bandBadgeStyle, bandForeground, isHexColor } from '../alertBandStyle';

describe('isHexColor', () => {
  it('accetta solo #RRGGBB', () => {
    expect(isHexColor('#B91C1C')).toBe(true);
    expect(isHexColor('#b91c1c')).toBe(true);
    // Forme che il campo colore nativo non sa rendere: la scorciatoia a 3 cifre, il valore a metà
    // digitazione, i nomi CSS.
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

  it('il giallo conta come fondo chiaro: è il caso che un `text-white` fisso renderebbe illeggibile', () => {
    expect(bandForeground('#FFFF00')).toBe('#111827');
  });

  it('il rosso e il verde scuri dei default restano su testo chiaro', () => {
    expect(bandForeground('#B91C1C')).toBe('#ffffff');
    expect(bandForeground('#15803D')).toBe('#ffffff');
  });

  it('colore non interpretabile → bianco, non un crash', () => {
    expect(bandForeground('rosso')).toBe('#ffffff');
  });
});

describe('bandBadgeStyle', () => {
  it('outline: nessun riempimento, bordo e testo del colore della banda', () => {
    expect(bandBadgeStyle({ color: '#B91C1C', emphasis: 'outline' })).toEqual({
      backgroundColor: 'transparent',
      borderColor: '#B91C1C',
      color: '#B91C1C',
    });
  });

  it('outline è il default quando la banda non dichiara emphasis', () => {
    // Le configurazioni salvate prima che il campo esistesse arrivano senza: devono rendere come
    // rendevano allora, non sparire né riempirsi.
    expect(bandBadgeStyle({ color: '#B91C1C' })).toMatchObject({ backgroundColor: 'transparent' });
  });

  it('soft: riempimento tinto trasparente, testo pieno', () => {
    const style = bandBadgeStyle({ color: '#B91C1C', emphasis: 'soft' });
    expect(style.backgroundColor).toBe('rgba(185, 28, 28, 0.15)');
    expect(style.color).toBe('#B91C1C');
  });

  it('solid: riempimento pieno e testo scelto per contrasto, non fisso', () => {
    expect(bandBadgeStyle({ color: '#15803D', emphasis: 'solid' })).toEqual({
      backgroundColor: '#15803D',
      borderColor: '#15803D',
      color: '#ffffff',
    });
    expect(bandBadgeStyle({ color: '#FFFF00', emphasis: 'solid' }).color).toBe('#111827');
  });

  it('soft su un colore non-hex degrada a outline invece di produrre un badge invisibile', () => {
    // `soft` ha bisogno dei canali per costruire l'alpha: senza, meglio nessuna enfasi che un
    // riempimento sbagliato.
    expect(bandBadgeStyle({ color: 'rosso', emphasis: 'soft' })).toEqual({
      backgroundColor: 'transparent',
      borderColor: 'rosso',
      color: 'rosso',
    });
  });
});

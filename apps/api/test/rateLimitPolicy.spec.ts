/**
 * Cache del blob AppConfig `rateLimit` in `resolveRateLimitPolicy` (rateLimitPolicy.ts).
 * `auth.login` risolve due bucket nello stesso tentativo (`login` via `withRateLimit`,
 * `loginByUsername` in `authenticateUser()`) — senza questa cache, ogni tentativo di login
 * fa due query identiche sulla stessa riga AppConfig.
 *
 * `vi.mock` (non `vi.spyOn` su un import con named export) perché uno spy sull'oggetto
 * modulo non sempre intercetta la binding usata da `rateLimitPolicy.ts` — vedi lessons.md
 * → "vi.mock non sempre intercetta: asserire sull'effetto, non sullo spy".
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { getConfig } from '../src/lib/configManager';
import { clearRateLimitConfigCache, resolveRateLimitPolicy } from '../src/lib/rateLimitPolicy';

import type { PrismaClient } from '@prisma/client';

vi.mock('../src/lib/configManager', () => ({
  getConfig: vi.fn(),
}));

// getConfig è mockato sopra: prisma non viene mai letto per davvero in questi test.
const fakePrisma = {} as unknown as PrismaClient;

describe('resolveRateLimitPolicy — cache del blob AppConfig rateLimit', () => {
  beforeEach(() => {
    clearRateLimitConfigCache();
    vi.mocked(getConfig).mockReset();
    vi.mocked(getConfig).mockResolvedValue(null);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('due risoluzioni per rotte diverse entro il TTL leggono AppConfig una sola volta', async () => {
    await resolveRateLimitPolicy('login', fakePrisma);
    await resolveRateLimitPolicy('loginByUsername', fakePrisma);

    expect(getConfig).toHaveBeenCalledTimes(1);
  });

  it('dopo la scadenza del TTL, la risoluzione successiva rilegge AppConfig', async () => {
    await resolveRateLimitPolicy('login', fakePrisma);
    vi.advanceTimersByTime(2001);
    await resolveRateLimitPolicy('login', fakePrisma);

    expect(getConfig).toHaveBeenCalledTimes(2);
  });

  it('un valore AppConfig valido resta quello servito dalla cache finché non scade', async () => {
    vi.mocked(getConfig).mockResolvedValue(
      JSON.stringify({ login: { max: 1, timeWindow: '30s', keyBy: 'ip' } })
    );

    const first = await resolveRateLimitPolicy('login', fakePrisma);
    // Anche se la riga AppConfig "cambiasse" nel frattempo, entro il TTL viene ignorato.
    vi.mocked(getConfig).mockResolvedValue(
      JSON.stringify({ login: { max: 99, timeWindow: '30s', keyBy: 'ip' } })
    );
    const second = await resolveRateLimitPolicy('login', fakePrisma);

    expect(first.max).toBe(1);
    expect(second.max).toBe(1);
    expect(getConfig).toHaveBeenCalledTimes(1);
  });
});

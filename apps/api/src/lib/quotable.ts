/**
 * Client per Quotable API — aforismi random usati nel daily greeting.
 * Fetch sempre live, mai cachato: nessuna persistenza server-side del risultato.
 */

import pino from 'pino';

const logger = pino({ level: 'info' });

const QUOTABLE_URL = 'https://api.quotable.io/random';
const FETCH_TIMEOUT_MS = 2000;

export interface QuotableQuote {
  content: string;
  author: string;
}

/**
 * Fetches a random quote from Quotable with a 2s timeout.
 * Never throws — returns null on any failure (timeout, network error, non-2xx, malformed payload)
 * so the caller can fall back to a local pool without wrapping this in try/catch.
 */
export async function fetchRandomQuote(): Promise<QuotableQuote | null> {
  try {
    const res = await fetch(QUOTABLE_URL, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!res.ok) {
      logger.warn({ status: res.status }, 'Quotable fetch failed: non-2xx status');
      return null;
    }

    const data = (await res.json()) as { content?: unknown; author?: unknown };

    if (
      typeof data.content !== 'string' ||
      data.content.trim() === '' ||
      typeof data.author !== 'string' ||
      data.author.trim() === ''
    ) {
      logger.warn('Quotable fetch failed: malformed payload');
      return null;
    }

    return { content: data.content, author: data.author };
  } catch (error) {
    logger.warn({ err: error }, 'Quotable fetch failed: timeout or network error');
    return null;
  }
}

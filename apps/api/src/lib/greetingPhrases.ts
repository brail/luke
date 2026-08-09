/**
 * Frasi statiche per il daily greeting: intro motivazionali, fallback quotes e saluto per fascia oraria.
 */

import { getRandomFact } from './dailyFacts';
import { fetchRandomQuote } from './quotable';
import { pickRandom } from './random';

export const GREETING_INTROS: string[] = [
  'vediamo come posso darti una mano oggi. Ti lascio con un pensiero:',
  'pronto a rimetterci le mani? Intanto, questo per iniziare bene:',
  "un'altra giornata, un'altra collezione da far quadrare. Un pensiero prima di partire:",
  'io sono già sveglio e operativo. Tu piano con il caffè, ma ecco uno spunto:',
  'diamoci dentro. Prima però, due righe per scaldare la testa:',
  'oggi si lavora, ma con calma: parti con questo pensiero.',
  'la dashboard ti aspetta, ma prima un attimo di pausa con questo spunto:',
  'un altro giorno, un altro carico di dati da domare. Comincia da qui:',
  'nessuna fretta: prima un pensiero, poi al lavoro.',
  'bentornato. Prendi un caffè e leggi questo, poi si parte.',
];

export const FALLBACK_QUOTES: { content: string; author: string }[] = [
  { content: 'The only way to do great work is to love what you do.', author: 'Steve Jobs' },
  { content: 'Success is not final, failure is not fatal: it is the courage to continue that counts.', author: 'Winston Churchill' },
  { content: 'In the middle of difficulty lies opportunity.', author: 'Albert Einstein' },
  { content: 'It always seems impossible until it is done.', author: 'Nelson Mandela' },
  { content: 'The best way to predict the future is to create it.', author: 'Peter Drucker' },
  { content: 'Simplicity is the ultimate sophistication.', author: 'Leonardo da Vinci' },
  { content: 'Quality is not an act, it is a habit.', author: 'Aristotle' },
  { content: 'Well done is better than well said.', author: 'Benjamin Franklin' },
];

/**
 * Returns the time-of-day greeting for Europe/Rome hour buckets:
 * 05:00-11:59 Buongiorno, 12:00-17:59 Buon pomeriggio, 18:00-04:59 Buonasera.
 */
export function getTimeBasedGreeting(hour: number): string {
  if (hour >= 5 && hour < 12) return 'Buongiorno';
  if (hour >= 12 && hour < 18) return 'Buon pomeriggio';
  return 'Buonasera';
}

export interface GreetingContent {
  type: 'quote' | 'fact';
  content: string;
  author: string | null;
}

/**
 * Picks the daily greeting body: 50/50 between a live Quotable fetch (falling back to the
 * local pool on failure) and a random local fact.
 */
export async function selectGreetingContent(): Promise<GreetingContent> {
  if (Math.random() < 0.5) {
    return { type: 'fact', content: getRandomFact(), author: null };
  }

  const quote = (await fetchRandomQuote()) ?? pickRandom(FALLBACK_QUOTES);
  return { type: 'quote', content: quote.content, author: quote.author };
}

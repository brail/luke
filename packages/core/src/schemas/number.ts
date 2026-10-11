import { z } from 'zod';

/**
 * An integer in `[min, max]` whose every issue — an emptied form field (`valueAsNumber` gives NaN),
 * a decimal, a value out of range — reads `message`: Zod reports the first one in English otherwise.
 */
export const intInRange = (min: number, max: number, message: string) =>
  z.number({ error: message }).int(message).min(min, message).max(max, message);

/** A TCP port: the SMTP server, SQL Server, an S3 endpoint. */
export const PortSchema = intInRange(1, 65535, 'Inserisci una porta tra 1 e 65535');

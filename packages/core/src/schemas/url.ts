import { z } from 'zod';

/**
 * An absolute `http:` or `https:` URL: one a person follows or is redirected to. Every other scheme
 * is refused (`javascript:`, `data:`), any host is accepted — `localhost`, an IP, a single-label
 * name — which `z.httpUrl()` would refuse.
 */
export const httpUrl = (message?: string) => z.url({ protocol: /^https?$/, error: message });

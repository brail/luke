import { serverLogout } from '../../../../lib/serverLogout';

/**
 * The one sign-out path (#238, ADR-048): a plain form post from any page, error pages included.
 * POST only: a GET (a link, a prefetch, an image tag) answers 405 and signs nobody out.
 * @auth {public}
 */
export function POST(request: Request) {
  return serverLogout(request);
}

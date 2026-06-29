import { handlers } from '../../../../auth';

/**
 * Handles GET /api/auth/[...nextauth]. Serves NextAuth.js session and provider endpoints (e.g. sign-in, sign-out, callback).
 * @auth {public}
 */
/**
 * Handles POST /api/auth/[...nextauth]. Processes NextAuth.js credential submissions and CSRF tokens.
 * @auth {public}
 */
export const { GET, POST } = handlers;

import { proxyUpload } from '../../../lib/uploadProxy';

/**
 * Handles POST /upload/[...path]: every browser upload, streamed to the same path on apps/api,
 * which authenticates it (`lib/uploadProxy.ts`).
 * @auth {api-bearer}
 */
export const POST = proxyUpload;

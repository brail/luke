declare function buildApiUrl(path: string): string;

// ruleid: luke-no-hardcoded-api-url
export const trpcUrl = 'http://localhost:3001/trpc';

// ruleid: luke-no-hardcoded-api-url
export const uploadUrl = `http://127.0.0.1:3001/upload/${'logo'}`;

// ok: luke-no-hardcoded-api-url
export const built = buildApiUrl('/trpc');

// ok: luke-no-hardcoded-api-url
export const webOrigin = 'http://localhost:3000';

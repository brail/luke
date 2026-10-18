/**
 * Names the database a script is about to work on, so the operator reads it before anything
 * happens: host, port and database, never the credentials in the connection string.
 */
export function describeTarget(url: string | undefined): string {
  if (!url) return '(DATABASE_URL not set)';
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}:${parsed.port || '5432'}${parsed.pathname}`;
  } catch {
    return '(unparseable DATABASE_URL)';
  }
}

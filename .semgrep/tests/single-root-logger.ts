import pino from 'pino';

declare const rootLogger: { child(bindings: object): unknown };

// ruleid: luke-single-root-logger
export const moduleLogger = pino({ level: 'info' });

// ok: luke-single-root-logger
export const childLogger = rootLogger.child({ module: 'mailer' });

// ok: luke-single-root-logger
export const destination = pino.destination(1);

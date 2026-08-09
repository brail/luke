function bad(logger: { info: (msg: string) => void }) {
  // ruleid: luke-no-console
  console.log('debug output');
}

function alsoBad() {
  // ruleid: luke-no-console
  console.error('boom');
}

function good(ctx: { logger: { info: (msg: string) => void } }) {
  // ok: luke-no-console
  ctx.logger.info('debug output');
}

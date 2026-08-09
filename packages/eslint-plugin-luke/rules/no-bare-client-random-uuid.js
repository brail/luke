const MESSAGE =
  'crypto.randomUUID() is undefined outside a secure context (HTTPS or localhost) — a client ' +
  "component reached over plain HTTP (e.g. an internal http:// hostname) crashes with " +
  '"crypto.randomUUID is not a function". Use the optional-call fallback: ' +
  'crypto.randomUUID?.() || Math.random().toString(36).substring(2) + Date.now().toString(36) ' +
  '(see apps/web/src/lib/trpc.tsx).';

/** True if `node.body[0]` is a `'use client'` directive prologue statement. */
function isClientComponent(programNode) {
  const first = programNode.body[0];
  return (
    !!first &&
    first.type === 'ExpressionStatement' &&
    first.expression.type === 'Literal' &&
    first.expression.value === 'use client'
  );
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        "Require the optional-call fallback for crypto.randomUUID() in 'use client' files — bare calls crash outside secure contexts.",
    },
    schema: [],
    messages: {
      bareRandomUUID: MESSAGE,
    },
  },
  create(context) {
    let clientComponent = false;

    return {
      Program(node) {
        clientComponent = isClientComponent(node);
      },
      'CallExpression[callee.object.name="crypto"][callee.property.name="randomUUID"]'(node) {
        if (clientComponent && !node.optional) {
          context.report({ node, messageId: 'bareRandomUUID' });
        }
      },
    };
  },
};

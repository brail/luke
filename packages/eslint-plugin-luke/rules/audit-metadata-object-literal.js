const MESSAGE =
  '`metadata` must be an object literal with its keys written out, and no spread. `AuditMetadata` ' +
  'types this property against `SAFE_KEY_LIST`, but TypeScript\'s excess-property check only sees ' +
  'properties written literally: `metadata: someVar`, `metadata: { ...input }` and ' +
  '`...(cond && { … })` all walk past it. A key that gets through is not an error — the sanitizer ' +
  'stores `[REDACTED]` — so the loss is silent until someone reads the audit log months later. ' +
  'Write the keys out; if the value really is dynamic, pick the fields explicitly.';

const AUDIT_CALLEE = 'logAudit';

/** `logAudit(...)`, `auditLog.logAudit(...)`, `await logAudit(...)` — however it is spelled. */
function isAuditCall(node) {
  const { callee } = node;
  if (callee.type === 'Identifier') return callee.name === AUDIT_CALLEE;
  return (
    callee.type === 'MemberExpression' &&
    callee.property.type === 'Identifier' &&
    callee.property.name === AUDIT_CALLEE
  );
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require logAudit metadata to be a spread-free object literal: the AuditMetadata type only checks literal properties, so every other form drifts silently into [REDACTED].',
    },
    schema: [],
    messages: { notLiteral: MESSAGE, hasSpread: MESSAGE },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (!isAuditCall(node)) return;

        for (const arg of node.arguments) {
          if (arg.type !== 'ObjectExpression') continue;

          const metadata = arg.properties.find(
            p =>
              p.type === 'Property' &&
              !p.computed &&
              ((p.key.type === 'Identifier' && p.key.name === 'metadata') ||
                (p.key.type === 'Literal' && p.key.value === 'metadata')),
          );
          if (!metadata) continue;

          if (metadata.value.type !== 'ObjectExpression') {
            context.report({ node: metadata.value, messageId: 'notLiteral' });
            continue;
          }

          // A conditional spread (`...(cond && { … })`) is the form that reads most like a literal
          // and is checked least — its keys are invisible to the type exactly like a bare variable.
          for (const prop of metadata.value.properties) {
            if (prop.type === 'SpreadElement') {
              context.report({ node: prop, messageId: 'hasSpread' });
            }
          }
        }
      },
    };
  },
};

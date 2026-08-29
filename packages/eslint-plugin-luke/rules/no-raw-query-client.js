const MESSAGE =
  'Reach the React Query cache through `trpc.useUtils()`, not `useQueryClient()`. A tRPC hook\'s ' +
  'query key is generated — `[["config","list"], { … }]` — so a hand-written one like ' +
  '`{ queryKey: ["config"] }` matches nothing and the invalidation silently does nothing. That is ' +
  'exactly how a deleted row stayed on screen: the mutation succeeded, the cache was never told. ' +
  '`utils.<router>.<procedure>.invalidate()` is type-checked against the real path instead.';

const REACT_QUERY = '@tanstack/react-query';
const BANNED = 'useQueryClient';

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow useQueryClient() in the web app: tRPC query keys are generated, so a hand-built key never matches and the invalidation is a no-op.',
    },
    schema: [],
    messages: { rawQueryClient: MESSAGE },
  },
  create(context) {
    return {
      // `import { useQueryClient } from '@tanstack/react-query'`
      ImportDeclaration(node) {
        if (node.source.value !== REACT_QUERY) return;
        for (const spec of node.specifiers) {
          if (spec.type === 'ImportSpecifier' && spec.imported.name === BANNED) {
            context.report({ node: spec, messageId: 'rawQueryClient' });
          }
        }
      },
      // Any call to it, however it got here (namespace import, re-export, a local alias).
      CallExpression(node) {
        const { callee } = node;
        const isDirect = callee.type === 'Identifier' && callee.name === BANNED;
        const isMember =
          callee.type === 'MemberExpression' &&
          callee.property.type === 'Identifier' &&
          callee.property.name === BANNED;
        if (isDirect || isMember) {
          context.report({ node, messageId: 'rawQueryClient' });
        }
      },
    };
  },
};

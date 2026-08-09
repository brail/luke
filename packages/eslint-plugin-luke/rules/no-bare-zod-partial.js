const MESSAGE =
  "Don't call .partial() directly — Zod v4 re-injects .default() values for fields omitted " +
  'from the input, which silently overwrites data once the partial schema feeds a Prisma update. ' +
  'Use partialWithoutDefaults() from @luke/core instead.';

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow bare .partial() on a Zod object schema; require partialWithoutDefaults() from @luke/core.',
    },
    schema: [],
    messages: {
      bareZodPartial: MESSAGE,
    },
  },
  create(context) {
    return {
      'CallExpression[callee.property.name="partial"]'(node) {
        context.report({ node: node.callee.property, messageId: 'bareZodPartial' });
      },
    };
  },
};

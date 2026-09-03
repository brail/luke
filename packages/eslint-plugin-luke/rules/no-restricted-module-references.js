import { moduleReferenceVisitors } from './lib/module-references.js';

/**
 * `no-restricted-imports` for every static module-reference form.
 *
 * ESLint's own rule sees `import`/`export … from` only. A module it forbids
 * still enters the graph through `import('x')`, `` import(`x`) ``,
 * `require('x')`, `import x = require('x')` and the type-level
 * `import('x').X` — measured on the real config for `@luke/core/server` from
 * an unenrolled web file: five of seven forms were silent. This rule takes the
 * same `paths` shape and judges all of them through `lib/module-references.js`.
 *
 * A match is the exact specifier or a deeper subpath of it (`x/…`). Type-only
 * forms are reported too, as the core rule does: a boundary that is drawn for
 * a module is drawn for its types as well.
 */

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Forbid the given module specifiers in every static reference form, not only import declarations.',
    },
    // Object-form schema so the options *array* itself is validated: with the
    // array form ESLint checks only the options that are present, and a bare
    // `'error'` reached `create` with no options at all — measured as a
    // TypeError while loading the rule, not a configuration error. `minItems`
    // makes the missing `paths` a schema violation ESLint reports as such.
    schema: {
      type: 'array',
      minItems: 1,
      maxItems: 1,
      items: [
        {
          type: 'object',
          properties: {
            paths: {
              type: 'array',
              minItems: 1,
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string', minLength: 1 },
                  message: { type: 'string', minLength: 1 },
                },
                required: ['name', 'message'],
                additionalProperties: false,
              },
            },
          },
          required: ['paths'],
          additionalProperties: false,
        },
      ],
    },
    messages: {
      restricted: "'{{specifier}}' is restricted here ({{form}}). {{message}}",
    },
  },

  create(context) {
    const paths = context.options[0].paths;

    return moduleReferenceVisitors(({ node, specifier, form }) => {
      const hit = paths.find((p) => specifier === p.name || specifier.startsWith(`${p.name}/`));
      if (hit) {
        context.report({ node, messageId: 'restricted', data: { specifier, form, message: hit.message } });
      }
    });
  },
};

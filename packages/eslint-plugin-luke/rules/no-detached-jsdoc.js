const isJsdoc = comment => comment.type === 'Block' && comment.value.startsWith('*');

/**
 * Refuses a JSDoc block followed directly by another one, with nothing but whitespace and no blank
 * line between them. TypeScript attaches only the last block to the declaration below, so the
 * first documents nothing and the declaration it was written for is left undocumented. Both
 * occurrences found were a doc block left behind when an edit moved or separated its declaration
 * (`lessons.md`, 2026-09-29). A blank line keeps a file header apart from the first declaration's
 * doc, which is how a header is written here.
 */
export default {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow a JSDoc block stacked directly on another JSDoc block.' },
    schema: [],
    messages: {
      detached:
        'Detached JSDoc: another JSDoc block follows it directly, so TypeScript attaches this one to ' +
        'nothing. Move it back onto the declaration it documents, or merge the two blocks.',
    },
  },
  create(context) {
    const { sourceCode } = context;
    return {
      Program() {
        const comments = sourceCode.getAllComments();
        for (let i = 0; i < comments.length - 1; i++) {
          const current = comments[i];
          const next = comments[i + 1];
          const between = sourceCode.text.slice(current.range[1], next.range[0]);
          if (isJsdoc(current) && isJsdoc(next) && between.trim() === '' && !/\n[^\S\n]*\n/.test(between)) {
            context.report({ loc: current.loc, messageId: 'detached' });
          }
        }
      },
    };
  },
};

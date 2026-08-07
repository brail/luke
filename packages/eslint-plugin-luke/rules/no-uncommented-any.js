const MESSAGE =
  "'any' senza commento esplicativo — CLAUDE.md richiede strict mode (no any, " +
  "no type assertion senza commento). Aggiungi un commento sulla stessa riga o " +
  "sulla riga precedente che spiega perche' non e' tipizzabile diversamente, " +
  "oppure usa 'unknown' + un type guard.";

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        "Disallow 'any' type annotations/assertions without an explanatory comment on the same or preceding line.",
    },
    schema: [],
    messages: { uncommentedAny: MESSAGE },
  },
  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode();

    // Accepts a trailing same-line comment (`x as any // reason`) or a comment block on the
    // line(s) directly above — the dominant style in this codebase for JSX props and multi-`any`
    // statements, where a single explanation covers every `any` in the expression/tag below it.
    function hasNearbyComment(node) {
      const startLine = node.loc.start.line;
      const endLine = node.loc.end.line;
      return sourceCode.getAllComments().some(c => {
        if (c.loc.start.line === endLine || c.loc.end.line === endLine) return true;
        return c.loc.end.line >= startLine - 3 && c.loc.end.line < startLine;
      });
    }

    function check(node) {
      if (!hasNearbyComment(node)) {
        context.report({ node, messageId: 'uncommentedAny' });
      }
    }

    return {
      TSAnyKeyword: check,
    };
  },
};

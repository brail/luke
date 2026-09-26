const MESSAGE =
  "'any' without an explanatory comment — CLAUDE.md requires strict mode (no any, " +
  "no type assertion without a comment). Add a comment on the same line or " +
  "the line above explaining why it cannot be typed otherwise, " +
  "or use 'unknown' + a type guard.";

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

const MESSAGE =
  "Valore Tailwind arbitrario (`prop-[...]`) senza commento esplicativo — CLAUDE.md " +
  "richiede un commento che giustifichi il valore quando non esiste uno step della " +
  "scala standard equivalente. Se uno step equivalente esiste, usa quello invece.";

// Matches a Tailwind arbitrary-VALUE utility token (`w-[327px]`, `max-h-[90vh]`,
// `sm:max-w-[500px]`, `grid-cols-[1fr_auto]`) but not arbitrary-VARIANT selectors
// (`data-[state=open]:`, `has-[...]`, `group-data-[...]`, `aria-[...]`, `[&_svg]`) — those have
// no non-arbitrary equivalent by design and are idiomatic Radix/shadcn syntax, not "magic
// numbers" needing justification.
const ARBITRARY_VALUE_TOKEN = /^[a-zA-Z0-9:_-]+-\[[^\]]+\]$/;
const VARIANT_PREFIX = /(?:^|:)(?:data|aria|has|group-data|peer-data|group-has|peer-has)-\[/;

function containsArbitraryValue(text) {
  if (!text || typeof text !== 'string') return false;
  return text.split(/\s+/).some(tok => {
    if (tok.startsWith('[&')) return false;
    if (!ARBITRARY_VALUE_TOKEN.test(tok)) return false;
    return !VARIANT_PREFIX.test(tok);
  });
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow Tailwind arbitrary-value utilities without an explanatory comment on the same or preceding line.',
    },
    schema: [],
    messages: { uncommentedArbitrary: MESSAGE },
  },
  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode();
    const filename = context.filename ?? context.getFilename();

    // shadcn CLI-generated primitives (components/ui/**) are vendor files regenerated via
    // `pnpm dlx shadcn@latest add <component>` — not hand-maintained, so not linted here.
    if (/[\\/]components[\\/]ui[\\/]/.test(filename)) {
      return {};
    }

    function hasNearbyComment(node) {
      const startLine = node.loc.start.line;
      const endLine = node.loc.end.line;
      return sourceCode.getAllComments().some(c => {
        if (c.loc.start.line === endLine || c.loc.end.line === endLine) return true;
        return c.loc.end.line >= startLine - 3 && c.loc.end.line < startLine;
      });
    }

    function checkStringValue(node, value) {
      if (containsArbitraryValue(value) && !hasNearbyComment(node)) {
        context.report({ node, messageId: 'uncommentedArbitrary' });
      }
    }

    return {
      Literal(node) {
        if (typeof node.value === 'string') checkStringValue(node, node.value);
      },
      TemplateElement(node) {
        checkStringValue(node, node.value.raw);
      },
    };
  },
};

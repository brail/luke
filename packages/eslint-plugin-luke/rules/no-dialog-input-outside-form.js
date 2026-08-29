const MESSAGE =
  'Text input inside a dialog with no <form> around it. Without one the browser has nothing to ' +
  'submit, so pressing Enter does nothing and validation has nowhere to report. Wrap the fields ' +
  'and the footer in a <form onSubmit={form.handleSubmit(...)}> and give the primary button ' +
  'type="submit". If this input genuinely has nothing to submit (a file picker, a filter), ' +
  'disable this rule on the line with a comment saying which.';

// Single-line entry only. A dialog holding one of these is a form whether or not it says so:
// Enter in a single-line input is the browser's submit gesture, and with no form there is nothing
// for it to submit. Textarea is deliberately absent — there Enter means "newline", so a dialog
// whose only field is a Textarea is legitimately form-less. One holding both is still caught
// through the Input. Checkbox, Switch and Select are reachable by keyboard without a submit.
const TEXT_INPUTS = new Set(['Input', 'NumberInput']);

// Overlay bodies. Enter is only load-bearing inside one of these: elsewhere the surrounding page
// form, if any, already governs the field.
const DIALOG_BODIES = new Set(['DialogContent', 'AlertDialogContent', 'SheetContent']);

/** Element name for both `<Input>` and `<Some.Input>`. */
function elementName(node) {
  const name = node.openingElement?.name;
  if (!name) return null;
  if (name.type === 'JSXIdentifier') return name.name;
  if (name.type === 'JSXMemberExpression' && name.property.type === 'JSXIdentifier') {
    return name.property.name;
  }
  return null;
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require a <form> ancestor for text inputs rendered inside a dialog, so Enter submits and validation has somewhere to report.',
    },
    schema: [],
    messages: { inputOutsideForm: MESSAGE },
  },
  create(context) {
    const filename = context.filename ?? context.getFilename();

    // shadcn CLI-generated primitives are vendor files, regenerated rather than hand-maintained.
    if (/[\\/]components[\\/]ui[\\/]/.test(filename)) {
      return {};
    }

    return {
      JSXElement(node) {
        if (!TEXT_INPUTS.has(elementName(node))) return;

        // Walk outward: a <form> on the way up satisfies the rule, a dialog body reached first
        // does not. Render props (`<FormField render={() => <Input/>} />`) stay on this chain,
        // so a field declared that way is still seen inside its form.
        for (let parent = node.parent; parent; parent = parent.parent) {
          if (parent.type !== 'JSXElement') continue;
          const name = elementName(parent);
          if (name === 'form') return;
          if (DIALOG_BODIES.has(name)) {
            context.report({ node, messageId: 'inputOutsideForm' });
            return;
          }
        }
      },
    };
  },
};

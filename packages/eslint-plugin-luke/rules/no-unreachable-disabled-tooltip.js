const MESSAGE =
  'Tooltip on a disabled control that keyboard users cannot reach. A disabled element emits ' +
  'neither pointerenter nor focus and is skipped by Tab, so with `asChild` the trigger never ' +
  'fires: the control is greyed out and the message explaining why never appears. Use ' +
  '<PermissionButton> for a permission gate on a Button, <PermissionTooltip> for anything else, ' +
  'or make the trigger a wrapper element carrying tabIndex — <span className="inline-flex" ' +
  'tabIndex={0}> around the disabled control.';

const NEGATIVE_TABINDEX_MESSAGE =
  'The wrapper carries a negative tabIndex, so Tab still skips it and the tooltip stays ' +
  'mouse-only — the plausible wrong fix, which looks like the sanctioned pattern and changes ' +
  'nothing. Use tabIndex={0}, or bind it to the disabled state (tabIndex={isLoading ? 0 : -1}) ' +
  'when the control is disabled only some of the time.';

const SELF_DISABLED_MESSAGE =
  'The tooltip trigger is itself disabled, so it never fires — a disabled element emits no ' +
  'pointer or focus events, and tabIndex does not make it focusable. Move the trigger onto a ' +
  'wrapper: <span className="inline-flex" tabIndex={0}> around the disabled control, or use ' +
  '<PermissionButton> for a permission gate.';

/** Element name for both `<Button>` and `<Some.Button>`. */
function elementName(node) {
  const name = node.openingElement?.name;
  if (!name) return null;
  if (name.type === 'JSXIdentifier') return name.name;
  if (name.type === 'JSXMemberExpression' && name.property.type === 'JSXIdentifier') {
    return name.property.name;
  }
  return null;
}

function getAttribute(node, attributeName) {
  return node.openingElement.attributes.find(
    attribute =>
      attribute.type === 'JSXAttribute' &&
      attribute.name.type === 'JSXIdentifier' &&
      attribute.name.name === attributeName
  );
}

function hasAttribute(node, attributeName) {
  return getAttribute(node, attributeName) !== undefined;
}

/**
 * Every `JSXElement` anywhere under `node`, including the ones reached only through an expression
 * container — `{items.map(i => <button disabled />)}` renders disabled controls just as much as a
 * literal child does, and a check that stops at literal children misses the whole family.
 * `parent` is skipped: ESLint back-links it during traversal and following it never terminates.
 */
function* jsxElements(node) {
  if (node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) yield* jsxElements(item);
    return;
  }
  if (typeof node.type !== 'string') return;
  if (node.type === 'JSXElement') yield node;
  for (const key of Object.keys(node)) {
    if (key === 'parent' || key === 'loc' || key === 'range') continue;
    yield* jsxElements(node[key]);
  }
}

/**
 * Whether the subtree renders something disabled. `disabled={isLoading}` counts: a control
 * disabled only while a mutation runs is just as unreachable during that window, and the window
 * is exactly when the user wants to know why the control does not respond.
 */
function containsDisabled(node) {
  for (const element of jsxElements(node)) {
    if (hasAttribute(element, 'disabled')) return true;
  }
  return false;
}

/**
 * The elements a trigger can actually render. Usually one literal child, but a child wrapped in an
 * expression container — `{cond ? <a /> : <b />}` — resolves to every branch, and each branch is a
 * trigger in its own right.
 */
function triggerRoots(node) {
  const meaningful = node.children.filter(
    child =>
      child.type === 'JSXElement' ||
      child.type === 'JSXFragment' ||
      (child.type === 'JSXText' && child.value.trim() !== '') ||
      (child.type === 'JSXExpressionContainer' &&
        child.expression.type !== 'JSXEmptyExpression')
  );
  if (meaningful.length !== 1) return [];
  return expressionRoots(meaningful[0]);
}

function expressionRoots(node) {
  switch (node.type) {
    case 'JSXElement':
      return [node];
    case 'JSXExpressionContainer':
      return expressionRoots(node.expression);
    case 'ConditionalExpression':
      return [...expressionRoots(node.consequent), ...expressionRoots(node.alternate)];
    case 'LogicalExpression':
      return expressionRoots(node.right);
    default:
      return [];
  }
}

/** Whether a `tabIndex` attribute can only ever hold a negative value, which Tab skips. */
function isAlwaysNegative(attribute) {
  const value = attribute.value;
  if (!value) return false;
  if (value.type === 'Literal') return Number(value.value) < 0;
  if (value.type !== 'JSXExpressionContainer') return false;
  const expression = value.expression;
  if (expression.type === 'Literal') return Number(expression.value) < 0;
  return (
    expression.type === 'UnaryExpression' &&
    expression.operator === '-' &&
    expression.argument.type === 'Literal' &&
    Number(expression.argument.value) > 0
  );
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require a focusable trigger for a tooltip that explains a disabled control, so keyboard users can reach the explanation.',
    },
    schema: [],
    messages: {
      unreachable: MESSAGE,
      negativeTabIndex: NEGATIVE_TABINDEX_MESSAGE,
      selfDisabled: SELF_DISABLED_MESSAGE,
    },
  },
  create(context) {
    const filename = context.filename ?? context.getFilename();

    // shadcn CLI-generated primitives are vendor files, regenerated rather than hand-maintained.
    if (/[\\/]components[\\/]ui[\\/]/.test(filename)) {
      return {};
    }

    return {
      JSXElement(node) {
        if (elementName(node) !== 'TooltipTrigger') return;
        if (!hasAttribute(node, 'asChild')) return;

        for (const child of triggerRoots(node)) {
          if (!containsDisabled(child)) continue;

          if (hasAttribute(child, 'disabled')) {
            context.report({ node: child, messageId: 'selfDisabled' });
            continue;
          }
          const tabIndex = getAttribute(child, 'tabIndex');
          if (!tabIndex) {
            context.report({ node: child, messageId: 'unreachable' });
          } else if (isAlwaysNegative(tabIndex)) {
            context.report({ node: child, messageId: 'negativeTabIndex' });
          }
        }
      },
    };
  },
};

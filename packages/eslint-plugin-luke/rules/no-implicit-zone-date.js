/**
 * The zone-implicit date forms ADR-035 §Enforcement refuses outside core's date modules: each reads
 * or writes a date in the zone of the process or the browser, which is neither the business zone
 * nor the reader's. A syntax rule, without type information: a method of another object that shares
 * a `Date` method's name is reported too, and is exempted with its reason.
 */

/** `Date` methods that read or write the local wall clock, or format in the local zone. */
const LOCAL_DATE_METHODS = new Set([
  'getFullYear', 'getYear', 'getMonth', 'getDate', 'getDay', 'getHours', 'getMinutes', 'getSeconds', 'getMilliseconds',
  'setFullYear', 'setYear', 'setMonth', 'setDate', 'setHours', 'setMinutes', 'setSeconds', 'setMilliseconds',
  'getTimezoneOffset', 'toDateString', 'toTimeString', 'toLocaleDateString', 'toLocaleTimeString',
]);

/**
 * A date-time string that names its offset after the time (`Z`, `±hh:mm`, `±hhmm`, `±hh`): it means one
 * instant in every zone. The time is required, or the `-10` of `2026-03-10` would read as an offset.
 */
const ZONED_STRING = /(?:Z|T[\d:.]+[+-]\d{2}(?::?\d{2})?)$/;

/** The end of a template's text that names the offset: `Z` or `±hh:mm`, the time being interpolated. */
const ZONED_TEMPLATE_END = /(?:Z|[+-]\d{2}:\d{2})$/;

/** The methods that cut the first ten characters — the date — off an ISO string. */
const DATE_PREFIX_METHODS = new Set(['slice', 'substring', 'substr']);

const propertyName = node => (node.type === 'MemberExpression' && !node.computed && node.property.type === 'Identifier' ? node.property.name : null);
const isIdentifier = (node, name) => node.type === 'Identifier' && node.name === name;
const isNumber = (node, value) => node.type === 'Literal' && node.value === value;

/** `x.method(...)`: the callee's object when `call` invokes `method`, otherwise null. */
function receiverOf(call, method) {
  return call.type === 'CallExpression' && propertyName(call.callee) === method ? call.callee.object : null;
}

/**
 * Whether `node` is visibly a string being assembled: a template, or a `+` with a string operand.
 * A `+` of two names may be arithmetic (`Date.now() + ttl`), which syntax cannot tell apart.
 */
function isAssembledString(node) {
  if (node.type === 'TemplateLiteral') return true;
  if (node.type !== 'BinaryExpression' || node.operator !== '+') return false;
  const isString = side => (side.type === 'Literal' && typeof side.value === 'string') || isAssembledString(side);
  return isString(node.left) || isString(node.right);
}

/** A template whose text ends by naming the offset, as `${date}T${time}:00Z` does. */
const isZonedTemplate = node => node.type === 'TemplateLiteral' && ZONED_TEMPLATE_END.test(node.quasis.at(-1).value.cooked ?? '');

/**
 * What makes the date string `argument` (of `new Date` or `Date.parse`) zone-implicit, or null when
 * nothing visible does: a literal or a template that does not name its offset, or a concatenation.
 * A variable is not judged — an ISO string from the server names its offset.
 */
function implicitDateArgument(argument, callee) {
  if (argument.type === 'Literal' && typeof argument.value === 'string' && !ZONED_STRING.test(argument.value)) return `${callee}(<string without Z>)`;
  if (argument.type === 'TemplateLiteral') return isZonedTemplate(argument) ? null : `${callee}(\`…\`)`;
  if (isAssembledString(argument)) return `${callee}(<concatenation>)`;
  return null;
}

/** Whether `node` is `x.toISOString()` or `x.toJSON()`, an instant's UTC ISO string. */
const isIsoString = node => !!(receiverOf(node, 'toISOString') || receiverOf(node, 'toJSON'));

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Refuse the zone-implicit Date forms outside core\'s date modules (ADR-035 §Enforcement).',
    },
    schema: [],
    messages: {
      implicitZone:
        '`{{form}}` reads or writes a date in the zone of the process or the browser. Name the zone through ' +
        "core's date helpers (calendarDateIn, instantAt, wallTimeIn, formatInstant, …) — ADR-035 §Enforcement.",
      datetimeSchema:
        '`z.string().datetime()` (`z.iso.datetime()`) accepts any offset and no bounds: use CalendarInstantSchema or ' +
        'CalendarDateSchema from @luke/core — ADR-035 §Enforcement.',
    },
  },
  create(context) {
    const report = (node, form) => context.report({ node, messageId: 'implicitZone', data: { form } });

    return {
      CallExpression(node) {
        const method = propertyName(node.callee);
        if (method && LOCAL_DATE_METHODS.has(method)) return report(node, `.${method}()`);

        if (method === 'parse' && isIdentifier(node.callee.object, 'Date')) {
          const form = node.arguments.length === 1 ? implicitDateArgument(node.arguments[0], 'Date.parse') : null;
          return form ? report(node, form) : undefined;
        }

        // `x.toISOString().slice(0, 10)`: the UTC date of an instant, whatever zone it was meant in.
        if (DATE_PREFIX_METHODS.has(method) && isIsoString(node.callee.object) && node.arguments.length === 2 && isNumber(node.arguments[0], 0) && isNumber(node.arguments[1], 10)) {
          return report(node, `.toISOString().${method}(0, 10)`);
        }

        // `z.string().datetime()`, and Zod 4's `z.iso.datetime()`, which is the same validator.
        const datetimeOf = receiverOf(node, 'datetime');
        if (!datetimeOf) return;
        const zodString = receiverOf(datetimeOf, 'string');
        const zodIso = datetimeOf.type === 'MemberExpression' && propertyName(datetimeOf) === 'iso' ? datetimeOf.object : null;
        if ((zodString && isIdentifier(zodString, 'z')) || (zodIso && isIdentifier(zodIso, 'z'))) context.report({ node, messageId: 'datetimeSchema' });
      },
      // `x.toISOString().split('T')[0]`, the same UTC date by another spelling.
      'MemberExpression[computed=true]'(node) {
        const split = receiverOf(node.object, 'split');
        if (split && isIsoString(split) && isNumber(node.property, 0) && node.object.arguments.length === 1 && node.object.arguments[0].value === 'T') {
          report(node, ".toISOString().split('T')[0]");
        }
      },
      NewExpression(node) {
        if (!isIdentifier(node.callee, 'Date')) return;
        if (node.arguments.length >= 2) return report(node, 'new Date(y, m, …)');
        const form = node.arguments.length === 1 ? implicitDateArgument(node.arguments[0], 'new Date') : null;
        if (form) report(node, form);
      },
      // A value reference only: `Intl.DateTimeFormatOptions` in a type is a TSQualifiedName.
      MemberExpression(node) {
        if (isIdentifier(node.object, 'Intl') && propertyName(node) === 'DateTimeFormat') report(node, 'Intl.DateTimeFormat');
      },
    };
  },
};

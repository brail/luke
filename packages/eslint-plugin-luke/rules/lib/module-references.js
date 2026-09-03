/**
 * Every statically knowable module reference in a file, normalised to one
 * callback, so that a rule about specifiers sees the same forms wherever it is
 * used. A rule that visits only `ImportDeclaration` is silent on the rest —
 * measured on the real config, not assumed:
 *
 * - `import x from 's'` / `import type x from 's'` / `import { type x } from 's'`
 * - `export { x } from 's'` / `export * from 's'` / `export type { x } from 's'`
 * - `import('s')` and `import(\`s\`)` — a template literal with no `${}` is as
 *   static as a string, and `require(\`s\`)` likewise
 * - `require('s')`
 * - `import x = require('s')`
 * - `import('s').X` and `typeof import('s')` — `TSImportType`, erased by the
 *   compiler but a reference the type checker resolves
 *
 * `typeOnly` is true for the forms the compiler erases. A specifier built from
 * an expression (`import(name)`, `` import(`${base}/x`) ``) is not judged: it
 * is not statically knowable, and silence there is the honest answer.
 */

function staticSpecifier(node) {
  if (!node) return null;
  if (node.type === 'Literal' && typeof node.value === 'string') return { node, value: node.value };
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0 && node.quasis.length === 1) {
    const cooked = node.quasis[0].value.cooked;
    return typeof cooked === 'string' ? { node, value: cooked } : null;
  }
  return null;
}

function allSpecifiersTypeOnly(specifiers, kindKey) {
  return specifiers.length > 0 && specifiers.every((s) => s[kindKey] === 'type');
}

/**
 * @param {(ref: { node: import('estree').Node, specifier: string, typeOnly: boolean, form: string }) => void} onReference
 * @returns {Record<string, (node: any) => void>} ESLint visitor map
 */
export function moduleReferenceVisitors(onReference) {
  return {
    ImportDeclaration(node) {
      const typeOnly = node.importKind === 'type' || allSpecifiersTypeOnly(node.specifiers, 'importKind');
      onReference({ node: node.source, specifier: node.source.value, typeOnly, form: 'import' });
    },
    'ExportNamedDeclaration[source]'(node) {
      const typeOnly = node.exportKind === 'type' || allSpecifiersTypeOnly(node.specifiers, 'exportKind');
      onReference({ node: node.source, specifier: node.source.value, typeOnly, form: 'export-from' });
    },
    ExportAllDeclaration(node) {
      onReference({ node: node.source, specifier: node.source.value, typeOnly: node.exportKind === 'type', form: 'export-all' });
    },
    ImportExpression(node) {
      const s = staticSpecifier(node.source);
      if (s) onReference({ node: s.node, specifier: s.value, typeOnly: false, form: 'import()' });
    },
    'CallExpression[callee.type="Identifier"][callee.name="require"]'(node) {
      const s = staticSpecifier(node.arguments[0]);
      if (s) onReference({ node: s.node, specifier: s.value, typeOnly: false, form: 'require()' });
    },
    TSImportEqualsDeclaration(node) {
      if (node.moduleReference.type !== 'TSExternalModuleReference') return;
      const s = staticSpecifier(node.moduleReference.expression);
      if (s) onReference({ node: s.node, specifier: s.value, typeOnly: node.importKind === 'type', form: 'import = require()' });
    },
    TSImportType(node) {
      // `source` is the canonical field on typescript-estree's TSImportType —
      // the literal itself. `argument` is a deprecated getter that wraps it in
      // a TSLiteralType and may go; a rule reading it would go silent, not
      // fail. Pinned by `lib/__tests__/module-references.test.js`.
      const s = staticSpecifier(node.source);
      if (s) onReference({ node: s.node, specifier: s.value, typeOnly: true, form: 'import() type' });
    },
  };
}

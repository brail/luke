// sharp's package.json "exports" field omits a "types" condition, so NodeNext/bundler
// module resolution can't find its bundled lib/index.d.ts on its own. A tsconfig
// `paths` remap would fix the type checker but ALSO redirects tsx's runtime
// `require('sharp')` to this declaration file (crashing with "sharp is not
// defined") — an ambient module declaration only affects the type checker.
//
// Centralized here rather than under apps/api/src/types/ because apps/web's own
// TS program also type-checks apps/api/src/lib/export/image.ts (via the
// @luke/api/* path alias used for tRPC end-to-end types), and ambient
// declarations don't propagate across separate TS programs. apps/api picks this
// up via typeRoots (see root tsconfig.json); apps/web's Next.js typecheck doesn't
// honor typeRoots, so it pulls this in via a triple-slash reference instead
// (see apps/web/src/types/sharp.d.ts).
declare module 'sharp' {
  import Sharp = require('../../apps/api/node_modules/sharp/lib/index');
  export = Sharp;
}

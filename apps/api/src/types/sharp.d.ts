// sharp's package.json "exports" field omits a "types" condition, so NodeNext
// module resolution can't find its bundled lib/index.d.ts on its own. A tsconfig
// `paths` remap would fix the type checker but ALSO redirects tsx's runtime
// `require('sharp')` to this declaration file (crashing with "sharp is not
// defined") — an ambient module declaration only affects the type checker.
declare module 'sharp' {
  import Sharp = require('../../node_modules/sharp/lib/index');
  export = Sharp;
}

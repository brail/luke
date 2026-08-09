// Next.js's own build-time typecheck does not honor `typeRoots` (confirmed: neither
// inherited via `extends` nor declared directly in this package's tsconfig — plain
// `tsc` picks up the ../../types/sharp shim fine, Next's checker does not). A
// triple-slash reference is a compiler directive processed independently of
// typeRoots/module resolution, and this file is naturally part of apps/web's own
// tsconfig `include` glob, so it reliably pulls the shared shim into this program.
/// <reference path="../../../../types/sharp/index.d.ts" />

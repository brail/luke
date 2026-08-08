/**
 * Setup file for the integration project only: activates the procedure recorder.
 *
 * Separate from `test/setup.ts` because that one is shared with the unit
 * project, where no spec invokes `appRouter` and importing it would add the
 * app's module graph to suites that don't need it.
 */

import { installProcedureRecorder } from './helpers/procedureUsage';

installProcedureRecorder();

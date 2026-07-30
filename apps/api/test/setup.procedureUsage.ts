/**
 * Setup file del solo progetto integration: attiva il recorder delle procedure.
 *
 * Separato da `test/setup.ts` perché quello è condiviso col progetto unit, dove
 * nessuna spec invoca `appRouter` e importarlo aggiungerebbe il module graph
 * dell'app a suite che non ne hanno bisogno.
 */

import { installProcedureRecorder } from './helpers/procedureUsage';

installProcedureRecorder();

/**
 * Conferma di un upload *pending* e collegamento a un'entità.
 *
 * Un file caricato nasce con `confirmedAt: null`: esiste nello storage ma non
 * appartiene ancora a nulla, e il reaper orario in `server.ts` lo spazza se
 * resta così. Collegarlo a un brand, a una riga di collection o al profilo
 * aziendale significa marcarlo confermato e scriverne la key sull'entità.
 *
 * Il predicato viveva copiato quattro volte — `brand.create`, `brand.update`,
 * `collectionLayout.rows.create`, `collectionLayout.rows.update` — carattere per
 * carattere. Questo modulo è quello, una volta sola.
 *
 * ## Senza policy, di proposito
 *
 * Unifica il **predicato**, non la **reazione**: ritorna la key oppure `null`, e
 * cosa farne lo decide il chiamante. È deliberato, perché i chiamanti divergono —
 * il profilo aziendale rifiuta con BAD_REQUEST (un salvataggio silenziosamente
 * senza logo è perdita di dati con un toast di successo), mentre il brand ha
 * storicamente ignorato l'id morto. Costringerli alla stessa reazione qui
 * significherebbe o duplicare di nuovo il predicato, o cambiare comportamento a
 * un chiamante di straforo.
 *
 * Vive in `lib/` e non in `services/` perché è una primitiva di transazione
 * senza conoscenza di dominio.
 */

import type { StorageBucket } from '@luke/core';

import type { Prisma, PrismaClient } from '@prisma/client';

/** Accetta sia il client normale sia quello di una transazione interattiva. */
type PrismaLike = PrismaClient | Prisma.TransactionClient;

/**
 * Conferma un `FileObject` pending e ne restituisce la storage key.
 *
 * I tre controlli sono congiuntivi e nessuno è ridondante:
 * - `confirmedAt === null` — deve essere ancora pending, cioè non già collegato
 *   a un'altra entità. Un file confermato ha già un proprietario.
 * - `createdBy === userId` — solo chi l'ha caricato può collegarlo.
 * - `bucket` — impedisce di far passare l'id di un file di un altro dominio
 *   (un logo brand spacciato per logo aziendale, per dire).
 *
 * Va chiamata **dentro** la stessa transazione che scrive la key sull'entità:
 * confermare e collegare devono riuscire o fallire insieme.
 *
 * @returns La storage key da scrivere sull'entità, o `null` se il file non
 *   esiste, non è pending, non è tuo, o è nel bucket sbagliato. Il chiamante
 *   decide se è un errore o un no-op.
 */
export async function confirmPendingFile(
  tx: PrismaLike,
  params: { fileObjectId: string; bucket: StorageBucket; userId: string }
): Promise<string | null> {
  const pendingFile = await tx.fileObject.findUnique({
    where: { id: params.fileObjectId },
    select: { key: true, confirmedAt: true, createdBy: true, bucket: true },
  });

  if (
    pendingFile?.confirmedAt !== null ||
    pendingFile.createdBy !== params.userId ||
    pendingFile.bucket !== params.bucket
  ) {
    return null;
  }

  await tx.fileObject.update({
    where: { id: params.fileObjectId },
    data: { confirmedAt: new Date() },
  });

  return pendingFile.key;
}

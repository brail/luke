'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  applyEdits,
  editsBetween,
  resetEditsToRoleDefaults,
  sendableEdits,
  withoutReflected,
  type SectionEdits,
  type SectionOverrides,
} from '../../../../../lib/sectionTree';
import { trpc } from '../../../../../lib/trpc';

/**
 * The section-override editor both access dialogs use (ADR-027). It holds the overrides the server
 * last returned and the administrator's edits — nothing else:
 * - each opening starts from a fresh read; the editor is ready only once it and the role defaults
 *   have answered, so cached data never stands in for the server;
 * - a background refetch never changes what the editor holds; only a reconciliation does;
 * - a save sends the edits on leaves the kill switch does not cover, each an absolute value, then
 *   reconciles: a fresh read replaces the server state and drops the edits it already reflects.
 *   A failed reconciliation marks the editor `stale`, and the dialog refuses further attempts.
 *
 * The dialog owns the busy state: it must disable every control from the first call of an attempt
 * to the end of its reconciliation, so no edit is made against a server state about to change.
 */
export function useSectionOverridesEditor({ userId, open }: { userId: string; open: boolean }) {
  const utils = trpc.useUtils();
  const setOverride = trpc.sectionAccess.set.useMutation();
  const { data: defaults } = trpc.sectionAccess.getDefaults.useQuery(undefined, { enabled: open });

  const [server, setServer] = useState<SectionOverrides | null>(null);
  const [edits, setEdits] = useState<SectionEdits>({});
  const [stale, setStale] = useState(false);

  /** A read that bypasses the query cache: `staleTime: 0` makes any cached answer too old. */
  const readServer = useCallback(async (): Promise<SectionOverrides> => {
    const rows = await utils.sectionAccess.getByUser.fetch({ userId }, { staleTime: 0 });
    return Object.fromEntries(rows.map(row => [row.section, row.enabled]));
  }, [utils, userId]);

  // A new opening starts from nothing. Reset during render when `open` changes, React's way of
  // adjusting state to a prop, rather than in the effect below.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    setServer(null);
    setEdits({});
    setStale(false);
  }

  useEffect(() => {
    if (!open) return;
    let current = true;
    readServer().then(
      fresh => {
        if (current) setServer(fresh);
      },
      () => {
        if (current) setStale(true);
      }
    );
    return () => {
      current = false;
    };
  }, [open, readServer]);

  /** Re-reads the server: replaces the state held and drops the edits it already reflects. */
  const reconcile = useCallback(
    async (pending: SectionEdits): Promise<void> => {
      try {
        const fresh = await readServer();
        setServer(fresh);
        setEdits(withoutReflected(pending, fresh));
      } catch {
        setEdits(pending);
        setStale(true);
      }
    },
    [readServer]
  );

  const ready = server !== null && defaults !== undefined && !stale;
  const shown = useMemo(() => applyEdits(server ?? {}, edits), [server, edits]);
  const toSend = defaults ? sendableEdits(edits, defaults.disabledSections) : [];

  return {
    /** The role defaults and kill switch, only once the editor is ready. */
    defaults: ready ? defaults : undefined,
    stale,
    /** The overrides the list shows. */
    shown,
    /** Whether a save has anything to send. */
    hasChanges: toSend.length > 0,
    /** Takes the overrides the list wants to show and keeps, as edits, where they differ from the server. */
    onChange: (next: SectionOverrides) => setEdits(editsBetween(server ?? {}, next)),
    /** Every switchable leaf back to the role defaults (a role change); killed leaves untouched. */
    resetToRoleDefaults: () => {
      if (server && defaults) setEdits(resetEditsToRoleDefaults(server, edits, defaults.disabledSections));
    },
    /** Sends the edits, then reconciles. Resolves with the number of calls that failed. */
    save: async (): Promise<number> => {
      const results = await Promise.allSettled(
        toSend.map(([section, enabled]) => setOverride.mutateAsync({ userId, section, enabled }))
      );
      const pending = { ...edits };
      toSend.forEach(([section], i) => {
        if (results[i]?.status === 'fulfilled') delete pending[section];
      });
      await reconcile(pending);
      return results.filter(result => result.status === 'rejected').length;
    },
    /** Re-reads the server after a failure elsewhere in the dialog's attempt. */
    reconcile: () => reconcile(edits),
  };
}

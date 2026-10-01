'use client';

import { Info, Settings2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '../../../../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../../../components/ui/dialog';

import { SectionAccessList } from './SectionAccessList';
import { type UserListItem } from './types';
import { useSectionOverridesEditor } from './useSectionOverridesEditor';

interface UserAccessDialogProps {
  user: UserListItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Dialog for editing section-visibility overrides for an existing user. It saves only the
 * administrator's edits, and re-reads the server after a failure (`useSectionOverridesEditor`).
 * @param user - The user whose section access is being managed.
 */
export function UserAccessDialog({ user, open, onOpenChange }: UserAccessDialogProps) {
  const editor = useSectionOverridesEditor({ userId: user.id, open });
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const failures = await editor.save();
      if (failures > 0) {
        toast.error(`${failures} sezione/i non aggiornata/e`);
        return;
      }
      toast.success('Accesso aggiornato');
      onOpenChange(false);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={next => {
        if (!next && !isSaving) onOpenChange(false);
      }}
    >
      <DialogContent className="sm:max-w-[560px] max-h-[85vh] p-0 gap-0 flex flex-col"> {/* px/vh: dialog width tuned to content, vh cap has no Tailwind scale equivalent */}
        <DialogHeader className="px-6 py-4 border-b shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="h-4 w-4" />
            Gestisci accesso — {user.firstName} {user.lastName}
          </DialogTitle>
          <DialogDescription>
            Configura sezioni visibili. Gli override si applicano sopra i default del ruolo{' '}
            <strong>{user.role}</strong>.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4">
          <div className="space-y-6">
            <div>
              <h3 className="text-sm font-semibold mb-3">Visibilità sezioni</h3>
              {editor.stale ? (
                <p className="text-sm text-destructive">
                  Impossibile verificare gli accessi salvati: chiudi e riapri la finestra.
                </p>
              ) : (
                <SectionAccessList
                  role={user.role}
                  defaults={editor.defaults}
                  overrides={editor.shown}
                  onChange={editor.onChange}
                  disabled={isSaving}
                />
              )}
            </div>

            {/* Brand access info */}
            <div className="flex items-start gap-2 rounded-md border bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground">
              <Info className="h-4 w-4 mt-0.5 shrink-0" />
              <p>
                L'accesso ai brand è gestito tramite la membership ai team aziendali.
                Configura i team dalla pagina <strong>Impostazioni → Azienda</strong>.
              </p>
            </div>
          </div>
        </div>

        <DialogFooter className="px-6 py-4 border-t shrink-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Annulla
          </Button>
          <Button
            onClick={handleSave}
            disabled={!editor.hasChanges || editor.stale || !editor.defaults || isSaving}
          >
            {isSaving ? 'Salvataggio...' : 'Salva'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import React from 'react';

import { Button } from '../ui/button';

interface SettingsActionsProps {
  onSave?: () => void;
  isSaving?: boolean;
  onTest?: () => void;
  isTesting?: boolean;
  disabled?: boolean;
}

export function SettingsActions({
  onSave,
  isSaving = false,
  onTest,
  isTesting = false,
  disabled = false,
}: SettingsActionsProps) {
  return (
    <div className="flex justify-end space-x-2 pt-4">
      {onTest && (
        <Button
          type="button"
          variant="outline"
          onClick={onTest}
          disabled={disabled || isSaving || isTesting}
          aria-busy={isTesting}
        >
          {isTesting ? 'Test in corso...' : 'Test Connessione'}
        </Button>
      )}
      {onSave && (
        <Button
          type="submit"
          onClick={onSave}
          disabled={disabled || isSaving || isTesting}
          aria-busy={isSaving}
        >
          {isSaving ? 'Salvataggio...' : 'Salva Configurazione'}
        </Button>
      )}
    </div>
  );
}

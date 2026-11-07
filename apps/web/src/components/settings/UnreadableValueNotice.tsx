import { PermissionButton } from '../PermissionButton';

export const UNREADABLE_VALUE_MESSAGE = 'Un valore salvato non è leggibile: inseriscilo di nuovo e salva.';

export interface UnreadableValueNoticeProps {
  /** What the notice says, when the page has more to say than `UNREADABLE_VALUE_MESSAGE`. */
  message?: string;
  /** Removes the stored value; without it the field can only be entered again (#193). */
  onRemove?: () => void;
  /** Whether the user may remove it (`config:update`). */
  canRemove?: boolean;
}

/** Beside a settings field whose stored value this instance cannot decrypt. */
export function UnreadableValueNotice({ message = UNREADABLE_VALUE_MESSAGE, onRemove, canRemove = false }: UnreadableValueNoticeProps) {
  return (
    <div className="flex items-center gap-2">
      <p className="text-sm text-status-critical">{message}</p>
      {onRemove && (
        <PermissionButton
          type="button"
          variant="link"
          size="xs"
          hasPermission={canRemove}
          tooltip="Non hai i permessi per rimuovere questo valore"
          onClick={onRemove}
        >
          Rimuovi
        </PermissionButton>
      )}
    </div>
  );
}

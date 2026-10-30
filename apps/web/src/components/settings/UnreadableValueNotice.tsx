export const UNREADABLE_VALUE_MESSAGE = 'Un valore salvato non è leggibile: inseriscilo di nuovo e salva.';

/** Beside a settings field whose stored value this instance cannot decrypt. */
export function UnreadableValueNotice() {
  return <p className="text-sm text-status-critical">{UNREADABLE_VALUE_MESSAGE}</p>;
}

declare function setConfirmOpen(open: boolean): void;

export function removeWithGlobal() {
  // ruleid: luke-no-native-confirm
  if (globalThis.confirm('Delete?')) return true;
  return false;
}

export function removeWithWindow() {
  // ruleid: luke-no-native-confirm
  return window.confirm('Delete?');
}

export function removeWithDialog() {
  // ok: luke-no-native-confirm
  setConfirmOpen(true);
}

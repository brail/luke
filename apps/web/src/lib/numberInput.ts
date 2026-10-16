import type { ChangeEvent } from 'react';

/** `<Input type="number">` props: empty or unparseable is `NaN` (the schema refuses it, not `parseInt || fallback`), shown empty. */
export function numberInputProps(value: number, onChange: (value: number) => void) {
  return {
    value: Number.isNaN(value) ? '' : value,
    onChange: (e: ChangeEvent<HTMLInputElement>) => onChange(e.target.valueAsNumber),
  };
}

/**
 * Props for an optional `<Input type="number">`: an emptied field is `null` (no value), unparseable text
 * stays `NaN` for the schema to refuse, and both show empty.
 */
export function nullableNumberInputProps(
  value: number | null | undefined,
  onChange: (value: number | null) => void,
) {
  return {
    value: value === null || value === undefined || Number.isNaN(value) ? '' : value,
    onChange: (e: ChangeEvent<HTMLInputElement>) =>
      onChange(e.target.value === '' && !e.target.validity.badInput ? null : e.target.valueAsNumber),
  };
}

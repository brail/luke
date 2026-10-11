import type { ChangeEvent } from 'react';

/** `<Input type="number">` props: empty or unparseable is `NaN` (the schema refuses it, not `parseInt || fallback`), shown empty. */
export function numberInputProps(value: number, onChange: (value: number) => void) {
  return {
    value: Number.isNaN(value) ? '' : value,
    onChange: (e: ChangeEvent<HTMLInputElement>) => onChange(e.target.valueAsNumber),
  };
}

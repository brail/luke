'use client';

import { Input } from './ui/input';

import type { ComponentProps } from 'react';


/**
 * Input numerico che disabilita il cambio valore via scroll wheel.
 * Il browser nativo incrementa/decrementa i number input sullo scroll —
 * questo comportamento è indesiderato nei form con molti campi.
 */
export function NumberInput(props: Omit<ComponentProps<typeof Input>, 'type'>) {
  return (
    <Input
      type="number"
      {...props}
      onWheel={e => e.currentTarget.blur()}
    />
  );
}

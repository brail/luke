'use client';

import { Input } from './ui/input';

import type { ComponentProps } from 'react';


/**
 * Numeric input that disables changing the value with the scroll wheel.
 * The browser natively increments/decrements number inputs on scroll —
 * unwanted behaviour in forms with many fields.
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

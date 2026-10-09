'use client';

import * as React from 'react';

import { cn } from '../../lib/utils';

// `size` is a native <input> attribute (number), so the compact affordance uses a
// dedicated `inputSize` prop instead of colliding with it.
const INPUT_SIZE: Record<'default' | 'sm', string> = {
  default: 'h-10 px-3 py-2 text-sm',
  sm: 'h-7 px-2 text-xs',
};

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  inputSize?: keyof typeof INPUT_SIZE;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, inputSize = 'default', onWheel, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          'flex w-full rounded-md border border-input bg-background ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
          INPUT_SIZE[inputSize],
          className
        )}
        ref={ref}
        // Chromium steps a focused number input on a vertical wheel turn, so scrolling the page
        // over the field silently changes its value; blurring the field stops the step. A local
        // change to the shadcn primitive: keep it when re-adding the component.
        onWheel={
          type === 'number'
            ? e => {
                if (e.deltaY !== 0) e.currentTarget.blur();
                onWheel?.(e);
              }
            : onWheel
        }
        {...props}
      />
    );
  }
);
Input.displayName = 'Input';

export { Input };

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
  ({ className, type, inputSize = 'default', ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          'flex w-full rounded-md border border-input bg-background ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
          INPUT_SIZE[inputSize],
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Input.displayName = 'Input';

export { Input };

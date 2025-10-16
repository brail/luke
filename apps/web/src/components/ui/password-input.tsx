import * as React from 'react';
import { cn } from '../../lib/utils';
import { Input } from './input';

export interface PasswordInputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  hasValue?: boolean;
}

const PasswordInput = React.forwardRef<HTMLInputElement, PasswordInputProps>(
  ({ className, hasValue = false, placeholder, ...props }, ref) => {
    // Se hasValue è true, mostra placeholder mascherato
    const displayPlaceholder = hasValue ? '••••••••' : placeholder;

    return (
      <Input
        type="password"
        className={cn(className)}
        placeholder={displayPlaceholder}
        ref={ref}
        {...props}
      />
    );
  }
);
PasswordInput.displayName = 'PasswordInput';

export { PasswordInput };

import { Eye, EyeOff } from 'lucide-react';
import React from 'react';

import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import {
  FormControl,
  FormDescription,
  FormItem,
  FormLabel,
  FormMessage,
} from '../ui/form';
import { Input } from '../ui/input';

interface SensitiveFieldProps {
  label: React.ReactNode;
  description?: string;
  hasValue?: boolean;
  placeholder?: string;
  disabled?: boolean;
  field: any;
}

export function SensitiveField({
  label,
  description,
  hasValue = false,
  placeholder,
  disabled = false,
  field,
}: SensitiveFieldProps) {
  const [showValue, setShowValue] = React.useState(false);

  const displayPlaceholder = hasValue
    ? '•••••••• (già configurato, lascia vuoto per non modificare)'
    : placeholder || 'Inserisci valore';

  return (
    <FormItem>
      <FormLabel>{label}</FormLabel>
      <FormControl>
        <div className="relative">
          <Input
            type={showValue ? 'text' : 'password'}
            placeholder={displayPlaceholder}
            disabled={disabled}
            className={cn('pr-10')}
            {...field}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
            onClick={() => setShowValue(!showValue)}
            disabled={disabled}
            tabIndex={-1}
          >
            {showValue ? (
              <EyeOff className="h-4 w-4 text-muted-foreground" />
            ) : (
              <Eye className="h-4 w-4 text-muted-foreground" />
            )}
            <span className="sr-only">
              {showValue ? 'Nascondi' : 'Mostra'} valore
            </span>
          </Button>
        </div>
      </FormControl>
      {description && <FormDescription>{description}</FormDescription>}
      {hasValue && !description && (
        <FormDescription>
          Password già salvata e cifrata. Lascia vuoto per mantenerla invariata.
        </FormDescription>
      )}
      <FormMessage />
    </FormItem>
  );
}

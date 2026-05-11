'use client';

import { Check, ChevronsUpDown } from 'lucide-react';
import { useState } from 'react';

import { Button } from '../../../../../components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '../../../../../components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../../../../../components/ui/popover';
import { trpc } from '../../../../../lib/trpc';
import { cn } from '../../../../../lib/utils';

interface VendorComboboxProps {
  value: string | null;
  onChange: (vendorId: string | null) => void;
  disabled?: boolean;
}

export function VendorCombobox({ value, onChange, disabled }: VendorComboboxProps) {
  const [open, setOpen] = useState(false);

  const { data, isLoading } = trpc.vendors.list.useQuery(
    undefined,
    { staleTime: 5 * 60 * 1000 },
  );
  const vendors = data?.items ?? [];

  const selected = vendors.find(v => v.id === value);
  const displayLabel = selected
    ? (selected.nickname ?? selected.name)
    : null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled || isLoading}
          className={cn(
            'w-full justify-between font-normal',
            !displayLabel && 'text-muted-foreground',
          )}
        >
          <span className="truncate">{displayLabel ?? 'Seleziona fornitore…'}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px] p-0" align="start" onWheel={e => e.stopPropagation()}>
        <Command>
          <CommandInput placeholder="Cerca fornitore…" />
          <CommandList className="max-h-60">
            <CommandEmpty>
              {isLoading ? 'Caricamento…' : 'Nessun fornitore trovato.'}
            </CommandEmpty>
            <CommandGroup>
              {/* Opzione "nessuno" */}
              <CommandItem
                value="__none__"
                onSelect={() => {
                  onChange(null);
                  setOpen(false);
                }}
              >
                <Check className={cn('mr-2 h-4 w-4', value === null ? 'opacity-100' : 'opacity-0')} />
                <span className="text-muted-foreground italic">— Nessuno —</span>
              </CommandItem>
              {vendors.map(v => {
                const label = v.nickname ?? v.name;
                return (
                  <CommandItem
                    key={v.id}
                    value={label}
                    onSelect={() => {
                      onChange(v.id);
                      setOpen(false);
                    }}
                  >
                    <Check className={cn('mr-2 h-4 w-4', value === v.id ? 'opacity-100' : 'opacity-0')} />
                    {label}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

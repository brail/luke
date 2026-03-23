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
  onChange: (navNo: string | null) => void;
  disabled?: boolean;
}

export function VendorCombobox({ value, onChange, disabled }: VendorComboboxProps) {
  const [open, setOpen] = useState(false);

  const { data: vendors = [], isLoading } = trpc.integrations.nav.vendors.list.useQuery(
    undefined,
    { staleTime: 5 * 60 * 1000 },
  );

  const selected = vendors.find(v => v.navNo === value);
  const displayLabel = selected
    ? (selected.searchName ?? selected.name)
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
          {displayLabel ?? 'Seleziona fornitore…'}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Cerca fornitore…" />
          <CommandList>
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
                const label = v.searchName ?? v.name;
                return (
                  <CommandItem
                    key={v.navNo}
                    value={label}
                    onSelect={() => {
                      onChange(v.navNo);
                      setOpen(false);
                    }}
                  >
                    <Check className={cn('mr-2 h-4 w-4', value === v.navNo ? 'opacity-100' : 'opacity-0')} />
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

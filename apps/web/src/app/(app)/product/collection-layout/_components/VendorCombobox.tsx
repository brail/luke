'use client';

import { Check, ChevronsUpDown } from 'lucide-react';
import { useEffect, useState } from 'react';

import type { RouterOutputs } from '@luke/api';
import type { Vendor } from '@luke/core';

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

/** A vendor as the search returns it, with the parameter sets its quotations may use. */
export type VendorListItem = RouterOutputs['vendors']['list']['items'][number];

type VendorOption = Pick<Vendor, 'id' | 'name' | 'nickname'>;

interface VendorComboboxProps {
  value: string | null;
  /** The vendor the row already has, labelled whatever the search returns. */
  selectedVendor?: VendorOption | null;
  /** Called with the new vendor ID and the vendor as the search returned it (null on clear). */
  onChange: (vendorId: string | null, vendor: VendorListItem | null) => void;
  disabled?: boolean;
}

const SEARCH_DEBOUNCE_MS = 300;

const labelOf = (vendor: VendorOption) => vendor.nickname ?? vendor.name;

/**
 * Searchable combobox for selecting an active vendor.
 *
 * The search runs on the server (`vendors.list`, name or nickname): the list returns at most one
 * page, so filtering it in the browser could never reach the vendors past it. The selected
 * vendor's label comes from the row (`selectedVendor`) or from the pick itself, not from the
 * current results.
 *
 * @param value - Currently selected vendor ID, or null when empty.
 * @param selectedVendor - The row's current vendor, for its label.
 * @param onChange - Called with the new vendor ID and vendor, or nulls on clear.
 */
export function VendorCombobox({ value, selectedVendor, onChange, disabled }: VendorComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [picked, setPicked] = useState<VendorOption | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  const { data, isPlaceholderData } = trpc.vendors.list.useQuery(
    debouncedSearch ? { search: debouncedSearch } : undefined,
    { enabled: open, staleTime: 5 * 60 * 1000, placeholderData: previous => previous },
  );
  // Results are listed only once they answer what is typed: a page left over from an earlier
  // search would let Enter pick a vendor that does not match it.
  const settled = data !== undefined && !isPlaceholderData && debouncedSearch === search.trim();
  const vendors = settled ? data.items : [];

  const selected = [picked, selectedVendor, ...vendors].find(v => v?.id === value);
  const displayLabel = selected ? labelOf(selected) : null;

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) setSearch('');
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            'w-full justify-between font-normal',
            !displayLabel && 'text-muted-foreground',
          )}
        >
          <span className="truncate">{displayLabel ?? 'Seleziona fornitore…'}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start" onWheel={e => e.stopPropagation()}>
        <Command shouldFilter={false}>
          <CommandInput placeholder="Cerca fornitore…" value={search} onValueChange={setSearch} />
          <CommandList className="max-h-60">
            {settled && <CommandEmpty>Nessun fornitore trovato.</CommandEmpty>}
            <CommandGroup>
              {/* Only on the unfiltered list, so that a search with no match reaches `CommandEmpty`. */}
              {!search && (
                <CommandItem
                  value="__none__"
                  onSelect={() => {
                    onChange(null, null);
                    handleOpenChange(false);
                  }}
                >
                  <Check className={cn('mr-2 h-4 w-4', value === null ? 'opacity-100' : 'opacity-0')} />
                  <span className="text-muted-foreground italic">— Nessuno —</span>
                </CommandItem>
              )}
              {vendors.map(v => (
                <CommandItem
                  key={v.id}
                  value={v.id}
                  onSelect={() => {
                    setPicked(v);
                    onChange(v.id, v);
                    handleOpenChange(false);
                  }}
                >
                  <Check className={cn('mr-2 h-4 w-4', value === v.id ? 'opacity-100' : 'opacity-0')} />
                  {labelOf(v)}
                </CommandItem>
              ))}
            </CommandGroup>
            {!settled && (
              <p className="py-6 text-center text-sm text-muted-foreground">Caricamento…</p>
            )}
            {settled && data.hasMore && (
              <p className="px-2 py-1.5 text-xs text-muted-foreground">
                Mostrati i primi {vendors.length}: affina la ricerca.
              </p>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

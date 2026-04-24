'use client';

import { Plus, Settings2, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { DEFAULT_CLOCKS_TIMEZONES, DEFAULT_FOREX_PAIRS, type WidgetConfigItem } from '@luke/core';

import { trpc } from '../../lib/trpc';
import { getTrpcErrorMessage } from '../../lib/trpcErrorMessages';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '../ui/sheet';
import { Switch } from '../ui/switch';

import { WIDGET_REGISTRY } from './widgetRegistry';

interface DashboardCustomizeSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  widgets: WidgetConfigItem[];
}

interface EditableListProps {
  label: string;
  placeholder: string;
  maxItems: number;
  value: string[];
  onChange: (v: string[]) => void;
  validator?: (s: string) => boolean;
  normalizer?: (s: string) => string;
}

function EditableList({
  label,
  placeholder,
  maxItems,
  value,
  onChange,
  validator = () => true,
  normalizer = s => s,
}: EditableListProps) {
  const [input, setInput] = useState('');

  function tryAdd() {
    const normalized = normalizer(input.trim());
    if (normalized && validator(normalized) && !value.includes(normalized)) {
      onChange([...value, normalized]);
      setInput('');
    }
  }

  return (
    <div className="space-y-2">
      <Label className="text-xs">{label}</Label>
      <div className="space-y-1">
        {value.map(item => (
          <div key={item} className="flex items-center justify-between text-sm">
            <span className="font-mono text-xs">{item}</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-5 w-5 p-0"
              onClick={() => onChange(value.filter(v => v !== item))}
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        ))}
      </div>
      {value.length < maxItems && (
        <div className="flex gap-1">
          <Input
            value={input}
            onChange={e => setInput(normalizer(e.target.value))}
            placeholder={placeholder}
            className="h-7 text-xs font-mono"
            onKeyDown={e => { if (e.key === 'Enter') tryAdd(); }}
          />
          <Button variant="outline" size="sm" className="h-7 px-2" onClick={tryAdd}>
            <Plus className="h-3 w-3" />
          </Button>
        </div>
      )}
    </div>
  );
}

const FOREX_RE = /^[A-Z]{3}\/[A-Z]{3}$/;

export function DashboardCustomizeSheet({
  open,
  onOpenChange,
  widgets,
}: DashboardCustomizeSheetProps) {
  const utils = trpc.useUtils();
  const saveConfig = trpc.dashboard.saveConfig.useMutation({
    onSuccess: () => utils.dashboard.getConfig.invalidate(),
    onError: err => toast.error(getTrpcErrorMessage(err)),
  });

  function toggleWidget(id: string, enabled: boolean) {
    saveConfig.mutate({ widgets: widgets.map(w => (w.id === id ? { ...w, enabled } : w)) });
  }

  function updateSettings(id: string, settings: Record<string, unknown>) {
    saveConfig.mutate({ widgets: widgets.map(w => (w.id === id ? { ...w, settings } : w)) });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-sm flex flex-col" side="right">
        <SheetHeader className="pb-4 border-b shrink-0">
          <SheetTitle className="flex items-center gap-2">
            <Settings2 className="h-4 w-4" />
            Personalizza dashboard
          </SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto py-4 space-y-4">
          {WIDGET_REGISTRY.map(def => {
            const saved = widgets.find(w => w.id === def.id);
            const enabled = saved?.enabled ?? def.defaultEnabled;
            const settings = saved?.settings;

            return (
              <div key={def.id} className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 flex-1">
                  <Switch
                    checked={enabled}
                    onCheckedChange={v => toggleWidget(def.id, v)}
                    disabled={saveConfig.isPending}
                  />
                  <span className="text-sm">{def.label}</span>
                </div>

                {def.configurable && enabled && (
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-7 px-2">
                        <Settings2 className="h-3.5 w-3.5" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-64 p-3" side="left">
                      {def.id === 'clocks' && (
                        <EditableList
                          label="Fusi orari IANA (max 6)"
                          placeholder="Europe/Paris"
                          maxItems={6}
                          value={(settings as { timezones?: string[] } | undefined)?.timezones ?? [...DEFAULT_CLOCKS_TIMEZONES]}
                          onChange={timezones => updateSettings(def.id, { timezones })}
                        />
                      )}
                      {def.id === 'forex' && (
                        <EditableList
                          label="Coppie valuta (max 8)"
                          placeholder="USD/CNY"
                          maxItems={8}
                          value={(settings as { pairs?: string[] } | undefined)?.pairs ?? [...DEFAULT_FOREX_PAIRS]}
                          onChange={pairs => updateSettings(def.id, { pairs })}
                          validator={s => FOREX_RE.test(s)}
                          normalizer={s => s.toUpperCase()}
                        />
                      )}
                    </PopoverContent>
                  </Popover>
                )}
              </div>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}

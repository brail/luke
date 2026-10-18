'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { CloneSeasonCalendarInputSchema } from '@luke/core';

import { PlanningGroupListRow } from '../../../../components/PlanningGroupListRow';
import { Button } from '../../../../components/ui/button';
import { Checkbox } from '../../../../components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../../components/ui/dialog';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '../../../../components/ui/form';
import { Input } from '../../../../components/ui/input';
import { ScrollArea } from '../../../../components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../../components/ui/select';
import { trpc } from '../../../../lib/trpc';
import { getTrpcErrorMessage } from '../../../../lib/trpcErrorMessages';

/**
 * The source half of the clone input; the target brand and season come from props, not from the
 * user. `dateShiftDays` stays a string here because that is what a number input holds — it is
 * parsed to the integer `CloneSeasonCalendarInputSchema` requires on submit, which also keeps an
 * emptied field from becoming NaN halfway through typing a negative offset.
 */
const CloneFormSchema = CloneSeasonCalendarInputSchema
  .pick({ sourcePlanningGroupIds: true })
  .extend({
    sourceBrandId: z.string().uuid('Seleziona il brand sorgente'),
    sourceSeasonId: z.string().uuid('Seleziona la stagione sorgente'),
    sourcePlanningGroupIds: z
      .array(z.string().uuid())
      .min(1, 'Seleziona almeno un gruppo di pianificazione'),
    dateShiftDays: z.string().regex(/^-?\d+$/, 'Inserisci un numero intero di giorni'),
  });

type CloneFormData = z.infer<typeof CloneFormSchema>;

const EMPTY_CLONE: CloneFormData = {
  sourceBrandId: '',
  sourceSeasonId: '',
  sourcePlanningGroupIds: [],
  dateShiftDays: '0',
};

interface Props {
  open: boolean;
  onClose: () => void;
  onCloned: () => void;
  targetBrandId: string;
  targetSeasonId: string;
}

/**
 * Dialog for cloning milestones from another brand+season into the current calendar.
 *
 * Lets the user pick a source brand, source season, and an optional day-shift
 * offset to apply to all cloned event dates.
 *
 * @param targetBrandId - Brand ID of the calendar that will receive the cloned events.
 * @param targetSeasonId - Season ID of the calendar that will receive the cloned events.
 * @param onCloned - Called after a successful clone operation.
 */
export function CloneBrandSeasonDialog({ open, onClose, onCloned, targetBrandId, targetSeasonId }: Props) {
  const form = useForm<CloneFormData>({
    resolver: zodResolver(CloneFormSchema),
    defaultValues: EMPTY_CLONE,
  });

  const sourceBrandId = form.watch('sourceBrandId');
  const sourceSeasonId = form.watch('sourceSeasonId');
  const selectedGroupIds = form.watch('sourcePlanningGroupIds');

  const { data: brandsData } = trpc.brand.list.useQuery(
    { isActive: true, limit: 100 },
    { enabled: open }
  );
  const { data: seasonsData } = trpc.season.list.useQuery(
    { isActive: true, limit: 100 },
    { enabled: open }
  );
  const { data: sourcePlanningGroups = [] } = trpc.planningGroup.list.useQuery(
    { brandId: sourceBrandId, seasonId: sourceSeasonId },
    { enabled: open && !!sourceBrandId && !!sourceSeasonId }
  );

  const cloneMutation = trpc.seasonCalendar.cloneFromBrandSeason.useMutation({
    onSuccess: data => {
      toast.success(`Clonato: ${data.milestonesCreated} milestone create`);
      onCloned();
      onClose();
    },
    onError: err => toast.error(getTrpcErrorMessage(err)),
  });

  // The dialog stays mounted across open/close, so without this reset it reopens on the source
  // calendar and group selection of the previous clone.
  useEffect(() => {
    if (open) form.reset(EMPTY_CLONE);
  }, [open, form]);

  // Esc and outside-click close through onOpenChange, a path the Cancel button does not take:
  // without this guard the dialog is dismissable while the clone is running.
  const handleOpenChange = (next: boolean) => {
    if (!next && !cloneMutation.isPending) onClose();
  };

  // Changing the source calendar invalidates the group picks: they belong to the previous one.
  const changeSource = (field: 'sourceBrandId' | 'sourceSeasonId', value: string) => {
    form.setValue(field, value, { shouldValidate: true });
    form.setValue('sourcePlanningGroupIds', [], { shouldValidate: false });
  };

  const toggleGroup = (groupId: string) => {
    const next = selectedGroupIds.includes(groupId)
      ? selectedGroupIds.filter(id => id !== groupId)
      : [...selectedGroupIds, groupId];
    form.setValue('sourcePlanningGroupIds', next, { shouldValidate: true });
  };

  const handleClone = (data: CloneFormData) => {
    cloneMutation.mutate({
      sourceBrandId: data.sourceBrandId,
      sourceSeasonId: data.sourceSeasonId,
      targetBrandId,
      targetSeasonId,
      sourcePlanningGroupIds: data.sourcePlanningGroupIds,
      dateShiftDays: Number.parseInt(data.dateShiftDays, 10),
      includeCancelled: false,
    });
  };

  const brands = brandsData?.items ?? [];
  const seasons = seasonsData?.items ?? [];

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[440px]"> {/* px: dialog width tuned to this form's content; no exact Tailwind max-w scale match */}
        <DialogHeader>
          <DialogTitle>Clona da altro calendario</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleClone)} className="grid gap-4">
            <div className="space-y-4 py-2">
              <FormField
                control={form.control}
                name="sourceBrandId"
                render={({ field }) => (
                  <FormItem className="space-y-1.5">
                    <FormLabel>Brand sorgente</FormLabel>
                    <Select value={field.value} onValueChange={v => changeSource('sourceBrandId', v)}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Seleziona brand" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {brands.map(b => (
                          <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="sourceSeasonId"
                render={({ field }) => (
                  <FormItem className="space-y-1.5">
                    <FormLabel>Stagione sorgente</FormLabel>
                    <Select value={field.value} onValueChange={v => changeSource('sourceSeasonId', v)}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Seleziona stagione" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {seasons.map(s => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.name}{s.year ? ` ${s.year}` : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {sourceBrandId && sourceSeasonId && (
                <FormField
                  control={form.control}
                  name="sourcePlanningGroupIds"
                  render={() => (
                    <FormItem className="space-y-1.5">
                      <FormLabel>Gruppi di pianificazione da clonare</FormLabel>
                      <ScrollArea className="h-32 rounded-md border">
                        <div className="p-2 space-y-0.5">
                          {sourcePlanningGroups.length === 0 && (
                            <p className="text-sm text-muted-foreground p-4 text-center">Nessun gruppo nel calendario sorgente</p>
                          )}
                          {sourcePlanningGroups.map(g => (
                            <div key={g.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/50">
                              <Checkbox
                                checked={selectedGroupIds.includes(g.id)}
                                onCheckedChange={() => toggleGroup(g.id)}
                              />
                              <PlanningGroupListRow group={g} />
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              <FormField
                control={form.control}
                name="dateShiftDays"
                render={({ field }) => (
                  <FormItem className="space-y-1.5">
                    <FormLabel>Offset giorni</FormLabel>
                    <FormControl>
                      <Input type="number" disabled={cloneMutation.isPending} {...field} />
                    </FormControl>
                    <FormDescription className="text-xs">
                      Numero di giorni da aggiungere a ogni data (negativo per anticipare).
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                Verranno clonate le milestone con stato: <strong>Pianificato, In corso, Completato</strong>.
                Le milestone Annullate non vengono copiate.
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose} disabled={cloneMutation.isPending}>
                Annulla
              </Button>
              <Button type="submit" disabled={cloneMutation.isPending}>
                {cloneMutation.isPending ? 'Clonazione…' : 'Clona'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

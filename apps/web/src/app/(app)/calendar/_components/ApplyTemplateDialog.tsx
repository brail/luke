'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { ApplyTemplateInputSchema } from '@luke/core';

import { PlanningGroupSelect } from '../../../../components/PlanningGroupSelect';
import { Button } from '../../../../components/ui/button';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../../components/ui/select';
import { narrowRouterOutput, trpc } from '../../../../lib/trpc';
import { getTrpcErrorMessage } from '../../../../lib/trpcErrorMessages';

import type { CalendarEventItem } from './types';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Called with the events just created by the apply, so the caller can hand them to the wizard. */
  onApplied: (createdEvents: CalendarEventItem[], planningGroupId: string) => void;
  brandId: string;
  seasonId: string;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Same shape the mutation accepts, with two deliberate departures: the uuid messages are the ones
 * the user should read when a select is still empty, and `anchorDate` is the `yyyy-mm-dd` a date
 * input produces — widened to the ISO datetime `ApplyTemplateInputSchema` wants on submit.
 * `force` is derived from the chosen group, not typed by anyone, so it is not a form field.
 */
const ApplyTemplateFormSchema = ApplyTemplateInputSchema
  .pick({ planningGroupId: true, templateId: true })
  .extend({
    planningGroupId: z.string().uuid('Seleziona un gruppo di pianificazione'),
    templateId: z.string().uuid('Seleziona un template'),
    anchorDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data non valida'),
  });

type ApplyTemplateFormData = z.infer<typeof ApplyTemplateFormSchema>;

/**
 * Dialog for applying a calendar template to a planning group of the current season calendar.
 *
 * The user picks a planning group, a template, and an anchor date; the backend computes each
 * milestone's date from the template item's offsetDays. `force: true` is sent automatically when
 * the chosen group already has events (re-applying a template to the same group).
 *
 * @param brandId - Brand of the target calendar (used to list planning groups).
 * @param seasonId - Season of the target calendar (used to list planning groups).
 * @param onApplied - Called with the newly created events after a successful apply.
 */
export function ApplyTemplateDialog({ open, onClose, onApplied, brandId, seasonId }: Props) {
  const form = useForm<ApplyTemplateFormData>({
    resolver: zodResolver(ApplyTemplateFormSchema),
    defaultValues: { planningGroupId: '', templateId: '', anchorDate: todayIso() },
  });

  const { data: templates, isLoading: loadingTemplates } = trpc.seasonCalendar.listTemplates.useQuery(
    undefined,
    { enabled: open }
  );
  const { data: planningGroups = [], isLoading: loadingGroups } = trpc.planningGroup.list.useQuery(
    { brandId, seasonId },
    { enabled: open }
  );

  const planningGroupId = form.watch('planningGroupId');
  const selectedGroup = planningGroups.find(g => g.id === planningGroupId);
  const hasMilestones = (selectedGroup?._count.events ?? 0) > 0;

  const applyMutation = trpc.seasonCalendar.applyTemplate.useMutation({
    onSuccess: (data) => {
      toast.success(`Template applicato: ${data.length} milestone create`);
      onApplied(narrowRouterOutput<CalendarEventItem[]>(data), planningGroupId);
      onClose();
    },
    onError: err => toast.error(getTrpcErrorMessage(err)),
  });

  // The dialog stays mounted across open/close, so without this reset it reopens on the group and
  // template picked last time.
  useEffect(() => {
    if (open) form.reset({ planningGroupId: '', templateId: '', anchorDate: todayIso() });
  }, [open, form]);

  // Esc and outside-click close through onOpenChange, a path the Cancel button does not take:
  // without this guard the dialog is dismissable while the template is being applied.
  const handleOpenChange = (next: boolean) => {
    if (!next && !applyMutation.isPending) onClose();
  };

  const handleApply = (data: ApplyTemplateFormData) => {
    applyMutation.mutate({
      planningGroupId: data.planningGroupId,
      templateId: data.templateId,
      anchorDate: new Date(data.anchorDate).toISOString(),
      force: hasMilestones,
    });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[420px]"> {/* px: dialog width tuned to this form's content; no exact Tailwind max-w scale match */}
        <DialogHeader>
          <DialogTitle>Applica template</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleApply)} className="grid gap-4">
            <div className="space-y-4 py-2">
              <FormField
                control={form.control}
                name="planningGroupId"
                render={({ field }) => (
                  <FormItem className="space-y-1.5">
                    <FormLabel>Gruppo di pianificazione</FormLabel>
                    <FormControl>
                      <PlanningGroupSelect
                        value={field.value}
                        onValueChange={field.onChange}
                        groups={planningGroups}
                        loading={loadingGroups}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="templateId"
                render={({ field }) => (
                  <FormItem className="space-y-1.5">
                    <FormLabel>Template</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange} disabled={loadingTemplates}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder={loadingTemplates ? 'Caricamento…' : 'Seleziona template'} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {templates?.map(t => (
                          <SelectItem key={t.id} value={t.id}>
                            {t.name}
                            {t.items.length > 0 && (
                              <span className="ml-1 text-muted-foreground">({t.items.length} milestone)</span>
                            )}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="anchorDate"
                render={({ field }) => (
                  <FormItem className="space-y-1.5">
                    <FormLabel>Data ancora (giorno 0)</FormLabel>
                    <FormControl>
                      <Input type="date" disabled={applyMutation.isPending} {...field} />
                    </FormControl>
                    <FormDescription className="text-xs">
                      Le milestone saranno create con offset relativo a questa data.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {hasMilestones && (
                <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  Il gruppo selezionato contiene già milestone. Applicando il template verranno aggiunte ulteriori milestone.
                </div>
              )}
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose} disabled={applyMutation.isPending}>
                Annulla
              </Button>
              <Button type="submit" disabled={applyMutation.isPending}>
                {applyMutation.isPending ? 'Applicazione…' : 'Applica'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

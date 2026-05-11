'use client';

import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { trpc } from '../../../lib/trpc';
import { getTrpcErrorMessage } from '../../../lib/trpcErrorMessages';
import { cn } from '../../../lib/utils';
import { ConfirmDialog } from '../../ConfirmDialog';
import { Button } from '../../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Checkbox } from '../../ui/checkbox';
import { Input } from '../../ui/input';
import { Skeleton } from '../../ui/skeleton';

function getDueDateStatus(dueDate: string | Date | null | undefined): 'today' | 'overdue' | null {
  if (!dueDate) return null;
  const due = new Date(dueDate);
  const today = new Date();
  if (due.toDateString() === today.toDateString()) return 'today';
  if (due < today) return 'overdue';
  return null;
}

export function TasksWidget() {
  const utils = trpc.useUtils();
  const [newLabel, setNewLabel] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; label: string } | null>(null);

  const { data: tasks, isLoading } = trpc.dashboard.getTasks.useQuery();

  const invalidate = () => utils.dashboard.getTasks.invalidate();

  const upsertMutation = trpc.dashboard.upsertTask.useMutation({
    onSuccess: invalidate,
    onError: err => toast.error(getTrpcErrorMessage(err)),
  });

  const deleteMutation = trpc.dashboard.deleteTask.useMutation({
    onSuccess: () => {
      setDeleteTarget(null);
      invalidate();
    },
    onError: err => toast.error(getTrpcErrorMessage(err)),
  });

  function handleAdd() {
    const label = newLabel.trim();
    if (!label) return;
    upsertMutation.mutate({ label, done: false });
    setNewLabel('');
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold">Attività da completare</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <Input
            placeholder="Nuova attività..."
            value={newLabel}
            onChange={e => setNewLabel(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
            className="h-8 text-sm"
          />
          <Button
            size="sm"
            variant="outline"
            className="h-8 px-2"
            onClick={handleAdd}
            disabled={!newLabel.trim() || upsertMutation.isPending}
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-6 w-full" />)}
          </div>
        ) : !tasks || tasks.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nessuna attività. Aggiungine una sopra.</p>
        ) : (
          <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
            {tasks.slice(0, 20).map(task => {
              const dueDateStatus = getDueDateStatus(task.dueDate);
              return (
                <div key={task.id} className="flex items-center gap-2 group">
                  <Checkbox
                    checked={task.done}
                    onCheckedChange={checked =>
                      upsertMutation.mutate({ id: task.id, label: task.label, done: !!checked })
                    }
                    className="shrink-0"
                  />
                  <span className={cn('text-sm flex-1 truncate', task.done && 'line-through text-muted-foreground')}>
                    {task.label}
                  </span>
                  {dueDateStatus === 'today' && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400 shrink-0">
                      oggi
                    </span>
                  )}
                  {dueDateStatus === 'overdue' && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400 shrink-0">
                      scaduto
                    </span>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive shrink-0"
                    onClick={() => setDeleteTarget({ id: task.id, label: task.label })}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={open => { if (!open) setDeleteTarget(null); }}
        title="Elimina attività"
        description={`Eliminare "${deleteTarget?.label}"?`}
        confirmText="Elimina"
        cancelText="Annulla"
        variant="destructive"
        actionType="delete"
        onConfirm={() => { if (deleteTarget) deleteMutation.mutate({ id: deleteTarget.id }); }}
        isLoading={deleteMutation.isPending}
      />
    </Card>
  );
}

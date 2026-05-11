'use client';

import { ExternalLink, MessageSquarePlus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { trpc } from '../lib/trpc';
import { getTrpcErrorMessage } from '../lib/trpcErrorMessages';

import { Button } from './ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './ui/dialog';
import { Input } from './ui/input';
import { Label } from './ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';
import { Textarea } from './ui/textarea';

export function FeedbackDialog() {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<'bug' | 'feature'>('bug');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  const submit = trpc.feedback.submit.useMutation({
    onSuccess: ({ issueUrl, issueNumber }) => {
      toast.success(
        <span>
          Segnalazione #{issueNumber} creata.{' '}
          <a href={issueUrl} target="_blank" rel="noopener noreferrer" className="underline inline-flex items-center gap-1">
            Apri <ExternalLink className="h-3 w-3" />
          </a>
        </span>,
      );
      setOpen(false);
      setTitle('');
      setDescription('');
      setType('bug');
    },
    onError: (err) => {
      toast.error(getTrpcErrorMessage(err));
    },
  });

  const canSubmit = title.trim().length > 0 && description.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground hover:text-foreground w-full justify-start">
          <MessageSquarePlus className="h-4 w-4" />
          Segnala / Suggerisci
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Segnalazione / Suggerimento</DialogTitle>
          <DialogDescription>
            Descrivi il problema o la funzionalità che vorresti vedere.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Tipo</Label>
            <Select value={type} onValueChange={v => setType(v as 'bug' | 'feature')}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="bug">🐛 Bug — qualcosa non funziona</SelectItem>
                <SelectItem value="feature">✨ Suggerimento — nuova funzionalità</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="fb-title">Titolo</Label>
            <Input
              id="fb-title"
              placeholder={type === 'bug' ? 'Es. Il prezzo non si salva' : 'Es. Aggiungere export PDF'}
              value={title}
              onChange={e => setTitle(e.target.value)}
              maxLength={200}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="fb-description">Descrizione</Label>
            <Textarea
              id="fb-description"
              placeholder={type === 'bug'
                ? 'Passi per riprodurre, comportamento atteso, cosa succede invece…'
                : 'Descrivi la funzionalità, il caso d\'uso, perché sarebbe utile…'}
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={5}
              maxLength={4000}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Annulla</Button>
          <Button
            onClick={() => submit.mutate({ type, title, description })}
            disabled={!canSubmit || submit.isPending}
          >
            {submit.isPending ? 'Invio…' : 'Invia'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

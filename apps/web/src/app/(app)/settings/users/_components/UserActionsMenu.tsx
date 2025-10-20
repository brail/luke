'use client';

import {
  MoreHorizontal,
  Edit,
  UserX,
  LogOut,
  Trash2,
  Mail,
  Shield,
  X,
} from 'lucide-react';
import React from 'react';
import { toast } from 'sonner';

import { Button } from '../../../../../components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../../../../components/ui/dropdown-menu';
import { trpc } from '../../../../../lib/trpc';

import { UserListItem, UserActionHandlers } from './types';

interface UserActionsMenuProps {
  user: UserListItem;
  currentUserId: string;
  handlers: UserActionHandlers;
  refetch?: () => void;
}

/**
 * Menu dropdown azioni per utente
 * Include protezioni self-action e gestione stati
 */
export function UserActionsMenu({
  user,
  currentUserId,
  handlers,
  refetch,
}: UserActionsMenuProps) {
  const isSelfAction = user.id === currentUserId;

  // Mutations per email verification
  const sendVerifyMutation =
    trpc.auth.requestEmailVerificationAdmin.useMutation({
      onSuccess: () => {
        toast.success('Email di verifica inviata');
      },
      onError: err => {
        toast.error(err?.message || 'Errore invio email');
      },
    });

  const forceVerifyMutation = trpc.users.forceVerifyEmail.useMutation({
    onSuccess: data => {
      toast.success(data.message);
      refetch?.();
    },
    onError: err => {
      toast.error(err?.message || 'Errore');
    },
  });

  const handleEdit = () => {
    handlers.onEdit(user);
  };

  const handleDisable = () => {
    // Doppia protezione: controlla anche qui prima di procedere
    if (isSelfAction) {
      toast.error('Non puoi disattivare il tuo stesso account');
      return;
    }
    handlers.onDisable(user);
  };

  const handleRevokeSessions = () => {
    // Protezione: impedisci auto-revoca
    if (isSelfAction) {
      toast.error(
        'Non puoi revocare le tue stesse sessioni da qui. Usa il profilo personale.'
      );
      return;
    }
    handlers.onRevokeSessions(user);
  };

  const handleHardDelete = () => {
    // Doppia protezione: controlla anche qui prima di procedere
    if (isSelfAction) {
      toast.error('Non puoi eliminare il tuo stesso account');
      return;
    }
    handlers.onHardDelete(user);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
          <span className="sr-only">Apri menu</span>
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={handleEdit}>
          <Edit className="mr-2 h-4 w-4" />
          Modifica
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={handleDisable}
          disabled={!user.isActive || isSelfAction}
        >
          <UserX className="mr-2 h-4 w-4" />
          Disattiva
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {!user.emailVerifiedAt && (
          <>
            <DropdownMenuItem
              onClick={async () => {
                await sendVerifyMutation.mutateAsync({ userId: user.id });
              }}
              disabled={sendVerifyMutation.isPending}
            >
              <Mail className="mr-2 h-4 w-4" />
              Invia email verifica
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={async () => {
                await forceVerifyMutation.mutateAsync({
                  userId: user.id,
                  verified: true,
                });
              }}
              disabled={forceVerifyMutation.isPending}
            >
              <Shield className="mr-2 h-4 w-4" />
              Forza verifica
            </DropdownMenuItem>
          </>
        )}
        {user.emailVerifiedAt && (
          <DropdownMenuItem
            onClick={async () => {
              await forceVerifyMutation.mutateAsync({
                userId: user.id,
                verified: false,
              });
            }}
            disabled={forceVerifyMutation.isPending}
          >
            <X className="mr-2 h-4 w-4" />
            Rimuovi verifica
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={handleRevokeSessions}
          className="text-orange-600 focus:text-orange-600"
        >
          <LogOut className="mr-2 h-4 w-4" />
          Logout da tutti i dispositivi
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={handleHardDelete}
          disabled={isSelfAction}
          className="text-destructive focus:text-destructive"
        >
          <Trash2 className="mr-2 h-4 w-4" />
          Elimina
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

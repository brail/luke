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
import { useRefresh } from '../../../../../lib/refresh';
import { trpc } from '../../../../../lib/trpc';
import { useStandardMutation } from '../../../../../lib/useStandardMutation';

import { UserListItem, UserActionHandlers } from './types';

interface UserActionsMenuProps {
  user: UserListItem;
  currentUserId: string;
  handlers: UserActionHandlers;
}

/**
 * Menu dropdown azioni per utente
 * Include protezioni self-action e gestione stati
 */
export function UserActionsMenu({
  user,
  currentUserId,
  handlers,
}: UserActionsMenuProps) {
  const isSelfAction = user.id === currentUserId;
  const refresh = useRefresh();

  // Mutation tRPC
  const sendVerifyMutation =
    trpc.auth.requestEmailVerificationAdmin.useMutation();
  const forceVerifyMutation = trpc.users.forceVerifyEmail.useMutation();

  // Mutations standardizzate
  const { mutate: sendVerify } = useStandardMutation({
    mutateFn: sendVerifyMutation.mutateAsync,
    onSuccessMessage: 'Email di verifica inviata',
    onErrorMessage: 'Errore invio email',
  });

  const { mutate: forceVerify } = useStandardMutation({
    mutateFn: forceVerifyMutation.mutateAsync,
    invalidate: refresh.users,
    onSuccess: (data: any) => toast.success(data.message),
    onErrorMessage: 'Errore',
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
                await sendVerify({ userId: user.id });
              }}
            >
              <Mail className="mr-2 h-4 w-4" />
              Invia email verifica
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={async () => {
                await forceVerify({
                  userId: user.id,
                  verified: true,
                });
              }}
            >
              <Shield className="mr-2 h-4 w-4" />
              Forza verifica
            </DropdownMenuItem>
          </>
        )}
        {user.emailVerifiedAt && (
          <DropdownMenuItem
            onClick={async () => {
              await forceVerify({
                userId: user.id,
                verified: false,
              });
            }}
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

'use client';

import { useSession } from 'next-auth/react';
import React, { useState } from 'react';

import { FeedbackDialog } from '../FeedbackDialog';
import { Button } from '../ui/button';

/**
 * Opens the feedback dialog from an error page. Renders nothing without a session,
 * because `feedback.submit` is a protected procedure.
 */
export function ReportIssueButton() {
  const { status } = useSession();
  const [open, setOpen] = useState(false);

  if (status !== 'authenticated') return null;

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        Segnala un problema
      </Button>
      <FeedbackDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

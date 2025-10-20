'use client';

import React from 'react';

import { ErrorState } from '../../components/system/ErrorState';
import { RetryButton } from '../../components/system/RetryButton';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  onError?: (error: Error, info: React.ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error(error);
    this.props.onError?.(error, info);
  }

  private handleRetry = () => {
    this.setState({ hasError: false });
  };

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <ErrorState
          title="Si è verificato un problema"
          description="Riprova l'azione. Se il problema persiste, contatta il supporto."
          actionSlot={<RetryButton onRetry={this.handleRetry} autoFocus />}
          secondarySlot={null}
        />
      );
    }
    return this.props.children;
  }
}

'use client';

interface AppVersionLabelProps {
  className?: string;
}

export function AppVersionLabel({ className }: AppVersionLabelProps) {
  const version = process.env.NEXT_PUBLIC_APP_VERSION;
  if (!version) return null;
  return (
    <div className={className}>
      {version}
      {process.env.NODE_ENV === 'development' && ' · development'}
    </div>
  );
}

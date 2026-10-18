'use client';

import { appVersionText } from '../lib/appVersion';

interface AppVersionLabelProps {
  className?: string;
}

export function AppVersionLabel({ className }: AppVersionLabelProps) {
  // Every rule about what this line says lives in `appVersionText()`, where it is a pure function
  // the unit tier can decide — including the development marker, which must survive a build that
  // carries no release identity.
  const text = appVersionText();
  if (!text) return null;

  return <div className={className}>{text}</div>;
}

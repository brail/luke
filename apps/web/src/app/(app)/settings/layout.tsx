import React from 'react';
import SettingsNav from '../../../components/SettingsNav';

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex">
      <SettingsNav />
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}

'use client';

import { PageHeader } from '../../../../components/PageHeader';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '../../../../components/ui/tabs';
import { usePermission } from '../../../../hooks/usePermission';

import { BusinessTimeZoneCard } from './_components/BusinessTimeZoneCard';
import { OrganizationTab } from './_components/OrganizationTab';
import { ProfileTab } from './_components/ProfileTab';

export default function CompanySettingsPage() {
  const { can } = usePermission();
  // The organization tab reads the teams: shown to whoever may read them.
  const canReadTeams = can('company_team:read');

  return (
    <>
      <PageHeader
        title="Azienda"
        description="Gestisci il profilo aziendale e la struttura organizzativa"
      />
      <Tabs defaultValue="profile" className="mt-6">
        <TabsList>
          <TabsTrigger value="profile">Profilo</TabsTrigger>
          {canReadTeams && <TabsTrigger value="organizzazione">Organizzazione</TabsTrigger>}
        </TabsList>
        <TabsContent value="profile" className="mt-6 space-y-6">
          <ProfileTab />
          <BusinessTimeZoneCard />
        </TabsContent>
        {canReadTeams && (
          <TabsContent value="organizzazione" className="mt-6">
            <OrganizationTab />
          </TabsContent>
        )}
      </Tabs>
    </>
  );
}

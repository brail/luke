'use client';

import { PageHeader } from '../../../../components/PageHeader';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '../../../../components/ui/tabs';

import { OrganizzazioneTab } from './_components/OrganizzazioneTab';
import { ProfileTab } from './_components/ProfileTab';

export default function CompanySettingsPage() {
  return (
    <>
      <PageHeader
        title="Azienda"
        description="Gestisci il profilo aziendale e la struttura organizzativa"
      />
      <Tabs defaultValue="profile" className="mt-6">
        <TabsList>
          <TabsTrigger value="profile">Profilo</TabsTrigger>
          <TabsTrigger value="organizzazione">Organizzazione</TabsTrigger>
        </TabsList>
        <TabsContent value="profile" className="mt-6">
          <ProfileTab />
        </TabsContent>
        <TabsContent value="organizzazione" className="mt-6">
          <OrganizzazioneTab />
        </TabsContent>
      </Tabs>
    </>
  );
}

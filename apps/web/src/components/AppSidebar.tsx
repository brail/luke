'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from './ui/sidebar';
import {
  Home,
  Users,
  Settings,
  ServerCog,
  HardDrive,
  Mail,
  Shield,
  FolderTree,
  ChevronRight,
} from 'lucide-react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from './ui/collapsible';
import { useState } from 'react';
import Logo from './Logo';

export default function AppSidebar() {
  const pathname = usePathname();
  const [isSettingsOpen, setIsSettingsOpen] = useState(
    pathname.startsWith('/settings/')
  );

  const isActive = (href: string) => pathname.startsWith(href);

  return (
    <Sidebar>
      <SidebarContent>
        {/* Header */}
        <div className="mb-6 p-4">
          <div className="flex items-center gap-3">
            <Logo size="md" className="text-primary" />
            <div>
              <h2 className="text-lg font-semibold text-foreground">Luke</h2>
              {/* 
                <p className="text-sm text-muted-foreground">
                  Console Amministrativa
                </p>
              */}
            </div>
          </div>
        </div>

        {/* Sezione Generale */}
        <SidebarGroup>
          <SidebarGroupLabel>Generale</SidebarGroupLabel>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild isActive={isActive('/dashboard')}>
                <Link href="/dashboard">
                  <Home size={18} />
                  <span>Dashboard</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>

        {/* Sezione Impostazioni */}
        <SidebarGroup>
          <SidebarGroupLabel>Impostazioni</SidebarGroupLabel>
          <SidebarMenu>
            <Collapsible
              open={isSettingsOpen}
              onOpenChange={setIsSettingsOpen}
              className="group/collapsible"
            >
              <SidebarMenuItem>
                <CollapsibleTrigger asChild>
                  <SidebarMenuButton>
                    <Settings size={18} />
                    <span>Impostazioni</span>
                    <ChevronRight
                      size={16}
                      className={`ml-auto transition-transform duration-200 ${
                        isSettingsOpen ? 'rotate-90' : ''
                      }`}
                    />
                  </SidebarMenuButton>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <SidebarMenuSub>
                    <SidebarMenuSubItem>
                      <SidebarMenuSubButton
                        asChild
                        isActive={isActive('/settings/users')}
                      >
                        <Link href="/settings/users">
                          <Users size={16} />
                          <span>Utenti</span>
                        </Link>
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                    <SidebarMenuSubItem>
                      <SidebarMenuSubButton
                        asChild
                        isActive={isActive('/settings/storage')}
                      >
                        <Link href="/settings/storage">
                          <HardDrive size={16} />
                          <span>Storage</span>
                        </Link>
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                    <SidebarMenuSubItem>
                      <SidebarMenuSubButton
                        asChild
                        isActive={isActive('/settings/mail')}
                      >
                        <Link href="/settings/mail">
                          <Mail size={16} />
                          <span>Mail</span>
                        </Link>
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                    <SidebarMenuSubItem>
                      <SidebarMenuSubButton
                        asChild
                        isActive={isActive('/settings/ldap')}
                      >
                        <Link href="/settings/ldap">
                          <Shield size={16} />
                          <span>Auth LDAP</span>
                        </Link>
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                  </SidebarMenuSub>
                </CollapsibleContent>
              </SidebarMenuItem>
            </Collapsible>
          </SidebarMenu>
        </SidebarGroup>

        {/* Sezione Manutenzione */}
        <SidebarGroup>
          <SidebarGroupLabel>Manutenzione</SidebarGroupLabel>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                isActive={isActive('/settings/config')}
              >
                <Link href="/settings/config">
                  <ServerCog size={18} />
                  <span>Configurazioni</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                isActive={isActive('/settings/import-export')}
              >
                <Link href="/settings/import-export">
                  <FolderTree size={18} />
                  <span>Import/Export</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}

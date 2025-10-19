'use client';

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
  LogOut,
  User,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
import { useState } from 'react';

import Logo from './Logo';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from './ui/collapsible';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from './ui/sidebar';

export default function AppSidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const [isSettingsOpen, setIsSettingsOpen] = useState(
    pathname.startsWith('/settings/')
  );

  const isActive = (href: string) => pathname.startsWith(href);

  const handleSignOut = async () => {
    await signOut({ callbackUrl: '/login' });
  };

  // Genera le iniziali da firstName e lastName
  const getUserInitials = (firstName?: string, lastName?: string) => {
    if (firstName && lastName) {
      return `${firstName[0]}${lastName[0]}`.toUpperCase();
    }
    if (firstName) {
      return firstName.slice(0, 2).toUpperCase();
    }
    if (lastName) {
      return lastName.slice(0, 2).toUpperCase();
    }
    return 'U';
  };

  // Genera il nome completo da firstName e lastName
  const getFullName = (firstName?: string, lastName?: string) => {
    if (firstName && lastName) {
      return `${firstName} ${lastName}`;
    }
    if (firstName) {
      return firstName;
    }
    if (lastName) {
      return lastName;
    }
    return 'Utente';
  };

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

      {/* Footer con dropdown utente */}
      <SidebarFooter>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <div className="flex items-center gap-3 p-2 rounded-md hover:bg-accent hover:text-accent-foreground cursor-pointer transition-colors">
              <Avatar className="h-8 w-8">
                <AvatarImage
                  src={session?.user?.image || ''}
                  alt={getFullName(
                    session?.user?.firstName,
                    session?.user?.lastName
                  )}
                />
                <AvatarFallback className="text-xs">
                  {getUserInitials(
                    session?.user?.firstName,
                    session?.user?.lastName
                  )}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">
                  {getFullName(
                    session?.user?.firstName,
                    session?.user?.lastName
                  )}
                </p>
              </div>
            </div>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem asChild>
              <Link href="/profile">
                <User className="mr-2 h-4 w-4" />
                <span>Profilo</span>
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={handleSignOut}
              className="text-red-600 focus:text-red-600"
            >
              <LogOut className="mr-2 h-4 w-4" />
              <span>Logout</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarFooter>
    </Sidebar>
  );
}

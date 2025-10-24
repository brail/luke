'use client';

import {
  Home,
  Users,
  Settings,
  ServerCog,
  HardDrive,
  Mail,
  Shield,
  ShieldPlus,
  Wrench,
  ChevronDown,
  LogOut,
  User,
  FolderTree,
  Building2,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';

import { useMenuAccess } from '../hooks/useMenuAccess';

import Logo from './Logo';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
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
} from './ui/sidebar';

export default function AppSidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const menuAccess = useMenuAccess();

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

        {/* Sezione Generale - Solo se ha almeno una voce abilitata */}
        {menuAccess.showGeneralSection && (
          <SidebarGroup>
            <SidebarGroupLabel>Generale</SidebarGroupLabel>
            <SidebarMenu>
              {/* Dashboard - Solo se accesso consentito */}
              {menuAccess.dashboard && (
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={isActive('/dashboard')}>
                    <Link href="/dashboard">
                      <Home size={18} />
                      <span>Dashboard</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
            </SidebarMenu>
          </SidebarGroup>
        )}
      </SidebarContent>

      {/* Sezione Sistema - Solo se ha almeno una voce abilitata */}
      {menuAccess.showSystemSection && (
        <SidebarFooter>
          <SidebarGroup>
            <SidebarGroupLabel>Sistema</SidebarGroupLabel>
            <SidebarMenu>
              {/* Dropdown Impostazioni - Solo se accesso consentito */}
              {menuAccess.settings && (
                <SidebarMenuItem>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <SidebarMenuButton>
                        <Settings size={18} />
                        <span>Impostazioni</span>
                        <ChevronDown size={16} className="ml-auto" />
                      </SidebarMenuButton>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-56">
                      <DropdownMenuItem asChild>
                        <Link
                          href="/settings/users"
                          className="flex items-center"
                        >
                          <Users className="mr-2 h-4 w-4" />
                          <span>Utenti</span>
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link
                          href="/settings/brands"
                          className="flex items-center"
                        >
                          <Building2 className="mr-2 h-4 w-4" />
                          <span>Brand</span>
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link
                          href="/settings/storage"
                          className="flex items-center"
                        >
                          <HardDrive className="mr-2 h-4 w-4" />
                          <span>Storage</span>
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link
                          href="/settings/mail"
                          className="flex items-center"
                        >
                          <Mail className="mr-2 h-4 w-4" />
                          <span>Mail</span>
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link
                          href="/settings/ldap"
                          className="flex items-center"
                        >
                          <Shield className="mr-2 h-4 w-4" />
                          <span>Auth LDAP</span>
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link
                          href="/settings/access"
                          className="flex items-center"
                        >
                          <ShieldPlus className="mr-2 h-4 w-4" />
                          <span>Accesso</span>
                        </Link>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </SidebarMenuItem>
              )}

              {/* Dropdown Manutenzione - Solo se accesso consentito */}
              {menuAccess.maintenance && (
                <SidebarMenuItem>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <SidebarMenuButton>
                        <Wrench size={18} />
                        <span>Manutenzione</span>
                        <ChevronDown size={16} className="ml-auto" />
                      </SidebarMenuButton>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-56">
                      <DropdownMenuItem asChild>
                        <Link
                          href="/maintenance/config"
                          className="flex items-center"
                        >
                          <ServerCog className="mr-2 h-4 w-4" />
                          <span>Configurazioni</span>
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link
                          href="/maintenance/import-export"
                          className="flex items-center"
                        >
                          <FolderTree className="mr-2 h-4 w-4" />
                          <span>Import/Export</span>
                        </Link>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </SidebarMenuItem>
              )}
            </SidebarMenu>
          </SidebarGroup>
        </SidebarFooter>
      )}

      {/* Footer con dropdown utente - sempre visibile */}
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

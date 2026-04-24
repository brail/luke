'use client';

import {
  Home,
  Users,
  Settings,
  ServerCog,
  HardDrive,
  Mail,
  Shield,
  Database,
  RefreshCw,
  ShieldCheck,
  Wrench,
  ChevronRight,
  ChevronDown,
  LogOut,
  User,
  FolderTree,
  Building2,
  CalendarDays,
  Calculator,
  TrendingUp,
  LayoutGrid,
  Truck,
  ShoppingCart,
  BarChart2,
  ClipboardList,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';

import { useMenuAccess } from '../hooks/useMenuAccess';
import { useMenuPreferences } from '../hooks/useMenuPreferences';

import Logo from './Logo';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuGroup,
} from './ui/dropdown-menu';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarMenuSub,
  SidebarMenuSubItem,
  SidebarMenuSubButton,
  SidebarRail,
  SidebarTrigger,
} from './ui/sidebar';

export default function AppSidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const menuAccess = useMenuAccess();
  const { menuStates, toggleMenu } = useMenuPreferences();

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
      <SidebarHeader>
        <div className="flex items-center justify-between px-2 py-1">
          <div className="flex items-center gap-3">
            <Logo size="sm" className="text-primary" />
            <h2 className="text-lg font-semibold text-foreground">Luke</h2>
          </div>
          <SidebarTrigger />
        </div>
      </SidebarHeader>
      <SidebarContent>

        {/* Menu compatto senza sezioni */}
        <SidebarMenu>
          {/* Dashboard */}
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

          {/* Vendite con submenu collapsabile */}
          {menuAccess.sales && (
            <SidebarMenuItem>
              <Collapsible
                open={menuStates.vendite}
                onOpenChange={(isOpen) => toggleMenu('vendite', isOpen)}
                className="group w-full"
              >
                <CollapsibleTrigger asChild>
                  <SidebarMenuButton isActive={isActive('/sales')} className="cursor-pointer">
                    <ShoppingCart size={18} />
                    <span>Vendite</span>
                    <ChevronRight size={16} className="ml-auto transition-transform group-data-[state=open]:rotate-90" />
                  </SidebarMenuButton>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <SidebarMenuSub>
                    {menuAccess.salesItems.statistics && (
                      <SidebarMenuSubItem>
                        <SidebarMenuSubButton
                          asChild
                          isActive={isActive('/sales/statistics')}
                        >
                          <Link href="/sales/statistics">
                            <BarChart2 size={16} />
                            <span>Statistiche</span>
                          </Link>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    )}
                  </SidebarMenuSub>
                </CollapsibleContent>
              </Collapsible>
            </SidebarMenuItem>
          )}

          {/* Prodotto con submenu collapsabile */}
          {menuAccess.product && (
            <SidebarMenuItem>
              <Collapsible
                open={menuStates.prodotto}
                onOpenChange={(isOpen) => toggleMenu('prodotto', isOpen)}
                className="group w-full"
              >
                <CollapsibleTrigger asChild>
                  <SidebarMenuButton isActive={isActive('/product')} className="cursor-pointer">
                    <Calculator size={18} />
                    <span>Prodotto</span>
                    <ChevronRight size={16} className="ml-auto transition-transform group-data-[state=open]:rotate-90" />
                  </SidebarMenuButton>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <SidebarMenuSub>
                    <SidebarMenuSubItem>
                      <SidebarMenuSubButton
                        asChild
                        isActive={isActive('/product/pricing')}
                      >
                        <Link href="/product/pricing">
                          <TrendingUp size={16} />
                          <span>Costi e Prezzi</span>
                        </Link>
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                    <SidebarMenuSubItem>
                      <SidebarMenuSubButton
                        asChild
                        isActive={isActive('/product/collection-layout')}
                      >
                        <Link href="/product/collection-layout">
                          <LayoutGrid size={16} />
                          <span>Collection Layout</span>
                        </Link>
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                    {menuAccess.productItems?.merchandisingPlan && (
                      <SidebarMenuSubItem>
                        <SidebarMenuSubButton
                          asChild
                          isActive={isActive('/product/merchandising-plan')}
                        >
                          <Link href="/product/merchandising-plan">
                            <ClipboardList size={16} />
                            <span>Merchandising Plan</span>
                          </Link>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    )}
                  </SidebarMenuSub>
                </CollapsibleContent>
              </Collapsible>
            </SidebarMenuItem>
          )}
        </SidebarMenu>
      </SidebarContent>

      {/* Menu Sistema - Dropdown (utility menus) */}
      {menuAccess.showSystemSection && (
        <SidebarFooter className="py-2">
          <div className="flex flex-col gap-1">
            {/* Amministrazione */}
            {menuAccess.admin && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SidebarMenuButton className="cursor-pointer">
                    <ShieldCheck size={18} />
                    <span>Amministrazione</span>
                    <ChevronDown size={16} className="ml-auto" />
                  </SidebarMenuButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="top" align="start" className="w-56">
                  <DropdownMenuGroup>
                    {menuAccess.adminItems.brands && (
                      <DropdownMenuItem asChild>
                        <Link href="/admin/brands" className="flex items-center gap-2">
                          <Building2 size={16} />
                          <span>Brand</span>
                        </Link>
                      </DropdownMenuItem>
                    )}
                    {menuAccess.adminItems.seasons && (
                      <DropdownMenuItem asChild>
                        <Link href="/admin/seasons" className="flex items-center gap-2">
                          <CalendarDays size={16} />
                          <span>Stagioni</span>
                        </Link>
                      </DropdownMenuItem>
                    )}
                    {menuAccess.adminItems.vendors && (
                      <DropdownMenuItem asChild>
                        <Link href="/admin/vendors" className="flex items-center gap-2">
                          <Truck size={16} />
                          <span>Fornitori</span>
                        </Link>
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {/* Impostazioni */}
            {menuAccess.settings && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SidebarMenuButton className="cursor-pointer">
                    <Settings size={18} />
                    <span>Impostazioni</span>
                    <ChevronDown size={16} className="ml-auto" />
                  </SidebarMenuButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="top" align="start" className="w-56">
                  <DropdownMenuGroup>
                    {menuAccess.settingsItems.users && (
                      <DropdownMenuItem asChild>
                        <Link href="/settings/users" className="flex items-center gap-2">
                          <Users size={16} />
                          <span>Utenti</span>
                        </Link>
                      </DropdownMenuItem>
                    )}
                    {menuAccess.settingsItems.storage && (
                      <DropdownMenuItem asChild>
                        <Link href="/settings/storage" className="flex items-center gap-2">
                          <HardDrive size={16} />
                          <span>Storage</span>
                        </Link>
                      </DropdownMenuItem>
                    )}
                    {menuAccess.settingsItems.mail && (
                      <DropdownMenuItem asChild>
                        <Link href="/settings/mail" className="flex items-center gap-2">
                          <Mail size={16} />
                          <span>Mail</span>
                        </Link>
                      </DropdownMenuItem>
                    )}
                    {menuAccess.settingsItems.ldap && (
                      <DropdownMenuItem asChild>
                        <Link href="/settings/ldap" className="flex items-center gap-2">
                          <Shield size={16} />
                          <span>Auth LDAP</span>
                        </Link>
                      </DropdownMenuItem>
                    )}
                    {menuAccess.settingsItems.nav && (
                      <DropdownMenuItem asChild>
                        <Link href="/settings/nav" className="flex items-center gap-2">
                          <Database size={16} />
                          <span>Microsoft NAV</span>
                        </Link>
                      </DropdownMenuItem>
                    )}
                    {menuAccess.settingsItems.nav_sync && (
                      <DropdownMenuItem asChild>
                        <Link href="/settings/nav-sync" className="flex items-center gap-2">
                          <RefreshCw size={16} />
                          <span>Sincronizzazione NAV</span>
                        </Link>
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {/* Manutenzione */}
            {menuAccess.maintenance && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SidebarMenuButton className="cursor-pointer">
                    <Wrench size={18} />
                    <span>Manutenzione</span>
                    <ChevronDown size={16} className="ml-auto" />
                  </SidebarMenuButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="top" align="start" className="w-56">
                  <DropdownMenuGroup>
                    {menuAccess.maintenanceItems.config && (
                      <DropdownMenuItem asChild>
                        <Link href="/maintenance/config" className="flex items-center gap-2">
                          <ServerCog size={16} />
                          <span>Configurazioni</span>
                        </Link>
                      </DropdownMenuItem>
                    )}
                    {menuAccess.maintenanceItems.import_export && (
                      <DropdownMenuItem asChild>
                        <Link href="/maintenance/import-export" className="flex items-center gap-2">
                          <FolderTree size={16} />
                          <span>Import/Export</span>
                        </Link>
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </SidebarFooter>
      )}

      {/* Versione app — solo in development */}
      {process.env.NODE_ENV === 'development' && (
        <div className="px-3 pb-1 text-xs text-muted-foreground/60 select-none">
          {[process.env.NEXT_PUBLIC_APP_VERSION, 'dev']
            .filter(Boolean)
            .join(' · ')}
        </div>
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
      <SidebarRail />
    </Sidebar>
  );
}

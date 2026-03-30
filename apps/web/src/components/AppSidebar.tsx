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
} from './ui/dropdown-menu'; // Solo per il menu utente al fondo
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarMenuSub,
  SidebarMenuSubItem,
  SidebarMenuSubButton,
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
      <SidebarContent>
        {/* Header */}
        <div className="mb-6 p-4">
          <div className="flex items-center gap-3">
            <Logo size="md" className="text-primary" />
            <div>
              <h2 className="text-lg font-semibold text-foreground">Luke</h2>
            </div>
          </div>
        </div>

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
                  </SidebarMenuSub>
                </CollapsibleContent>
              </Collapsible>
            </SidebarMenuItem>
          )}
        </SidebarMenu>
      </SidebarContent>

      {/* Menu Sistema */}
      {menuAccess.showSystemSection && (
        <SidebarFooter>
          <SidebarMenu>
            {/* Amministrazione */}
            {menuAccess.admin && (
              <SidebarMenuItem>
                <Collapsible
                  open={menuStates.amministrazione}
                  onOpenChange={(isOpen) => toggleMenu('amministrazione', isOpen)}
                  className="group w-full"
                >
                  <CollapsibleTrigger asChild>
                    <SidebarMenuButton className="cursor-pointer">
                      <ShieldCheck size={18} />
                      <span>Amministrazione</span>
                      <ChevronRight size={16} className="ml-auto transition-transform group-data-[state=open]:rotate-90" />
                    </SidebarMenuButton>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <SidebarMenuSub>
                      {menuAccess.adminItems.brands && (
                        <SidebarMenuSubItem>
                          <SidebarMenuSubButton
                            asChild
                            isActive={isActive('/admin/brands')}
                          >
                            <Link href="/admin/brands">
                              <Building2 size={16} />
                              <span>Brand</span>
                            </Link>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      )}
                      {menuAccess.adminItems.seasons && (
                        <SidebarMenuSubItem>
                          <SidebarMenuSubButton
                            asChild
                            isActive={isActive('/admin/seasons')}
                          >
                            <Link href="/admin/seasons">
                              <CalendarDays size={16} />
                              <span>Stagioni</span>
                            </Link>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      )}
                      {menuAccess.adminItems.vendors && (
                        <SidebarMenuSubItem>
                          <SidebarMenuSubButton
                            asChild
                            isActive={isActive('/admin/vendors')}
                          >
                            <Link href="/admin/vendors">
                              <Truck size={16} />
                              <span>Fornitori</span>
                            </Link>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      )}
                    </SidebarMenuSub>
                  </CollapsibleContent>
                </Collapsible>
              </SidebarMenuItem>
            )}

            {/* Impostazioni */}
            {menuAccess.settings && (
              <SidebarMenuItem>
                <Collapsible
                  open={menuStates.impostazioni}
                  onOpenChange={(isOpen) => toggleMenu('impostazioni', isOpen)}
                  className="group w-full"
                >
                  <CollapsibleTrigger asChild>
                    <SidebarMenuButton className="cursor-pointer">
                      <Settings size={18} />
                      <span>Impostazioni</span>
                      <ChevronRight size={16} className="ml-auto transition-transform group-data-[state=open]:rotate-90" />
                    </SidebarMenuButton>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <SidebarMenuSub>
                      {menuAccess.settingsItems.users && (
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
                      )}
                      {menuAccess.settingsItems.storage && (
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
                      )}
                      {menuAccess.settingsItems.mail && (
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
                      )}
                      {menuAccess.settingsItems.ldap && (
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
                      )}
                      {menuAccess.settingsItems.nav && (
                        <SidebarMenuSubItem>
                          <SidebarMenuSubButton
                            asChild
                            isActive={isActive('/settings/nav')}
                          >
                            <Link href="/settings/nav">
                              <Database size={16} />
                              <span>Microsoft NAV</span>
                            </Link>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      )}
                      {menuAccess.settingsItems.nav_sync && (
                        <SidebarMenuSubItem>
                          <SidebarMenuSubButton
                            asChild
                            isActive={isActive('/settings/nav-sync')}
                          >
                            <Link href="/settings/nav-sync">
                              <RefreshCw size={16} />
                              <span>Sincronizzazione NAV</span>
                            </Link>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      )}
                    </SidebarMenuSub>
                  </CollapsibleContent>
                </Collapsible>
              </SidebarMenuItem>
            )}

            {/* Manutenzione */}
            {menuAccess.maintenance && (
              <SidebarMenuItem>
                <Collapsible
                  open={menuStates.manutenzione}
                  onOpenChange={(isOpen) => toggleMenu('manutenzione', isOpen)}
                  className="group w-full"
                >
                  <CollapsibleTrigger asChild>
                    <SidebarMenuButton className="cursor-pointer">
                      <Wrench size={18} />
                      <span>Manutenzione</span>
                      <ChevronRight size={16} className="ml-auto transition-transform group-data-[state=open]:rotate-90" />
                    </SidebarMenuButton>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <SidebarMenuSub>
                      {menuAccess.maintenanceItems.config && (
                        <SidebarMenuSubItem>
                          <SidebarMenuSubButton
                            asChild
                            isActive={isActive('/maintenance/config')}
                          >
                            <Link href="/maintenance/config">
                              <ServerCog size={16} />
                              <span>Configurazioni</span>
                            </Link>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      )}
                      {menuAccess.maintenanceItems.import_export && (
                        <SidebarMenuSubItem>
                          <SidebarMenuSubButton
                            asChild
                            isActive={isActive('/maintenance/import-export')}
                          >
                            <Link href="/maintenance/import-export">
                              <FolderTree size={16} />
                              <span>Import/Export</span>
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
    </Sidebar>
  );
}

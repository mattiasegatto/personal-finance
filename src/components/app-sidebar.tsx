import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  LayoutDashboard,
  ArrowLeftRight,
  CreditCard,
  Landmark,
  TrendingUp,
  Repeat,
  CalendarClock,
  BarChart3,
  Settings,
  Users,
  Lock,
  LogOut,
  Tags,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

const personal = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Movimenti", url: "/movimenti", icon: ArrowLeftRight },
  { title: "Conti e carte", url: "/conti", icon: CreditCard },
  { title: "Categorie", url: "/categorie", icon: Tags },
  { title: "Patrimonio", url: "/patrimonio", icon: Landmark },
  { title: "Investimenti", url: "/investimenti", icon: TrendingUp },
  { title: "Redditi e ricorrenti", url: "/ricorrenti", icon: Repeat },
  { title: "Scadenze", url: "/scadenze", icon: CalendarClock },
  { title: "Report e analisi", url: "/report", icon: BarChart3 },
] as const;

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const path = useRouterState({ select: (r) => r.location.pathname });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const signOut = async () => {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  const item = (i: { title: string; url: string; icon: typeof Users }) => (
    <SidebarMenuItem key={i.url}>
      <SidebarMenuButton asChild isActive={path === i.url} tooltip={i.title}>
        <Link to={i.url}>
          <i.icon className="h-4 w-4" />
          {!collapsed && <span>{i.title}</span>}
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="px-3 py-5">
        <div className="flex items-center gap-2">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-sidebar-primary font-display text-sidebar-primary-foreground">
            f
          </div>
          {!collapsed && (
            <span className="font-display text-lg text-sidebar-accent-foreground">
              Personal Finance
            </span>
          )}
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="gap-1.5">
            <Lock className="h-3 w-3" />
            Spazio personale
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{personal.map(item)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel className="gap-1.5">
            <Users className="h-3 w-3" />
            Spazio condiviso
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {item({ title: "Spese condivise", url: "/spese-condivise", icon: Users })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup className="mt-auto">
          <SidebarGroupContent>
            <SidebarMenu>
              {item({ title: "Impostazioni e spazi", url: "/impostazioni", icon: Settings })}
              <SidebarMenuItem>
                <SidebarMenuButton tooltip="Esci" onClick={signOut}>
                  <LogOut className="h-4 w-4" />
                  {!collapsed && <span>Esci</span>}
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}

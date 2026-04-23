import { useQuery } from "@tanstack/react-query";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarRail,
  useSidebar,
} from "@wow-dashboard/ui/components/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@wow-dashboard/ui/components/dropdown-menu";
import { ArrowDown, ArrowUp, ChevronUp, Copy, LayoutDashboard, Scale, Settings, Star, Trophy } from "lucide-react";
import { Link, useRouterState } from "@tanstack/react-router";
import { useMemo } from "react";

import { apiQueryOptions } from "@/lib/api-client";
import { authClient } from "@/lib/auth-client";
import { getClassTextColor } from "@/lib/class-colors";
import { usePinnedCharacters } from "@/lib/pinned-characters";

const navItems = [
  { to: "/dashboard" as const, label: "Dashboard", icon: LayoutDashboard },
  { to: "/scoreboard" as const, label: "Scoreboard", icon: Trophy },
  { to: "/copy-helper" as const, label: "Copy Helper", icon: Copy },
  { to: "/compare" as const, label: "Compare", icon: Scale },
];

const bottomNavItems = [{ to: "/settings" as const, label: "Settings", icon: Settings }];

function NavUser() {
  const session = authClient.useSession();
  const user = session.data?.user;
  const { isMobile } = useSidebar();

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold uppercase">
                {user?.name?.[0] ?? "?"}
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{user?.name ?? "Loading…"}</span>
              </div>
              <ChevronUp className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
            className="min-w-48"
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel>{user?.name}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => {
                  authClient.signOut({
                    fetchOptions: {
                      onSuccess: () => {
                        location.reload();
                      },
                    },
                  });
                }}
              >
                Sign Out
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

export function AppSidebar() {
  const session = authClient.useSession();
  const router = useRouterState();
  const pathname = router.location.pathname;
  const { pinnedCharacterIds, movePinnedCharacter } = usePinnedCharacters();
  const charactersQuery = useQuery({
    ...apiQueryOptions.charactersLatest({ characterId: pinnedCharacterIds }),
    enabled: pinnedCharacterIds.length > 0,
  });
  const characters = charactersQuery.data;
  const isQuickAccessLoading = charactersQuery.isLoading;
  const quickAccessCharacters = useMemo(() => {
    if (characters === undefined || characters === null || pinnedCharacterIds.length === 0) {
      return [];
    }

    const charactersById = new Map(
      characters.map((character) => [String(character._id), character]),
    );
    return pinnedCharacterIds.flatMap((characterId) => {
      const character = charactersById.get(characterId);
      return character ? [character] : [];
    });
  }, [characters, pinnedCharacterIds]);
  const showQuickAccess =
    pinnedCharacterIds.length > 0 &&
    (isQuickAccessLoading || quickAccessCharacters.length > 0);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link to="/dashboard">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground text-xs font-bold">
                  W
                </div>
                <span className="font-semibold">WoW Dashboard</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => {
                const isActive =
                  item.to === "/scoreboard"
                    ? pathname === item.to || pathname.startsWith("/players/")
                    : pathname === item.to;

                return (
                  <SidebarMenuItem key={item.to}>
                    <SidebarMenuButton asChild isActive={isActive} tooltip={item.label}>
                      <Link to={item.to}>
                        <item.icon />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {showQuickAccess && (
          <SidebarGroup>
            <SidebarGroupLabel className="flex items-center gap-2">
              <Star className="size-3.5 text-yellow-400" />
              <span>Quick Access</span>
            </SidebarGroupLabel>
            <SidebarGroupContent>
              {isQuickAccessLoading ? (
                <SidebarMenu>
                  {pinnedCharacterIds.slice(0, 4).map((characterId) => (
                    <SidebarMenuSkeleton key={characterId} showIcon />
                  ))}
                </SidebarMenu>
              ) : (
                <SidebarMenu>
                  {quickAccessCharacters.map((character, index) => (
                    <SidebarMenuItem key={character._id}>
                      <SidebarMenuButton
                        asChild
                        isActive={pathname === `/character/${character._id}`}
                        tooltip={`${character.name} — ${character.realm}`}
                        className="h-9 border border-sidebar-border/50 bg-sidebar-accent/20 pr-14 hover:bg-sidebar-accent/35 data-[active=true]:border-sidebar-border data-[active=true]:bg-sidebar-accent/55"
                      >
                        <Link to="/character/$characterId" params={{ characterId: character._id }}>
                          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm border border-sidebar-border/70 bg-sidebar text-[10px] font-semibold uppercase">
                            {character.name[0] ?? "?"}
                          </div>
                          <div className="grid min-w-0 flex-1 text-left leading-tight">
                            <span className={`truncate font-medium ${getClassTextColor(character.class)}`}>
                              {character.name}
                            </span>
                            <span className="truncate text-[11px] text-sidebar-foreground/60">
                              {character.realm}
                              {character.snapshot ? ` · ${character.snapshot.itemLevel.toFixed(1)} iLvl` : ""}
                            </span>
                          </div>
                        </Link>
                      </SidebarMenuButton>
                      <SidebarMenuAction
                        showOnHover
                        className="right-7"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          movePinnedCharacter(String(character._id), "up");
                        }}
                        disabled={index === 0}
                        aria-label={`Move ${character.name} up`}
                      >
                        <ArrowUp />
                      </SidebarMenuAction>
                      <SidebarMenuAction
                        showOnHover
                        className="right-1"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          movePinnedCharacter(String(character._id), "down");
                        }}
                        disabled={index === quickAccessCharacters.length - 1}
                        aria-label={`Move ${character.name} down`}
                      >
                        <ArrowDown />
                      </SidebarMenuAction>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              )}
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {/* Bottom nav pushed to bottom of content area */}
        <SidebarGroup className="mt-auto">
          <SidebarGroupContent>
            <SidebarMenu>
              {bottomNavItems.map((item) => (
                <SidebarMenuItem key={item.to}>
                  <SidebarMenuButton
                    asChild
                    isActive={pathname === item.to}
                    tooltip={item.label}
                  >
                    <Link to={item.to}>
                      <item.icon />
                      <span>{item.label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        {session.data ? (
          <NavUser />
        ) : null}
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}

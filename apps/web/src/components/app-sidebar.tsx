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
import ArrowDown from "lucide-react/dist/esm/icons/arrow-down.mjs";
import ArrowUp from "lucide-react/dist/esm/icons/arrow-up.mjs";
import ChevronUp from "lucide-react/dist/esm/icons/chevron-up.mjs";
import Copy from "lucide-react/dist/esm/icons/copy.mjs";
import LayoutDashboard from "lucide-react/dist/esm/icons/layout-dashboard.mjs";
import PanelLeftClose from "lucide-react/dist/esm/icons/panel-left-close.mjs";
import Scale from "lucide-react/dist/esm/icons/scale.mjs";
import Settings from "lucide-react/dist/esm/icons/settings.mjs";
import Shield from "lucide-react/dist/esm/icons/shield.mjs";
import Star from "lucide-react/dist/esm/icons/star.mjs";
import Trophy from "lucide-react/dist/esm/icons/trophy.mjs";
import { Link, useRouterState } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { createCharacterRouteId } from "@wow-dashboard/api-schema";
import { toast } from "sonner";

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

const settingsNavItem = { to: "/settings" as const, label: "Settings", icon: Settings };
const adminNavItem = { to: "/admin" as const, label: "Admin", icon: Shield };

function getCharacterRouteSegment(pathname: string) {
  if (!pathname.startsWith("/character/")) {
    return "";
  }

  const segment = pathname.slice("/character/".length).split("/")[0] ?? "";
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function NavUser() {
  const session = authClient.useSession();
  const user = session.data?.user;
  const { isMobile } = useSidebar();
  const [isSigningOut, setIsSigningOut] = useState(false);

  async function handleSignOut() {
    if (isSigningOut) return;

    setIsSigningOut(true);
    try {
      const result = await authClient.signOut();
      if (result.error) {
        throw new Error("Sign-out request failed");
      }
      location.assign("/");
    } catch {
      toast.error("Could not sign out. Check your connection and try again.");
      setIsSigningOut(false);
    }
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-sidebar-accent text-xs font-semibold uppercase text-sidebar-accent-foreground ring-1 ring-sidebar-border">
                {user?.name?.[0] ?? "?"}
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{user?.name ?? "Loading…"}</span>
              </div>
              <ChevronUp aria-hidden="true" className="ml-auto" />
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
                disabled={isSigningOut}
                onClick={() => void handleSignOut()}
              >
                {isSigningOut ? "Signing Out…" : "Sign Out"}
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
  const { toggleSidebar } = useSidebar();
  const meQuery = useQuery(apiQueryOptions.me());
  const router = useRouterState();
  const pathname = router.location.pathname;
  const activeCharacterRouteSegment = getCharacterRouteSegment(pathname);
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
    pinnedCharacterIds.length > 0 && (isQuickAccessLoading || quickAccessCharacters.length > 0);
  const bottomNavItems = meQuery.data?.isAdmin
    ? [adminNavItem, settingsNavItem]
    : [settingsNavItem];

  return (
    <Sidebar collapsible="icon" variant="floating">
      <SidebarHeader className="border-b border-sidebar-border/70">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild className="pr-10">
              <Link to="/dashboard">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-sidebar-primary font-mono text-[10px] font-bold text-sidebar-primary-foreground shadow-sm">
                  WD
                </div>
                <div className="grid min-w-0 flex-1 text-left leading-tight">
                  <span className="truncate font-semibold tracking-tight">WoW Dashboard</span>
                  <span className="truncate text-[10px] text-sidebar-foreground/55">
                    Character intelligence
                  </span>
                </div>
              </Link>
            </SidebarMenuButton>
            <SidebarMenuAction
              onClick={toggleSidebar}
              aria-label="Collapse sidebar"
              title="Collapse sidebar"
            >
              <PanelLeftClose aria-hidden="true" />
            </SidebarMenuAction>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
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
                        <item.icon aria-hidden="true" />
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
              <Star aria-hidden="true" className="text-sidebar-primary" />
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
                  {quickAccessCharacters.map((character, index) => {
                    const characterRouteId = createCharacterRouteId(character);
                    const isActive =
                      activeCharacterRouteSegment === characterRouteId ||
                      activeCharacterRouteSegment === character._id;

                    return (
                      <SidebarMenuItem key={character._id}>
                        <SidebarMenuButton
                          asChild
                          isActive={isActive}
                          tooltip={`${character.name} — ${character.realm}`}
                          size="lg"
                          variant="outline"
                          className="pr-14 ring-1 ring-sidebar-border/70"
                        >
                          <Link
                            to="/character/$characterId"
                            params={{ characterId: characterRouteId }}
                          >
                            <div className="flex size-7 shrink-0 items-center justify-center rounded-sm border border-sidebar-border/70 bg-sidebar text-[10px] font-semibold uppercase">
                              {character.name[0] ?? "?"}
                            </div>
                            <div className="grid min-w-0 flex-1 text-left leading-tight">
                              <span
                                className={`truncate font-medium ${getClassTextColor(character.class)}`}
                              >
                                {character.name}
                              </span>
                              <span className="truncate text-[11px] text-sidebar-foreground/60">
                                {character.realm}
                                {character.snapshot
                                  ? ` · ${character.snapshot.itemLevel.toFixed(1)} iLvl`
                                  : ""}
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
                          <ArrowUp aria-hidden="true" />
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
                          <ArrowDown aria-hidden="true" />
                        </SidebarMenuAction>
                      </SidebarMenuItem>
                    );
                  })}
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
                  <SidebarMenuButton asChild isActive={pathname === item.to} tooltip={item.label}>
                    <Link to={item.to}>
                      <item.icon aria-hidden="true" />
                      <span>{item.label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border/70">
        {session.data ? <NavUser /> : null}
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}

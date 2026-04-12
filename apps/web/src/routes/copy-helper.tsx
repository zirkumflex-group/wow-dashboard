import { createFileRoute, redirect } from "@tanstack/react-router";
import { api } from "@wow-dashboard/backend/convex/_generated/api";
import { Badge } from "@wow-dashboard/ui/components/badge";
import { Button } from "@wow-dashboard/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@wow-dashboard/ui/components/card";
import { Checkbox } from "@wow-dashboard/ui/components/checkbox";
import { Input } from "@wow-dashboard/ui/components/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@wow-dashboard/ui/components/sheet";
import { Skeleton } from "@wow-dashboard/ui/components/skeleton";
import { useQuery } from "convex/react";
import { Check, Copy, Users, Zap } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { getClassTextColor } from "../lib/class-colors";
import { getMythicPlusDungeonMeta } from "../lib/mythic-plus-static";
import {
  TRADE_SLOT_LABELS,
  getTradeSlotExportLabels,
  type TradeSlotKey,
} from "../lib/trade-slots";

export const Route = createFileRoute("/copy-helper")({
  beforeLoad: ({ context }) => {
    if (!context.isAuthenticated) throw redirect({ to: "/" });
  },
  component: RouteComponent,
});

function getDefaultExportHeadline(selectedCount: number) {
  if (selectedCount <= 1) return "SOLO";
  if (selectedCount === 2) return "DUO";
  if (selectedCount === 3) return "TRIO";
  return "GROUP";
}

function getExportRoleLabel(role: string) {
  if (role === "tank") return "Tank";
  if (role === "healer") return "Heal";
  return "DD";
}

function getExportClassLabel(className: string) {
  const normalizedClassName = className.trim().toLowerCase();

  if (normalizedClassName === "death knight") return "DK";
  if (normalizedClassName === "demon hunter") return "DH";

  return className.trim();
}

function formatExportScore(score: number) {
  if (score >= 1000) {
    const compactScore = Math.round(score / 100) / 10;
    return `${Number.isInteger(compactScore) ? compactScore.toFixed(0) : compactScore.toFixed(1)}k`;
  }

  return Math.round(score).toString();
}

function buildExportLine(character: {
  class: string;
  nonTradeableSlots: TradeSlotKey[];
  ownerDiscordUserId: string | null;
  snapshot: {
    role: string;
    mythicPlusScore: number;
    ownedKeystone: {
      level: number;
      mapChallengeModeID?: number;
      mapName?: string;
    } | null;
  };
}, options: {
  includeKey: boolean;
  includeTradeLocks: boolean;
  includeDiscordId: boolean;
}) {
  const discordMention = character.ownerDiscordUserId
    ? `<@${character.ownerDiscordUserId}>`
    : "[missing-discord-id]";
  const exportSegments = [
    getExportRoleLabel(character.snapshot.role),
    getExportClassLabel(character.class),
    formatExportScore(character.snapshot.mythicPlusScore),
  ];
  const detailSegments: string[] = [];

  if (options.includeKey) {
    detailSegments.push(getEquippedKeystoneExportLabel(character.snapshot.ownedKeystone));
  }

  if (options.includeTradeLocks) {
    const tradeLockLabels = getTradeSlotExportLabels(character.nonTradeableSlots);
    if (tradeLockLabels.length > 0) {
      detailSegments.push(`can't trade: ${tradeLockLabels.join(", ")}`);
    }
  }

  for (const detailSegment of detailSegments) {
    exportSegments.push("|", detailSegment);
  }

  if (options.includeDiscordId) {
    exportSegments.push(discordMention);
  }

  return exportSegments.join(" ");
}

type BoosterCharacter = {
  _id: string;
  playerId: string;
  name: string;
  realm: string;
  region: string;
  class: string;
  faction: "alliance" | "horde";
  isBooster: boolean;
  nonTradeableSlots: TradeSlotKey[];
  ownerBattleTag: string | null;
  ownerDiscordUserId: string | null;
  snapshot: {
    role: "tank" | "healer" | "dps";
    mythicPlusScore: number;
    itemLevel: number;
    takenAt: number;
    ownedKeystone: {
      level: number;
      mapChallengeModeID?: number;
      mapName?: string;
    } | null;
  } | null;
};

type ReadyBoosterCharacter = BoosterCharacter & {
  snapshot: NonNullable<BoosterCharacter["snapshot"]>;
};

function hasSnapshot(character: BoosterCharacter): character is ReadyBoosterCharacter {
  return character.snapshot !== null;
}

function getEquippedKeystoneLabel(
  keystone:
    | {
        level: number;
        mapChallengeModeID?: number;
        mapName?: string;
      }
    | null,
) {
  if (!keystone) {
    return "No keystone";
  }

  const dungeonMeta = getMythicPlusDungeonMeta(keystone.mapChallengeModeID, keystone.mapName);
  const dungeonLabel =
    dungeonMeta?.shortName ??
    keystone.mapName ??
    (keystone.mapChallengeModeID !== undefined
      ? `Dungeon ${keystone.mapChallengeModeID}`
      : "Unknown");

  return `+${keystone.level} ${dungeonLabel}`;
}

function getEquippedKeystoneExportLabel(
  keystone:
    | {
        level: number;
        mapChallengeModeID?: number;
        mapName?: string;
      }
    | null,
) {
  if (!keystone) {
    return "No key";
  }

  const dungeonMeta = getMythicPlusDungeonMeta(keystone.mapChallengeModeID, keystone.mapName);
  const dungeonLabel =
    dungeonMeta?.shortName ??
    keystone.mapName ??
    (keystone.mapChallengeModeID !== undefined
      ? `Dungeon ${keystone.mapChallengeModeID}`
      : "Unknown");

  return `${dungeonLabel} +${keystone.level}`;
}

function RouteComponent() {
  const boosterCharacters = useQuery(
    (api as any).characters.getBoosterCharactersForExport,
  ) as BoosterCharacter[] | null | undefined;
  const [selectedCharacterIds, setSelectedCharacterIds] = useState<string[]>([]);
  const [customHeadline, setCustomHeadline] = useState("");
  const [includeKey, setIncludeKey] = useState(true);
  const [includeTradeLocks, setIncludeTradeLocks] = useState(true);
  const [includeDiscordId, setIncludeDiscordId] = useState(true);

  useEffect(() => {
    if (!boosterCharacters) {
      return;
    }

    const validCharacterIds = new Set(
      boosterCharacters
        .filter((character) => character.snapshot)
        .map((character) => String(character._id)),
    );

    setSelectedCharacterIds((currentCharacterIds) =>
      currentCharacterIds.filter((characterId) => validCharacterIds.has(characterId)),
    );
  }, [boosterCharacters]);

  const selectableCharacters = useMemo(
    () => boosterCharacters?.filter(hasSnapshot) ?? [],
    [boosterCharacters],
  );
  const selectedCharacterIdSet = useMemo(
    () => new Set(selectedCharacterIds),
    [selectedCharacterIds],
  );
  const selectedCharacters = useMemo(
    () =>
      selectableCharacters.filter((character) =>
        selectedCharacterIdSet.has(String(character._id)),
      ),
    [selectableCharacters, selectedCharacterIdSet],
  );
  const missingDiscordCharacters = useMemo(
    () => selectedCharacters.filter((character) => !character.ownerDiscordUserId),
    [selectedCharacters],
  );

  const exportHeadline = customHeadline.trim() || getDefaultExportHeadline(selectedCharacters.length);
  const exportText = useMemo(() => {
    if (selectedCharacters.length === 0) {
      return "";
    }

    return [
      exportHeadline,
      ...selectedCharacters.map((character) =>
        buildExportLine(character, {
          includeKey,
          includeTradeLocks,
          includeDiscordId,
        }),
      ),
    ].join("\r\n");
  }, [exportHeadline, includeDiscordId, includeKey, includeTradeLocks, selectedCharacters]);

  function toggleCharacterSelection(characterId: string) {
    setSelectedCharacterIds((currentCharacterIds) =>
      currentCharacterIds.includes(characterId)
        ? currentCharacterIds.filter((currentCharacterId) => currentCharacterId !== characterId)
        : [...currentCharacterIds, characterId],
    );
  }

  function handleSelectAll() {
    setSelectedCharacterIds(selectableCharacters.map((character) => String(character._id)));
  }

  function handleClearSelection() {
    setSelectedCharacterIds([]);
  }

  async function handleCopyExport() {
    if (!exportText) {
      return;
    }

    if (includeDiscordId && missingDiscordCharacters.length > 0) {
      toast.error("Every selected booster needs a Discord ID before copying.");
      return;
    }

    try {
      await navigator.clipboard.writeText(exportText);
      toast.success("Export copied to clipboard.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not copy export.");
    }
  }

  if (boosterCharacters === undefined) {
    return (
      <div className="w-full px-4 py-6 sm:px-6 lg:px-8">
        <div className="space-y-6">
          <div className="space-y-2">
            <Skeleton className="h-9 w-52" />
            <Skeleton className="h-4 w-80" />
          </div>
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
            <Card className="border-border/70 bg-card">
              <CardContent className="space-y-3 p-6">
                {Array.from({ length: 5 }).map((_, index) => (
                  <Skeleton key={index} className="h-24 rounded-xl" />
                ))}
              </CardContent>
            </Card>
            <Card className="border-border/70 bg-card">
              <CardContent className="space-y-4 p-6">
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-36 w-full" />
                <Skeleton className="h-10 w-32" />
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  if (boosterCharacters === null) {
    return (
      <div className="w-full px-4 py-6 sm:px-6 lg:px-8">
        <Card className="border-dashed">
          <CardContent className="py-12 text-center">
            <p className="text-sm text-muted-foreground">You need to be signed in to use this page.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="w-full px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-bold">
            <Copy className="h-7 w-7 text-zinc-300" />
            Copy Helper
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Select booster characters and generate a ready-to-paste group string.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>{boosterCharacters.length} booster chars</span>
          <span>{selectedCharacters.length} selected</span>
          <span>{missingDiscordCharacters.length} missing Discord IDs</span>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
        <Card className="border-border/70 bg-card">
          <CardHeader className="border-b border-border/70 pb-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  Booster Selection
                </CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  Characters are listed here once they are marked as a booster on their detail page.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <label className="flex items-center gap-2 rounded-md border border-border/60 px-2.5 py-1.5 text-xs text-muted-foreground">
                  <Checkbox checked={includeKey} onCheckedChange={(value) => setIncludeKey(!!value)} />
                  <span>Key</span>
                </label>
                <label className="flex items-center gap-2 rounded-md border border-border/60 px-2.5 py-1.5 text-xs text-muted-foreground">
                  <Checkbox
                    checked={includeTradeLocks}
                    onCheckedChange={(value) => setIncludeTradeLocks(!!value)}
                  />
                  <span>Trade Lock</span>
                </label>
                <label className="flex items-center gap-2 rounded-md border border-border/60 px-2.5 py-1.5 text-xs text-muted-foreground">
                  <Checkbox
                    checked={includeDiscordId}
                    onCheckedChange={(value) => setIncludeDiscordId(!!value)}
                  />
                  <span>Discord ID</span>
                </label>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={handleSelectAll}
                  disabled={selectableCharacters.length === 0}
                >
                  Select All
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={handleClearSelection}
                  disabled={selectedCharacters.length === 0}
                >
                  Clear
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 p-6">
            {boosterCharacters.length === 0 ? (
              <Card className="border-dashed bg-background/70">
                <CardContent className="py-10 text-center">
                  <p className="text-sm text-muted-foreground">No booster characters yet.</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Open a character page and use the booster toggle next to the pin button.
                  </p>
                </CardContent>
              </Card>
            ) : (
              boosterCharacters.map((character) => {
                const characterId = String(character._id);
                const isSelected = selectedCharacterIdSet.has(characterId);
                const isSelectable = character.snapshot !== null;

                return (
                  <div
                    key={characterId}
                    role="button"
                    tabIndex={isSelectable ? 0 : -1}
                    onClick={() => {
                      if (isSelectable) {
                        toggleCharacterSelection(characterId);
                      }
                    }}
                    onKeyDown={(event) => {
                      if (!isSelectable) {
                        return;
                      }

                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        toggleCharacterSelection(characterId);
                      }
                    }}
                    className={`w-full rounded-xl border p-4 text-left transition-colors ${
                      isSelected
                        ? "border-emerald-400/50 bg-emerald-500/10"
                        : "border-border/70 bg-background/60 hover:bg-background"
                    } ${!isSelectable ? "cursor-not-allowed opacity-60" : ""}`}
                    aria-pressed={isSelected}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs ${
                          isSelected
                            ? "border-emerald-400/60 bg-emerald-500/20 text-emerald-200"
                            : "border-border/70 bg-background text-muted-foreground"
                        }`}
                      >
                        {isSelected ? <Check className="h-3.5 w-3.5" /> : null}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`font-semibold ${getClassTextColor(character.class)}`}>
                            {character.name}
                          </span>
                          <Badge variant="outline" className="border-border/60 bg-background/80">
                            {character.class}
                          </Badge>
                          {character.snapshot && (
                            <Badge variant="outline" className="border-border/60 bg-background/80">
                              {getExportRoleLabel(character.snapshot.role)}
                            </Badge>
                          )}
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {character.realm}-{character.region.toUpperCase()}
                          {character.ownerBattleTag ? ` · ${character.ownerBattleTag}` : ""}
                        </p>
                        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                          {character.snapshot ? (
                            <>
                              <Badge variant="outline" className="border-border/60 bg-background/80">
                                Score {formatExportScore(character.snapshot.mythicPlusScore)}
                              </Badge>
                              <Badge variant="outline" className="border-border/60 bg-background/80">
                                iLvl {character.snapshot.itemLevel.toFixed(1)}
                              </Badge>
                              {includeKey && (
                                <Badge variant="outline" className="border-border/60 bg-background/80">
                                  {getEquippedKeystoneLabel(character.snapshot.ownedKeystone)}
                                </Badge>
                              )}
                            </>
                          ) : (
                            <Badge variant="outline" className="border-orange-500/40 bg-orange-500/10 text-orange-300">
                              Missing snapshot
                            </Badge>
                          )}
                          {includeDiscordId && (
                            <Badge
                              variant="outline"
                              className={
                                character.ownerDiscordUserId
                                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                                  : "border-orange-500/40 bg-orange-500/10 text-orange-300"
                              }
                            >
                              {character.ownerDiscordUserId ? "Discord linked" : "No Discord ID"}
                            </Badge>
                          )}
                          {includeTradeLocks && (
                            <Sheet>
                              <SheetTrigger asChild>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="h-7 border-border/60 bg-background/80 px-2 text-xs"
                                  onClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                  }}
                                >
                                  Trade Locks {character.nonTradeableSlots.length}
                                </Button>
                              </SheetTrigger>
                              <SheetContent className="w-full sm:max-w-md">
                                <SheetHeader>
                                  <SheetTitle>{character.name} Trade Locks</SheetTitle>
                                  <SheetDescription>
                                    Slots marked here are treated as not tradeable for this character.
                                  </SheetDescription>
                                </SheetHeader>
                                <div className="mt-6 space-y-3">
                                  {character.nonTradeableSlots.length === 0 ? (
                                    <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200">
                                      No locked slots. This character is marked as able to trade all tracked slots.
                                    </div>
                                  ) : (
                                    <div className="grid gap-2 sm:grid-cols-2">
                                      {character.nonTradeableSlots.map((slotKey) => (
                                        <div
                                          key={slotKey}
                                          className="rounded-lg border border-border/60 bg-card/50 px-3 py-2 text-sm text-foreground"
                                        >
                                          {TRADE_SLOT_LABELS[slotKey]}
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </SheetContent>
                            </Sheet>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        <Card className="border-border/70 bg-card">
          <CardHeader className="border-b border-border/70 pb-4">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Zap className="h-4 w-4 text-muted-foreground" />
              Export Preview
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Uses the format Role Class M+ Score Discord ID.
            </p>
          </CardHeader>
          <CardContent className="space-y-4 p-6">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground" htmlFor="copy-helper-headline">
                Label
              </label>
              <Input
                id="copy-helper-headline"
                value={customHeadline}
                onChange={(event) => setCustomHeadline(event.target.value)}
                placeholder={getDefaultExportHeadline(selectedCharacters.length)}
              />
              <p className="text-xs text-muted-foreground">
                Leave empty to auto-generate.
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-foreground">Output</span>
                <span className="text-xs text-muted-foreground">
                  {selectedCharacters.length} line{selectedCharacters.length === 1 ? "" : "s"}
                </span>
              </div>
              <textarea
                value={exportText}
                readOnly
                className="min-h-64 w-full rounded-xl border border-border/70 bg-background/70 p-3 font-mono text-sm leading-6 text-foreground outline-none"
                placeholder="Select booster characters to generate an export string."
              />
            </div>

            {includeDiscordId && missingDiscordCharacters.length > 0 && (
              <div className="rounded-xl border border-orange-500/40 bg-orange-500/10 p-3 text-sm text-orange-200">
                {missingDiscordCharacters.length} selected character
                {missingDiscordCharacters.length === 1 ? "" : "s"} still need an owner Discord ID.
              </div>
            )}

            <Button
              type="button"
              onClick={handleCopyExport}
              disabled={!exportText || (includeDiscordId && missingDiscordCharacters.length > 0)}
              className="w-full gap-2"
            >
              <Copy className="h-4 w-4" />
              Copy Export
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

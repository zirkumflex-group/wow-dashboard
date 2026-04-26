const TRADE_SLOT_OPTIONS = [
  { key: "head", label: "Head" },
  { key: "shoulders", label: "Shoulders" },
  { key: "chest", label: "Chest" },
  { key: "wrist", label: "Wrist" },
  { key: "hands", label: "Hands" },
  { key: "waist", label: "Waist" },
  { key: "legs", label: "Legs" },
  { key: "feet", label: "Feet" },
  { key: "neck", label: "Neck" },
  { key: "back", label: "Back" },
  { key: "finger1", label: "Finger 1" },
  { key: "finger2", label: "Finger 2" },
  { key: "trinket1", label: "Trinket 1" },
  { key: "trinket2", label: "Trinket 2" },
  { key: "mainHand", label: "Main Hand" },
  { key: "offHand", label: "Off Hand" },
] as const;

export type TradeSlotKey = (typeof TRADE_SLOT_OPTIONS)[number]["key"];

export const TRADE_SLOT_EDITOR_OPTIONS = [
  { key: "head", label: "Head", slotKeys: ["head"] },
  { key: "shoulders", label: "Shoulders", slotKeys: ["shoulders"] },
  { key: "chest", label: "Chest", slotKeys: ["chest"] },
  { key: "wrist", label: "Wrist", slotKeys: ["wrist"] },
  { key: "hands", label: "Hands", slotKeys: ["hands"] },
  { key: "waist", label: "Waist", slotKeys: ["waist"] },
  { key: "legs", label: "Legs", slotKeys: ["legs"] },
  { key: "feet", label: "Feet", slotKeys: ["feet"] },
  { key: "neck", label: "Neck", slotKeys: ["neck"] },
  { key: "back", label: "Back", slotKeys: ["back"] },
  { key: "finger", label: "Finger", slotKeys: ["finger1", "finger2"] },
  { key: "trinket", label: "Trinket", slotKeys: ["trinket1", "trinket2"] },
  { key: "mainHand", label: "Main Hand", slotKeys: ["mainHand"] },
  { key: "offHand", label: "Off Hand", slotKeys: ["offHand"] },
] as const satisfies ReadonlyArray<{
  key: string;
  label: string;
  slotKeys: readonly TradeSlotKey[];
}>;

const TRADE_SLOT_EXPORT_LABELS: Record<TradeSlotKey, string> = {
  head: "Head",
  shoulders: "Shoulder",
  chest: "Chest",
  wrist: "Wrist",
  hands: "Hands",
  waist: "Waist",
  legs: "Legs",
  feet: "Feet",
  neck: "Neck",
  back: "Back",
  finger1: "Finger",
  finger2: "Finger",
  trinket1: "Trinket",
  trinket2: "Trinket",
  mainHand: "Main-Hand",
  offHand: "Off-Hand",
};

export function getTradeSlotExportLabels(slotKeys: TradeSlotKey[]) {
  const uniqueLabels = new Set(slotKeys.map((slotKey) => TRADE_SLOT_EXPORT_LABELS[slotKey]));

  return TRADE_SLOT_OPTIONS.flatMap((slot) => {
    const exportLabel = TRADE_SLOT_EXPORT_LABELS[slot.key];
    if (!uniqueLabels.has(exportLabel)) {
      return [];
    }

    uniqueLabels.delete(exportLabel);
    return [exportLabel];
  });
}

export function normalizeTradeSlotKeys(slotKeys: readonly TradeSlotKey[]) {
  const uniqueSlotKeys = new Set(slotKeys);
  const hasFingerSlot = uniqueSlotKeys.has("finger1") || uniqueSlotKeys.has("finger2");
  const hasTrinketSlot = uniqueSlotKeys.has("trinket1") || uniqueSlotKeys.has("trinket2");

  if (hasFingerSlot) {
    uniqueSlotKeys.add("finger1");
    uniqueSlotKeys.add("finger2");
  }

  if (hasTrinketSlot) {
    uniqueSlotKeys.add("trinket1");
    uniqueSlotKeys.add("trinket2");
  }

  return TRADE_SLOT_OPTIONS.flatMap((slot) => (uniqueSlotKeys.has(slot.key) ? [slot.key] : []));
}

export function toggleTradeSlotGroup(
  currentSlotKeys: readonly TradeSlotKey[],
  targetSlotKeys: readonly TradeSlotKey[],
) {
  const nextSlotKeys = new Set(normalizeTradeSlotKeys(currentSlotKeys));
  const hasAllTargetSlots = targetSlotKeys.every((slotKey) => nextSlotKeys.has(slotKey));

  for (const slotKey of targetSlotKeys) {
    if (hasAllTargetSlots) {
      nextSlotKeys.delete(slotKey);
    } else {
      nextSlotKeys.add(slotKey);
    }
  }

  return normalizeTradeSlotKeys(Array.from(nextSlotKeys));
}

export function getTradeSlotEditorCount(slotKeys: readonly TradeSlotKey[]) {
  const normalizedSlotKeys = new Set(normalizeTradeSlotKeys(slotKeys));

  return TRADE_SLOT_EDITOR_OPTIONS.filter((slot) =>
    slot.slotKeys.every((slotKey) => normalizedSlotKeys.has(slotKey)),
  ).length;
}

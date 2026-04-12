export const TRADE_SLOT_OPTIONS = [
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

export const TRADE_SLOT_LABELS: Record<TradeSlotKey, string> = Object.fromEntries(
  TRADE_SLOT_OPTIONS.map((slot) => [slot.key, slot.label]),
) as Record<TradeSlotKey, string>;

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

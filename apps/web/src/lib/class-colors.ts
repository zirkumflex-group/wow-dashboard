const CLASS_TOKEN_TO_KEY: Record<string, string> = {
  WARRIOR: "warrior",
  PALADIN: "paladin",
  HUNTER: "hunter",
  ROGUE: "rogue",
  PRIEST: "priest",
  DEATHKNIGHT: "death knight",
  SHAMAN: "shaman",
  MAGE: "mage",
  WARLOCK: "warlock",
  MONK: "monk",
  DRUID: "druid",
  DEMONHUNTER: "demon hunter",
  EVOKER: "evoker",
};

const CLASS_TEXT_COLORS: Record<string, string> = {
  warrior: "text-[#C69B6D]",
  paladin: "text-[#F48CBA]",
  hunter: "text-[#AAD372]",
  rogue: "text-[#FFF468]",
  priest: "text-[#FFFFFF]",
  "death knight": "text-[#C41E3A]",
  shaman: "text-[#0070DD]",
  mage: "text-[#3FC7EB]",
  warlock: "text-[#8788EE]",
  monk: "text-[#00FF98]",
  druid: "text-[#FF7C0A]",
  "demon hunter": "text-[#A330C9]",
  evoker: "text-[#33937F]",
};

const CLASS_BG_COLORS: Record<string, string> = {
  warrior: "bg-[#C69B6D]/10 border-[#C69B6D]/20",
  paladin: "bg-[#F48CBA]/10 border-[#F48CBA]/20",
  hunter: "bg-[#AAD372]/10 border-[#AAD372]/20",
  rogue: "bg-[#FFF468]/10 border-[#FFF468]/20",
  priest: "bg-[#FFFFFF]/10 border-[#FFFFFF]/20",
  "death knight": "bg-[#C41E3A]/10 border-[#C41E3A]/20",
  shaman: "bg-[#0070DD]/10 border-[#0070DD]/20",
  mage: "bg-[#3FC7EB]/10 border-[#3FC7EB]/20",
  warlock: "bg-[#8788EE]/10 border-[#8788EE]/20",
  monk: "bg-[#00FF98]/10 border-[#00FF98]/20",
  druid: "bg-[#FF7C0A]/10 border-[#FF7C0A]/20",
  "demon hunter": "bg-[#A330C9]/10 border-[#A330C9]/20",
  evoker: "bg-[#33937F]/10 border-[#33937F]/20",
};

function getClassColorKey(cls: string) {
  const trimmed = cls.trim();
  if (trimmed === "") {
    return null;
  }

  const normalizedToken = trimmed.toUpperCase().replace(/[\s_-]/g, "");
  return CLASS_TOKEN_TO_KEY[normalizedToken] ?? trimmed.toLowerCase();
}

export function getClassTextColor(cls: string) {
  const key = getClassColorKey(cls);
  return key ? CLASS_TEXT_COLORS[key] ?? "text-foreground" : "text-foreground";
}

export function getClassBgColor(cls: string) {
  const key = getClassColorKey(cls);
  return key ? CLASS_BG_COLORS[key] ?? "bg-card border-border" : "bg-card border-border";
}

import type { BuddySpecies, BuddyRarity, BuddyHat } from "../../types";

export const SPECIES_MAP: Record<
  BuddySpecies,
  { emoji: string; color: string; description: string }
> = {
  duck: { emoji: "🦆", color: "#FFD700", description: "一只金色小鸭" },
  goose: { emoji: "🦢", color: "#FFFFFF", description: "优雅的白鹅" },
  blob: { emoji: "🫧", color: "#87CEEB", description: "软糯的小团子" },
  cat: { emoji: "🐱", color: "#FFA500", description: "好奇的小猫" },
  dragon: { emoji: "🐉", color: "#FF4500", description: "威严的小龙" },
  octopus: { emoji: "🐙", color: "#FF69B4", description: "多爪小章鱼" },
  owl: { emoji: "🦉", color: "#8B4513", description: "睿智的猫头鹰" },
  penguin: { emoji: "🐧", color: "#2F4F4F", description: "憨态可掬的企鹅" },
  turtle: { emoji: "🐢", color: "#228B22", description: "沉稳的小龟" },
  snail: { emoji: "🐌", color: "#DDA0DD", description: "慢悠悠的蜗牛" },
  ghost: { emoji: "👻", color: "#E6E6FA", description: "调皮的幽灵" },
  axolotl: { emoji: "🦎", color: "#FFB6C1", description: "微笑的六角恐龙" },
  capybara: { emoji: "🦫", color: "#DEB887", description: "佛系水豚" },
  cactus: { emoji: "🌵", color: "#32CD32", description: "扎人但可爱" },
  robot: { emoji: "🤖", color: "#C0C0C0", description: "机械小助手" },
  rabbit: { emoji: "🐰", color: "#FFE4E1", description: "蹦跳的小兔" },
  mushroom: { emoji: "🍄", color: "#FF6347", description: "森林小蘑菇" },
  chonk: { emoji: "🐹", color: "#D2691E", description: "圆滚滚的胖胖" },
};

export const HAT_MAP: Record<BuddyHat, string> = {
  none: "",
  crown: "👑",
  tophat: "🎩",
  propeller: "🌀",
  halo: "😇",
  wizard: "🧙",
  beanie: "🧢",
  tinyduck: "🦆",
};

export const RARITY_COLORS: Record<BuddyRarity, string> = {
  common: "#9E9E9E",
  uncommon: "#4CAF50",
  rare: "#2196F3",
  epic: "#9C27B0",
  legendary: "#FF9800",
};

export const RARITY_LABELS: Record<BuddyRarity, string> = {
  common: "普通",
  uncommon: "不凡",
  rare: "稀有",
  epic: "史诗",
  legendary: "传说",
};

export const STAT_LABELS: Record<string, { icon: string; label: string }> = {
  DEBUGGING: { icon: "🐛", label: "调试" },
  PATIENCE: { icon: "🧘", label: "耐心" },
  CHAOS: { icon: "🌀", label: "混沌" },
  WISDOM: { icon: "🦉", label: "智慧" },
  SNARK: { icon: "💬", label: "毒舌" },
};

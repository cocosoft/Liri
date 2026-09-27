import i18n from "@/i18n";
import type { BuddySpecies, BuddyRarity, BuddyHat } from "../../types";

export const SPECIES_MAP: Record<
  BuddySpecies,
  { emoji: string; color: string; description: string }
> = {
  duck: {
    emoji: "🦆",
    color: "#FFD700",
    description: i18n.t("buddy.speciesDescDuck"),
  },
  goose: {
    emoji: "🦢",
    color: "#FFFFFF",
    description: i18n.t("buddy.speciesDescGoose"),
  },
  blob: {
    emoji: "🫧",
    color: "#87CEEB",
    description: i18n.t("buddy.speciesDescBlob"),
  },
  cat: {
    emoji: "🐱",
    color: "#FFA500",
    description: i18n.t("buddy.speciesDescCat"),
  },
  dragon: {
    emoji: "🐉",
    color: "#FF4500",
    description: i18n.t("buddy.speciesDescDragon"),
  },
  octopus: {
    emoji: "🐙",
    color: "#FF69B4",
    description: i18n.t("buddy.speciesDescOctopus"),
  },
  owl: {
    emoji: "🦉",
    color: "#8B4513",
    description: i18n.t("buddy.speciesDescOwl"),
  },
  penguin: {
    emoji: "🐧",
    color: "#2F4F4F",
    description: i18n.t("buddy.speciesDescPenguin"),
  },
  turtle: {
    emoji: "🐢",
    color: "#228B22",
    description: i18n.t("buddy.speciesDescTurtle"),
  },
  snail: {
    emoji: "🐌",
    color: "#DDA0DD",
    description: i18n.t("buddy.speciesDescSnail"),
  },
  ghost: {
    emoji: "👻",
    color: "#E6E6FA",
    description: i18n.t("buddy.speciesDescGhost"),
  },
  axolotl: {
    emoji: "🦎",
    color: "#FFB6C1",
    description: i18n.t("buddy.speciesDescAxolotl"),
  },
  capybara: {
    emoji: "🦫",
    color: "#DEB887",
    description: i18n.t("buddy.speciesDescCapybara"),
  },
  cactus: {
    emoji: "🌵",
    color: "#32CD32",
    description: i18n.t("buddy.speciesDescCactus"),
  },
  robot: {
    emoji: "🤖",
    color: "#C0C0C0",
    description: i18n.t("buddy.speciesDescRobot"),
  },
  rabbit: {
    emoji: "🐰",
    color: "#FFE4E1",
    description: i18n.t("buddy.speciesDescRabbit"),
  },
  mushroom: {
    emoji: "🍄",
    color: "#FF6347",
    description: i18n.t("buddy.speciesDescMushroom"),
  },
  chonk: {
    emoji: "🐹",
    color: "#D2691E",
    description: i18n.t("buddy.speciesDescChonk"),
  },
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
  common: i18n.t("buddy.rarityCommon"),
  uncommon: i18n.t("buddy.rarityUncommon"),
  rare: i18n.t("buddy.rarityRare"),
  epic: i18n.t("buddy.rarityEpic"),
  legendary: i18n.t("buddy.rarityLegendary"),
};

export const STAT_LABELS: Record<string, { icon: string; label: string }> = {
  DEBUGGING: { icon: "🐛", label: i18n.t("buddy.statDebugging") },
  PATIENCE: { icon: "🧘", label: i18n.t("buddy.statPatience") },
  CHAOS: { icon: "🌀", label: i18n.t("buddy.statChaos") },
  WISDOM: { icon: "🦉", label: i18n.t("buddy.statWisdom") },
  SNARK: { icon: "💬", label: i18n.t("buddy.statSnark") },
};

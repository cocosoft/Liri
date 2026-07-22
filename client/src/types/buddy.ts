export type BuddySpecies =
  | "duck"
  | "goose"
  | "blob"
  | "cat"
  | "dragon"
  | "octopus"
  | "owl"
  | "penguin"
  | "turtle"
  | "snail"
  | "ghost"
  | "axolotl"
  | "capybara"
  | "cactus"
  | "robot"
  | "rabbit"
  | "mushroom"
  | "chonk";

export type BuddyRarity = "common" | "uncommon" | "rare" | "epic" | "legendary";

export type BuddyStat = "DEBUGGING" | "PATIENCE" | "CHAOS" | "WISDOM" | "SNARK";

export type BuddyEye = "·" | "✦" | "×" | "◉" | "@" | "°";

export type BuddyHat =
  | "none"
  | "crown"
  | "tophat"
  | "propeller"
  | "halo"
  | "wizard"
  | "beanie"
  | "tinyduck";

export interface BuddyCompanion {
  name: string;
  species: BuddySpecies;
  rarity: BuddyRarity;
  eye: BuddyEye;
  hat: BuddyHat;
  shiny: boolean;
  stats: Record<BuddyStat, number>;
  level: number;
  experience: number;
  experienceToNext: number;
  hatchedAt: number;
  personality: string;
}

export interface BuddyInteractionResult {
  companion: BuddyCompanion;
  message: string;
  statChanges: Partial<Record<BuddyStat, number>>;
}

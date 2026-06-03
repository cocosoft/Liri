import React, { useState, useEffect } from "react";
import {
  SPECIES_MAP,
  HAT_MAP,
  RARITY_COLORS,
  RARITY_LABELS,
} from "./buddySprites";
import type {
  BuddySpecies,
  BuddyRarity,
  BuddyEye,
  BuddyHat,
} from "../../types";

interface BuddyAvatarProps {
  species: BuddySpecies;
  rarity: BuddyRarity;
  eye: BuddyEye;
  hat: BuddyHat;
  shiny?: boolean;
  frame?: number;
  size?: "sm" | "md" | "lg";
  showName?: boolean;
  name?: string;
  onClick?: () => void;
}

const EYES = ["·", "✦", "×", "◉", "@", "°"] as const;

const sizeMap = {
  sm: {
    container: "w-12 h-12",
    emoji: "text-2xl",
    eye: "text-xs",
    hatOffset: "-top-1",
  },
  md: {
    container: "w-20 h-20",
    emoji: "text-5xl",
    eye: "text-sm",
    hatOffset: "-top-3",
  },
  lg: {
    container: "w-32 h-32",
    emoji: "text-7xl",
    eye: "text-base",
    hatOffset: "-top-4",
  },
};

function BuddyAvatar({
  species,
  rarity,
  eye,
  hat,
  shiny = false,
  frame = 0,
  size = "md",
  showName = false,
  name,
  onClick,
}: BuddyAvatarProps) {
  const [displayEye, setDisplayEye] = useState(eye);
  const sizes = sizeMap[size];
  const speciesInfo = SPECIES_MAP[species];
  const rarityColor = RARITY_COLORS[rarity];
  const hatEmoji = HAT_MAP[hat];
  const rarityLabel = RARITY_LABELS[rarity];

  useEffect(() => {
    if (frame === 0) return;
    const idx = frame % EYES.length;
    setDisplayEye(EYES[idx] as BuddyEye);
  }, [frame]);

  return (
    <div
      onClick={onClick}
      className={`relative inline-flex flex-col items-center justify-center cursor-pointer transition-transform hover:scale-110 ${sizes.container} ${onClick ? "cursor-pointer" : "cursor-default"}`}
      style={{ filter: shiny ? "brightness(1.2) saturate(1.3)" : undefined }}
      title={`${speciesInfo.description} (${rarityLabel})`}
    >
      {hatEmoji && (
        <span
          className={`absolute select-none z-10 ${sizes.hatOffset}`}
          style={{
            fontSize:
              size === "sm" ? "0.75rem" : size === "md" ? "1.25rem" : "1.75rem",
          }}
        >
          {hatEmoji}
        </span>
      )}
      <span className={`select-none leading-none ${sizes.emoji}`}>
        {speciesInfo.emoji}
      </span>
      <span
        className={`select-none mt-0.5 font-bold ${sizes.eye}`}
        style={{ color: rarityColor }}
      >
        {displayEye}
      </span>
      {showName && name && (
        <span className="text-xs text-gray-600 dark:text-gray-400 mt-1 truncate max-w-full">
          {name}
        </span>
      )}
    </div>
  );
}

export default React.memo(BuddyAvatar);

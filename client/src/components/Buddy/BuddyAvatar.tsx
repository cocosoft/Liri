import React, { useState, useEffect } from "react";
import { SPECIES_MAP, HAT_MAP, RARITY_LABELS } from "./buddySprites";
import BuddySVG from "./BuddySVG";
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
      className={`relative inline-flex flex-col items-center justify-center transition-transform hover:scale-110 ${sizes.container} ${onClick ? "cursor-pointer" : "cursor-default"}`}
      title={`${speciesInfo.description} (${rarityLabel})`}
    >
      {size === "md" || size === "lg" ? (
        <BuddySVG
          species={species}
          rarity={rarity}
          eye={displayEye}
          hat={hat}
          shiny={shiny}
          size={size === "md" ? 80 : 112}
        />
      ) : (
        <>
          {hatEmoji && (
            <span
              className={`absolute select-none z-10 ${sizes.hatOffset}`}
              style={{ fontSize: "0.75rem" }}
            >
              {hatEmoji}
            </span>
          )}
          <span className="select-none leading-none text-2xl">
            {speciesInfo.emoji}
          </span>
        </>
      )}
      {showName && name && (
        <span className="text-xs text-gray-600 dark:text-gray-400 mt-1 truncate max-w-full">
          {name}
        </span>
      )}
    </div>
  );
}

export default React.memo(BuddyAvatar);

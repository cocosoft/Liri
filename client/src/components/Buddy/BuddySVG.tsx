import React, { useMemo } from "react";
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

interface BuddySVGProps {
  species: BuddySpecies;
  rarity: BuddyRarity;
  eye: BuddyEye;
  hat: BuddyHat;
  shiny?: boolean;
  size?: number;
}

/** 稀有度对应的视觉效果 */
const RARITY_EFFECTS: Record<
  BuddyRarity,
  {
    glow: string;
    ring: string;
    border: string;
    bgGradient: [string, string];
  }
> = {
  common: {
    glow: "none",
    ring: "none",
    border: "#9E9E9E",
    bgGradient: ["#f3f4f6", "#e5e7eb"],
  },
  uncommon: {
    glow: "none",
    ring: "none",
    border: "#4CAF50",
    bgGradient: ["#e8f5e9", "#c8e6c9"],
  },
  rare: {
    glow: "url(#glow)",
    ring: "none",
    border: "#2196F3",
    bgGradient: ["#e3f2fd", "#bbdefb"],
  },
  epic: {
    glow: "url(#glow)",
    ring: "epic",
    border: "#9C27B0",
    bgGradient: ["#f3e5f5", "#e1bee7"],
  },
  legendary: {
    glow: "url(#glow)",
    ring: "legendary",
    border: "#FF9800",
    bgGradient: ["#fff3e0", "#ffe0b2"],
  },
};

function BuddySVG({
  species,
  rarity,
  eye,
  hat,
  shiny = false,
  size = 96,
}: BuddySVGProps) {
  const speciesInfo = SPECIES_MAP[species];
  const hatEmoji = HAT_MAP[hat];
  const effect = RARITY_EFFECTS[rarity];
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.42;
  const emojiSize = size * 0.48;
  const eyeSize = size * 0.14;

  // 闪光粒子位置
  const sparkles = useMemo(() => {
    if (!shiny) return [];
    return Array.from({ length: 6 }, (_, i) => ({
      x: cx + Math.cos((i * Math.PI) / 3) * r * 1.15,
      y: cy + Math.sin((i * Math.PI) / 3) * r * 1.15,
      delay: i * 0.3,
    }));
  }, [shiny, cx, cy, r]);

  return (
    <svg
      width={size + 20}
      height={size + 30}
      viewBox={`0 0 ${size + 20} ${size + 30}`}
      className="select-none"
    >
      <defs>
        <radialGradient id={`bg-grad-${species}`} cx="30%" cy="30%">
          <stop offset="0%" stopColor={effect.bgGradient[0]} />
          <stop offset="100%" stopColor={effect.bgGradient[1]} />
        </radialGradient>
        <filter id="glow">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* 史诗光环 */}
      {effect.ring === "epic" && (
        <circle
          cx={cx + 10}
          cy={cy + 5}
          r={r + 6}
          fill="none"
          stroke="#9C27B0"
          strokeWidth="2"
          strokeDasharray="6 3"
          opacity="0.5"
        />
      )}

      {/* 传说光环 */}
      {effect.ring === "legendary" && (
        <>
          <circle
            cx={cx + 10}
            cy={cy + 5}
            r={r + 4}
            fill="none"
            stroke="#FF9800"
            strokeWidth="2"
            opacity="0.6"
          />
          <circle
            cx={cx + 10}
            cy={cy + 5}
            r={r + 8}
            fill="none"
            stroke="#FF9800"
            strokeWidth="1"
            strokeDasharray="4 4"
            opacity="0.3"
          />
        </>
      )}

      {/* 主体圆形背景 */}
      <circle
        cx={cx + 10}
        cy={cy + 5}
        r={r}
        fill={`url(#bg-grad-${species})`}
        stroke={effect.border}
        strokeWidth={rarity === "legendary" ? 2.5 : rarity === "epic" ? 2 : 1.5}
        filter={effect.glow}
      />

      {/* 物种 Emoji */}
      <text
        x={cx + 10}
        y={cy + 5}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={emojiSize}
        className="pointer-events-none"
      >
        {speciesInfo.emoji}
      </text>

      {/* 帽子 */}
      {hatEmoji && (
        <text
          x={cx + 10}
          y={cy - r + 12}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={size * 0.22}
          className="pointer-events-none"
        >
          {hatEmoji}
        </text>
      )}

      {/* 眼睛 */}
      <text
        x={cx + 10}
        y={cy + r + 8}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={eyeSize}
        fill={RARITY_COLORS[rarity]}
        fontWeight="bold"
        className="pointer-events-none"
      >
        {eye}
      </text>

      {/* 稀有度标签 */}
      <text
        x={cx + 10}
        y={cy + r + 22}
        textAnchor="middle"
        fontSize={size * 0.1}
        fill={RARITY_COLORS[rarity]}
        className="pointer-events-none"
      >
        {RARITY_LABELS[rarity]}
      </text>

      {/* 闪光粒子 */}
      {sparkles.map((s, i) => (
        <circle
          key={i}
          cx={s.x + 10}
          cy={s.y + 5}
          r={2}
          fill="#FFD700"
          opacity="0.8"
        >
          <animate
            attributeName="opacity"
            values="0.8;0.2;0.8"
            dur="1.5s"
            begin={`${s.delay}s`}
            repeatCount="indefinite"
          />
        </circle>
      ))}
    </svg>
  );
}

export default React.memo(BuddySVG);

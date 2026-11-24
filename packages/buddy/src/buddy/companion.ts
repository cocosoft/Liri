declare const Bun: { hash: (s: string) => bigint };

import { getGlobalConfig } from '@openliri/infra/config';
import type { GlobalConfig } from '@openliri/infra/config';
import { loadGrowthState } from './growthPersistence';
import { resolveBuddyLevel } from './level';
import {
  type Companion,
  type CompanionBones,
  EYES,
  HATS,
  RARITIES,
  RARITY_WEIGHTS,
  RARITY_FLOOR,
  type Rarity,
  SPECIES,
  STAT_NAMES,
  type StatName,
} from './types.js';

// Mulberry32 — tiny seeded PRNG, good enough for picking ducks
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s: string): number {
  if (typeof Bun !== 'undefined') {
    return Number(BigInt(Bun.hash(s)) & 0xffffffffn);
  }
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)]!;
}

function rollRarity(rng: () => number): Rarity {
  const total = Object.values(RARITY_WEIGHTS).reduce((a, b) => a + b, 0);
  let roll = rng() * total;
  for (const rarity of RARITIES) {
    roll -= RARITY_WEIGHTS[rarity];
    if (roll < 0) return rarity;
  }
  return 'common';
}

// One peak stat, one dump stat, rest scattered. Rarity bumps the floor.
function rollStats(
  rng: () => number,
  rarity: Rarity
): Record<StatName, number> {
  const floor = RARITY_FLOOR[rarity];
  const peak = pick(rng, STAT_NAMES);
  let dump = pick(rng, STAT_NAMES);
  while (dump === peak) dump = pick(rng, STAT_NAMES);

  const stats = {} as Record<StatName, number>;
  for (const name of STAT_NAMES) {
    if (name === peak) {
      stats[name] = Math.min(100, floor + 50 + Math.floor(rng() * 30));
    } else if (name === dump) {
      stats[name] = Math.max(1, floor - 10 + Math.floor(rng() * 15));
    } else {
      stats[name] = floor + Math.floor(rng() * 40);
    }
  }
  return stats;
}

const SALT = 'friend-2026-401';

export type Roll = {
  bones: CompanionBones;
  inspirationSeed: number;
};

function rollFrom(rng: () => number): Roll {
  const rarity = rollRarity(rng);
  const bones: CompanionBones = {
    rarity,
    species: pick(rng, SPECIES),
    eye: pick(rng, EYES),
    hat: rarity === 'common' ? 'none' : pick(rng, HATS),
    shiny: rng() < 0.01,
    stats: rollStats(rng, rarity),
  };
  return { bones, inspirationSeed: Math.floor(rng() * 1e9) };
}

// Called from three hot paths (500ms sprite tick, per-keystroke PromptInput,
// per-turn observer) with the same userId → cache the deterministic result.
let rollCache: { key: string; value: Roll } | undefined;
export function roll(userId: string): Roll {
  const key = userId + SALT;
  if (rollCache?.key === key) return rollCache.value;
  const value = rollFrom(mulberry32(hashString(key)));
  rollCache = { key, value };
  return value;
}

export function rollWithSeed(seed: string): Roll {
  return rollFrom(mulberry32(hashString(seed)));
}

export function companionUserId(): string {
  const config = getGlobalConfig();
  // 2026-10-06（P2-8 ② 配置字段迁移收尾）：改读**嵌套形态** `internal.userID`
  // —— 旧扁平 `config.userID` 已随 `ConfigMigration.migrateToV2` 折入 `internal`
  // 并删声明；`oauthAccount.accountUuid` 优先级不变（常规安装取它）。
  return config.oauthAccount?.accountUuid ?? config.internal?.userID ?? 'anon';
}

/** config 中的伙伴条目（`GlobalConfig.companion`，旧形状只有 name/soul） */
export type StoredCompanionConfig = NonNullable<GlobalConfig['companion']>;

/**
 * 由 config 条目 + 骨骼组装 `Companion`（2026-11-25 形状收口）
 *
 * 历史 config 只有 `{ name, soul }`，而 `Companion` 需要 `personality` / `hatchedAt`；
 * 直接展开会让前端拿到 `undefined`。这里显式映射：
 * - `personality` = `personality ?? soul`（旧配置的个性设定就是个性）
 * - `hatchedAt` = `hatchedAt ?? 0`（缺省按未记录处理，不伪造时间）
 */
export function buildCompanionFromStored(
  stored: StoredCompanionConfig,
  bones: CompanionBones
): Companion {
  return {
    name: stored.name,
    personality: stored.personality || stored.soul || '',
    hatchedAt: stored.hatchedAt ?? 0,
    // bones last：旧格式 config 里残留的骨骼字段必须被覆盖
    ...bones,
  };
}

// Regenerate bones from userId, merge with stored soul. Bones never persist
// so species renames and SPECIES-array edits can't break stored companions,
// and editing config.companion can't fake a rarity.
export function getCompanion(): Companion | undefined {
  const stored = getGlobalConfig().companion;
  if (!stored) return undefined;
  const { bones } = roll(companionUserId());
  return buildCompanionFromStored(stored, bones);
}

/** 伙伴快照：骨骼/灵魂 + 由累计经验派生的等级视图（`/v1/buddy/*` 统一契约） */
export interface BuddyCompanionSnapshot extends Companion {
  level: number;
  experience: number;
  experienceToNext: number;
}

/**
 * 取伙伴快照（2026-11-25 契约收口 A）
 *
 * 等级/经验**不单独持久化**：真源 = `buddy-growth.json` 的累计经验，
 * 经 `resolveBuddyLevel()` 派生 ⇒ 前端直接展示，不再出现 undefined/NaN。
 * 未孵化 ⇒ `null`（与旧 `getCompanion()` 语义一致）。
 */
export async function getCompanionSnapshot(): Promise<BuddyCompanionSnapshot | null> {
  const companion = getCompanion();
  if (!companion) return null;
  const growth = await loadGrowthState();
  return { ...companion, ...resolveBuddyLevel(growth.experience) };
}

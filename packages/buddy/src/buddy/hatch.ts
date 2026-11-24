/**
 * 伙伴孵化（2026-11-25）
 *
 * 产品口径（用户拍板）：
 * - **触发**：首条用户消息自动孵化（`recordUserSession()` 内调用，与 UI 文案「对话即孵化」一致）；
 * - **命名**：按确定性骨骼（物种 + 最高属性）生成，不使用模型、可复现。
 *
 * 写入位置：`config.companion`（沿用既有配置形状；同时写 `soul` 与 `personality` 以兼容旧读取方）。
 */

import { configManager } from '@openliri/infra/config';
import { getLogger } from '@openliri/infra/monitoring';
import { handleError } from '@openliri/infra/error';
import {
  buildCompanionFromStored,
  companionUserId,
  getCompanion,
  roll,
} from './companion';
import type { Companion, CompanionBones, Species, StatName } from './types';

const logger = getLogger('buddy:hatch');

/** 物种 → 中文名（命名用；未登记物种回退物种 id） */
const SPECIES_NAMES: Record<Species, string> = {
  duck: '鸭鸭',
  goose: '鹅鹅',
  blob: '团子',
  cat: '猫猫',
  dragon: '小龙',
  octopus: '章鱼',
  owl: '猫头鹰',
  penguin: '企鹅',
  turtle: '乌龟',
  snail: '蜗牛',
  ghost: '幽灵',
  axolotl: '六角恐龙',
  capybara: '水豚',
  cactus: '仙人掌',
  robot: '机器人',
  rabbit: '兔兔',
  mushroom: '蘑菇',
  chonk: '胖胖',
};

/** 名字前缀池（确定性取一个，避免所有伙伴同名） */
const NAME_PREFIXES = ['小', '团', '豆', '元宝', '阿', '噗'] as const;

/** 属性 → 个性词（按最高两项拼接） */
const STAT_TRAITS: Record<StatName, string> = {
  DEBUGGING: '严谨',
  PATIENCE: '耐心',
  CHAOS: '跳脱',
  WISDOM: '睿智',
  SNARK: '毒舌',
};

/** 孵化档案（纯函数产物） */
export interface HatchProfile {
  name: string;
  personality: string;
}

/** 稳定哈希取模（与 userId 绑定，跨进程可复现） */
function stableIndex(seed: string, mod: number): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return hash % mod;
}

/**
 * 由确定性骨骼生成孵化档案（纯函数，便于测试）
 *
 * - 名字 = 前缀（按 `userId + species` 稳定选取）+ 物种中文名；
 * - 个性 = 最高两项属性的个性词拼接（如「跳脱又毒舌」）。
 */
export function buildHatchProfile(
  bones: CompanionBones,
  userId: string
): HatchProfile {
  const speciesName = SPECIES_NAMES[bones.species] ?? bones.species;
  const prefix =
    NAME_PREFIXES[stableIndex(`${userId}:${bones.species}`, NAME_PREFIXES.length)];
  const ranked = (Object.entries(bones.stats) as Array<[StatName, number]>).sort(
    (a, b) => b[1] - a[1]
  );
  const traits = ranked
    .slice(0, 2)
    .map(([stat]) => STAT_TRAITS[stat])
    .filter(Boolean);
  const personality = traits.length > 0 ? traits.join('又') : '好奇';

  return { name: `${prefix}${speciesName}`, personality };
}

/**
 * 确保伙伴已孵化（幂等）
 *
 * 已存在 ⇒ 原样返回；否则写入 `config.companion` 并返回新伙伴。
 * 配置写失败（只读配置等边界）只记录错误并返回 `undefined` —— 不阻塞对话链路。
 */
export function ensureCompanionHatched(): Companion | undefined {
  const existing = getCompanion();
  if (existing) return existing;

  const userId = companionUserId();
  const { bones } = roll(userId);
  const profile = buildHatchProfile(bones, userId);
  const stored = {
    name: profile.name,
    // 旧读取方用 soul；新读取方用 personality（两者同值，见 buildCompanionFromStored）
    soul: profile.personality,
    personality: profile.personality,
    hatchedAt: Date.now(),
  };

  try {
    configManager.saveGlobalConfig((current) => ({
      ...current,
      companion: stored,
    }));
  } catch (e) {
    void handleError(e, { module: 'buddy:hatch', action: 'saveCompanion' });
    logger.warn('伙伴孵化失败（配置不可写），本次不孵化', {
      error: e instanceof Error ? e.message : String(e),
    });
    return undefined;
  }

  logger.info('伙伴已孵化', {
    name: stored.name,
    species: bones.species,
    personality: stored.personality,
  });
  return buildCompanionFromStored(stored, bones);
}

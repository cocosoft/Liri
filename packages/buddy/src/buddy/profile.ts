/**
 * 伙伴资料维护（2026-11-25，用户需求）
 *
 * 允许用户自行选择/维护：**伙伴类型（物种）**、**名字**、**性格**。
 * 稀有度 / 眼睛 / 帽子 / 属性仍由 userId 确定性派生（不接受用户改，防伪造）。
 *
 * 数据落点仍是 `config.companion`（与孵化同一真源），写入后返回最新伙伴快照。
 */

import { configManager } from '@openliri/infra/config';
import { getLogger } from '@openliri/infra/monitoring';
import { getCompanionSnapshot } from './companion';
import type { BuddyCompanionSnapshot } from './companion';
import { isSpecies } from './companion';
import { broadcastBuddyEvent, BUDDY_UPDATED_EVENT } from './events';
import type { Species } from './types';

const logger = getLogger('buddy:profile');

/** 名字长度上限 */
const MAX_NAME_LENGTH = 24;
/** 性格长度上限 */
const MAX_PERSONALITY_LENGTH = 120;

/** 用户可维护的伙伴资料补丁（字段缺省 = 不修改） */
export interface CompanionProfilePatch {
  name?: string;
  personality?: string;
  species?: string;
}

/** 校验失败原因 */
export type CompanionProfileError =
  | 'INVALID_NAME'
  | 'INVALID_PERSONALITY'
  | 'INVALID_SPECIES'
  | 'NOT_HATCHED';

/** 归一化后的补丁（仅含合法字段） */
export interface NormalizedCompanionProfile {
  name?: string;
  personality?: string;
  species?: Species;
}

/**
 * 校验并归一化用户补丁（纯函数，便于测试）
 *
 * - `name`：trim 后 1–24 字符；
 * - `personality`：trim 后 ≤120 字符（允许空串 = 清空）；
 * - `species`：必须是已登记物种 id。
 */
export function normalizeCompanionProfilePatch(
  patch: CompanionProfilePatch
):
  | { ok: true; value: NormalizedCompanionProfile }
  | { ok: false; error: Exclude<CompanionProfileError, 'NOT_HATCHED'> } {
  const value: NormalizedCompanionProfile = {};

  if (patch.name !== undefined) {
    const name = String(patch.name).trim();
    if (name.length === 0 || name.length > MAX_NAME_LENGTH) {
      return { ok: false, error: 'INVALID_NAME' };
    }
    value.name = name;
  }

  if (patch.personality !== undefined) {
    const personality = String(patch.personality).trim();
    if (personality.length > MAX_PERSONALITY_LENGTH) {
      return { ok: false, error: 'INVALID_PERSONALITY' };
    }
    value.personality = personality;
  }

  if (patch.species !== undefined) {
    if (!isSpecies(patch.species)) {
      return { ok: false, error: 'INVALID_SPECIES' };
    }
    value.species = patch.species;
  }

  return { ok: true, value };
}

/**
 * 应用资料补丁（写入 `config.companion`）并返回最新快照
 *
 * 未孵化 ⇒ `NOT_HATCHED`（前端引导先对话孵化）。
 */
export async function updateCompanionProfile(
  patch: CompanionProfilePatch
): Promise<
  | { ok: true; companion: BuddyCompanionSnapshot }
  | { ok: false; error: CompanionProfileError }
> {
  const current = await getCompanionSnapshot();
  if (!current) return { ok: false, error: 'NOT_HATCHED' };

  const normalized = normalizeCompanionProfilePatch(patch);
  if (!normalized.ok) return normalized;

  const { name, personality, species } = normalized.value;
  configManager.saveGlobalConfig((config) => {
    const stored = config.companion;
    if (!stored) return config;
    return {
      ...config,
      companion: {
        ...stored,
        ...(name !== undefined ? { name } : {}),
        // soul 与 personality 同步写，避免旧读取方看到旧个性
        ...(personality !== undefined
          ? { personality, soul: personality }
          : {}),
        ...(species !== undefined ? { species } : {}),
      },
    };
  });

  const updated = await getCompanionSnapshot();
  logger.info('伙伴资料已更新', {
    name: updated?.name,
    species: updated?.species,
    hasPersonality: Boolean(updated?.personality),
  });
  // 未预期：刚写入却读不到（例如并发删除 config）
  if (!updated) return { ok: false, error: 'NOT_HATCHED' };
  // 实时通知其他前端：资料已更新（当前请求方也可直接用响应体）
  broadcastBuddyEvent(BUDDY_UPDATED_EVENT, {
    name: updated.name,
    species: updated.species,
    personality: updated.personality,
  });
  return { ok: true, companion: updated };
}

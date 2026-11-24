/**
 * 伙伴等级视图（2026-11-25，契约收口 A）
 *
 * 唯一真源 = `buddy-growth.json` 的累计经验（`GrowthState.experience`）；
 * `level / experience / experienceToNext` 均由累计经验**派生**，不单独持久化，
 * 避免"等级与经验两套数"。前后端只读同一派生结果（后端返回，前端直接展示）。
 */

/** 升到下一级的基础经验步长（第 L 级 → L+1 级需要 `L * XP_PER_LEVEL_STEP`） */
export const XP_PER_LEVEL_STEP = 100;

/** 伙伴等级视图（与 `client/src/types/buddy.ts#BuddyCompanion` 的三字段同义） */
export interface BuddyLevelView {
  /** 当前等级（从 1 起） */
  level: number;
  /** 当前等级内已积累的经验（展示为 `experience / experienceToNext XP`） */
  experience: number;
  /** 升到下一级所需的经验（当前等级区间总长） */
  experienceToNext: number;
}

/**
 * 由累计经验派生等级视图
 *
 * 曲线：第 L 级区间长度 = `L * 100`（L1: 0–100，L2: 100–300，L3: 300–600 …）。
 * 非法/负数经验按 0 处理（不抛错、不产生 NaN）。
 */
export function resolveBuddyLevel(totalExperience: number): BuddyLevelView {
  const total =
    Number.isFinite(totalExperience) && totalExperience > 0
      ? Math.floor(totalExperience)
      : 0;

  let level = 1;
  let consumed = 0;
  let step = XP_PER_LEVEL_STEP;
  while (total >= consumed + step) {
    consumed += step;
    level++;
    step = XP_PER_LEVEL_STEP * level;
  }

  return {
    level,
    experience: total - consumed,
    experienceToNext: step,
  };
}

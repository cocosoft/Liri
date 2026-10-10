/**
 * 圈复杂度棘轮**纯比较核心**（P2-6）—— 抽为纯函数以便**负向自证**（不在测试里跑 ESLint）。
 *
 * 语义：`≥ threshold` 的函数计数**只允许减少、不允许增加**（重尾离群棘轮）。
 */

export interface ComplexityBaseline {
  version: number;
  threshold: number;
  countAtThreshold: number;
  reference?: Record<string, number>;
  note?: string;
}

export interface ComplexityComparison {
  /** 实测 ≥ threshold 的函数数 */
  atThreshold: number;
  /** 实测 ≥40 的函数数（参考口径，与 state-complexity-audit 对齐） */
  above40: number;
  /** 违规（应为空才通过） */
  problems: string[];
  /** 已缩小（应下调基线以锁定成果）—— 不阻断 */
  shrink: string | null;
}

/** 比较实测复杂度值与基线（纯函数） */
export function compareComplexity(
  values: readonly number[],
  baseline: ComplexityBaseline
): ComplexityComparison {
  const problems: string[] = [];
  if (
    !Number.isFinite(baseline.threshold) ||
    !Number.isFinite(baseline.countAtThreshold)
  ) {
    problems.push('基线缺少 threshold / countAtThreshold（非法基线）');
    return { atThreshold: -1, above40: -1, problems, shrink: null };
  }

  const atThreshold = values.filter((v) => v >= baseline.threshold).length;
  const above40 = values.filter((v) => v >= 40).length;

  let shrink: string | null = null;
  if (atThreshold > baseline.countAtThreshold) {
    problems.push(
      `重尾离群**增加**：≥${baseline.threshold} 由 ${baseline.countAtThreshold} → ${atThreshold}（棘轮只允许减少）`
    );
  } else if (atThreshold < baseline.countAtThreshold) {
    shrink = `≥${baseline.threshold} 由 ${baseline.countAtThreshold} → ${atThreshold} ⇒ 请下调基线锁定成果`;
  }
  return { atThreshold, above40, problems, shrink };
}

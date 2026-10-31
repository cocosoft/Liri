/**
 * 覆盖率 · 关键模块专属门槛（纯逻辑，2026-11-01）
 *
 * 背景：CI 只有**全局**行覆盖率门槛（18%）。全局达标会掩盖"某关键模块 0 覆盖"——
 * 例如今天新增的工具结果三态契约 / 已读文件锚定 / 参数归一化，若没人测，
 * 18% 照样绿。本模块让「关键模块」各自带**专属下限**，未达标或**在 lcov 里查不到**都算失败
 * （查不到 = 未被任何测试导入 ⇒ 视为 0 覆盖，不接受"沉默通过"）。
 *
 * 口径：行覆盖率 = 命中 DA 行数 ÷ 该文件 DA 行数；matcher 支持
 *   ① 精确仓库相对路径（`app/src/x.ts`）；
 *   ② 目录前缀（以 `/` 结尾，如 `app/src/query/`）；
 *   lcov 的 `SF:` 可能是绝对路径或相对路径 ⇒ 统一反斜杠转正斜杠后按「等于」或「以 /path 结尾」匹配。
 */

/** 单个文件在 lcov 中的行覆盖 */
export interface LcovFileCoverage {
  /** 归一化后的文件路径（正斜杠） */
  file: string;
  totalLines: number;
  coveredLines: number;
}

/** 关键模块规则 */
export interface CriticalModuleRule {
  /** 仓库相对路径，或目录前缀（以 `/` 结尾） */
  path: string;
  /** 行覆盖率下限（百分比，0–100） */
  minLineCoverage: number;
  /** 为什么必须覆盖（可读性；缺失不阻断） */
  why?: string;
}

/** 配置文件结构 */
export interface CriticalCoverageConfig {
  modules: CriticalModuleRule[];
}

/** 单条规则的评估结果 */
export interface CriticalEvaluation {
  rule: CriticalModuleRule;
  /** 命中该规则的文件数（目录前缀时可能 >1） */
  matchedFiles: number;
  totalLines: number;
  coveredLines: number;
  /** 行覆盖率（0–100，保留 2 位）；无匹配文件时为 0 */
  percent: number;
  pass: boolean;
  /** 未通过原因（通过时为空） */
  reason?: string;
}

/** 路径归一化：反斜杠 → 正斜杠，去掉 `./` 前缀 */
export function normalizeCoveragePath(file: string): string {
  return file.replace(/\\/g, '/').replace(/^\.\//, '');
}

/** 解析 lcov 内容为「按文件」的行覆盖（忽略无 DA 行的文件） */
export function parseLcovByFile(content: string): LcovFileCoverage[] {
  const out: LcovFileCoverage[] = [];
  let current: LcovFileCoverage | null = null;

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (line.startsWith('SF:')) {
      current = {
        file: normalizeCoveragePath(line.slice(3)),
        totalLines: 0,
        coveredLines: 0,
      };
      continue;
    }
    if (line.startsWith('DA:') && current) {
      const hitCount = Number(line.slice(3).split(',')[1] ?? '0');
      current.totalLines += 1;
      if (Number.isFinite(hitCount) && hitCount > 0) current.coveredLines += 1;
      continue;
    }
    if (line === 'end_of_record' && current) {
      if (current.totalLines > 0) out.push(current);
      current = null;
    }
  }
  // 容错：lcov 末尾缺 end_of_record
  if (current && current.totalLines > 0) out.push(current);
  return out;
}

/** 该 lcov 文件是否命中规则（精确路径或以 `/路径` 结尾；目录前缀按包含匹配） */
function matches(rule: CriticalModuleRule, file: string): boolean {
  const target = normalizeCoveragePath(rule.path);
  if (target.endsWith('/')) return file.includes(target);
  return file === target || file.endsWith(`/${target}`);
}

/** 逐条规则评估（纯函数，便于单测） */
export function evaluateCriticalModules(
  files: readonly LcovFileCoverage[],
  config: CriticalCoverageConfig
): CriticalEvaluation[] {
  return config.modules.map((rule) => {
    const hits = files.filter((f) => matches(rule, f.file));
    const totalLines = hits.reduce((sum, f) => sum + f.totalLines, 0);
    const coveredLines = hits.reduce((sum, f) => sum + f.coveredLines, 0);
    const percent =
      totalLines === 0
        ? 0
        : Math.round((coveredLines / totalLines) * 10000) / 100;

    if (hits.length === 0) {
      return {
        rule,
        matchedFiles: 0,
        totalLines: 0,
        coveredLines: 0,
        percent: 0,
        pass: false,
        reason: '未出现在 lcov（未被任何测试导入 ⇒ 视为 0 覆盖）',
      };
    }
    const pass = percent >= rule.minLineCoverage;
    return {
      rule,
      matchedFiles: hits.length,
      totalLines,
      coveredLines,
      percent,
      pass,
      ...(pass
        ? {}
        : {
            reason: `行覆盖率 ${percent}% < 下限 ${rule.minLineCoverage}%`,
          }),
    };
  });
}

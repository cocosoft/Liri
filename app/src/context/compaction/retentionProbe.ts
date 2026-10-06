// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * retentionProbe — 压缩后「关键实体保留度」**确定性**探针（M5，2026-10-06）
 *
 * 背景（回仓取证）：压缩只度量**体积**（`CompactionHistoryEntry` 仅
 * `beforeTokens/afterTokens/savingPercent`）⇒ "省了 80% token 但把关键实体
 * （文件路径/工具名/参数/结论）全丢了"**系统无从感知**（体积指标只会显示"压缩成功"）。
 *
 * 本模块用**确定性正则**抽取"高价值、可辨识"实体，度量其在压缩产物中的保留比例：
 * 无 LLM、无依赖、无 IO ⇒ 纯函数、可单测、低开销（不改变压缩行为）。
 *
 * 口径（M5 裁定）：
 * - **折叠区口径（仅 Tier 3）**：`source` = 被折叠批原文、`target` = 该批摘要文本
 *   （Tier 1/2 按设计有损、不产出摘要 ⇒ 不适用）；
 * - 阈值 `0.4` + **仅告警**（不改压缩行为，fail-open）。
 *
 * spec：`.trae/specs/compaction-retention-probe.md`（裁定 D1=折叠区口径 / D2=0.4 / D3=仅告警）。
 */

/**
 * 实体抽取模式（确定性正则，按"高价值、可辨识"选取）。
 * ⚠️ 全局正则：消费处一律用 `String.prototype.matchAll`（**只读 `lastIndex`、不复用 exec/test**，
 * 避免 `/g` + `test()` 的 `lastIndex` 残留误判 —— 该项目既有教训）。
 */
const ENTITY_PATTERNS: readonly RegExp[] = [
  /https?:\/\/[^\s)\]}"'`,;，。；：、）】]+/g, // URL（排 ASCII/CJK 收尾标点）
  /\b[A-Za-z_][\w-]*(?:\.[A-Za-z_][\w-]*)+\b/g, // 点分（文件/包/标识符）
  /\b[\w.-]+\/[\w./-]+\b/g, // 含斜杠的路径
  /\b[A-Z][A-Z0-9_]{3,}\b/g, // 常量 / 环境变量
  /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g, // snake_case
  /\b[a-z]+(?:[A-Z][a-z0-9]+)+\b/g, // camelCase
  // 带单位/百分号的数值：末位后不许接字母数字（`\b` 在 `%` 等非词字符后**不成立**，故用前瞻）
  /\b\d+(?:\.\d+)?(?:%|ms|s|KB|MB|GB|k|M)(?![a-zA-Z0-9])/g,
];

/** 尾部标点（ASCII + CJK —— 中文语境下句读常为全角，须一并剥离） */
const TRAILING_PUNCTUATION = /[.,;:，。；：、]+$/;

/**
 * 最短实体长度（过滤 `a.b` 之类似是而非的噪音）。
 * **含数字的 token 例外**：短数值（`87%` / `5s`）本身就是高信号实体（spec §3 明列 `87%`）。
 */
const MIN_ENTITY_LENGTH = 4;
const HAS_DIGIT = /\d/;

/** `missing` 上报上限（防日志爆量） */
export const MAX_MISSING_REPORTED = 20;

/** 低保留度告警阈值（M5 裁定 D2：0.4 = 丢失 >60% 才告警） */
export const DEFAULT_RETENTION_WARN_RATIO = 0.4;

export interface RetentionResult {
  /** 原文抽取出的实体总数（去重后） */
  total: number;
  /** 产物中仍出现的实体数 */
  retained: number;
  /** `retained / total`；`total === 0` ⇒ `1`（视为无损，不制造假告警） */
  ratio: number;
  /** 丢失实体（上限 `MAX_MISSING_REPORTED`） */
  missing: string[];
}

/**
 * 抽取"高价值、可确定性辨识"的关键实体（去重）。
 * 空/非字符串 ⇒ 空集（不抛错）。
 */
export function extractKeyEntities(text: string): Set<string> {
  const out = new Set<string>();
  if (!text) return out;
  for (const re of ENTITY_PATTERNS) {
    for (const match of text.matchAll(re)) {
      // 剥离**尾部标点**（正则的 `[^\s]` 类会把句尾 `,`/`。`/`；` 等吞进 token）
      const token = match[0].trim().replace(TRAILING_PUNCTUATION, '');
      if (token.length >= MIN_ENTITY_LENGTH || HAS_DIGIT.test(token))
        out.add(token);
    }
  }
  return out;
}

/**
 * 度量 `source` 的关键实体在 `target` 中的保留情况（纯函数）。
 *
 * @param source 被替换的原文（折叠区口径 = 被折叠批原文）
 * @param target 替换产物（折叠区口径 = 该批摘要文本）
 */
export function measureRetention(
  source: string,
  target: string
): RetentionResult {
  const srcEntities = extractKeyEntities(source);
  if (srcEntities.size === 0) {
    return { total: 0, retained: 0, ratio: 1, missing: [] };
  }
  const tgtEntities = extractKeyEntities(target);
  const missing: string[] = [];
  let retained = 0;
  for (const entity of srcEntities) {
    if (tgtEntities.has(entity)) {
      retained++;
    } else if (missing.length < MAX_MISSING_REPORTED) {
      missing.push(entity);
    }
  }
  return {
    total: srcEntities.size,
    retained,
    ratio: retained / srcEntities.size,
    missing,
  };
}

/**
 * 跨批聚合（Tier 3 迭代折叠会产生多批）—— 按**实体总量加权**，而非各批 `ratio` 的算术平均
 * （后者会让"小批全丢"被"大批全留"稀释）。`total === 0` 的批次不计入（视为不适用）。
 */
export function mergeRetention(
  results: readonly RetentionResult[]
): RetentionResult {
  const applicable = results.filter((r) => r.total > 0);
  if (applicable.length === 0) {
    return { total: 0, retained: 0, ratio: 1, missing: [] };
  }
  let total = 0;
  let retained = 0;
  const missing: string[] = [];
  for (const r of applicable) {
    total += r.total;
    retained += r.retained;
    for (const item of r.missing) {
      if (missing.length < MAX_MISSING_REPORTED) missing.push(item);
    }
  }
  return { total, retained, ratio: retained / total, missing };
}

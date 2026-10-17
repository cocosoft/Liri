// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * Planner 输出解析（纯函数，2026-10-17 U-01）。
 *
 * 背景：原实现 `JSON.parse` 失败后按行切分并取前 10 行（`LongRunningTaskOrchestrator`
 * 2026-10 之前的行为），会把解释性文本当成步骤 ⇒ 计划失真且不可观测。
 *
 * 口径：
 * - 只接受**结构化 JSON**；允许首尾 ```json 围栏与前后噪声；
 * - 解析失败返回 `{ ok:false, reason }`，由调用方决定“修复重问/整体失败”，
 *   **不在此处做行切兜底**（CS05 根因优先）。
 */

export interface PlanDraft {
  steps: string[];
  acceptanceCriteria: string[];
  /** 仅首轮规划使用；调用方仍需做防环/越界过滤 */
  dependsOn?: number[][];
}

export type PlanParseResult =
  | { ok: true; draft: PlanDraft }
  | { ok: false; reason: string };

/**
 * 剥离**首尾**代码围栏（``` / ```json）。正文中的代码块不受影响：
 * 只有 trim 后首行以 ``` 开头、末行恰为 ``` 时才剥离。
 */
export function stripOuterFence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  const lines = trimmed.split('\n');
  if (lines.length < 3) return trimmed;
  if (lines[lines.length - 1]!.trim() !== '```') return trimmed;
  // 首行必须只是围栏（可带语言标签），否则视为正文
  if (!/^```[A-Za-z0-9_-]*$/.test(lines[0]!.trim())) return trimmed;
  return lines.slice(1, -1).join('\n').trim();
}

/**
 * 提取**首个平衡的 JSON 对象**（跳过字符串内的括号与转义）。
 * 找不到/不闭合 ⇒ `null`。
 */
export function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/** 解析 Planner 输出；失败返回原因，不做任何降级。 */
export function parsePlanDraft(text: string): PlanParseResult {
  if (typeof text !== 'string' || !text.trim()) {
    return { ok: false, reason: 'empty-output' };
  }

  const cleaned = stripOuterFence(text);
  const jsonText = cleaned.startsWith('{')
    ? cleaned
    : extractFirstJsonObject(cleaned);
  if (!jsonText) return { ok: false, reason: 'no-json-object' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    return { ok: false, reason: `json-parse-error: ${String(err)}` };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, reason: 'root-not-object' };
  }

  const record = parsed as Record<string, unknown>;
  const stepsRaw = record.steps;
  if (!Array.isArray(stepsRaw) || stepsRaw.length === 0) {
    return { ok: false, reason: 'steps-missing-or-empty' };
  }
  if (!stepsRaw.every((s) => typeof s === 'string' && s.trim().length > 0)) {
    return { ok: false, reason: 'steps-contain-non-string' };
  }

  const acceptanceRaw = record.acceptanceCriteria;
  if (
    acceptanceRaw !== undefined &&
    (!Array.isArray(acceptanceRaw) ||
      !acceptanceRaw.every((s) => typeof s === 'string'))
  ) {
    return { ok: false, reason: 'acceptance-invalid' };
  }

  const dependsRaw = record.dependsOn;
  if (
    dependsRaw !== undefined &&
    (!Array.isArray(dependsRaw) ||
      !dependsRaw.every(
        (deps) =>
          Array.isArray(deps) &&
          deps.every((d) => Number.isInteger(d) && Number(d) >= 0)
      ))
  ) {
    return { ok: false, reason: 'depends-on-invalid' };
  }

  return {
    ok: true,
    draft: {
      steps: stepsRaw as string[],
      acceptanceCriteria: (acceptanceRaw as string[] | undefined) ?? [],
      dependsOn: dependsRaw as number[][] | undefined,
    },
  };
}

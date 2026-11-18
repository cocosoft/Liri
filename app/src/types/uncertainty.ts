/**
 * 不确定性与推理轨迹：A2A / ACP 共用的**纯契约**（D5，2026-11-14）
 *
 * Spec：`.trae/specs/a2a-acp-uncertainty-field.md`（字段名与协商方式已确认）。
 *
 * 三条硬约束：
 * 1. **默认不发**：只有对端通过 A2A 扩展 URI 或请求头协商后才允许写 `liri.*` 键；
 * 2. **不造假**：`score` / `method` 来自真实产出方（自评或验证器）；无产出方 ⇒ 不写字段（CS04）；
 * 3. **不传原始 CoT**：只传步骤摘要；且**必须**经过脱敏函数（未提供脱敏 ⇒ 只保留 `kind`）。
 *
 * 本文件零 IO、零上层依赖：a2a 路由与 acp runtime 都可安全引用。
 */

/** A2A `metadata` 上的键名（消息级 / 任务级同键） */
export const LIRI_UNCERTAINTY_KEY = 'liri.uncertainty';
export const LIRI_REASONING_TRACE_KEY = 'liri.reasoningTrace';

/** 协商信号 */
export const A2A_UNCERTAINTY_EXTENSION_URI = 'urn:liri:a2a:uncertainty:v1';
export const A2A_UNCERTAINTY_REQUEST_HEADER = 'x-liri-uncertainty';

/** 字段边界（与 spec §4 一致） */
export const UNCERTAINTY_MAX_TEXT_CHARS = 200;
export const UNCERTAINTY_MAX_TRACE_STEPS = 20;

export type LiriUncertaintyMethod = 'self_report' | 'verifier' | 'hybrid';
export type LiriTraceKind = 'plan' | 'tool' | 'check' | 'revise';

/** 0..1，越小越有把握（本项目统一"不确定性"语义，不设 confidence 双轨） */
export interface LiriUncertainty {
  score: number;
  method: LiriUncertaintyMethod;
  rationale?: string;
}

export interface LiriTraceStep {
  step: number;
  kind: LiriTraceKind;
  summary: string;
}

const METHODS: readonly LiriUncertaintyMethod[] = [
  'self_report',
  'verifier',
  'hybrid',
];
const KINDS: readonly LiriTraceKind[] = ['plan', 'tool', 'check', 'revise'];

/** 截断到上限（超长加省略号；空串 ⇒ undefined） */
function clampText(
  value: unknown,
  max: number = UNCERTAINTY_MAX_TEXT_CHARS
): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

/**
 * 归一化 `liri.uncertainty`（**纯函数**）。
 *
 * - `score` 必须有限且 0..1，四舍五入 2 位；越界 ⇒ **整条丢弃**（不夹取、不伪造）；
 * - `method` 必须为枚举值，否则丢弃；
 * - `rationale` 仅在提供 `redact` 时保留（脱敏 fail-closed）。
 */
export function normalizeUncertainty(
  input: unknown,
  redact?: (text: string) => string
): LiriUncertainty | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const o = input as Record<string, unknown>;

  const score = o['score'];
  if (typeof score !== 'number' || !Number.isFinite(score)) return null;
  if (score < 0 || score > 1) return null;

  const method = o['method'];
  if (
    typeof method !== 'string' ||
    !METHODS.includes(method as LiriUncertaintyMethod)
  ) {
    return null;
  }

  const rawRationale = clampText(o['rationale']);
  const rationale =
    rawRationale && redact ? clampText(redact(rawRationale)) : undefined;

  return {
    score: Math.round(score * 100) / 100,
    method: method as LiriUncertaintyMethod,
    ...(rationale ? { rationale } : {}),
  };
}

/**
 * 归一化 `liri.reasoningTrace`（**纯函数**）。
 *
 * - 最多 20 条；`step` 由本函数**按顺序重排**为 1..n（不信任入参编号）；
 * - `kind` 非枚举 ⇒ 该条丢弃；
 * - `summary` 仅在有 `redact` 时保留（未脱敏 ⇒ 只留 `kind`，符合 spec §4-4）。
 */
export function normalizeTrace(
  input: unknown,
  redact?: (text: string) => string
): LiriTraceStep[] {
  if (!Array.isArray(input)) return [];
  const out: LiriTraceStep[] = [];
  for (const item of input) {
    if (out.length >= UNCERTAINTY_MAX_TRACE_STEPS) break;
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    const kind = o['kind'];
    if (typeof kind !== 'string' || !KINDS.includes(kind as LiriTraceKind)) {
      continue;
    }
    const rawSummary = clampText(o['summary']);
    const summary =
      rawSummary && redact ? clampText(redact(rawSummary)) : undefined;
    out.push({
      step: out.length + 1,
      kind: kind as LiriTraceKind,
      ...(summary ? { summary } : {}),
    } as LiriTraceStep);
  }
  return out;
}

/** 把已归一化的信号合入 metadata；两者皆空 ⇒ 返回原对象（**不写键**） */
export function attachUncertaintyMetadata(
  metadata: Record<string, unknown> | undefined,
  signal: { uncertainty?: LiriUncertainty | null; trace?: LiriTraceStep[] }
): Record<string, unknown> | undefined {
  const hasUncertainty = !!signal.uncertainty;
  const hasTrace = (signal.trace?.length ?? 0) > 0;
  if (!hasUncertainty && !hasTrace) return metadata;
  return {
    ...(metadata ?? {}),
    ...(hasUncertainty ? { [LIRI_UNCERTAINTY_KEY]: signal.uncertainty } : {}),
    ...(hasTrace ? { [LIRI_REASONING_TRACE_KEY]: signal.trace } : {}),
  };
}

/**
 * 是否已协商（**纯函数**）：
 * - 扩展 URI 命中（AgentCard `capabilities.extensions[].uri`），或
 * - 单次请求头 `X-Liri-Uncertainty: accept`。
 *
 * 两者都没有 ⇒ `false`（默认不发，spec §3）。
 */
export function acceptsUncertainty(input: {
  header?: string | string[] | undefined;
  extensionUris?: readonly (string | undefined)[];
}): boolean {
  const header = Array.isArray(input.header) ? input.header[0] : input.header;
  if (typeof header === 'string' && header.trim().toLowerCase() === 'accept') {
    return true;
  }
  return (input.extensionUris ?? []).some(
    (uri) => uri === A2A_UNCERTAINTY_EXTENSION_URI
  );
}

/** 从一组消息里取**最后一条**带 `liri.uncertainty` 的值（任务级汇总口径，不重算） */
export function lastUncertaintyFromMessages(
  messages: readonly { metadata?: Record<string, unknown> }[]
): LiriUncertainty | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const value = messages[i]?.metadata?.[LIRI_UNCERTAINTY_KEY];
    if (value === undefined) continue;
    return normalizeUncertainty(value);
  }
  return null;
}

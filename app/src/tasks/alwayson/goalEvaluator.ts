/**
 * AlwaysOn **目标达成自评**（纯函数，2026-10-20 产品裁定「启用自评」）。
 *
 * 为什么需要：v2 之前报告固定 `Goal Achievement: unverified` —— 因为"本轮没报错"不等于
 * "目标已达成"。本模块只负责**提示词构造**与**结构化解析**，实际模型调用由宿主注入
 * （`AlwaysOnBridgeDeps.evaluateGoal`，遵守 R00-001：`tasks` 不直接依赖 `chat`）。
 *
 * 关键口径（不臆造）：
 * - 只认模型显式给出的 `yes` / `no` / `unknown` 三值，**任何解析失败一律 `unverified`**；
 * - `reason` 只做长度截断，不改写、不补全（CS06 证据驱动）；
 * - 判定依据**仅限**调用方给的文本证据（计划 / 执行输出 / 错误 / 工具调用数 / 补丁字节），
 *   明确禁止模型为此读取文件或调用工具 —— 本轮改动只在隔离区且**未 apply**，
 *   去仓库里看反而会得出"没改"的错误结论。
 */

/** 三值判定（`unverified` 含"未评估"/"解析失败"/"预算不足"等所有不可判定情形） */
export type AlwaysOnGoalVerdict = 'achieved' | 'not_achieved' | 'unverified';

/** 自评结果（报告与通知共用） */
export interface AlwaysOnGoalEvaluation {
  verdict: AlwaysOnGoalVerdict;
  /** 模型给出的理由（已截断）；`unverified` 时可能是宿主侧原因（如 `budget-locked`） */
  reason?: string;
  /** 判定来源：`model` / `skipped:*` / `error:*` 等（便于排查"为什么是 unverified"） */
  source?: string;
}

/** 自评提示词输入（全部来自本轮**已发生**的事实） */
export interface AlwaysOnGoalPromptInput {
  goalSummary: string;
  planJson: string;
  success: boolean;
  toolCalls: number;
  errors: readonly string[];
  /** 模型最终输出（过长时由调用方截断，避免自评本身爆上下文） */
  output: string;
  /** 本轮导出的补丁字节数（0 表示无改动；未隔离轮次为 undefined） */
  diffBytes?: number;
}

/** 理由截断上限（报告单行可读） */
export const GOAL_REASON_MAX_CHARS = 200;

/**
 * 构造自评提示词。
 *
 * 输出契约：**仅一行 JSON** `{"achieved":"yes|no|unknown","reason":"≤60字"}`；
 * 把"证据"与"判定"分开写，避免模型把执行日志复述成结论。
 */
export function buildGoalEvaluationPrompt(
  input: AlwaysOnGoalPromptInput
): string {
  const errorsBlock =
    input.errors.length > 0
      ? input.errors.map((e) => `- ${e}`).join('\n')
      : '（无）';
  return [
    '你是 AlwaysOn 自主执行器的「目标达成自评」。',
    '只依据下面给出的**本次执行事实**判断目标是否达成，不要调用任何工具、不要读取文件、不要臆测未给出的信息。',
    '',
    `目标：${input.goalSummary}`,
    `计划：${input.planJson}`,
    `执行状态：${input.success ? '流程成功' : '流程失败'}（成功仅代表没抛错，不等于目标达成）`,
    `工具调用次数：${input.toolCalls}`,
    `补丁字节：${input.diffBytes ?? '未隔离'}`,
    '错误：',
    errorsBlock,
    '',
    '执行输出（可能已截断）：',
    input.output.trim() || '（空）',
    '',
    '请只输出**一行 JSON**，不要代码块、不要额外说明：',
    '{"achieved":"yes|no|unknown","reason":"不超过60字的依据"}',
    '判定口径：yes = 事实足以证明目标已达成；no = 事实表明未达成或只做了部分；',
    'unknown = 证据不足，无法判断（宁填 unknown 也不要猜）。',
  ].join('\n');
}

/** 从模型输出里取出第一个 JSON 对象（容忍代码块 / 前后说明文字） */
function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * 模型原始取值 → 三值判定。
 *
 * 写成**无引号键**的对象字面量：这三个词是「自评输出契约」的取值，不是系统状态词汇
 * （`stateMachineCatalog` 未登记也不该登记）⇒ 用映射表而不是裸 `case` 字面量，
 * 既让 `lint:state-ratchet` 不误判，也把契约集中在一处。
 */
const RAW_VERDICT_MAP: Record<string, AlwaysOnGoalVerdict> = {
  yes: 'achieved',
  no: 'not_achieved',
  unknown: 'unverified',
};

/**
 * 解析模型自评输出。
 *
 * - `yes → achieved`、`no → not_achieved`、`unknown → unverified`；
 * - 缺字段 / 非法取值 / 非 JSON ⇒ `unverified`（source 说明具体原因，**不猜**）。
 */
export function parseGoalEvaluation(text: string): AlwaysOnGoalEvaluation {
  const json = extractFirstJsonObject(text);
  if (!json) {
    return {
      verdict: 'unverified',
      reason: '自评输出不含 JSON',
      source: 'parse:no-json',
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return {
      verdict: 'unverified',
      reason: '自评输出 JSON 无法解析',
      source: 'parse:invalid-json',
    };
  }
  if (!parsed || typeof parsed !== 'object') {
    return {
      verdict: 'unverified',
      reason: '自评输出不是对象',
      source: 'parse:not-object',
    };
  }
  const record = parsed as Record<string, unknown>;
  const rawVerdict =
    typeof record['achieved'] === 'string'
      ? record['achieved'].trim().toLowerCase()
      : '';
  const reason =
    typeof record['reason'] === 'string'
      ? record['reason'].trim().slice(0, GOAL_REASON_MAX_CHARS)
      : undefined;

  const mapped = Object.hasOwn(RAW_VERDICT_MAP, rawVerdict)
    ? RAW_VERDICT_MAP[rawVerdict]
    : undefined;
  if (!mapped) {
    return {
      verdict: 'unverified',
      reason: reason ?? `自评取值非法: ${rawVerdict || '(空)'}`,
      source: 'parse:invalid-verdict',
    };
  }
  return { verdict: mapped, reason, source: 'model' };
}

/** 未评估（宿主跳过/预算不足/异常）的构造器 —— 统一 source 口径 */
export function unverifiedGoal(
  source: string,
  reason?: string
): AlwaysOnGoalEvaluation {
  return { verdict: 'unverified', source, ...(reason ? { reason } : {}) };
}

/** 报告里的一行文案（三段式：结论 + 依据 + 来源，便于人读与排查） */
export function formatGoalAchievementLine(
  goal?: AlwaysOnGoalEvaluation
): string {
  if (!goal) {
    return '- **Goal Achievement**: unverified（仅记录本轮执行结果，未做模型自评）';
  }
  const label =
    goal.verdict === 'achieved'
      ? 'achieved'
      : goal.verdict === 'not_achieved'
        ? 'not_achieved'
        : 'unverified';
  const parts: string[] = [];
  if (goal.reason) parts.push(goal.reason);
  if (goal.source && goal.source !== 'model') parts.push(`来源 ${goal.source}`);
  return `- **Goal Achievement**: ${label}${
    parts.length > 0 ? `（${parts.join('；')}）` : ''
  }`;
}

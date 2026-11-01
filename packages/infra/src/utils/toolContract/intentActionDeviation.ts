/**
 * intentActionDeviation.ts — **意图-动作偏离**规则检查（语义护栏「便宜版」，2026-10-21）
 *
 * 由来（`演进方案-极简内核与分层循环.md` §1.4 / §3 W5）：
 * 语义护栏用向量/图谱成本高、误报难控；先做**规则化**的偏离检查（低成本），语义层后置。
 *
 * 判据（**宁漏勿误**）：
 *   - 目标文本明确是**只读意图**（查看 / 分析 / 总结 / read / show …），
 *     且**不含任何变更词**（修改 / 修复 / 创建 / 删除 / fix / add …）；
 *   - 本次工具动作确实会**变更状态**（写文件类；或 shell 里出现 rm/mv/git commit/重定向等）。
 *   两条同时成立 ⇒ 判偏离，由权限层升级为 `ask`（**不直接拒绝**：用户仍可批准）。
 *
 * 主动排除的误报源：
 *   - "分析并修复" 这类**混合意图** ⇒ 变更词优先，**不判**；
 *   - shell 里的只读命令（`ls` / `git status` / `cat`）⇒ 不算变更动作；
 *   - 目标文本缺失 / 过短 ⇒ **不判**（没有意图就不谈偏离）。
 *
 * 本模块零依赖（仅同目录的工具角色判定），不读配置、不碰存储，可直接单测。
 */

import { isFileWriteToolName, isShellToolName } from './toolRoles.js';

/** 只读意图词（命中即视为"用户只想看，不想改"） */
const READ_ONLY_INTENT_PATTERNS: readonly RegExp[] = [
  /查看|看一看|看一下|看看|阅读|列出|显示|分析|总结|解释|统计|查询|搜索|是什么|有哪些|怎么(样|回事)/,
  /\b(read|show|list|explain|summar|analy[sz]|inspect|search|find|describe|what|where|how)\b/i,
];

/**
 * 变更意图词（命中即视为"用户要改东西"，与只读词并存时**优先**）。
 *
 * 注意：**不收**「实现 / 生成」这类易作名词的词 —— "看看这个文件的实现" 会被误判为变更意图
 * （实测踩中）。宁可漏判，也不要误报。
 */
const MUTATE_INTENT_PATTERNS: readonly RegExp[] = [
  /修改|改成|改为|写入|写进|创建|新建|删除|移除|修复|重构|添加|更新|替换|部署|安装|提交|推送|重命名|移动|整理成/,
  /\b(fix|implement|add|update|remove|delete|create|write|refactor|deploy|install|commit|push|rename|move)\b/i,
];

/** shell 命令里的变更动作（读不到命令 ⇒ 不判变更，宁漏勿误） */
const SHELL_MUTATE_PATTERNS: readonly RegExp[] = [
  /(^|[;&|]\s*)(rm|rmdir|del|erase|mv|move|cp|copy|mkdir|touch|chmod|chown|truncate|tee)\b/i,
  /\bgit\s+(commit|push|reset|checkout|apply|clean|rebase|merge)\b/i,
  /\bsed\s+-i\b/i,
  />>?/,
];

/** 目标文本下限：太短（如"继续"）不足以判意图 */
const MIN_GOAL_TEXT_LENGTH = 4;

export type IntentKind = 'read-only' | 'mutate' | 'unclassified';
export type ActionKind = 'read' | 'mutate';

export interface IntentActionDeviationInput {
  /** 目标/意图文本（通常取最近一条用户消息；缺失 ⇒ 不判） */
  goalText?: string;
  toolName: string;
  /** 工具入参（shell 需要看 command 判读/写） */
  input?: Record<string, unknown>;
}

export interface IntentActionDeviationResult {
  deviated: boolean;
  /** 偏离理由（仅 `deviated=true` 时提供，供审批卡片展示） */
  reason?: string;
}

/** 目标文本 → 意图类别（变更词优先，避免"分析并修复"被误判为只读） */
export function classifyIntent(goalText?: string): IntentKind {
  const text = goalText?.trim() ?? '';
  if (text.length < MIN_GOAL_TEXT_LENGTH) return 'unclassified';
  if (MUTATE_INTENT_PATTERNS.some((re) => re.test(text))) return 'mutate';
  if (READ_ONLY_INTENT_PATTERNS.some((re) => re.test(text))) return 'read-only';
  return 'unclassified';
}

/** 工具 + 入参 → 动作类别 */
export function classifyAction(
  toolName: string,
  input?: Record<string, unknown>
): ActionKind {
  if (isFileWriteToolName(toolName)) return 'mutate';
  if (isShellToolName(toolName)) {
    const command =
      typeof input?.['command'] === 'string' ? input['command'] : '';
    // 读不到命令 ⇒ 按只读处理（宁漏勿误）；有命令才按内容判
    return command && SHELL_MUTATE_PATTERNS.some((re) => re.test(command))
      ? 'mutate'
      : 'read';
  }
  return 'read';
}

/** 意图-动作偏离判定（纯函数） */
export function detectIntentActionDeviation(
  input: IntentActionDeviationInput
): IntentActionDeviationResult {
  const intent = classifyIntent(input.goalText);
  if (intent !== 'read-only') return { deviated: false };
  const action = classifyAction(input.toolName, input.input);
  if (action !== 'mutate') return { deviated: false };
  return {
    deviated: true,
    reason:
      `意图-动作偏离：目标看起来是只读（查看/分析），但工具 \`${input.toolName}\` 会变更状态` +
      '（规则化检查，非语义判定；确认无误可批准）',
  };
}

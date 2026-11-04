// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * chatMode → 模型档位 / 工具集 的**唯一映射表**（P1，2026-11-04）。
 *
 * 背景（方案 §1.4）：前端「智能问答 / 深度思考 / 代码 / 创意 / 研究」五个选项里，
 * 只有 `research` 有后端行为（走 `researchService`），其余四个**只改图标与文案**——
 * `chatMode` 一直活在组件 state 里，后端从未读取。
 *
 * 本模块把"某个模式意味着什么"收敛成**纯函数**，供聊天入口按会话 `metadata.chatMode`
 * 取用；任何调用方都不得再各写一张映射表（CS01 / 双轨制禁止）。
 *
 * 边界（方案 §3.4）：
 * - 模式**只影响** 模型档位 / 工具集 / 轮次预算 / 提示词分层；
 * - **不得**放宽权限判定（硬安全 / 路径 / deny 规则恒在模式之上）。
 *
 * 未接线时（`chatMode` 缺失或脏值）一律按 `auto` 处理 ⇒ 与改造前行为一致（零行为变更）。
 */

/** 前端下拉的五个取值（与 `client/src/components/ChatArea/ChatInput.tsx` 同集合） */
export type ChatMode = 'auto' | 'deep' | 'code' | 'creative' | 'research';

/** 合法取值（校验用唯一真源） */
export const CHAT_MODES: readonly ChatMode[] = [
  'auto',
  'deep',
  'code',
  'creative',
  'research',
];

/**
 * 模型档位：复用既有任务分工的路由键。
 *
 * - `deep` / `code` ⇒ `coding`（需要强推理 / 代码能力，走任务分工里的编程档）；
 * - `auto` / `creative` / `research` ⇒ `chat`（默认对话档）。
 */
export type ChatModeRouteKey = 'chat' | 'coding';

/**
 * 工具集档位：
 * - `all`：全部工具；
 * - `no-shell`：去掉终端类工具（创意模式是低副作用写文案，不需要执行命令）。
 */
export type ChatModeToolset = 'all' | 'no-shell';

export interface ChatModePolicy {
  mode: ChatMode;
  routeKey: ChatModeRouteKey;
  toolset: ChatModeToolset;
  /** 轮次预算乘子（≥1；`deep` / `code` 允许更长的 ReAct 循环） */
  turnMultiplier: number;
}

/** 各模式的具体映射（**唯一事实源**；新增模式只改这里） */
const MODE_POLICY: Record<ChatMode, Omit<ChatModePolicy, 'mode'>> = {
  // 智能问答：按问题自动选档 ⇒ 保持默认档位与全量工具
  auto: { routeKey: 'chat', toolset: 'all', turnMultiplier: 1 },
  // 深度思考：显式要求长推理 ⇒ 强档 + 更长轮次；工具不限（需要检索/读文件）
  deep: { routeKey: 'coding', toolset: 'all', turnMultiplier: 2 },
  // 代码：面向仓库 ⇒ 强档 + 更长轮次 + 全量工具（含终端）
  code: { routeKey: 'coding', toolset: 'all', turnMultiplier: 2 },
  // 创意：低副作用 ⇒ 默认档、去掉终端类工具、预算不放大
  creative: { routeKey: 'chat', toolset: 'no-shell', turnMultiplier: 1 },
  // 研究：已由 researchService 承接（不进普通聊天流）；此处仅作兜底，行为与默认一致
  research: { routeKey: 'chat', toolset: 'all', turnMultiplier: 1 },
};

/**
 * 归一化会话里的 `chatMode` 取值。
 *
 * 缺失 / 非字符串 / 非法值 ⇒ `auto`（conservative：不因脏值放宽工具集或预算）。
 * 大小写不敏感（前端历史值可能是 `Deep`）。
 */
export function resolveChatMode(raw: unknown): ChatMode {
  if (typeof raw !== 'string') return 'auto';
  const normalized = raw.trim().toLowerCase();
  return (CHAT_MODES as readonly string[]).includes(normalized)
    ? (normalized as ChatMode)
    : 'auto';
}

/** 取某个模式对应的完整策略（非法值按 `auto`） */
export function resolveChatModePolicy(raw: unknown): ChatModePolicy {
  const mode = resolveChatMode(raw);
  return { mode, ...MODE_POLICY[mode] };
}

/**
 * 「终端 / 代码执行」类工具名 —— `no-shell` 模式下从**模型可见工具集**中移除。
 *
 * 为什么不用 `isShellToolName()`：它只覆盖 `bash / shell / command`，且被**权限规则**
 * 消费（命令级黑白名单匹配）。本仓实际终端工具叫 `PowerShellTool`，另 `code_run` 也能执行
 * 任意代码 ⇒ 若往 `toolRoles` 里加名字，会连带改变权限层行为。工具可见性是另一个口径，
 * 故此处独立成表（只有"哪些工具算执行类"这一个事实）。
 */
const EXEC_TOOL_NAMES: ReadonlySet<string> = new Set([
  'bash',
  'shell',
  'command',
  'powershell',
  'code_run',
]);

/**
 * 按模式过滤工具清单（模型**可见**的工具集）。
 *
 * 只做**减法**：`no-shell` 去掉执行类工具，其余原样保留。权限判定不受此影响 ——
 * 被过滤掉的工具即便被模型点名也不会执行（工具注册表仍会按权限链拒绝）。
 */
export function filterToolSchemasByChatMode<T extends { name: string }>(
  schemas: readonly T[],
  policy: ChatModePolicy
): T[] {
  if (policy.toolset !== 'no-shell') return [...schemas];
  return schemas.filter((schema) => !EXEC_TOOL_NAMES.has(schema.name));
}

/**
 * 会话上下文（记忆检索专用）
 * 描述当前会话的运行时状态，用于记忆检索时的权重调整
 *
 * 2026-10-01 数据契约专项 U5（`SessionContext` 簇 · B）：原名 `SessionContext`，与
 * `context/types/Context.ts`（ALS 注入的**会话运行时**上下文）及 `security/SecurityAudit.ts`
 * （**命令执行/审计**上下文）**同名不同物** ⇒ 依 §9.2 原则 2「一名一规范落点」改名为
 * **`MemorySessionContext`**（规范名 `SessionContext` 归 context 域，见该簇裁定 §9.9）。
 */
export interface MemorySessionContext {
  /** 会话唯一标识 */
  sessionId: string;

  /** 当前会话的消息轮数 */
  turnCount: number;

  /** 会话已持续时长（毫秒） */
  duration: number;

  /** 会话开始时间戳 */
  startedAt: number;

  /** 会话标签 */
  tags?: string[];

  /** 近期讨论主题 */
  recentTopics?: string[];

  /** 关联的项目 ID（用于注入项目上下文到 system prompt） */
  projectId?: string;
}

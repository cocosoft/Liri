/**
 * 会话上下文（记忆检索专用）
 * 描述当前会话的运行时状态，用于记忆检索时的权重调整
 */
export interface SessionContext {
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

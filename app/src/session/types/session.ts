/**
 * 会话状态
 *
 * 统一使用 {@link DataSessionStatus}（10 态标准词表，含 RUNNING/COMPLETED/ERROR/ABORTED）
 */
import { DataSessionStatus } from '@modules/core';

export { DataSessionStatus };

/**
 * 会话元数据
 *
 * @see {@link DataSessionMetadata}（协议/存储向模型；与领域模型形状不等价，勿直接互换）
 */
export interface SessionMetadata {
  /**
   * 会话标题
   */
  title: string;

  /**
   * 会话描述
   */
  description?: string;

  /**
   * 会话标签
   */
  tags?: string[];

  /**
   * 会话模式
   */
  mode?: string;

  /**
   * 会话级**工具能力 profile**（TG-4 / `T1-13`，2026-10-13）：声明能力标签（如 `media` / `coding`）
   * ⇒ 经 `tools/toolProfile.ts` 把对应工具类别**追加**进本会话的可见白名单。
   * **未声明 ⇒ 零行为变更**。注入后的**最终可见集**由 `execution/preparedSnapshot.ts` 在
   * PREPARED 阶段落盘（可复现：重放读落盘快照，**不读本字段**）。
   */
  toolProfile?: string[];

  /**
   * 回复详略档（`/effort` 写入，2026-10-22）：`low` / `medium` / `high` / `auto`。
   * 读取点：`chat/services/MessageContextPipeline.assembleContextualSystemPrompt`
   * 注入 system 提示段；`auto` 或未设置 ⇒ 不注入（行为与接线前一致）。
   */
  effortLevel?: 'low' | 'medium' | 'high' | 'auto';

  /**
   * **预留**（2026-10-22）：由 `effortLevel` 推导的思考预算（token）。
   * 当前无 provider 消费，仅随会话元数据落库，供后续 thinking 接线使用。
   */
  thinkingBudget?: number;

  /**
   * 模型名称
   */
  model?: string;

  /**
   * 创建者
   */
  creator?: string;

  /**
   * 最后活动时间
   */
  lastActivityAt?: Date;

  /**
   * 多租户 P1（2026-10-21）：**会话归属**（创建时的请求身份）。
   * 本地身份创建的会话不写该字段；判定见 `core/identity/sessionOwnership.ts`。
   */
  owner?: { tenantId: string; userId: string };

  /**
   * 总消息数
   */
  totalMessages?: number;

  /**
   * 总token数
   */
  totalTokens?: number;

  /**
   * 总成本
   */
  totalCost?: number;

  /**
   * 工作空间 ID
   */
  workspaceId?: string;

  /**
   * 供应商 ID
   */
  providerId?: string;

  /**
   * 任务覆盖配置
   */
  tasksOverride?: unknown;

  /**
   * 自定义元数据
   */
  [key: string]: any;
}

/**
 * 会话接口
 *
 * @see {@link DataSession}（协议/存储向模型；与领域模型形状不等价，勿直接互换）
 */
export interface ChatSession {
  /**
   * 会话ID
   */
  id: string;

  /**
   * 会话标题
   */
  title?: string;

  /**
   * 会话状态（统一 10 态标准词表）
   */
  state: DataSessionStatus;

  /**
   * 会话元数据
   */
  metadata: SessionMetadata;

  /**
   * 消息列表
   */
  messages: Message[];

  /**
   * 创建时间
   */
  createdAt: Date;

  /**
   * 更新时间
   */
  updatedAt: Date;

  /**
   * 结束时间
   */
  endedAt?: Date;

  /**
   * 归档时间
   */
  archivedAt?: Date;

  /**
   * 最后修改时间
   */
  lastModifiedAt?: number;
}

/**
 * 会话存储接口
 */
export interface SessionStorage {
  /**
   * 保存会话
   * @param session 会话对象
   */
  saveSession(session: ChatSession): Promise<void>;

  /**
   * 加载会话
   * @param sessionId 会话ID
   * @returns 会话对象或null
   */
  loadSession(sessionId: string): Promise<ChatSession | null>;

  /**
   * 加载所有会话
   * @returns 会话列表
   */
  loadSessions(): Promise<ChatSession[]>;

  /**
   * 删除会话
   * @param sessionId 会话ID
   */
  deleteSession(sessionId: string): Promise<void>;

  /**
   * 更新会话
   * @param session 会话对象
   */
  updateSession(session: ChatSession): Promise<void>;

  /**
   * 保存消息
   * @param sessionId 会话ID
   * @param message 消息对象
   */
  saveMessage(sessionId: string, message: Message): Promise<void>;

  /**
   * 加载消息
   * @param sessionId 会话ID
   * @returns 消息列表
   */
  loadMessages(sessionId: string): Promise<Message[]>;
}

/**
 * 创建会话的参数
 *
 * @see {@link DataCreateSessionParams}（协议/存储向模型；与领域模型形状不等价，勿直接互换）
 */
export interface CreateSessionParams {
  /**
   * 会话标题
   */
  title: string;

  /**
   * 外部传入的稳定会话 ID（如通道侧 "c2c:xxx"、"group:xxx"）。
   * 不传则自动生成随机 ID。
   */
  id?: string;

  /**
   * 会话描述
   */
  description?: string;

  /**
   * 会话标签
   */
  tags?: string[];

  /**
   * 会话模式
   */
  mode?: string;

  /**
   * 模型名称
   */
  model?: string;

  /**
   * 创建者
   */
  creator?: string;

  /**
   * 多租户 P1：显式指定会话归属（缺省 ⇒ 由 `SessionLifecycleManager` 取当前请求身份）
   */
  owner?: { tenantId: string; userId: string };

  /**
   * 初始消息
   */
  initialMessages?: Message[];

  /**
   * 自定义元数据
   */
  metadata?: Record<string, unknown>;
}

/**
 * 会话管理器接口
 */
export interface SessionManager {
  /**
   * 创建会话
   * @param params 创建会话的参数
   * @returns 会话对象
   */
  createSession(params: CreateSessionParams): ChatSession;

  /**
   * 获取会话
   * @param sessionId 会话ID
   * @returns 会话对象或undefined
   */
  getSession(sessionId: string): ChatSession | undefined;

  /**
   * 获取所有会话
   * @returns 会话列表
   */
  getSessions(): ChatSession[];

  /**
   * 删除会话
   * @param sessionId 会话ID
   */
  deleteSession(sessionId: string): void;

  /**
   * 保存会话
   * @param session 会话对象
   */
  saveSession(session: ChatSession): Promise<void>;

  /**
   * 加载会话
   * @param sessionId 会话ID
   * @returns 会话对象或undefined
   */
  loadSession(sessionId: string): Promise<ChatSession | undefined>;

  /**
   * 加载所有会话
   * @returns 会话列表
   */
  loadSessions(): Promise<ChatSession[]>;

  /**
   * 更新会话
   * @param session 会话对象
   */
  updateSession(session: ChatSession): void;

  /**
   * 添加消息
   * @param sessionId 会话ID
   * @param message 消息对象
   */
  addMessage(sessionId: string, message: Message): void;

  /**
   * 获取当前会话
   * @returns 当前会话对象或undefined
   */
  getCurrentSession(): ChatSession | undefined;

  /**
   * 设置当前会话
   * @param sessionId 会话ID
   */
  setCurrentSession(sessionId: string): void;

  /**
   * 创建会话检查点
   * @param sessionId 会话ID
   * @param label 检查点标签（可选）
   */
  createCheckpoint?(sessionId: string, label?: string): Promise<string>;

  /**
   * 列出会话检查点
   * @param sessionId 会话ID
   */
  listCheckpoints?(
    sessionId: string
  ): Promise<Array<{ id: string; label?: string; createdAt: number }>>;

  /**
   * 回滚到指定检查点
   * @param checkpointId 检查点ID
   */
  rollbackToCheckpoint?(checkpointId: string): Promise<void>;
}

/**
 * 从Message类型导入
 */
import type { Message } from './message';

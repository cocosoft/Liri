/**
 * CombinedSessionGateway — 跨 Agent 会话聚合网关
 *
 * 聚合多个 SessionGateway 实例，每个实例代表一個 Agent/Scope。
 * 提供统一查询接口：
 * - listSessions / getSession → 跨所有 Agent 合并结果
 * - 会话 Key 自动路由到对应 Gateway
 * - 支持按 Agent 筛选
 *
 * 参考 OpenClaw config/sessions/combined-store-gateway.ts 的设计：
 * - 多 store 源合并
 * - canonicalKey 去重
 * - 按 updatedAt 最新胜出
 */

import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { SessionGateway } from '../SessionGateway';
import type { SessionGatewayConfig } from '../SessionGateway';
import { SessionType } from '../types/Session';
import type {
  UnifiedSession,
  SessionFilter,
  SessionStats,
  CreateSessionParams,
} from '../types/Session';
import type { UnifiedMessage } from '../types/Message';
import type { Transcript } from '../types/Transcript';

const logger = getLogger('session:combinedGateway');

export const DEFAULT_AGENT_ID = 'default';

export interface AgentGatewayEntry {
  agentId: string;
  gateway: SessionGateway;
  label?: string;
  active: boolean;
}

export interface CombinedGatewayConfig {
  agents?: AgentGatewayEntry[];
  autoInitialize?: boolean;
}

export interface CombinedSessionResult {
  sessions: UnifiedSession[];
  agentSources: Record<string, string[]>;
}

export class CombinedSessionGateway {
  private agents: Map<string, AgentGatewayEntry> = new Map();
  private autoInitialize: boolean;
  private initialized = false;

  constructor(config: CombinedGatewayConfig = {}) {
    this.autoInitialize = config.autoInitialize ?? true;

    if (config.agents) {
      for (const entry of config.agents) {
        this.agents.set(entry.agentId, entry);
      }
    }
  }

  registerAgent(
    agentId: string,
    gateway: SessionGateway,
    label?: string
  ): void {
    this.agents.set(agentId, {
      agentId,
      gateway,
      label,
      active: true,
    });
    logger.info('注册 Agent 网关', { agentId, label });
  }

  unregisterAgent(agentId: string): boolean {
    return this.agents.delete(agentId);
  }

  setAgentActive(agentId: string, active: boolean): void {
    const entry = this.agents.get(agentId);
    if (entry) {
      entry.active = active;
    }
  }

  getAgent(agentId: string): SessionGateway | undefined {
    return this.agents.get(agentId)?.gateway;
  }

  getAgentIds(): string[] {
    return Array.from(this.agents.keys());
  }

  getActiveAgentIds(): string[] {
    return Array.from(this.agents.entries())
      .filter(([, entry]) => entry.active)
      .map(([id]) => id);
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    const activeAgents = this.getActiveAgentEntries();
    await Promise.all(
      activeAgents.map(async ({ agentId, gateway }) => {
        try {
          await gateway.initialize();
        } catch (err) {
          await handleError(err, {
            module: 'sessions:gateway:combined',
            action: 'Agent 网关初始化失败',
          });
        }
      })
    );

    if (this.autoInitialize && activeAgents.length === 0) {
      const defaultGateway = new SessionGateway();
      this.registerAgent(DEFAULT_AGENT_ID, defaultGateway);
      await defaultGateway.initialize();
    }

    this.initialized = true;
    logger.info('CombinedSessionGateway 初始化完成', {
      agentCount: this.agents.size,
    });
  }

  async createSession(
    params: CreateSessionParams & {
      userId?: string;
      chatType?: string;
      agentId?: string;
    } = {}
  ): Promise<UnifiedSession> {
    const agentId = params.agentId ?? DEFAULT_AGENT_ID;
    const gateway = this.resolveGateway(agentId);

    if (!gateway) {
      throw new Error(`Unknown agent: ${agentId}`);
    }

    return gateway.createSession(params);
  }

  async getSession(
    sessionId: string,
    agentId?: string
  ): Promise<UnifiedSession | null> {
    if (agentId) {
      const gateway = this.agents.get(agentId)?.gateway;
      return gateway?.getSession(sessionId) ?? null;
    }

    const activeEntries = this.getActiveAgentEntries();
    const results = await Promise.all(
      activeEntries.map(async ({ agentId: aid, gateway }) => {
        try {
          const session = await gateway.getSession(sessionId);
          return session ? { session, agentId: aid } : null;
        } catch (err) {
          return null;
        }
      })
    );

    const found = results
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .sort((a, b) => b.session.updatedAt - a.session.updatedAt);

    return found.length > 0 ? found[0].session : null;
  }

  async updateSession(
    session: UnifiedSession,
    agentId?: string
  ): Promise<void> {
    if (agentId) {
      const gateway = this.agents.get(agentId)?.gateway;
      if (gateway) {
        logger.info('updateSession: 显式 Agent 更新', {
          sessionId: session.id,
          agentId,
        });
        await gateway.updateSession(session);
      }
      return;
    }

    // P1-19 修复：无 agentId 时不再广播写入所有 Agent——会话只属于一个 Agent，
    // 广播会把 A 的会话写到 B 的存储（数据串扰）。按会话归属定位唯一 Agent。
    const foundOwner = await this.findSessionAgent(session.id);
    const owner = foundOwner ?? DEFAULT_AGENT_ID;
    const gateway = this.agents.get(owner)?.gateway;
    if (gateway) {
      logger.info('updateSession: 按归属 Agent 更新', {
        sessionId: session.id,
        owner,
        ownerSource: foundOwner ? 'probe_found' : 'default_fallback',
      });
      await gateway.updateSession(session);
      return;
    }
    // 归属 Agent 不可用（未注册/未激活）时回退到第一个 active，兜底不丢写入
    const fallback = this.getActiveAgentEntries()[0];
    if (fallback) {
      logger.warn('updateSession: 归属 Agent 不可用，回退写入', {
        sessionId: session.id,
        owner,
        fallbackAgentId: fallback.agentId,
      });
      await fallback.gateway.updateSession(session);
    }
  }

  async deleteSession(sessionId: string, agentId?: string): Promise<void> {
    if (agentId) {
      const gateway = this.agents.get(agentId)?.gateway;
      if (gateway) {
        logger.info('deleteSession: 显式 Agent 删除', { sessionId, agentId });
        await gateway.deleteSession(sessionId);
      }
      return;
    }

    // P1-19 修复：同 updateSession，按会话归属定位，避免广播删除其他 Agent 数据
    const foundOwner = await this.findSessionAgent(sessionId);
    const owner = foundOwner ?? DEFAULT_AGENT_ID;
    const gateway = this.agents.get(owner)?.gateway;
    if (gateway) {
      logger.info('deleteSession: 按归属 Agent 删除', {
        sessionId,
        owner,
        ownerSource: foundOwner ? 'probe_found' : 'default_fallback',
      });
      await gateway.deleteSession(sessionId);
      return;
    }
    const fallback = this.getActiveAgentEntries()[0];
    if (fallback) {
      logger.warn('deleteSession: 归属 Agent 不可用，回退删除', {
        sessionId,
        owner,
        fallbackAgentId: fallback.agentId,
      });
      await fallback.gateway.deleteSession(sessionId);
    }
  }

  /**
   * 跨 active Agent 定位会话归属（首个包含该会话的 Agent）
   * @returns 归属 AgentId；未找到返回 undefined
   */
  private async findSessionAgent(
    sessionId: string
  ): Promise<string | undefined> {
    for (const { agentId, gateway } of this.getActiveAgentEntries()) {
      try {
        const session = await gateway.getSession(sessionId);
        if (session) return agentId;
      } catch {
        // 单个 Agent 查询失败不影响其他 Agent
      }
    }
    return undefined;
  }

  async listSessions(
    filter?: SessionFilter,
    agentIds?: string[]
  ): Promise<CombinedSessionResult> {
    const targetIds = agentIds ?? this.getActiveAgentIds();
    const agentSources: Record<string, string[]> = {};

    const allSessions = new Map<
      string,
      { session: UnifiedSession; agentId: string }
    >();

    for (const agentId of targetIds) {
      const entry = this.agents.get(agentId);
      if (!entry?.active) continue;

      try {
        const sessions = await entry.gateway.listSessions(filter);
        agentSources[agentId] = sessions.map((s) => s.id);

        for (const session of sessions) {
          const existing = allSessions.get(session.id);
          if (!existing || session.updatedAt > existing.session.updatedAt) {
            allSessions.set(session.id, { session, agentId });
          }
        }
      } catch (err) {
        logger.warning('列出 Agent 会话失败', {
          agentId,
          error: String(err),
        });
      }
    }

    const sessions = Array.from(allSessions.values())
      .map((s) => s.session)
      .sort((a, b) => b.updatedAt - a.updatedAt);

    return { sessions, agentSources };
  }

  async searchSessions(
    query: string,
    agentIds?: string[]
  ): Promise<CombinedSessionResult> {
    const targetIds = agentIds ?? this.getActiveAgentIds();
    const agentSources: Record<string, string[]> = {};
    const allSessions = new Map<
      string,
      { session: UnifiedSession; agentId: string }
    >();

    for (const agentId of targetIds) {
      const entry = this.agents.get(agentId);
      if (!entry?.active) continue;

      try {
        const sessions = await entry.gateway.searchSessions(query);
        agentSources[agentId] = sessions.map((s) => s.id);

        for (const session of sessions) {
          const existing = allSessions.get(session.id);
          if (!existing || session.updatedAt > existing.session.updatedAt) {
            allSessions.set(session.id, { session, agentId });
          }
        }
      } catch (err) {
        logger.warning('搜索 Agent 会话失败', {
          agentId,
          error: String(err),
        });
      }
    }

    const sessions = Array.from(allSessions.values())
      .map((s) => s.session)
      .sort((a, b) => b.updatedAt - a.updatedAt);

    return { sessions, agentSources };
  }

  async getSessionStats(agentId?: string): Promise<SessionStats> {
    if (agentId) {
      const gateway = this.agents.get(agentId)?.gateway;
      if (!gateway) {
        return {
          totalSessions: 0,
          activeSessions: 0,
          archivedSessions: 0,
          averageSessionDuration: 0,
          totalMessages: 0,
        };
      }
      return gateway.getSessionStats();
    }

    const activeEntries = this.getActiveAgentEntries();
    let totalSessions = 0;
    let totalMessages = 0;
    let totalDuration = 0;
    let totalActive = 0;
    let totalArchived = 0;

    for (const { gateway } of activeEntries) {
      try {
        const stats = await gateway.getSessionStats();
        totalSessions += stats.totalSessions;
        totalMessages += stats.totalMessages;
        totalDuration += stats.averageSessionDuration * stats.totalSessions;
        // P2-24b 修复：聚合各 gateway 的真实活跃/归档会话数（原硬编码 0）
        totalActive += stats.activeSessions;
        totalArchived += stats.archivedSessions;
      } catch (err) {
        logger.warning('获取会话统计失败', {
          error: String(err),
        });
      }
    }

    return {
      totalSessions,
      activeSessions: totalActive,
      archivedSessions: totalArchived,
      averageSessionDuration:
        totalSessions > 0 ? totalDuration / totalSessions : 0,
      totalMessages,
    };
  }

  async sendMessage(
    sessionId: string,
    message: UnifiedMessage,
    agentId?: string
  ): Promise<void> {
    if (agentId) {
      const gateway = this.agents.get(agentId)?.gateway;
      if (!gateway) {
        throw new Error(`Unknown agent: ${agentId}`);
      }
      logger.info('sendMessage: 显式 Agent 写入', {
        sessionId,
        agentId,
        messageId: message.id,
      });
      await gateway.sendMessage(sessionId, message);
      return;
    }

    // P2-24c 修复：写前先定位会话归属 Agent（只读探测，跨 Agent 探测无副作用），
    // 只写归属 Agent——原 try-next 链在"第一个 gateway 写入成功后才抛错"的极端
    // 场景会把同一条消息重复写到多个 Agent（数据串扰）。归属写入失败直接上抛，
    // 不再换 Agent 重试（换 Agent 重试 = 重复写）。
    const foundOwner = await this.findSessionAgent(sessionId);
    const owner = foundOwner ?? DEFAULT_AGENT_ID;
    const gateway = this.agents.get(owner)?.gateway;
    if (gateway) {
      logger.info('sendMessage: 按归属 Agent 写入', {
        sessionId,
        owner,
        ownerSource: foundOwner ? 'probe_found' : 'default_fallback',
        messageId: message.id,
      });
      await gateway.sendMessage(sessionId, message);
      return;
    }
    // 归属 Agent 不可用（未注册/未激活）时回退到第一个 active（同 updateSession 兜底）
    const fallback = this.getActiveAgentEntries()[0];
    if (fallback) {
      logger.warn('sendMessage: 归属 Agent 不可用，回退写入', {
        sessionId,
        owner,
        fallbackAgentId: fallback.agentId,
      });
      await fallback.gateway.sendMessage(sessionId, message);
      return;
    }
    throw new Error(`No active gateway found for session: ${sessionId}`);
  }

  async getMessages(
    sessionId: string,
    options?: { limit?: number; offset?: number },
    agentId?: string
  ): Promise<UnifiedMessage[]> {
    if (agentId) {
      const gateway = this.agents.get(agentId)?.gateway;
      logger.info('getMessages: 显式 Agent 读取', { sessionId, agentId });
      return gateway?.getMessages(sessionId, options) ?? [];
    }

    // P2-24c 修复：按归属 Agent 读取（与 sendMessage 路由一致）——原 try-next 链
    // 在"会话存在但为空 + 其他 Agent 存在同 id 会话"时会读错 Agent 的数据。
    const foundOwner = await this.findSessionAgent(sessionId);
    const owner = foundOwner ?? DEFAULT_AGENT_ID;
    const gateway = this.agents.get(owner)?.gateway;
    if (gateway) {
      const messages = (await gateway.getMessages(sessionId, options)) ?? [];
      logger.info('getMessages: 按归属 Agent 读取', {
        sessionId,
        owner,
        ownerSource: foundOwner ? 'probe_found' : 'default_fallback',
        messageCount: messages.length,
      });
      return messages;
    }
    const fallback = this.getActiveAgentEntries()[0];
    if (fallback) {
      logger.warn('getMessages: 归属 Agent 不可用，回退读取', {
        sessionId,
        owner,
        fallbackAgentId: fallback.agentId,
      });
      return fallback.gateway.getMessages(sessionId, options) ?? [];
    }
    return [];
  }

  async loadTranscript(
    sessionId: string,
    agentId?: string
  ): Promise<Transcript | null> {
    if (agentId) {
      const gateway = this.agents.get(agentId)?.gateway;
      return gateway?.loadTranscript(sessionId) ?? null;
    }

    const activeEntries = this.getActiveAgentEntries();
    for (const { gateway } of activeEntries) {
      try {
        const transcript = await gateway.loadTranscript(sessionId);
        if (transcript) return transcript;
      } catch (err) {
        // Try next gateway
      }
    }

    return null;
  }

  async close(agentId?: string): Promise<void> {
    if (agentId) {
      const gateway = this.agents.get(agentId)?.gateway;
      await gateway?.close();
      this.agents.delete(agentId);
      return;
    }

    const entries = Array.from(this.agents.values());
    await Promise.all(
      entries.map(async ({ agentId: aid, gateway }) => {
        try {
          await gateway.close();
        } catch (err) {
          logger.warning('关闭 Agent 网关失败', {
            agentId: aid,
            error: String(err),
          });
        }
      })
    );

    this.agents.clear();
    this.initialized = false;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  getAgentCount(): number {
    return this.agents.size;
  }

  private resolveGateway(agentId: string): SessionGateway | undefined {
    const entry = this.agents.get(agentId);
    if (entry?.active) return entry.gateway;

    // P2-24a 修复：显式指定的非默认 agent 不活跃时不再静默回退到任意活跃 agent
    // （否则会话会被创建到错误的 Agent，调用方无感）。由调用方抛错感知。
    if (agentId !== DEFAULT_AGENT_ID) return undefined;

    // 默认 agent 不活跃时回退到任意活跃 agent（保持系统默认会话可用）
    for (const [, e] of this.agents) {
      if (e.active) return e.gateway;
    }

    return undefined;
  }

  private getActiveAgentEntries(): {
    agentId: string;
    gateway: SessionGateway;
  }[] {
    return Array.from(this.agents.entries())
      .filter(([, entry]) => entry.active)
      .map(([agentId, entry]) => ({ agentId, gateway: entry.gateway }));
  }
}

/**
 * CouncilOrchestrator（理事会编排器）
 *
 * 桥接 CouncilEngine 与 AI 服务，负责：
 * 1. 实现 statementCallback（调用 AI 为每个 Agent 生成发言）
 * 2. 实现 consensusCallback（调用 AI 判定共识）
 * 3. 提供 startCouncil() 一站式入口（创建 session + 执行辩论 + 缓存）
 * 4. 提供 runDebate() 方法（仅执行辩论，不创建 session）
 * 5. 内嵌 5 个专家 Agent 角色定义
 * 6. Token 优化（规则拼接摘要）
 */

import { CouncilEngine } from './CouncilEngine.js';
import type {
  CouncilSession,
  CouncilAgentRole,
  CouncilStatement,
  ConsensusResult,
} from './CouncilTypes.js';
import type { CouncilConfig } from './CouncilEngine.js';
import { globalEventBus } from '../core/events/EventBus.js';
import { OrchestrationEventType } from '../agent/events/OrchestrationEvents.js';
import { Logger, LogLevel } from '@modules/monitoring';
import aiService from '@modules/ai';
import type { AIMessage } from '@modules/ai';
import { getAgentRoleStore } from './AgentRoleStore.js';
import { getAgentRegistry } from '../agent/registry/AgentRegistry.js';
import type { AgentDefinition } from '../agent/registry/AgentRegistry.js';

const logger = new Logger({
  module: 'CouncilOrchestrator',
  level: LogLevel.INFO,
});

// ============================================================
// 内置 5 个专家 Agent 角色
// ============================================================

/** 默认专家 Agent 角色列表 */
const DEFAULT_AGENTS: CouncilAgentRole[] = [
  {
    agentId: 'architect',
    name: '架构师',
    expertise: ['系统架构', '模块设计', '扩展性'],
    weight: 1.0,
  },
  {
    agentId: 'security',
    name: '安全专家',
    expertise: ['安全漏洞', '权限控制', '数据保护'],
    weight: 1.0,
  },
  {
    agentId: 'performance',
    name: '性能专家',
    expertise: ['性能优化', '资源占用', '并发处理'],
    weight: 1.0,
  },
  {
    agentId: 'frontend',
    name: '前端专家',
    expertise: ['UI/UX', '组件设计', '用户体验'],
    weight: 0.8,
  },
  {
    agentId: 'backend',
    name: '后端专家',
    expertise: ['API 设计', '数据存储', '服务编排'],
    weight: 1.0,
  },
];

// ============================================================
// 将默认 Agent 注册到 AgentRegistry（启动时引导）
// ============================================================

function bootstrapAgentRegistry(): void {
  const registry = getAgentRegistry();
  const existing = registry.discoverAgents();
  if (existing.length > 0) return; // 已有注册，跳过引导

  registry.registerAgents(
    DEFAULT_AGENTS.map((a) => ({
      agentId: a.agentId,
      name: a.name,
      role: a.agentId,
      expertise: a.expertise,
      weight: a.weight,
      systemPrompt: a.systemPrompt,
      priority: a.weight >= 1.0 ? 8 : 6,
    }))
  );
}
bootstrapAgentRegistry();

// ============================================================
// 简易缓存（Map 实现，最大 15 条）
// ============================================================

const councilCache = new Map<string, CouncilSession>();
const CACHE_MAX_SIZE = 15;

// ============================================================
// 复杂度关键词（用于触发 Council）
// ============================================================

/** 触发 Council 的关键词列表 */
const COMPLEX_KEYWORDS = [
  '架构设计',
  '系统重构',
  '技术选型',
  '方案设计',
  '安全审查',
  '安全漏洞',
  '权限控制',
  '性能优化',
  '性能瓶颈',
  '并发处理',
  '风险评估',
  '影响范围',
  '设计模式',
  '最佳实践',
];

/**
 * 判断消息是否包含复杂度关键词
 */
export function containsComplexKeywords(message: string): boolean {
  return COMPLEX_KEYWORDS.some((kw) => message.includes(kw));
}

// ============================================================
// 角色专属 system prompt 模板
// ============================================================

/** 角色专属 system prompt */
const ROLE_PROMPTS: Record<string, string> = {
  architect: `你是一位资深系统架构师，专长于系统架构设计、模块拆分和扩展性规划。
在辩论中，请从架构层面分析问题，关注：
- 模块边界划分和职责分离
- 接口契约设计和依赖方向
- 扩展性和可维护性
- 长远技术演进路径`,
  security: `你是一位资深安全专家，专长于安全漏洞防御、权限控制和数据保护。
在辩论中，请从安全层面分析问题，关注：
- 潜在的安全漏洞和攻击面
- 认证授权方案（OAuth2、JWT 等）
- 数据加密和隐私保护
- 合规性要求`,
  performance: `你是一位资深性能优化专家，专长于性能调优、资源管理和并发处理。
在辩论中，请从性能层面分析问题，关注：
- 缓存策略和资源优化
- 数据库索引和查询优化
- 并发处理和线程安全
- 资源占用和响应延迟`,
  frontend: `你是一位资深前端专家，专长于 UI/UX 设计、组件架构和用户体验。
在辩论中，请从前端层面分析问题，关注：
- 组件设计和状态管理
- 响应式布局和用户体验
- 前端性能优化（懒加载、代码分割）
- 可访问性和国际化`,
  backend: `你是一位资深后端专家，专长于 API 设计、数据存储和服务编排。
在辩论中，请从后端层面分析问题，关注：
- RESTful API 和微服务设计
- 数据库选型和数据建模
- 消息队列和异步处理
- 服务发现和负载均衡`,
};

/** 共识判定 system prompt */
const CONSENSUS_SYSTEM_PROMPT = `你是一位技术决策主持人。根据以下多位专家的辩论发言，做出共识判定。

判定规则：
1. "unanimous"（一致通过）：所有专家意见一致，没有分歧
2. "majority"（多数通过）：多数专家达成一致，存在少数不同意见
3. "deadlock"（无法达成共识）：各方意见严重分歧，无法形成统一结论

请返回 JSON 格式：
{
  "result": "unanimous" | "majority" | "deadlock",
  "finalProposal": "最终方案描述",
  "minorityOpinion": "少数派意见（majority 时有值，unanimous 时为 null）"
}`;

// ============================================================
// CouncilOrchestrator
// ============================================================

export class CouncilOrchestrator {
  /** 当前加载的 Agent 角色映射（agentId → 完整角色，含 systemPrompt） */
  private _agentsMap: Map<string, CouncilAgentRole> = new Map();

  /**
   * @param engine CouncilEngine 实例，由调用方注入（确保 SSE 共享）
   */
  constructor(private engine: CouncilEngine) {}

  /**
   * 一站式创建并启动辩论（含缓存）
   * 从数据库加载配置的专家角色，若数据库无数据则使用硬编码默认值
   * @param workspaceId 工作空间 ID
   * @param topic 议题
   * @param context 背景描述
   * @param agents 参与 Agent 列表（默认从 DB 加载，无数据时使用内置 5 个专家）
   * @param config 配置（最大轮次等）
   * @returns 完整的 CouncilSession（含共识结果）
   */
  async startCouncil(
    workspaceId: string,
    topic: string,
    context: string,
    agents?: CouncilAgentRole[],
    config: CouncilConfig = { maxRounds: 3 }
  ): Promise<CouncilSession> {
    // 未传入 agents 时，从数据库加载（无数据则使用硬编码默认值）
    const resolvedAgents = agents ?? (await this.loadAgents());
    // 更新 Agent 映射，供 statementCallback 查找 systemPrompt
    this._updateAgentsMap(resolvedAgents);

    const cacheKey = this.hashTopic(topic);
    const cached = councilCache.get(cacheKey);
    if (cached) {
      logger.info('Council 缓存命中', { topic });
      return cached;
    }

    // 1. 创建 session
    const session = this.engine.createSession(
      workspaceId,
      topic,
      context,
      resolvedAgents,
      config
    );

    // 2. 发射 COUNCIL_START 事件（sessionId 有效）
    try {
      globalEventBus.publish(OrchestrationEventType.COUNCIL_START, {
        sessionId: session.sessionId,
        workspaceId,
        topic,
        agents: resolvedAgents.map((a) => ({
          agentId: a.agentId,
          name: a.name,
        })),
        timestamp: Date.now(),
      });
    } catch (err) {
      // EventBus 发射失败不应阻塞主流程
    }

    // 3. 执行辩论
    const result = await this.engine.runDebate(
      session.sessionId,
      this.statementCallback.bind(this),
      this.consensusCallback.bind(this)
    );

    // 4. 发射 COUNCIL_END 事件
    try {
      globalEventBus.publish(OrchestrationEventType.COUNCIL_END, {
        sessionId: session.sessionId,
        result: result.result,
        finalProposal: result.finalProposal,
        timestamp: Date.now(),
      });
    } catch (err) {
      // EventBus 发射失败不应阻塞主流程
    }

    // 5. 写入缓存（超出上限时删除最旧条目）
    if (councilCache.size >= CACHE_MAX_SIZE) {
      const firstKey = councilCache.keys().next().value;
      if (firstKey) councilCache.delete(firstKey);
    }
    councilCache.set(cacheKey, result);

    return result;
  }

  /**
   * 从数据库加载启用的 Agent 角色，无数据时尝试 AgentRegistry，最后回退到硬编码默认值
   */
  private async loadAgents(): Promise<CouncilAgentRole[]> {
    try {
      const store = getAgentRoleStore();
      const rows = await store.listEnabled();

      if (rows.length > 0) {
        return rows.map((row) => ({
          agentId: row.agentId,
          name: row.name,
          expertise: row.expertise,
          weight: row.weight,
          systemPrompt: row.systemPrompt,
        }));
      }
    } catch (err) {
      logger.warn('从数据库加载 Agent 角色失败');
    }

    // 数据库无数据或无配置 → 尝试 AgentRegistry
    const registry = getAgentRegistry();
    const registered = registry.discoverAgents();
    if (registered.length > 0) {
      return registered.map(toCouncilAgentRole);
    }

    // 最后回退到硬编码默认值
    logger.warn('AgentRegistry 为空，使用硬编码默认 Agent 列表');
    return DEFAULT_AGENTS;
  }

  /**
   * 更新 Agent 映射表（供 statementCallback 查找 systemPrompt）
   */
  private _updateAgentsMap(agents: CouncilAgentRole[]): void {
    this._agentsMap.clear();
    for (const agent of agents) {
      this._agentsMap.set(agent.agentId, agent);
    }
  }

  /**
   * 在已创建的 session 上执行辩论（不含缓存）
   * 用于需要单独控制 session 生命周期的场景（如 handler 两步走）
   * @param sessionId Council 会话 ID
   * @returns 完整的 CouncilSession（含共识结果）
   */
  async runDebate(sessionId: string): Promise<CouncilSession> {
    const session = this.engine.getSession(sessionId);
    if (session) {
      this._updateAgentsMap(session.agents);
    }
    return this.engine.runDebate(
      sessionId,
      this.statementCallback.bind(this),
      this.consensusCallback.bind(this)
    );
  }

  /**
   * statementCallback：为每个 Agent 角色生成发言
   */
  private async statementCallback(
    agentId: string,
    agentName: string,
    round: number,
    type: CouncilStatement['type'],
    topic: string,
    context: string,
    prevStatements: CouncilStatement[]
  ): Promise<{ content: string; keyPoints: string[] }> {
    // 优先使用 Agent 的自定义 systemPrompt，再回退到内置模板
    const agent = this._agentsMap.get(agentId);
    const systemPrompt = agent?.systemPrompt
      ? agent.systemPrompt
      : this.buildRolePrompt(agentId, type);
    const userPrompt = this.buildDebatePrompt(
      topic,
      context,
      round,
      type,
      prevStatements
    );
    const response = await this.callAI(systemPrompt, userPrompt, {
      maxTokens: 512,
    });
    return this.parseStatementResponse(response);
  }

  /**
   * consensusCallback：判定共识结果
   */
  private async consensusCallback(session: CouncilSession): Promise<{
    result: ConsensusResult;
    finalProposal: string;
    minorityOpinion: string | null;
  }> {
    const prompt = this.buildConsensusPrompt(session);
    const response = await this.callAI(CONSENSUS_SYSTEM_PROMPT, prompt, {
      maxTokens: 1024,
    });
    return this.parseConsensusResponse(response);
  }

  /**
   * AI 调用封装
   * @param systemPrompt 系统提示词
   * @param userPrompt 用户提示词
   * @param options 选项（maxTokens 等）
   * @returns AI 响应的文本内容
   */
  private async callAI(
    systemPrompt: string,
    userPrompt: string,
    options?: { maxTokens?: number }
  ): Promise<string> {
    const messages: AIMessage[] = [];

    if (systemPrompt) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      messages.push({ role: 'system' as any, content: systemPrompt });
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    messages.push({ role: 'user' as any, content: userPrompt });

    const response = await aiService.generate(messages, undefined, {
      max_tokens: options?.maxTokens ?? 512,
      temperature: 0.7,
    });

    return response.content ?? '';
  }

  // ============================================================
  // 辅助方法：Prompt 构建
  // ============================================================

  /**
   * 构建角色专属 system prompt
   */
  private buildRolePrompt(agentId: string, type: string): string {
    const basePrompt = ROLE_PROMPTS[agentId] ?? `你是一位${agentId}专家。`;

    const typeInstruction: Record<string, string> = {
      position:
        '这是第一轮立场陈述。请基于你的专业领域，对议题提出你的核心观点和建议。输出格式：先给出完整的陈述内容，然后在末尾用 [KEY_POINTS] 标签列出关键论点，每行一个。',
      rebuttal:
        '这是反驳轮。请针对前面其他专家的发言，提出你的不同意见或补充观点。如有分歧，请明确指出并阐述理由。输出格式同上。',
      supplement:
        '这是补充论证轮。请针对前面的讨论，补充你的额外分析或被你忽略的角度。输出格式同上。',
      final:
        '这是最终总结轮。请基于前面所有辩论，给出你的最终建议和结论。不需要再重复之前的观点，聚焦于你的最终立场。输出格式同上。',
    };

    return `${basePrompt}\n\n${typeInstruction[type] ?? typeInstruction.position}`;
  }

  /**
   * 构建辩论上下文 user prompt（含规则拼接摘要）
   */
  private buildDebatePrompt(
    topic: string,
    context: string,
    round: number,
    type: string,
    prevStatements: CouncilStatement[]
  ): string {
    const parts: string[] = [];

    parts.push(`## 议题\n${topic}`);

    if (context) {
      parts.push(`\n## 背景\n${context}`);
    }

    // 规则拼接前序轮次摘要（不额外调用 AI 压缩）
    if (round > 1 && prevStatements.length > 0) {
      parts.push(`\n## 前序辩论摘要`);
      const completedRounds = new Set<number>();
      for (const stmt of prevStatements) {
        completedRounds.add(stmt.round);
      }
      const sortedRounds = Array.from(completedRounds).sort((a, b) => a - b);

      for (const r of sortedRounds) {
        if (r >= round) continue;
        const roundStmts = prevStatements.filter((s) => s.round === r);
        const summary = roundStmts
          .map((s) => {
            const kp = s.keyPoints.length > 0 ? s.keyPoints.join('；') : '';
            return `${s.agentName}：${kp || s.content.slice(0, 80)}`;
          })
          .join('\n');
        parts.push(`\n### 第 ${r} 轮\n${summary}`);
      }
    }

    const typeLabel: Record<string, string> = {
      position: '立场陈述',
      rebuttal: '反驳',
      supplement: '补充论证',
      final: '最终总结',
    };

    parts.push(
      `\n## 当前任务\n这是第 ${round} 轮辩论（${typeLabel[type] ?? type}）。请发表你的专业意见。`
    );

    return parts.join('\n');
  }

  /**
   * 构建 Consensus 判定 prompt
   */
  private buildConsensusPrompt(session: CouncilSession): string {
    const parts: string[] = [];

    parts.push(`## 议题\n${session.topic}`);

    parts.push(
      `\n## 辩论总结\n共 ${session.maxRounds} 轮，${session.agents.length} 位专家参与。`
    );

    // 按轮次汇总所有发言
    for (let r = 1; r <= session.maxRounds; r++) {
      const roundStmts = session.statements.filter((s) => s.round === r);
      if (roundStmts.length === 0) continue;

      parts.push(`\n### 第 ${r} 轮`);
      for (const stmt of roundStmts) {
        const kp =
          stmt.keyPoints.length > 0
            ? `\n关键论点：${stmt.keyPoints.join('；')}`
            : '';
        parts.push(`\n**${stmt.agentName}**：${stmt.content}${kp}`);
      }
    }

    parts.push(`\n请根据以上辩论内容，做出共识判定。返回 JSON 格式。`);

    return parts.join('\n');
  }

  // ============================================================
  // 辅助方法：响应解析
  // ============================================================

  /**
   * 解析 AI 回复为结构化发言
   */
  private parseStatementResponse(response: string): {
    content: string;
    keyPoints: string[];
  } {
    // 尝试按 [KEY_POINTS] 标签拆分
    const kpMatch = response.match(/\[KEY_POINTS\]\s*\n?([\s\S]*?)$/i);

    if (kpMatch) {
      const content = response.slice(0, response.indexOf(kpMatch[0])).trim();
      const keyPoints = kpMatch[1]
        .split('\n')
        .map((line) => line.replace(/^[-*\d.]+\s*/, '').trim())
        .filter(Boolean);

      return { content: content || response, keyPoints };
    }

    // 无标签回退：尝试按 JSON 解析
    try {
      const parsed = JSON.parse(response);
      if (parsed.content && Array.isArray(parsed.keyPoints)) {
        return { content: parsed.content, keyPoints: parsed.keyPoints };
      }
    } catch (err) {
      // 不是 JSON，使用全文作为 content
    }

    return { content: response, keyPoints: [] };
  }

  /**
   * 解析 AI 共识判定回复
   */
  private parseConsensusResponse(response: string): {
    result: ConsensusResult;
    finalProposal: string;
    minorityOpinion: string | null;
  } {
    // 尝试 JSON 解析
    try {
      // 提取 JSON 块（可能被 markdown 代码块包裹）
      const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
      const jsonStr = jsonMatch ? jsonMatch[1].trim() : response.trim();
      const parsed = JSON.parse(jsonStr);

      const result: ConsensusResult =
        parsed.result === 'unanimous' ||
        parsed.result === 'majority' ||
        parsed.result === 'deadlock'
          ? parsed.result
          : 'deadlock';

      return {
        result,
        finalProposal: parsed.finalProposal ?? '无法达成共识',
        minorityOpinion: parsed.minorityOpinion ?? null,
      };
    } catch (err) {
      // JSON 解析失败，回退：从文本中推断
      logger.warn('Consensus JSON 解析失败，使用文本回退');
    }

    // 文本回退
    const lower = response.toLowerCase();
    if (lower.includes('unanimous') || lower.includes('一致')) {
      return {
        result: 'unanimous',
        finalProposal: response.slice(0, 500),
        minorityOpinion: null,
      };
    }
    if (lower.includes('majority') || lower.includes('多数')) {
      return {
        result: 'majority',
        finalProposal: response.slice(0, 500),
        minorityOpinion: '少数派意见未明确',
      };
    }

    return {
      result: 'deadlock',
      finalProposal: '各方未能达成共识',
      minorityOpinion: null,
    };
  }

  /**
   * 简易 topic hash（用于缓存 key）
   */
  private hashTopic(topic: string): string {
    const normalized = topic.trim().slice(0, 100);
    return `${normalized}::${topic.length}`;
  }
}

/**
 * 将 AgentDefinition 适配为 CouncilAgentRole
 */
function toCouncilAgentRole(def: AgentDefinition): CouncilAgentRole {
  return {
    agentId: def.agentId,
    name: def.name,
    expertise: def.expertise,
    weight: def.weight,
    systemPrompt: def.systemPrompt,
  };
}

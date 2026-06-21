/**
 * AI 编排智能（Orchestration Intelligence）
 *
 * 提供 5 项智能特性，增强工作项编排的自动化决策能力：
 * 1. 变更影响评估（ChangeImpactAnalyzer）
 * 2. 风险主动识别（RiskDetector）
 * 3. 决策分级（DecisionClassifier）
 * 4. 异常升级（EscalationManager）
 * 5. 资源争用自动调度（ResourceScheduler）
 */

import { randomUUID } from 'node:crypto';
import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({ module: 'OrchIntelligence', level: LogLevel.INFO });

// ==================== 类型定义 ====================

/** 影响范围级别 */
export type ImpactLevel = 'none' | 'low' | 'medium' | 'high' | 'critical';

/** 风险等级 */
export type RiskLevel = 'none' | 'low' | 'medium' | 'high' | 'critical';

/** 决策类型 */
export type DecisionType =
  | 'ai_auto' // AI 自决
  | 'ai_propose_human_confirm' // AI 出方案，人确认
  | 'human_required'; // 人必须审

/** 异常类型 */
export type EscalationType =
  | 'stuck' // 卡住不动
  | 'timeout' // 超时
  | 'repeated_failure' // 重复失败
  | 'resource_unavailable' // 资源不可用
  | 'conflict'; // 冲突

/** 变更影响分析结果 */
export interface ChangeImpactResult {
  /** 受影响文件列表 */
  affectedFiles: string[];
  /** 受影响模块 */
  affectedModules: string[];
  /** 影响范围级别 */
  impactLevel: ImpactLevel;
  /** 影响说明 */
  description: string;
  /** 建议的测试范围 */
  testSuggestions: string[];
  /** 是否有破坏性变更 */
  isBreaking: boolean;
  /** 上下游依赖分析 */
  dependencyChain: string[];
}

/** 风险识别结果 */
export interface RiskDetectionResult {
  /** 风险 ID */
  id: string;
  /** 风险描述 */
  description: string;
  /** 风险等级 */
  level: RiskLevel;
  /** 风险类别 */
  category:
    | 'security'
    | 'performance'
    | 'compatibility'
    | 'data'
    | 'architectural'
    | 'other';
  /** 触发条件 */
  trigger: string;
  /** 缓解建议 */
  mitigation: string;
  /** 是否已自动缓解 */
  mitigated: boolean;
}

/** 决策分级结果 */
export interface DecisionResult {
  /** 决策类型 */
  type: DecisionType;
  /** 决策原因 */
  reason: string;
  /** 要求的审批人角色 */
  requiredApprover?: string;
  /** AI 建议（ai_propose_human_confirm 时有值） */
  aiProposal?: string;
  /** 决策依据 */
  evidence: string[];
}

/** 异常升级请求 */
export interface EscalationRequest {
  /** 异常类型 */
  type: EscalationType;
  /** 关联工作项 ID */
  workItemId: string;
  /** 异常描述 */
  description: string;
  /** 发生次数 */
  occurrenceCount: number;
  /** 上次发生时间 */
  lastOccurrence: number;
  /** 建议的升级方向 */
  suggestedDirection: string;
}

/** 资源争用调度项 */
export interface ResourceScheduleItem {
  /** 工作项 ID */
  workItemId: string;
  /** 优先级 */
  priority: number;
  /** 所需资源列表 */
  requiredResources: string[];
  /** 排队序号 */
  queuePosition: number;
  /** 预计等待时间（ms） */
  estimatedWaitMs: number;
  /** 是否可插队 */
  canJumpQueue: boolean;
}

// ==================== 1. 变更影响评估 ====================

/**
 * 变更影响分析器
 *
 * 在工作项审核时自动分析变更影响范围：
 * - 分析修改文件的依赖关系
 * - 评估影响级别
 * - 生成测试建议
 */
export class ChangeImpactAnalyzer {
  /** 已知的模块依赖关系（可配置） */
  private moduleDependencies: Map<string, string[]> = new Map();

  /** 已知的破坏性变更模式 */
  private breakingPatterns: Array<{ pattern: RegExp; description: string }> =
    [];

  constructor() {
    this.initBreakingPatterns();
  }

  /** 初始化破坏性变更模式 */
  private initBreakingPatterns(): void {
    this.breakingPatterns = [
      {
        pattern: /export\s+(interface|type)\s+\w+/,
        description: '导出类型变更',
      },
      {
        pattern: /export\s+(default\s+)?class\s+\w+/,
        description: '导出类变更',
      },
      { pattern: /import\s+.*\s+from\s+['"]/, description: '模块导入变更' },
      {
        pattern: /\.env|config\.json|package\.json/,
        description: '配置文件变更',
      },
      {
        pattern: /CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE/,
        description: '数据库结构变更',
      },
    ];
  }

  /**
   * 注册模块依赖关系
   */
  registerDependency(module: string, dependencies: string[]): void {
    this.moduleDependencies.set(module, dependencies);
  }

  /**
   * 分析变更影响
   * @param changedFiles 变更的文件列表
   * @param changedContent 变更内容摘要
   */
  analyze(changedFiles: string[], changedContent: string): ChangeImpactResult {
    const affectedModules = new Set<string>();
    const testSuggestions: string[] = [];
    const dependencyChain: string[] = [];
    let isBreaking = false;

    // 分析每个变更文件
    for (const file of changedFiles) {
      const module = this.extractModuleName(file);
      affectedModules.add(module);

      // 检查是否命中破坏性变更模式
      for (const { pattern, description } of this.breakingPatterns) {
        if (pattern.test(file) || pattern.test(changedContent)) {
          isBreaking = true;
          logger.info('检测到破坏性变更', { file, pattern: description });
        }
      }

      // 查找依赖此模块的其他模块
      for (const [depModule, deps] of this.moduleDependencies) {
        if (deps.includes(module)) {
          affectedModules.add(depModule);
          dependencyChain.push(`${depModule} → ${module}`);
        }
      }
    }

    // 确定影响级别
    const impactLevel = this.calculateImpactLevel(
      changedFiles.length,
      affectedModules.size,
      isBreaking
    );

    // 生成测试建议
    testSuggestions.push(`单元测试: ${changedFiles.join(', ')}`);
    if (affectedModules.size > 1) {
      testSuggestions.push(`集成测试: ${[...affectedModules].join(' → ')}`);
    }
    if (isBreaking) {
      testSuggestions.push(`回归测试: 全量运行`);
    }

    return {
      affectedFiles: changedFiles,
      affectedModules: [...affectedModules],
      impactLevel,
      description: this.generateImpactDescription(
        impactLevel,
        affectedModules.size,
        isBreaking
      ),
      testSuggestions,
      isBreaking,
      dependencyChain,
    };
  }

  /** 从文件路径提取模块名 */
  private extractModuleName(filePath: string): string {
    const parts = filePath.replace(/\\/g, '/').split('/');
    const srcIndex = parts.indexOf('src');
    if (srcIndex >= 0 && parts.length > srcIndex + 1) {
      return parts[srcIndex + 1];
    }
    return parts[parts.length - 1].replace(/\.[^.]+$/, '');
  }

  /** 计算影响级别 */
  private calculateImpactLevel(
    fileCount: number,
    moduleCount: number,
    isBreaking: boolean
  ): ImpactLevel {
    if (isBreaking && moduleCount > 3) return 'critical';
    if (isBreaking || moduleCount > 3) return 'high';
    if (fileCount > 5 || moduleCount > 1) return 'medium';
    if (fileCount > 1) return 'low';
    return 'none';
  }

  /** 生成影响描述 */
  private generateImpactDescription(
    level: ImpactLevel,
    moduleCount: number,
    isBreaking: boolean
  ): string {
    const parts: string[] = [];
    parts.push(`影响 ${moduleCount} 个模块`);
    if (isBreaking) parts.push('包含破坏性变更');
    parts.push(`影响等级: ${level}`);
    return parts.join('，');
  }
}

// ==================== 2. 风险主动识别 ====================

/**
 * 风险检测器
 *
 * 在工作项创建时自动识别潜在风险：
 * - 安全风险（SQL 注入、XSS 等）
 * - 性能风险（N+1 查询、大循环等）
 * - 兼容性风险（API 变更、数据结构变更）
 * - 数据风险（数据迁移、删除操作）
 */
export class RiskDetector {
  /** 风险检测规则 */
  private rules: Array<{
    category: RiskDetectionResult['category'];
    patterns: RegExp[];
    level: RiskLevel;
    description: string;
    mitigation: string;
  }> = [];

  constructor() {
    this.initRules();
  }

  /** 初始化检测规则 */
  private initRules(): void {
    this.rules = [
      // 安全风险
      {
        category: 'security',
        patterns: [
          /\.innerHTML\s*=/,
          /eval\s*\(/,
          /dangerouslySetInnerHTML/,
          /raw\s+SQL|string\s+interpolation.*sql/i,
        ],
        level: 'high',
        description: '检测到潜在的安全风险（XSS/注入）',
        mitigation: '使用参数化查询或安全的 DOM API',
      },
      // 性能风险
      {
        category: 'performance',
        patterns: [
          /for\s*\(.*\)\s*\{[^}]*await/,
          /Promise\.all\(.*map/,
          /\.forEach\(.*async/,
        ],
        level: 'medium',
        description: '检测到潜在的性能风险（N+1 查询/串行异步）',
        mitigation: '使用批量查询或并行处理',
      },
      // 兼容性风险
      {
        category: 'compatibility',
        patterns: [
          /export\s+(interface|type)\s+\w+/,
          /\.d\.ts$/,
          /package\.json/,
        ],
        level: 'medium',
        description: '检测到接口/类型定义变更，可能影响兼容性',
        mitigation: '确认变更是否为向后兼容，必要时提供迁移指南',
      },
      // 数据风险
      {
        category: 'data',
        patterns: [
          /DELETE\s+FROM|DROP\s+TABLE|TRUNCATE/,
          /\.remove\(\)|\.delete\(\)/,
          /migration|migrate|schema.*change/i,
        ],
        level: 'high',
        description: '检测到数据删除或结构变更操作',
        mitigation: '确保有数据备份，在非生产环境验证后再执行',
      },
      // 架构风险
      {
        category: 'architectural',
        patterns: [
          /circular\s+import|circular\s+dependency/,
          /new\s+dependency|new\s+package/,
        ],
        level: 'low',
        description: '检测到新增依赖或架构变更',
        mitigation: '评估新依赖的必要性和维护成本',
      },
    ];
  }

  /**
   * 检测风险
   * @param workItemTitle 工作项标题
   * @param workItemDescription 工作项描述
   * @param changedFiles 变更文件列表
   */
  detect(
    workItemTitle: string,
    workItemDescription: string,
    changedFiles: string[]
  ): RiskDetectionResult[] {
    const results: RiskDetectionResult[] = [];
    const combinedText = `${workItemTitle}\n${workItemDescription}\n${changedFiles.join('\n')}`;

    for (const rule of this.rules) {
      for (const pattern of rule.patterns) {
        if (pattern.test(combinedText)) {
          results.push({
            id: randomUUID(),
            description: rule.description,
            level: rule.level,
            category: rule.category,
            trigger: pattern.source,
            mitigation: rule.mitigation,
            mitigated: false,
          });
          break; // 每个规则只触发一次
        }
      }
    }

    logger.info('风险检测完成', {
      workItemTitle,
      riskCount: results.length,
      highRiskCount: results.filter(
        (r) => r.level === 'high' || r.level === 'critical'
      ).length,
    });

    return results;
  }

  /** 获取风险摘要 */
  getRiskSummary(results: RiskDetectionResult[]): string {
    if (results.length === 0) return '未检测到明显风险';

    const highRisks = results.filter(
      (r) => r.level === 'high' || r.level === 'critical'
    );
    if (highRisks.length > 0) {
      return `检测到 ${highRisks.length} 个高风险项，建议审核后再执行`;
    }

    return `检测到 ${results.length} 个低/中风险项，可继续执行但需关注`;
  }
}

// ==================== 3. 决策分级 ====================

/**
 * 决策分级器
 *
 * 按决策类型自动判断审批人：
 * - AI 自决：简单、低风险、重复性操作
 * - AI 出方案人确认：中等复杂度，需要人类最终确认
 * - 人必须审：高风险、破坏性变更、生产环境操作
 */
export class DecisionClassifier {
  /**
   * 分类决策
   * @param workItemTitle 工作项标题
   * @param workItemDescription 工作项描述
   * @param impactResult 变更影响分析结果
   * @param risks 风险检测结果
   */
  classify(
    workItemTitle: string,
    workItemDescription: string,
    impactResult: ChangeImpactResult | null,
    risks: RiskDetectionResult[]
  ): DecisionResult {
    const evidence: string[] = [];
    let type: DecisionType = 'ai_auto';
    let reason = '';
    let requiredApprover: string | undefined;
    let aiProposal: string | undefined;

    // 规则 1：破坏性变更 → 人必须审
    if (impactResult?.isBreaking) {
      type = 'human_required';
      reason = '包含破坏性变更';
      requiredApprover = 'tech_lead';
      evidence.push('破坏性变更检测');
    }

    // 规则 2：高风险 → 人必须审
    const highRisks = risks.filter(
      (r) => r.level === 'high' || r.level === 'critical'
    );
    if (highRisks.length > 0) {
      type = 'human_required';
      reason = `检测到 ${highRisks.length} 个高风险项`;
      requiredApprover = highRisks.some((r) => r.category === 'security')
        ? 'security_lead'
        : 'tech_lead';
      evidence.push(
        `高风险: ${highRisks.map((r) => r.description).join(', ')}`
      );
    }

    // 规则 3：影响范围大 → AI 出方案人确认
    if (
      impactResult &&
      impactResult.impactLevel === 'high' &&
      type !== 'human_required'
    ) {
      type = 'ai_propose_human_confirm';
      reason = `影响 ${impactResult.affectedModules.length} 个模块`;
      evidence.push(`影响范围: ${impactResult.description}`);
    }

    // 规则 4：中等风险 → AI 出方案人确认
    const mediumRisks = risks.filter((r) => r.level === 'medium');
    if (mediumRisks.length > 0 && type === 'ai_auto') {
      type = 'ai_propose_human_confirm';
      reason = `检测到 ${mediumRisks.length} 个中风险项`;
      evidence.push(
        `中风险: ${mediumRisks.map((r) => r.description).join(', ')}`
      );
    }

    // 规则 5：简单任务 → AI 自决
    if (type === 'ai_auto') {
      reason = '低风险、低影响范围，AI 可自主决策';
      evidence.push('无高风险或破坏性变更');
      aiProposal = `根据分析，此任务可自动执行：${workItemTitle}`;
    }

    // 生成 AI 建议
    if (type === 'ai_propose_human_confirm') {
      aiProposal = `建议方案：${workItemTitle}\n${reason}\n\n请确认后执行。`;
    }

    logger.info('决策分级完成', { type, reason, workItemTitle });

    return {
      type,
      reason,
      requiredApprover,
      aiProposal,
      evidence,
    };
  }
}

// ==================== 4. 异常升级 ====================

/**
 * 异常升级管理器
 *
 * 当工作项执行卡住时自动判断升级方向：
 * - 不静默卡死
 * - 不反复骚扰用户
 * - 根据异常类型和次数智能升级
 */
export class EscalationManager {
  /** 异常记录 */
  private escalations: Map<string, EscalationRequest[]> = new Map();

  /** 升级策略 */
  private readonly escalationPolicy = {
    maxRetries: 3, // 最大重试次数
    retryDelayMs: 5000, // 重试延迟
    cooldownMs: 30000, // 冷却时间（避免反复骚扰）
    maxAutoEscalations: 2, // 最大自动升级次数
  };

  /**
   * 记录异常
   */
  recordEscalation(
    workItemId: string,
    type: EscalationType,
    description: string,
    suggestedDirection: string
  ): EscalationRequest {
    const existing = this.escalations.get(workItemId) || [];

    const request: EscalationRequest = {
      type,
      workItemId,
      description,
      occurrenceCount: existing.filter((e) => e.type === type).length + 1,
      lastOccurrence: Date.now(),
      suggestedDirection,
    };

    existing.push(request);
    this.escalations.set(workItemId, existing);

    logger.warn('异常升级记录', {
      workItemId,
      type,
      occurrenceCount: request.occurrenceCount,
    });

    return request;
  }

  /**
   * 判断是否需要升级
   */
  shouldEscalate(workItemId: string, type: EscalationType): boolean {
    const existing = this.escalations.get(workItemId) || [];
    const sameType = existing.filter((e) => e.type === type);

    // 同类型异常超过最大重试次数
    if (sameType.length >= this.escalationPolicy.maxRetries) {
      return true;
    }

    // 检查冷却时间
    const now = Date.now();
    const recentEscalations = existing.filter(
      (e) => now - e.lastOccurrence < this.escalationPolicy.cooldownMs
    );
    if (recentEscalations.length >= this.escalationPolicy.maxAutoEscalations) {
      return true;
    }

    return false;
  }

  /**
   * 获取升级建议
   */
  getEscalationAdvice(workItemId: string): string {
    const existing = this.escalations.get(workItemId) || [];
    if (existing.length === 0) return '';

    const lastEscalation = existing[existing.length - 1];
    const totalCount = existing.length;

    if (totalCount >= this.escalationPolicy.maxRetries * 2) {
      return `工作项 ${workItemId} 已多次异常（${totalCount} 次），建议暂停并人工介入排查根因`;
    }

    if (lastEscalation.occurrenceCount >= this.escalationPolicy.maxRetries) {
      return `工作项 ${workItemId} 的 ${lastEscalation.type} 异常已重复 ${lastEscalation.occurrenceCount} 次，建议：${lastEscalation.suggestedDirection}`;
    }

    return lastEscalation.suggestedDirection;
  }

  /** 清除工作项的异常记录 */
  clearEscalations(workItemId: string): void {
    this.escalations.delete(workItemId);
  }

  /** 获取所有活跃异常 */
  getActiveEscalations(): EscalationRequest[] {
    const active: EscalationRequest[] = [];
    for (const requests of this.escalations.values()) {
      if (requests.length > 0) {
        active.push(requests[requests.length - 1]);
      }
    }
    return active;
  }
}

// ==================== 5. 资源争用自动调度 ====================

/**
 * 资源争用调度器
 *
 * 当多个工作项争用同一资源时自动排队：
 * - 优先级排序
 * - 预估等待时间
 * - 允许插队
 */
export class ResourceScheduler {
  /** 资源锁 */
  private resourceLocks: Map<string, string> = new Map();

  /** 等待队列 */
  private waitQueue: Map<string, ResourceScheduleItem[]> = new Map();

  /** 资源 → 工作项优先级映射 */
  private resourcePriorities: Map<string, Map<string, number>> = new Map();

  /**
   * 请求资源
   * @returns 调度结果（是否获得资源，排队位置等）
   */
  requestResource(
    workItemId: string,
    resources: string[],
    priority: number
  ): ResourceScheduleItem[] {
    const results: ResourceScheduleItem[] = [];

    for (const resource of resources) {
      // 资源可用
      if (!this.resourceLocks.has(resource)) {
        this.resourceLocks.set(resource, workItemId);
        results.push({
          workItemId,
          priority,
          requiredResources: [resource],
          queuePosition: 0,
          estimatedWaitMs: 0,
          canJumpQueue: false,
        });
        continue;
      }

      // 资源已被占用，加入等待队列
      if (!this.waitQueue.has(resource)) {
        this.waitQueue.set(resource, []);
      }

      const queue = this.waitQueue.get(resource)!;
      const position = queue.length + 1;

      const item: ResourceScheduleItem = {
        workItemId,
        priority,
        requiredResources: [resource],
        queuePosition: position,
        estimatedWaitMs: this.estimateWaitTime(resource, position),
        canJumpQueue: priority > (queue[0]?.priority || 0),
      };

      queue.push(item);
      // 按优先级排序
      queue.sort((a, b) => b.priority - a.priority);

      results.push(item);
    }

    logger.info('资源调度完成', {
      workItemId,
      resources,
      acquired: results
        .filter((r) => r.queuePosition === 0)
        .map((r) => r.requiredResources),
      queued: results
        .filter((r) => r.queuePosition > 0)
        .map((r) => r.requiredResources),
    });

    return results;
  }

  /**
   * 释放资源
   */
  releaseResource(resource: string, workItemId: string): void {
    if (this.resourceLocks.get(resource) === workItemId) {
      this.resourceLocks.delete(resource);

      // 从等待队列中取出下一个
      const queue = this.waitQueue.get(resource);
      if (queue && queue.length > 0) {
        const next = queue.shift()!;
        this.resourceLocks.set(resource, next.workItemId);
        logger.info('资源已分配给下一个等待者', {
          resource,
          nextWorkItem: next.workItemId,
        });
      }
    }
  }

  /**
   * 插队（高优先级工作项）
   */
  jumpQueue(workItemId: string, resource: string, priority: number): boolean {
    const queue = this.waitQueue.get(resource);
    if (!queue) return false;

    const existingIndex = queue.findIndex(
      (item) => item.workItemId === workItemId
    );
    if (existingIndex === -1) return false;

    // 提升优先级到队首
    const item = queue.splice(existingIndex, 1)[0];
    item.priority = priority;
    queue.unshift(item);

    logger.info('工作项插队成功', { workItemId, resource, priority });
    return true;
  }

  /** 预估等待时间 */
  private estimateWaitTime(resource: string, position: number): number {
    // 简单估算：每个前面的工作项平均需要 5 分钟
    const avgTimePerItem = 5 * 60 * 1000;
    return position * avgTimePerItem;
  }

  /** 获取资源使用状态 */
  getResourceStatus(): Array<{
    resource: string;
    lockedBy: string | null;
    queueLength: number;
  }> {
    const allResources = new Set<string>();
    for (const key of this.resourceLocks.keys()) allResources.add(key);
    for (const key of this.waitQueue.keys()) allResources.add(key);

    return [...allResources].map((resource) => ({
      resource,
      lockedBy: this.resourceLocks.get(resource) || null,
      queueLength: this.waitQueue.get(resource)?.length || 0,
    }));
  }
}

// ==================== 全局单例导出 ====================

export const changeImpactAnalyzer = new ChangeImpactAnalyzer();
export const riskDetector = new RiskDetector();
export const decisionClassifier = new DecisionClassifier();
export const escalationManager = new EscalationManager();
export const resourceScheduler = new ResourceScheduler();

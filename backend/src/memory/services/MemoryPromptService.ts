/**
 * 记忆提示服务
 * 负责生成记忆提示和使用指导
 */

import { Memory } from '../types/Memory';
import { MemoryType } from '../types/MemoryType';
import { MemoryManager } from '../MemoryManager';

/**
 * 记忆提示类型
 */
export enum MemoryPromptType {
  USAGE_GUIDANCE = 'usage_guidance',
  MEMORY_SUGGESTION = 'memory_suggestion',
  ORGANIZATION_TIPS = 'organization_tips',
  RETRIEVAL_HELP = 'retrieval_help',
  MAINTENANCE_ADVICE = 'maintenance_advice',
}

/**
 * 记忆提示接口
 */
export interface MemoryPrompt {
  id: string;
  type: MemoryPromptType;
  title: string;
  content: string;
  relevance: number; // 0-1
  timestamp: Date;
  tags?: string[];
}

/**
 * 记忆提示服务
 */
export class MemoryPromptService {
  private memoryManager: MemoryManager;
  private promptsCache: Map<string, MemoryPrompt[]> = new Map();

  /**
   * 构造函数
   * @param memoryManager 记忆管理器
   */
  constructor(memoryManager: MemoryManager) {
    this.memoryManager = memoryManager;
  }

  /**
   * 生成记忆提示
   * @param context 上下文信息
   * @returns 记忆提示列表
   */
  async generatePrompts(context: {
    userActions?: string[];
    recentMemories?: Memory[];
    currentTask?: string;
    query?: string;
  }): Promise<MemoryPrompt[]> {
    const prompts: MemoryPrompt[] = [];

    // 生成使用指导提示
    prompts.push(...await this.generateUsageGuidance());

    // 生成记忆建议提示
    if (context.userActions) {
      prompts.push(...await this.generateMemorySuggestions(context.userActions));
    }

    // 生成组织提示
    prompts.push(...await this.generateOrganizationTips());

    // 生成检索帮助提示
    if (context.query) {
      prompts.push(...await this.generateRetrievalHelp(context.query));
    }

    // 生成维护建议
    prompts.push(...await this.generateMaintenanceAdvice());

    // 按相关性排序
    prompts.sort((a, b) => b.relevance - a.relevance);

    // 限制返回数量
    return prompts.slice(0, 5);
  }

  /**
   * 生成使用指导提示
   * @returns 使用指导提示
   */
  private async generateUsageGuidance(): Promise<MemoryPrompt[]> {
    const prompts: MemoryPrompt[] = [
      {
        id: `usage_${Date.now()}`,
        type: MemoryPromptType.USAGE_GUIDANCE,
        title: '如何有效使用记忆系统',
        content: `记忆系统可以帮助你：\n\n` +
          `1. **保存重要信息**：用户偏好、项目上下文、决策理由等\n` +
          `2. **组织记忆**：按类型（用户、反馈、项目、参考）分类\n` +
          `3. **定期回顾**：保持记忆的准确性和相关性\n` +
          `4. **使用搜索**：快速找到相关记忆\n\n` +
          `提示：使用清晰的标题和描述，保持记忆内容简洁明了。`,
        relevance: 0.8,
        timestamp: new Date(),
        tags: ['guidance', 'usage'],
      },
    ];

    return prompts;
  }

  /**
   * 生成记忆建议提示
   * @param userActions 用户行为
   * @returns 记忆建议提示
   */
  private async generateMemorySuggestions(userActions: string[]): Promise<MemoryPrompt[]> {
    const prompts: MemoryPrompt[] = [];

    // 分析用户行为，生成相关建议
    if (userActions.includes('corrected_answer')) {
      prompts.push({
        id: `suggestion_${Date.now()}`,
        type: MemoryPromptType.MEMORY_SUGGESTION,
        title: '保存用户更正',
        content: '用户刚刚更正了你的回答，建议将这个更正保存为反馈类型的记忆，以便在未来的对话中参考。',
        relevance: 0.9,
        timestamp: new Date(),
        tags: ['suggestion', 'feedback'],
      });
    }

    if (userActions.includes('asked_repeated_question')) {
      prompts.push({
        id: `suggestion_${Date.now() + 1}`,
        type: MemoryPromptType.MEMORY_SUGGESTION,
        title: '保存常见问题',
        content: '用户重复询问了类似问题，建议将相关信息保存为参考类型的记忆，以便快速回答。',
        relevance: 0.85,
        timestamp: new Date(),
        tags: ['suggestion', 'reference'],
      });
    }

    if (userActions.includes('provided_preference')) {
      prompts.push({
        id: `suggestion_${Date.now() + 2}`,
        type: MemoryPromptType.MEMORY_SUGGESTION,
        title: '保存用户偏好',
        content: '用户提供了新的偏好信息，建议将其保存为用户类型的记忆，以便个性化服务。',
        relevance: 0.8,
        timestamp: new Date(),
        tags: ['suggestion', 'user'],
      });
    }

    return prompts;
  }

  /**
   * 生成组织提示
   * @returns 组织提示
   */
  private async generateOrganizationTips(): Promise<MemoryPrompt[]> {
    const stats = await this.memoryManager.getMemoryStats();
    const prompts: MemoryPrompt[] = [];

    // 基于记忆统计信息生成组织建议
    if (stats.total > 50) {
      prompts.push({
        id: `org_${Date.now()}`,
        type: MemoryPromptType.ORGANIZATION_TIPS,
        title: '优化记忆组织',
        content: `你的记忆库已有 ${stats.total} 条记忆，建议：\n\n` +
          `1. **定期清理**：删除过时或重复的记忆\n` +
          `2. **使用标签**：为记忆添加相关标签，便于分类和搜索\n` +
          `3. **整理结构**：按主题或项目组织记忆文件\n` +
          `4. **更新描述**：确保记忆标题和描述准确反映内容`,
        relevance: 0.75,
        timestamp: new Date(),
        tags: ['organization', 'tips'],
      });
    }

    // 检查记忆类型分布
    const typeDistribution = Object.entries(stats.byType);
    const dominantType = typeDistribution.reduce((max, [type, count]) => 
      count > max.count ? { type, count } : max, 
      { type: '', count: 0 }
    );

    if (dominantType.count > stats.total * 0.7) {
      prompts.push({
        id: `org_${Date.now() + 1}`,
        type: MemoryPromptType.ORGANIZATION_TIPS,
        title: '平衡记忆类型',
        content: `你的记忆主要集中在 ${dominantType.type} 类型，建议丰富其他类型的记忆，如：\n\n` +
          `1. **用户记忆**：保存用户偏好和背景信息\n` +
          `2. **反馈记忆**：记录用户反馈和更正\n` +
          `3. **项目记忆**：存储项目相关信息和决策\n` +
          `4. **参考记忆**：整理常用参考资料`,
        relevance: 0.7,
        timestamp: new Date(),
        tags: ['organization', 'balance'],
      });
    }

    return prompts;
  }

  /**
   * 生成检索帮助提示
   * @param query 搜索查询
   * @returns 检索帮助提示
   */
  private async generateRetrievalHelp(query: string): Promise<MemoryPrompt[]> {
    const prompts: MemoryPrompt[] = [
      {
        id: `retrieval_${Date.now()}`,
        type: MemoryPromptType.RETRIEVAL_HELP,
        title: '优化搜索查询',
        content: `为了获得更准确的记忆检索结果，建议：\n\n` +
          `1. **使用具体关键词**：避免使用过于宽泛的词汇\n` +
          `2. **包含相关标签**：如 #project, #user, #feedback 等\n` +
          `3. **使用语义相关词**：尝试不同但相关的表达方式\n` +
          `4. **限定时间范围**：对于时间敏感的记忆`,
        relevance: 0.8,
        timestamp: new Date(),
        tags: ['retrieval', 'search'],
      },
    ];

    // 基于查询内容提供具体建议
    if (query.includes('project')) {
      prompts.push({
        id: `retrieval_${Date.now() + 1}`,
        type: MemoryPromptType.RETRIEVAL_HELP,
        title: '项目记忆检索',
        content: '尝试使用项目名称、项目相关标签或具体项目阶段作为搜索关键词，以找到更相关的项目记忆。',
        relevance: 0.85,
        timestamp: new Date(),
        tags: ['retrieval', 'project'],
      });
    }

    if (query.includes('user')) {
      prompts.push({
        id: `retrieval_${Date.now() + 2}`,
        type: MemoryPromptType.RETRIEVAL_HELP,
        title: '用户记忆检索',
        content: '尝试使用用户相关关键词、偏好或行为描述作为搜索词，以找到相关的用户记忆。',
        relevance: 0.85,
        timestamp: new Date(),
        tags: ['retrieval', 'user'],
      });
    }

    return prompts;
  }

  /**
   * 生成维护建议
   * @returns 维护建议
   */
  private async generateMaintenanceAdvice(): Promise<MemoryPrompt[]> {
    const prompts: MemoryPrompt[] = [
      {
        id: `maintenance_${Date.now()}`,
        type: MemoryPromptType.MAINTENANCE_ADVICE,
        title: '记忆系统维护',
        content: `定期维护记忆系统可以提高其有效性：\n\n` +
          `1. **清理过期记忆**：删除不再相关的记忆\n` +
          `2. **更新记忆内容**：确保记忆信息保持最新\n` +
          `3. **备份记忆数据**：定期备份以防止数据丢失\n` +
          `4. **重建索引**：定期重建搜索索引以提高检索性能`,
        relevance: 0.6,
        timestamp: new Date(),
        tags: ['maintenance', 'advice'],
      },
    ];

    return prompts;
  }

  /**
   * 获取记忆使用统计
   * @returns 记忆使用统计
   */
  async getMemoryUsageStats(): Promise<{
    totalMemories: number;
    memoryTypes: Record<MemoryType, number>;
    recentMemories: number;
    averageMemorySize: number;
  }> {
    const stats = await this.memoryManager.getMemoryStats();
    const allMemories = await this.memoryManager.getAllMemories();

    // 计算平均记忆大小
    const totalSize = stats.totalSize;
    const averageSize = stats.total > 0 ? totalSize / stats.total : 0;

    return {
      totalMemories: stats.total,
      memoryTypes: stats.byType,
      recentMemories: stats.recent,
      averageMemorySize: averageSize,
    };
  }

  /**
   * 清除提示缓存
   */
  clearCache(): void {
    this.promptsCache.clear();
  }

  /**
   * 获取缓存的提示
   * @param key 缓存键
   * @returns 缓存的提示
   */
  getCachedPrompts(key: string): MemoryPrompt[] | undefined {
    return this.promptsCache.get(key);
  }

  /**
   * 缓存提示
   * @param key 缓存键
   * @param prompts 提示列表
   */
  cachePrompts(key: string, prompts: MemoryPrompt[]): void {
    this.promptsCache.set(key, prompts);
  }
}

/**
 * 创建记忆提示服务实例
 * @param memoryManager 记忆管理器
 * @returns 记忆提示服务实例
 */
export function createMemoryPromptService(memoryManager: MemoryManager): MemoryPromptService {
  return new MemoryPromptService(memoryManager);
}
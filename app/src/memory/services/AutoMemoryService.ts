/**
 * 自动记忆服务
 * 负责自动识别和创建记忆
 */

import { Memory } from '../types/Memory';
import { MemoryType } from '../types/MemoryType';

/** MemoryManager 最小接口（避免循环依赖） */
interface MemoryManager {
  updateMemory(id: string, updates: Partial<Memory>): Promise<Memory>;
  createMemory(
    memory: Omit<Memory, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<Memory>;
  getAllMemories(): Promise<Memory[]>;
}
import type { AIService } from '@modules/ai';
import { Logger, LogLevel } from '@modules/monitoring';
import type { KnowledgeBaseWriter } from './KnowledgeBaseWriter';

/**
 * 自动记忆触发类型
 */
export enum AutoMemoryTriggerType {
  USER_CORRECTION = 'user_correction',
  REPEATED_QUESTION = 'repeated_question',
  PREFERENCE_STATEMENT = 'preference_statement',
  IMPORTANT_INFORMATION = 'important_information',
  PROJECT_CONTEXT = 'project_context',
  EXPLICIT_REQUEST = 'explicit_request',
  USER_FACT = 'user_fact',
}

/**
 * 自动记忆配置
 */
export interface AutoMemoryConfig {
  enabled: boolean;
  minConfidence: number; // 0-1
  maxMemorySize: number; // 字符数
  maxMemoriesPerConversation: number;
  triggerTypes: AutoMemoryTriggerType[];
  useLLM?: boolean; // 是否使用 LLM 进行智能记忆检测
}

/**
 * 记忆提取结果
 */
export interface MemoryExtractionResult {
  content: string;
  title: string;
  type: MemoryType;
  confidence: number;
  trigger: AutoMemoryTriggerType;
  tags: string[];
}

/**
 * 自动记忆服务
 */
export class AutoMemoryService {
  private memoryManager: MemoryManager;
  private config: AutoMemoryConfig;
  private conversationMemories: Map<string, Memory[]> = new Map();
  private aiService: AIService | null = null;
  private logger: Logger;
  private knowledgeBaseWriter: KnowledgeBaseWriter | null = null;

  /**
   * 构造函数
   * @param memoryManager 记忆管理器
   * @param config 自动记忆配置
   * @param aiService 可选的 AI 服务，用于 LLM 驱动的记忆检测
   */
  constructor(
    memoryManager: MemoryManager,
    config: Partial<AutoMemoryConfig> = {},
    aiService?: AIService,
    knowledgeBaseWriter?: KnowledgeBaseWriter
  ) {
    this.memoryManager = memoryManager;
    this.aiService = aiService || null;
    this.knowledgeBaseWriter = knowledgeBaseWriter || null;
    this.config = {
      enabled: true,
      minConfidence: 0.7,
      maxMemorySize: 1000,
      maxMemoriesPerConversation: 5,
      triggerTypes: Object.values(AutoMemoryTriggerType),
      useLLM: false,
      ...config,
    };
    this.logger = new Logger({
      module: 'memory:services:autoMemory',
      level: LogLevel.INFO,
    });
  }

  /**
   * 设置知识库写入器
   */
  setKnowledgeBaseWriter(writer: KnowledgeBaseWriter): void {
    this.knowledgeBaseWriter = writer;
  }

  /**
   * 处理对话消息，自动创建记忆
   * @param conversationId 对话ID
   * @param messages 对话消息
   * @returns 创建的记忆列表
   */
  async processConversation(
    conversationId: string,
    messages: Array<{
      role: string;
      content: string;
      timestamp: Date;
    }>
  ): Promise<Memory[]> {
    if (!this.config.enabled) {
      return [];
    }

    // 分析消息，提取潜在记忆
    const extractions = this.extractPotentialMemories(messages);

    // 过滤低置信度的提取
    const filteredExtractions = extractions.filter(
      (extraction) => extraction.confidence >= this.config.minConfidence
    );

    // 检查对话记忆数量限制
    const existingMemories =
      this.conversationMemories.get(conversationId) || [];
    if (existingMemories.length >= this.config.maxMemoriesPerConversation) {
      return [];
    }

    // 创建记忆
    const createdMemories: Memory[] = [];
    for (const extraction of filteredExtractions) {
      // 检查是否已存在类似记忆
      const similarMemory = await this.findSimilarMemory(extraction.content);
      if (similarMemory) {
        // 更新现有记忆
        await this.memoryManager.updateMemory(similarMemory.id, {
          content: extraction.content,
          metadata: {
            ...similarMemory.metadata,
            tags: [...(similarMemory.metadata.tags || []), ...extraction.tags],
          },
        });
        createdMemories.push(similarMemory);
      } else {
        // 创建新记忆
        const memory = await this.memoryManager.createMemory({
          content: extraction.content,
          metadata: {
            name: extraction.title,
            description: `自动创建的记忆 - ${extraction.trigger}`,
            type: extraction.type,
            tags: extraction.tags,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        });
        createdMemories.push(memory);
      }
    }

    // 更新对话记忆记录
    if (createdMemories.length > 0) {
      const updatedMemories = [...existingMemories, ...createdMemories];
      this.conversationMemories.set(conversationId, updatedMemories);
    }

    // 将高置信度的重要信息同步到知识库
    if (this.knowledgeBaseWriter) {
      for (let i = 0; i < createdMemories.length; i++) {
        const extraction = filteredExtractions[i];
        if (
          extraction &&
          extraction.trigger === AutoMemoryTriggerType.IMPORTANT_INFORMATION &&
          extraction.confidence >= 0.8
        ) {
          await this.knowledgeBaseWriter.writeFromMemory(createdMemories[i]);
        }
      }
    }

    return createdMemories;
  }

  /**
   * 提取潜在记忆
   * @param messages 对话消息
   * @returns 记忆提取结果列表
   */
  private extractPotentialMemories(
    messages: Array<{
      role: string;
      content: string;
      timestamp: Date;
    }>
  ): MemoryExtractionResult[] {
    const results: MemoryExtractionResult[] = [];

    // 分析每条消息
    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];

      // 检查用户更正
      if (
        this.config.triggerTypes.includes(AutoMemoryTriggerType.USER_CORRECTION)
      ) {
        const correctionResult = this.detectUserCorrection(
          message,
          messages.slice(0, i)
        );
        if (correctionResult) {
          results.push(correctionResult);
        }
      }

      // 检查重复问题
      if (
        this.config.triggerTypes.includes(
          AutoMemoryTriggerType.REPEATED_QUESTION
        )
      ) {
        const repeatedResult = this.detectRepeatedQuestion(
          message,
          messages.slice(0, i)
        );
        if (repeatedResult) {
          results.push(repeatedResult);
        }
      }

      // 检查偏好声明
      if (
        this.config.triggerTypes.includes(
          AutoMemoryTriggerType.PREFERENCE_STATEMENT
        )
      ) {
        const preferenceResult = this.detectPreferenceStatement(message);
        if (preferenceResult) {
          results.push(preferenceResult);
        }
      }

      // 检查重要信息
      if (
        this.config.triggerTypes.includes(
          AutoMemoryTriggerType.IMPORTANT_INFORMATION
        )
      ) {
        const importantResult = this.detectImportantInformation(message);
        if (importantResult) {
          results.push(importantResult);
        }
      }

      // 检查项目上下文
      if (
        this.config.triggerTypes.includes(AutoMemoryTriggerType.PROJECT_CONTEXT)
      ) {
        const contextResult = this.detectProjectContext(message);
        if (contextResult) {
          results.push(contextResult);
        }
      }

      // 检查明确请求
      if (
        this.config.triggerTypes.includes(
          AutoMemoryTriggerType.EXPLICIT_REQUEST
        )
      ) {
        const requestResult = this.detectExplicitRequest(message);
        if (requestResult) {
          results.push(requestResult);
        }
      }

      // 检查用户个人信息声明（姓名、年龄、经历等事实性陈述）
      if (this.config.triggerTypes.includes(AutoMemoryTriggerType.USER_FACT)) {
        const factResult = this.detectUserFact(message);
        if (factResult) {
          results.push(factResult);
        }
      }
    }

    // 去重和排序
    return this.deduplicateAndSort(results);
  }

  /**
   * 检测用户更正
   * @param message 当前消息
   * @param previousMessages 之前的消息
   * @returns 记忆提取结果
   */
  private detectUserCorrection(
    message: { role: string; content: string; timestamp: Date },
    previousMessages: Array<{ role: string; content: string; timestamp: Date }>
  ): MemoryExtractionResult | null {
    if (message.role !== 'user') {
      return null;
    }

    // 检测更正关键词
    const correctionKeywords = [
      '不是',
      '不对',
      '错误',
      '纠正',
      '应该是',
      '实际上',
      '其实',
      '准确来说',
      'No',
      'not',
      'incorrect',
      'wrong',
      'actually',
      'correction',
      'should be',
    ];

    const hasCorrectionKeyword = correctionKeywords.some((keyword) =>
      message.content.toLowerCase().includes(keyword.toLowerCase())
    );

    if (!hasCorrectionKeyword) {
      return null;
    }

    // 查找相关的助手回复
    const assistantReplies = previousMessages.filter(
      (msg) => msg.role === 'assistant'
    );
    if (assistantReplies.length === 0) {
      return null;
    }

    const lastAssistantReply = assistantReplies[assistantReplies.length - 1];

    return {
      content: `用户对AI行为的要求：${message.content}\n\n上下文：${lastAssistantReply.content}`,
      title: '系统指令',
      type: MemoryType.CODE_PATTERN,
      confidence: 0.85,
      trigger: AutoMemoryTriggerType.USER_CORRECTION,
      tags: ['instruction', 'system', 'behavior'],
    };
  }

  /**
   * 检测重复问题
   * @param message 当前消息
   * @param previousMessages 之前的消息
   * @returns 记忆提取结果
   */
  private detectRepeatedQuestion(
    message: { role: string; content: string; timestamp: Date },
    previousMessages: Array<{ role: string; content: string; timestamp: Date }>
  ): MemoryExtractionResult | null {
    if (message.role !== 'user') {
      return null;
    }

    // 只处理问题
    if (
      !message.content.endsWith('?') &&
      !message.content.toLowerCase().includes('如何') &&
      !message.content.toLowerCase().includes('怎么') &&
      !message.content.toLowerCase().includes('what') &&
      !message.content.toLowerCase().includes('how')
    ) {
      return null;
    }

    // 查找类似的问题
    const similarQuestions = previousMessages.filter((msg) => {
      if (msg.role !== 'user') return false;

      // 简单的相似度检测
      const similarity = this.calculateSimilarity(message.content, msg.content);
      return similarity > 0.6;
    });

    if (similarQuestions.length === 0) {
      return null;
    }

    return {
      content: message.content,
      title: '常见问题',
      type: MemoryType.DECISION,
      confidence: 0.75,
      trigger: AutoMemoryTriggerType.REPEATED_QUESTION,
      tags: ['question', 'reference', 'frequent'],
    };
  }

  /**
   * 检测偏好声明
   * @param message 当前消息
   * @returns 记忆提取结果
   */
  private detectPreferenceStatement(message: {
    role: string;
    content: string;
    timestamp: Date;
  }): MemoryExtractionResult | null {
    if (message.role !== 'user') {
      return null;
    }

    // 检测偏好关键词
    const preferenceKeywords = [
      '喜欢',
      '偏好',
      '希望',
      '想要',
      '不要',
      '避免',
      '更喜欢',
      'like',
      'prefer',
      'want',
      "don't want",
      'avoid',
      'would like',
    ];

    const hasPreferenceKeyword = preferenceKeywords.some((keyword) =>
      message.content.toLowerCase().includes(keyword.toLowerCase())
    );

    if (!hasPreferenceKeyword) {
      return null;
    }

    return {
      content: message.content,
      title: '用户偏好',
      type: MemoryType.USER_PREFERENCE,
      confidence: 0.8,
      trigger: AutoMemoryTriggerType.PREFERENCE_STATEMENT,
      tags: ['preference', 'user', 'habit'],
    };
  }

  /**
   * 检测重要信息
   * @param message 当前消息
   * @returns 记忆提取结果
   */
  private detectImportantInformation(message: {
    role: string;
    content: string;
    timestamp: Date;
  }): MemoryExtractionResult | null {
    // 检测重要性关键词
    const importantKeywords = [
      '重要',
      '关键',
      '注意',
      '记住',
      '务必',
      '必须',
      'important',
      'key',
      'note',
      'remember',
      'must',
      'critical',
    ];

    const hasImportantKeyword = importantKeywords.some((keyword) =>
      message.content.toLowerCase().includes(keyword.toLowerCase())
    );

    if (!hasImportantKeyword) {
      return null;
    }

    return {
      content: message.content,
      title: '重要信息',
      type: MemoryType.DECISION,
      confidence: 0.7,
      trigger: AutoMemoryTriggerType.IMPORTANT_INFORMATION,
      tags: ['important', 'reference', 'critical'],
    };
  }

  /**
   * 检测用户个人信息声明（姓名、经历、联系信息等事实性陈述）
   * 匹配模式如："姓名：彭云"、"我叫xxx"、"邮箱：xx@xx.com"、"2005年-2008年创业"
   */
  private detectUserFact(message: {
    role: string;
    content: string;
    timestamp: Date;
  }): MemoryExtractionResult | null {
    // 仅处理用户消息
    if (message.role !== 'user') {
      return null;
    }

    const text = message.content;

    // 个人信息声明模式
    const personalFactPatterns = [
      /姓名[：:]\s*\S+/,
      /我叫\s*\S+/,
      /我是\s*\S+/,
      /邮箱[：:]\s*\S+/,
      /电话[：:]\s*\S+/,
      /手机[：:]\s*\S+/,
      /github[：:]\s*\S+/i,
      /微信[：:]\s*\S+/,
      /城市[：:]\s*\S+/,
      /学历[：:]\s*\S+/,
      /学校[：:]\s*\S+/,
      /专业[：:]\s*\S+/,
      /公司[：:]\s*\S+/,
      /职位[：:]\s*\S+/,
      /毕业[：:]\s*\S+/,
      /\d{4}\s*年\s*[-~至到]\s*/,
      /\d{4}\s*[-~至到]\s*\d{4}\s*年/,
      /创业/,
      /工作经历/,
      /求职意向[：:]\s*\S+/,
      /技术栈[：:]/,
      /擅长[：:]/,
    ];

    const matched = personalFactPatterns.some((p) => p.test(text));
    if (!matched) {
      return null;
    }

    return {
      content: text,
      title: '用户身份信息',
      type: MemoryType.USER_FACT,
      confidence: 0.85,
      trigger: AutoMemoryTriggerType.USER_FACT,
      tags: ['identity', 'personal', 'profile'],
    };
  }

  /**
   * 检测项目上下文
   * @param message 当前消息
   * @returns 记忆提取结果
   */
  private detectProjectContext(message: {
    role: string;
    content: string;
    timestamp: Date;
  }): MemoryExtractionResult | null {
    // 检测项目相关关键词
    const projectKeywords = [
      '项目',
      '任务',
      '目标',
      '计划',
      '截止日期',
      '里程碑',
      'project',
      'task',
      'goal',
      'plan',
      'deadline',
      'milestone',
    ];

    const hasProjectKeyword = projectKeywords.some((keyword) =>
      message.content.toLowerCase().includes(keyword.toLowerCase())
    );

    if (!hasProjectKeyword) {
      return null;
    }

    return {
      content: message.content,
      title: '项目上下文',
      type: MemoryType.PROJECT_KNOWLEDGE,
      confidence: 0.75,
      trigger: AutoMemoryTriggerType.PROJECT_CONTEXT,
      tags: ['project', 'context', 'plan'],
    };
  }

  /**
   * 检测明确请求
   * @param message 当前消息
   * @returns 记忆提取结果
   */
  private detectExplicitRequest(message: {
    role: string;
    content: string;
    timestamp: Date;
  }): MemoryExtractionResult | null {
    if (message.role !== 'user') {
      return null;
    }

    // 检测明确请求关键词
    const requestKeywords = [
      '记住',
      '保存',
      '记录',
      '存储',
      'remember',
      'save',
      'record',
      'store',
    ];

    const hasRequestKeyword = requestKeywords.some((keyword) =>
      message.content.toLowerCase().includes(keyword.toLowerCase())
    );

    if (!hasRequestKeyword) {
      return null;
    }

    return {
      content: message.content,
      title: '用户明确要求记忆',
      type: MemoryType.USER_PREFERENCE,
      confidence: 0.9,
      trigger: AutoMemoryTriggerType.EXPLICIT_REQUEST,
      tags: ['request', 'user', 'explicit'],
    };
  }

  /**
   * 计算文本相似度
   * @param text1 文本1
   * @param text2 文本2
   * @returns 相似度分数 (0-1)
   */
  private calculateSimilarity(text1: string, text2: string): number {
    // 简单的余弦相似度实现
    const words1 = text1.toLowerCase().split(/\s+/);
    const words2 = text2.toLowerCase().split(/\s+/);

    const wordSet = new Set([...words1, ...words2]);
    const vector1: number[] = Array.from(wordSet).map((word) =>
      words1.includes(word) ? 1 : 0
    );
    const vector2: number[] = Array.from(wordSet).map((word) =>
      words2.includes(word) ? 1 : 0
    );

    const dotProduct = vector1.reduce(
      (sum, val, i) => sum + val * vector2[i],
      0
    );
    const magnitude1 = Math.sqrt(
      vector1.reduce((sum, val) => sum + val * val, 0)
    );
    const magnitude2 = Math.sqrt(
      vector2.reduce((sum, val) => sum + val * val, 0)
    );

    if (magnitude1 === 0 || magnitude2 === 0) {
      return 0;
    }

    return dotProduct / (magnitude1 * magnitude2);
  }

  /**
   * 去重和排序提取结果
   * @param results 提取结果列表
   * @returns 去重和排序后的结果
   */
  private deduplicateAndSort(
    results: MemoryExtractionResult[]
  ): MemoryExtractionResult[] {
    // 去重
    const uniqueResults = new Map<string, MemoryExtractionResult>();
    for (const result of results) {
      const key = result.content.substring(0, 100); // 使用内容前100个字符作为键
      if (!uniqueResults.has(key)) {
        uniqueResults.set(key, result);
      }
    }

    // 按置信度排序
    return Array.from(uniqueResults.values()).sort(
      (a, b) => b.confidence - a.confidence
    );
  }

  /**
   * 查找类似的记忆（带时间窗口过滤和反向引用更新）
   * @param content 记忆内容
   * @returns 类似的记忆或null
   */
  private async findSimilarMemory(content: string): Promise<Memory | null> {
    const allMemories = await this.memoryManager.getAllMemories();
    const now = Date.now();
    const dedupWindowMs = 48 * 60 * 60 * 1000; // 48小时时间窗口

    for (const memory of allMemories) {
      const memoryAge = now - memory.updatedAt.getTime();
      // 时间窗口过滤：只比较 48 小时内的记忆
      if (memoryAge > dedupWindowMs) {
        const similarity = this.calculateSimilarity(content, memory.content);
        if (similarity > 0.85) {
          // 超过 48 小时的内容需要更高阈值才能认定为重复
          memory.updatedAt = new Date();
          await this.memoryManager.updateMemory(memory.id, memory);
          return memory;
        }
        continue;
      }

      const similarity = this.calculateSimilarity(content, memory.content);
      if (similarity > 0.7) {
        // 更新原记忆的更新时间，标记最近被引用过
        memory.updatedAt = new Date();
        await this.memoryManager.updateMemory(memory.id, memory);
        return memory;
      }
    }

    return null;
  }

  /**
   * 设置自动记忆配置
   * @param config 配置
   */
  setConfig(config: Partial<AutoMemoryConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 获取自动记忆配置
   * @returns 配置
   */
  getConfig(): AutoMemoryConfig {
    return { ...this.config };
  }

  /**
   * 清除对话记忆记录
   * @param conversationId 对话ID
   */
  clearConversationMemory(conversationId: string): void {
    this.conversationMemories.delete(conversationId);
  }

  /**
   * 清除所有对话记忆记录
   */
  clearAllConversationMemories(): void {
    this.conversationMemories.clear();
  }
}

/**
 * 创建自动记忆服务实例
 * @param memoryManager 记忆管理器
 * @param config 自动记忆配置
 * @returns 自动记忆服务实例
 */
export function createAutoMemoryService(
  memoryManager: MemoryManager,
  config: Partial<AutoMemoryConfig> = {}
): AutoMemoryService {
  return new AutoMemoryService(memoryManager, config);
}

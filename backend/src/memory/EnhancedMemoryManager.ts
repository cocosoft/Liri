/**
 * 增强记忆管理器
 * 提供高级记忆分析、关联和智能检索功能
 */

import type { 
  Memory, 
  MemoryMetadata,
  MemoryQuery,
  MemorySearchResult
} from './types/Memory.js';

import { 
  MemoryManager,
  MemoryStore,
  MemoryIndexer,
  MemoryRetriever 
} from './index.js';

export interface EnhancedMemoryManagerConfig {
  enableAdvancedAnalysis: boolean;
  enableMemoryAssociation: boolean;
  enableSmartRetrieval: boolean;
  enableLifecycleManagement: boolean;
  maxAssociationDepth: number;
  similarityThreshold: number;
  retentionPeriod: number; // 保留周期（天）
}

export interface MemoryAnalysis {
  memoryId: string;
  analysisId: string;
  semanticSimilarity: number;
  contextualRelevance: number;
  temporalProximity: number;
  associationStrength: number;
  overallScore: number;
  keyTopics: string[];
  sentiment: 'positive' | 'neutral' | 'negative';
  complexity: 'simple' | 'medium' | 'complex';
}

export interface MemoryAssociation {
  associationId: string;
  sourceMemoryId: string;
  targetMemoryId: string;
  associationType: 'semantic' | 'temporal' | 'contextual' | 'causal';
  strength: number;
  confidence: number;
  description: string;
  created: number;
}

export interface SmartRetrievalResult {
  memories: Memory[];
  analysis: MemoryAnalysis[];
  associations: MemoryAssociation[];
  recommendations: string[];
  confidence: number;
  retrievalStrategy: string;
}

export interface MemoryLifecycle {
  memoryId: string;
  created: number;
  lastAccessed: number;
  accessCount: number;
  relevanceScore: number;
  lifecycleStage: 'active' | 'archived' | 'expired' | 'deleted';
  retentionScore: number;
  nextReviewDate: number;
}

export class EnhancedMemoryManager {
  private config: EnhancedMemoryManagerConfig;
  private baseManager: MemoryManager;
  private memoryStore: MemoryStore;
  private memoryIndexer: MemoryIndexer;
  private memoryRetriever: MemoryRetriever;
  private memoryAssociations: Map<string, MemoryAssociation[]> = new Map();
  private memoryLifecycles: Map<string, MemoryLifecycle> = new Map();

  constructor(config?: Partial<EnhancedMemoryManagerConfig>) {
    this.config = {
      enableAdvancedAnalysis: true,
      enableMemoryAssociation: true,
      enableSmartRetrieval: true,
      enableLifecycleManagement: true,
      maxAssociationDepth: 3,
      similarityThreshold: 0.7,
      retentionPeriod: 365, // 默认1年
      ...config,
    };
    
    this.baseManager = new MemoryManager();
    this.memoryStore = new MemoryStore();
    this.memoryIndexer = new MemoryIndexer();
    this.memoryRetriever = new MemoryRetriever();
  }

  /**
   * 增强的记忆存储方法
   */
  async storeMemoryEnhanced(memory: Memory): Promise<{
    memoryId: string;
    analysis?: MemoryAnalysis;
    associations: MemoryAssociation[];
    lifecycle: MemoryLifecycle;
  }> {
    // 使用基础管理器存储记忆
    const memoryId = await this.baseManager.store(memory);
    
    // 高级分析
    let analysis: MemoryAnalysis | undefined;
    if (this.config.enableAdvancedAnalysis) {
      analysis = await this.analyzeMemory(memory);
    }

    // 记忆关联
    let associations: MemoryAssociation[] = [];
    if (this.config.enableMemoryAssociation) {
      associations = await this.associateMemory(memoryId, memory);
    }

    // 生命周期管理
    const lifecycle = this.createLifecycle(memoryId);

    return {
      memoryId,
      analysis,
      associations,
      lifecycle
    };
  }

  /**
   * 智能记忆检索
   */
  async retrieveMemoriesSmart(
    query: MemoryQuery,
    context?: Record<string, any>
  ): Promise<SmartRetrievalResult> {
    const startTime = Date.now();
    
    // 基础检索
    const memories = await this.memoryRetriever.retrieve(query);
    
    // 高级分析
    const analysis: MemoryAnalysis[] = [];
    const associations: MemoryAssociation[] = [];
    
    if (this.config.enableAdvancedAnalysis) {
      for (const memory of memories) {
        const memoryAnalysis = await this.analyzeMemory(memory);
        analysis.push(memoryAnalysis);
        
        // 获取关联记忆
        if (this.config.enableMemoryAssociation) {
          const memoryAssociations = this.getMemoryAssociations(memory.id);
          associations.push(...memoryAssociations);
        }
      }
    }

    // 生成推荐
    const recommendations = this.generateRecommendations(memories, analysis, context);
    
    // 计算置信度
    const confidence = this.calculateRetrievalConfidence(memories, analysis, query);
    
    // 确定检索策略
    const retrievalStrategy = this.determineRetrievalStrategy(query, memories.length);

    // 更新生命周期访问记录
    memories.forEach(memory => {
      this.updateLifecycleAccess(memory.id);
    });

    const endTime = Date.now();
    const retrievalTime = endTime - startTime;

    return {
      memories,
      analysis,
      associations,
      recommendations,
      confidence,
      retrievalStrategy: `${retrievalStrategy} (${retrievalTime}ms)`
    };
  }

  /**
   * 记忆分析
   */
  private async analyzeMemory(memory: Memory): Promise<MemoryAnalysis> {
    const analysis: MemoryAnalysis = {
      memoryId: memory.id,
      analysisId: `analysis-${memory.id}-${Date.now()}`,
      semanticSimilarity: this.calculateSemanticSimilarity(memory),
      contextualRelevance: this.calculateContextualRelevance(memory),
      temporalProximity: this.calculateTemporalProximity(memory),
      associationStrength: this.calculateAssociationStrength(memory),
      overallScore: 0,
      keyTopics: this.extractKeyTopics(memory),
      sentiment: this.analyzeSentiment(memory),
      complexity: this.assessComplexity(memory)
    };

    // 计算综合分数
    analysis.overallScore = this.calculateOverallScore(analysis);

    return analysis;
  }

  /**
   * 记忆关联
   */
  private async associateMemory(memoryId: string, memory: Memory): Promise<MemoryAssociation[]> {
    const associations: MemoryAssociation[] = [];
    
    // 获取现有记忆进行关联分析
    const existingMemories = await this.getAllMemories();
    
    for (const existingMemory of existingMemories) {
      if (existingMemory.id === memoryId) continue;
      
      const similarity = this.calculateMemorySimilarity(memory, existingMemory);
      
      if (similarity >= this.config.similarityThreshold) {
        const association = this.createAssociation(memoryId, existingMemory.id, similarity);
        associations.push(association);
      }
    }

    // 保存关联关系
    this.memoryAssociations.set(memoryId, associations);

    return associations;
  }

  /**
   * 计算记忆相似度
   */
  private calculateMemorySimilarity(memory1: Memory, memory2: Memory): number {
    let similarity = 0;
    
    // 内容相似度
    if (memory1.content && memory2.content) {
      const contentSimilarity = this.calculateTextSimilarity(memory1.content, memory2.content);
      similarity += contentSimilarity * 0.4;
    }
    
    // 元数据相似度
    if (memory1.metadata && memory2.metadata) {
      const metadataSimilarity = this.calculateMetadataSimilarity(memory1.metadata, memory2.metadata);
      similarity += metadataSimilarity * 0.3;
    }
    
    // 时间相似度
    const timeSimilarity = this.calculateTimeSimilarity(memory1.created, memory2.created);
    similarity += timeSimilarity * 0.3;
    
    return Math.min(similarity, 1);
  }

  /**
   * 计算文本相似度（简化实现）
   */
  private calculateTextSimilarity(text1: string, text2: string): number {
    // 简化实现：基于共同词汇的相似度
    const words1 = new Set(text1.toLowerCase().split(/\s+/));
    const words2 = new Set(text2.toLowerCase().split(/\s+/));
    
    const intersection = new Set([...words1].filter(word => words2.has(word)));
    const union = new Set([...words1, ...words2]);
    
    return union.size > 0 ? intersection.size / union.size : 0;
  }

  /**
   * 计算元数据相似度
   */
  private calculateMetadataSimilarity(metadata1: MemoryMetadata, metadata2: MemoryMetadata): number {
    let similarity = 0;
    let comparisonCount = 0;
    
    // 比较共同字段
    const fields = ['type', 'category', 'tags', 'priority'] as const;
    
    fields.forEach(field => {
      if (metadata1[field] && metadata2[field]) {
        if (metadata1[field] === metadata2[field]) {
          similarity += 0.25;
        }
        comparisonCount++;
      }
    });
    
    return comparisonCount > 0 ? similarity / comparisonCount : 0;
  }

  /**
   * 计算时间相似度
   */
  private calculateTimeSimilarity(time1: number, time2: number): number {
    const timeDiff = Math.abs(time1 - time2);
    const oneDay = 24 * 60 * 60 * 1000;
    
    // 时间差越小，相似度越高
    return Math.max(0, 1 - timeDiff / (30 * oneDay)); // 30天内的时间相似度
  }

  /**
   * 创建关联关系
   */
  private createAssociation(
    sourceId: string, 
    targetId: string, 
    strength: number
  ): MemoryAssociation {
    return {
      associationId: `assoc-${sourceId}-${targetId}-${Date.now()}`,
      sourceMemoryId: sourceId,
      targetMemoryId: targetId,
      associationType: this.determineAssociationType(strength),
      strength,
      confidence: strength * 0.8 + 0.2, // 基于强度计算置信度
      description: this.generateAssociationDescription(sourceId, targetId, strength),
      created: Date.now()
    };
  }

  /**
   * 确定关联类型
   */
  private determineAssociationType(strength: number): MemoryAssociation['associationType'] {
    if (strength > 0.8) return 'semantic';
    if (strength > 0.6) return 'contextual';
    if (strength > 0.4) return 'temporal';
    return 'causal';
  }

  /**
   * 生成关联描述
   */
  private generateAssociationDescription(
    sourceId: string, 
    targetId: string, 
    strength: number
  ): string {
    const type = this.determineAssociationType(strength);
    
    switch (type) {
      case 'semantic':
        return `高度相关的语义关联（强度: ${strength.toFixed(2)}）`;
      case 'contextual':
        return `上下文关联（强度: ${strength.toFixed(2)}）`;
      case 'temporal':
        return `时间关联（强度: ${strength.toFixed(2)}）`;
      case 'causal':
        return `可能的因果关系（强度: ${strength.toFixed(2)}）`;
      default:
        return `一般关联（强度: ${strength.toFixed(2)}）`;
    }
  }

  /**
   * 计算语义相似度
   */
  private calculateSemanticSimilarity(memory: Memory): number {
    // 简化实现：基于关键词匹配
    if (!memory.content) return 0;
    
    const keywords = ['重要', '关键', '核心', '主要', '重点'];
    let keywordCount = 0;
    
    keywords.forEach(keyword => {
      if (memory.content.includes(keyword)) {
        keywordCount++;
      }
    });
    
    return Math.min(keywordCount / keywords.length, 1);
  }

  /**
   * 计算上下文相关性
   */
  private calculateContextualRelevance(memory: Memory): number {
    // 简化实现：基于元数据完整性
    let relevance = 0;
    
    if (memory.metadata) {
      if (memory.metadata.type) relevance += 0.3;
      if (memory.metadata.category) relevance += 0.3;
      if (memory.metadata.tags && memory.metadata.tags.length > 0) relevance += 0.2;
      if (memory.metadata.priority) relevance += 0.2;
    }
    
    return Math.min(relevance, 1);
  }

  /**
   * 计算时间接近度
   */
  private calculateTemporalProximity(memory: Memory): number {
    const now = Date.now();
    const memoryAge = now - memory.created;
    const oneDay = 24 * 60 * 60 * 1000;
    
    // 记忆越新，接近度越高
    return Math.max(0, 1 - memoryAge / (30 * oneDay)); // 30天内的时间接近度
  }

  /**
   * 计算关联强度
   */
  private calculateAssociationStrength(memory: Memory): number {
    const associations = this.getMemoryAssociations(memory.id);
    
    if (associations.length === 0) return 0;
    
    const totalStrength = associations.reduce((sum, assoc) => sum + assoc.strength, 0);
    return totalStrength / associations.length;
  }

  /**
   * 提取关键主题
   */
  private extractKeyTopics(memory: Memory): string[] {
    const topics: string[] = [];
    
    if (!memory.content) return topics;
    
    // 简化实现：提取高频词汇
    const words = memory.content.toLowerCase().split(/\s+/);
    const wordCount = new Map<string, number>();
    
    words.forEach(word => {
      if (word.length > 2) { // 忽略短词
        wordCount.set(word, (wordCount.get(word) || 0) + 1);
      }
    });
    
    // 取频率最高的3个词
    const sortedWords = [...wordCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([word]) => word);
    
    return sortedWords;
  }

  /**
   * 分析情感
   */
  private analyzeSentiment(memory: Memory): MemoryAnalysis['sentiment'] {
    if (!memory.content) return 'neutral';
    
    const positiveWords = ['好', '优秀', '成功', '满意', '高兴'];
    const negativeWords = ['坏', '失败', '问题', '困难', '失望'];
    
    let positiveCount = 0;
    let negativeCount = 0;
    
    positiveWords.forEach(word => {
      if (memory.content!.includes(word)) positiveCount++;
    });
    
    negativeWords.forEach(word => {
      if (memory.content!.includes(word)) negativeCount++;
    });
    
    if (positiveCount > negativeCount) return 'positive';
    if (negativeCount > positiveCount) return 'negative';
    return 'neutral';
  }

  /**
   * 评估复杂度
   */
  private assessComplexity(memory: Memory): MemoryAnalysis['complexity'] {
    if (!memory.content) return 'simple';
    
    const contentLength = memory.content.length;
    const wordCount = memory.content.split(/\s+/).length;
    
    if (contentLength > 500 || wordCount > 100) return 'complex';
    if (contentLength > 200 || wordCount > 50) return 'medium';
    return 'simple';
  }

  /**
   * 计算综合分数
   */
  private calculateOverallScore(analysis: MemoryAnalysis): number {
    const weights = {
      semanticSimilarity: 0.3,
      contextualRelevance: 0.25,
      temporalProximity: 0.2,
      associationStrength: 0.25
    };
    
    return (
      analysis.semanticSimilarity * weights.semanticSimilarity +
      analysis.contextualRelevance * weights.contextualRelevance +
      analysis.temporalProximity * weights.temporalProximity +
      analysis.associationStrength * weights.associationStrength
    );
  }

  /**
   * 生成推荐
   */
  private generateRecommendations(
    memories: Memory[],
    analysis: MemoryAnalysis[],
    context?: Record<string, any>
  ): string[] {
    const recommendations: string[] = [];
    
    if (memories.length === 0) {
      recommendations.push('未找到相关记忆，建议扩展搜索条件');
      return recommendations;
    }
    
    // 基于分析结果生成推荐
    const highScoreMemories = analysis.filter(a => a.overallScore > 0.8);
    if (highScoreMemories.length > 0) {
      recommendations.push(`发现 ${highScoreMemories.length} 个高相关度记忆`);
    }
    
    const complexMemories = analysis.filter(a => a.complexity === 'complex');
    if (complexMemories.length > 0) {
      recommendations.push(`有 ${complexMemories.length} 个复杂记忆，可能需要详细分析`);
    }
    
    // 基于上下文生成推荐
    if (context?.searchType === 'learning') {
      recommendations.push('建议关注关联记忆以建立知识网络');
    }
    
    return recommendations;
  }

  /**
   * 计算检索置信度
   */
  private calculateRetrievalConfidence(
    memories: Memory[],
    analysis: MemoryAnalysis[],
    query: MemoryQuery
  ): number {
    if (memories.length === 0) return 0;
    
    // 基于记忆数量和质量计算置信度
    const avgScore = analysis.reduce((sum, a) => sum + a.overallScore, 0) / analysis.length;
    const quantityFactor = Math.min(memories.length / 10, 1); // 数量因子
    
    return Math.min(0.95, avgScore * 0.7 + quantityFactor * 0.3);
  }

  /**
   * 确定检索策略
   */
  private determineRetrievalStrategy(query: MemoryQuery, resultCount: number): string {
    if (resultCount === 0) return '无结果策略';
    if (resultCount <= 3) return '精确匹配策略';
    if (resultCount <= 10) return '标准检索策略';
    return '大规模检索策略';
  }

  /**
   * 创建生命周期
   */
  private createLifecycle(memoryId: string): MemoryLifecycle {
    const now = Date.now();
    const lifecycle: MemoryLifecycle = {
      memoryId,
      created: now,
      lastAccessed: now,
      accessCount: 0,
      relevanceScore: 0.5, // 初始分数
      lifecycleStage: 'active',
      retentionScore: 1.0, // 初始保留分数
      nextReviewDate: now + 7 * 24 * 60 * 60 * 1000 // 7天后复查
    };
    
    this.memoryLifecycles.set(memoryId, lifecycle);
    return lifecycle;
  }

  /**
   * 更新生命周期访问记录
   */
  private updateLifecycleAccess(memoryId: string): void {
    const lifecycle = this.memoryLifecycles.get(memoryId);
    if (lifecycle) {
      lifecycle.lastAccessed = Date.now();
      lifecycle.accessCount++;
      
      // 基于访问频率更新相关性分数
      lifecycle.relevanceScore = Math.min(1.0, 0.5 + (lifecycle.accessCount * 0.1));
    }
  }

  /**
   * 获取记忆关联
   */
  private getMemoryAssociations(memoryId: string): MemoryAssociation[] {
    return this.memoryAssociations.get(memoryId) || [];
  }

  /**
   * 获取所有记忆
   */
  private async getAllMemories(): Promise<Memory[]> {
    // 简化实现：返回空数组
    return [];
  }

  /**
   * 获取配置
   */
  getConfig(): EnhancedMemoryManagerConfig {
    return { ...this.config };
  }

  /**
   * 更新配置
   */
  updateConfig(newConfig: Partial<EnhancedMemoryManagerConfig>): void {
    Object.assign(this.config, newConfig);
  }

  /**
   * 清空关联数据
   */
  clearAssociations(): void {
    this.memoryAssociations.clear();
  }

  /**
   * 清空生命周期数据
   */
  clearLifecycles(): void {
    this.memoryLifecycles.clear();
  }
}
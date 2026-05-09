/**
 * 智能记忆分析器
 * 提供深度记忆分析、模式识别和知识图谱构建功能
 */

import type { Memory, MemoryMetadata, MemoryQuery } from './types/Memory.js';

export interface MemoryPattern {
  patternId: string;
  name: string;
  description: string;
  patternType: 'temporal' | 'semantic' | 'contextual' | 'behavioral';
  confidence: number;
  frequency: number;
  examples: string[];
  implications: string[];
}

export interface KnowledgeGraph {
  graphId: string;
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
  centrality: Record<string, number>;
  clusters: KnowledgeCluster[];
  density: number;
}

export interface KnowledgeNode {
  nodeId: string;
  memoryId: string;
  type: 'memory' | 'concept' | 'entity';
  label: string;
  weight: number;
  centrality: number;
  clusterId?: string;
}

export interface KnowledgeEdge {
  edgeId: string;
  sourceId: string;
  targetId: string;
  type: 'semantic' | 'temporal' | 'causal' | 'associative';
  weight: number;
  confidence: number;
  description: string;
}

export interface KnowledgeCluster {
  clusterId: string;
  name: string;
  description: string;
  nodes: string[];
  centroid: string;
  cohesion: number;
  size: number;
}

export interface MemoryInsight {
  insightId: string;
  type: 'pattern' | 'trend' | 'anomaly' | 'opportunity';
  title: string;
  description: string;
  confidence: number;
  impact: 'low' | 'medium' | 'high';
  evidence: string[];
  recommendations: string[];
  timestamp: number;
}

export class SmartMemoryAnalyzer {
  private memoryPatterns: Map<string, MemoryPattern> = new Map();
  private knowledgeGraphs: Map<string, KnowledgeGraph> = new Map();
  private analysisWindow: number = 30 * 24 * 60 * 60 * 1000; // 30天

  constructor() {
    this.initializeDefaultPatterns();
  }

  /**
   * 初始化默认记忆模式
   */
  private initializeDefaultPatterns(): void {
    const defaultPatterns: MemoryPattern[] = [
      {
        patternId: 'pattern-001',
        name: '学习曲线模式',
        description: '知识获取和技能提升的渐进模式',
        patternType: 'temporal',
        confidence: 0.8,
        frequency: 0.6,
        examples: ['技能学习记录', '知识积累过程'],
        implications: ['学习效率分析', '技能提升建议'],
      },
      {
        patternId: 'pattern-002',
        name: '问题解决模式',
        description: '问题识别、分析和解决的系统性模式',
        patternType: 'behavioral',
        confidence: 0.7,
        frequency: 0.5,
        examples: ['故障排除记录', '问题解决方案'],
        implications: ['问题解决效率', '方法论优化'],
      },
      {
        patternId: 'pattern-003',
        name: '知识关联模式',
        description: '不同知识点之间的关联和整合模式',
        patternType: 'semantic',
        confidence: 0.75,
        frequency: 0.4,
        examples: ['概念关联记录', '知识网络构建'],
        implications: ['知识整合', '学习路径优化'],
      },
    ];

    defaultPatterns.forEach((pattern) => {
      this.memoryPatterns.set(pattern.patternId, pattern);
    });
  }

  /**
   * 深度记忆分析
   */
  async analyzeMemoriesDeep(memories: Memory[]): Promise<{
    patterns: MemoryPattern[];
    insights: MemoryInsight[];
    knowledgeGraph?: KnowledgeGraph;
    summary: {
      totalMemories: number;
      patternMatches: number;
      insightCount: number;
      averageComplexity: number;
      knowledgeDensity: number;
    };
  }> {
    const patterns = this.analyzePatterns(memories);
    const insights = await this.generateInsights(memories, patterns);
    const knowledgeGraph =
      memories.length >= 5
        ? await this.buildKnowledgeGraph(memories)
        : undefined;

    const summary = {
      totalMemories: memories.length,
      patternMatches: patterns.length,
      insightCount: insights.length,
      averageComplexity: this.calculateAverageComplexity(memories),
      knowledgeDensity: knowledgeGraph ? knowledgeGraph.density : 0,
    };

    return {
      patterns,
      insights,
      knowledgeGraph,
      summary,
    };
  }

  /**
   * 分析记忆模式
   */
  private analyzePatterns(memories: Memory[]): MemoryPattern[] {
    const matchedPatterns: MemoryPattern[] = [];

    if (memories.length < 3) return matchedPatterns;

    // 分析时间模式
    const temporalPatterns = this.analyzeTemporalPatterns(memories);
    matchedPatterns.push(...temporalPatterns);

    // 分析语义模式
    const semanticPatterns = this.analyzeSemanticPatterns(memories);
    matchedPatterns.push(...semanticPatterns);

    // 分析行为模式
    const behavioralPatterns = this.analyzeBehavioralPatterns(memories);
    matchedPatterns.push(...behavioralPatterns);

    return matchedPatterns;
  }

  /**
   * 分析时间模式
   */
  private analyzeTemporalPatterns(memories: Memory[]): MemoryPattern[] {
    const patterns: MemoryPattern[] = [];

    // 检查学习曲线模式
    if (this.detectLearningCurve(memories)) {
      const pattern = this.memoryPatterns.get('pattern-001');
      if (pattern) {
        patterns.push({
          ...pattern,
          confidence: this.calculatePatternConfidence(memories, pattern),
        });
      }
    }

    // 检查周期性模式
    const periodicPattern = this.detectPeriodicPattern(memories);
    if (periodicPattern) {
      patterns.push(periodicPattern);
    }

    return patterns;
  }

  /**
   * 检测学习曲线
   */
  private detectLearningCurve(memories: Memory[]): boolean {
    if (memories.length < 5) return false;

    // 按时间排序
    const sortedMemories = [...memories].sort((a, b) => a.created - b.created);

    // 检查复杂度是否随时间增加
    let complexityIncrease = 0;
    for (let i = 1; i < sortedMemories.length; i++) {
      const prevComplexity = this.assessMemoryComplexity(sortedMemories[i - 1]);
      const currComplexity = this.assessMemoryComplexity(sortedMemories[i]);

      if (currComplexity > prevComplexity) {
        complexityIncrease++;
      }
    }

    return complexityIncrease >= sortedMemories.length * 0.6; // 60%以上复杂度增加
  }

  /**
   * 检测周期性模式
   */
  private detectPeriodicPattern(memories: Memory[]): MemoryPattern | null {
    if (memories.length < 7) return null;

    // 简化实现：检测每周模式
    const weeklyCount = this.countMemoriesByDayOfWeek(memories);
    const maxCount = Math.max(...Object.values(weeklyCount));
    const minCount = Math.min(...Object.values(weeklyCount));

    if (maxCount > minCount * 2) {
      // 最大数量是最小数量的2倍以上
      return {
        patternId: `periodic-${Date.now()}`,
        name: '周期性活动模式',
        description: '检测到每周特定时间的活动模式',
        patternType: 'temporal',
        confidence: 0.6,
        frequency: 0.3,
        examples: ['每周固定活动记录'],
        implications: ['活动规划优化', '时间管理建议'],
      };
    }

    return null;
  }

  /**
   * 按星期统计记忆数量
   */
  private countMemoriesByDayOfWeek(memories: Memory[]): Record<number, number> {
    const counts: Record<number, number> = {
      0: 0,
      1: 0,
      2: 0,
      3: 0,
      4: 0,
      5: 0,
      6: 0,
    };

    memories.forEach((memory) => {
      const dayOfWeek = new Date(memory.created).getDay();
      counts[dayOfWeek]++;
    });

    return counts;
  }

  /**
   * 分析语义模式
   */
  private analyzeSemanticPatterns(memories: Memory[]): MemoryPattern[] {
    const patterns: MemoryPattern[] = [];

    // 检查知识关联模式
    if (this.detectKnowledgeAssociation(memories)) {
      const pattern = this.memoryPatterns.get('pattern-003');
      if (pattern) {
        patterns.push({
          ...pattern,
          confidence: this.calculatePatternConfidence(memories, pattern),
        });
      }
    }

    // 检查主题集中模式
    const thematicPattern = this.detectThematicConcentration(memories);
    if (thematicPattern) {
      patterns.push(thematicPattern);
    }

    return patterns;
  }

  /**
   * 检测知识关联
   */
  private detectKnowledgeAssociation(memories: Memory[]): boolean {
    if (memories.length < 3) return false;

    // 检查记忆之间是否有共同主题
    const commonThemes = this.findCommonThemes(memories);
    return commonThemes.length >= 2; // 至少2个共同主题
  }

  /**
   * 检测主题集中
   */
  private detectThematicConcentration(
    memories: Memory[]
  ): MemoryPattern | null {
    const themes = this.extractAllThemes(memories);
    const themeCounts = this.countThemeOccurrences(themes);

    const dominantTheme = Object.entries(themeCounts).sort(
      (a, b) => b[1] - a[1]
    )[0];

    if (dominantTheme && dominantTheme[1] >= memories.length * 0.7) {
      // 70%以上
      return {
        patternId: `thematic-${Date.now()}`,
        name: '主题集中模式',
        description: `检测到"${dominantTheme[0]}"主题的高度集中`,
        patternType: 'semantic',
        confidence: 0.7,
        frequency: 0.4,
        examples: ['特定主题的密集学习记录'],
        implications: ['主题深度挖掘', '知识扩展建议'],
      };
    }

    return null;
  }

  /**
   * 分析行为模式
   */
  private analyzeBehavioralPatterns(memories: Memory[]): MemoryPattern[] {
    const patterns: MemoryPattern[] = [];

    // 检查问题解决模式
    if (this.detectProblemSolving(memories)) {
      const pattern = this.memoryPatterns.get('pattern-002');
      if (pattern) {
        patterns.push({
          ...pattern,
          confidence: this.calculatePatternConfidence(memories, pattern),
        });
      }
    }

    return patterns;
  }

  /**
   * 检测问题解决模式
   */
  private detectProblemSolving(memories: Memory[]): boolean {
    const problemKeywords = ['问题', '解决', '故障', '修复', '调试'];
    let problemCount = 0;

    memories.forEach((memory) => {
      if (memory.content) {
        problemKeywords.forEach((keyword) => {
          if (memory.content!.includes(keyword)) {
            problemCount++;
          }
        });
      }
    });

    return problemCount >= memories.length * 0.5; // 50%以上包含问题关键词
  }

  /**
   * 生成洞察
   */
  private async generateInsights(
    memories: Memory[],
    patterns: MemoryPattern[]
  ): Promise<MemoryInsight[]> {
    const insights: MemoryInsight[] = [];

    // 基于模式生成洞察
    patterns.forEach((pattern) => {
      const insight = this.generatePatternInsight(pattern, memories);
      if (insight) {
        insights.push(insight);
      }
    });

    // 生成趋势洞察
    const trendInsight = this.generateTrendInsight(memories);
    if (trendInsight) {
      insights.push(trendInsight);
    }

    // 生成异常洞察
    const anomalyInsight = this.generateAnomalyInsight(memories);
    if (anomalyInsight) {
      insights.push(anomalyInsight);
    }

    return insights;
  }

  /**
   * 生成模式洞察
   */
  private generatePatternInsight(
    pattern: MemoryPattern,
    memories: Memory[]
  ): MemoryInsight | null {
    if (pattern.confidence < 0.6) return null;

    return {
      insightId: `insight-${pattern.patternId}-${Date.now()}`,
      type: 'pattern',
      title: `发现"${pattern.name}"模式`,
      description: pattern.description,
      confidence: pattern.confidence,
      impact:
        pattern.confidence > 0.8
          ? 'high'
          : pattern.confidence > 0.6
            ? 'medium'
            : 'low',
      evidence: pattern.examples.slice(0, 3),
      recommendations: pattern.implications,
      timestamp: Date.now(),
    };
  }

  /**
   * 生成趋势洞察
   */
  private generateTrendInsight(memories: Memory[]): MemoryInsight | null {
    if (memories.length < 5) return null;

    const sortedMemories = [...memories].sort((a, b) => a.created - b.created);
    const complexityTrend = this.analyzeComplexityTrend(sortedMemories);

    if (complexityTrend.direction !== 'stable') {
      return {
        insightId: `trend-${Date.now()}`,
        type: 'trend',
        title: `记忆复杂度${complexityTrend.direction === 'increasing' ? '上升' : '下降'}趋势`,
        description: `检测到记忆内容复杂度${complexityTrend.direction === 'increasing' ? '逐渐增加' : '逐渐减少'}的趋势`,
        confidence: complexityTrend.strength,
        impact: complexityTrend.strength > 0.7 ? 'medium' : 'low',
        evidence: ['时间序列分析', '复杂度评估'],
        recommendations: [
          complexityTrend.direction === 'increasing'
            ? '考虑知识巩固和复习'
            : '可能需要挑战更复杂的内容',
        ],
        timestamp: Date.now(),
      };
    }

    return null;
  }

  /**
   * 生成异常洞察
   */
  private generateAnomalyInsight(memories: Memory[]): MemoryInsight | null {
    const anomalies = this.detectAnomalies(memories);

    if (anomalies.length > 0) {
      return {
        insightId: `anomaly-${Date.now()}`,
        type: 'anomaly',
        title: `检测到${anomalies.length}个记忆异常`,
        description: '发现记忆模式中的异常点，可能需要特别关注',
        confidence: 0.7,
        impact: 'medium',
        evidence: anomalies
          .slice(0, 3)
          .map((anomaly) => `异常记忆: ${anomaly.memoryId}`),
        recommendations: ['检查异常记忆的上下文', '分析异常原因'],
        timestamp: Date.now(),
      };
    }

    return null;
  }

  /**
   * 构建知识图谱
   */
  private async buildKnowledgeGraph(
    memories: Memory[]
  ): Promise<KnowledgeGraph> {
    const nodes: KnowledgeNode[] = [];
    const edges: KnowledgeEdge[] = [];

    // 创建记忆节点
    memories.forEach((memory) => {
      const node: KnowledgeNode = {
        nodeId: `node-${memory.id}`,
        memoryId: memory.id,
        type: 'memory',
        label: this.extractMemoryLabel(memory),
        weight: this.calculateNodeWeight(memory),
        centrality: 0,
      };
      nodes.push(node);
    });

    // 创建关联边
    for (let i = 0; i < memories.length; i++) {
      for (let j = i + 1; j < memories.length; j++) {
        const similarity = this.calculateMemorySimilarity(
          memories[i],
          memories[j]
        );

        if (similarity > 0.3) {
          // 相似度阈值
          const edge: KnowledgeEdge = {
            edgeId: `edge-${memories[i].id}-${memories[j].id}`,
            sourceId: `node-${memories[i].id}`,
            targetId: `node-${memories[j].id}`,
            type: this.determineEdgeType(similarity),
            weight: similarity,
            confidence: similarity * 0.8,
            description: `记忆关联 (相似度: ${similarity.toFixed(2)})`,
          };
          edges.push(edge);
        }
      }
    }

    // 计算中心性
    const centrality = this.calculateCentrality(nodes, edges);

    // 识别聚类
    const clusters = this.identifyClusters(nodes, edges);

    // 计算密度
    const density = this.calculateGraphDensity(nodes, edges);

    return {
      graphId: `graph-${Date.now()}`,
      nodes,
      edges,
      centrality,
      clusters,
      density,
    };
  }

  /**
   * 计算记忆相似度
   */
  private calculateMemorySimilarity(memory1: Memory, memory2: Memory): number {
    let similarity = 0;

    if (memory1.content && memory2.content) {
      const contentSimilarity = this.calculateTextSimilarity(
        memory1.content,
        memory2.content
      );
      similarity += contentSimilarity * 0.6;
    }

    if (memory1.metadata && memory2.metadata) {
      const metadataSimilarity = this.calculateMetadataSimilarity(
        memory1.metadata,
        memory2.metadata
      );
      similarity += metadataSimilarity * 0.4;
    }

    return Math.min(similarity, 1);
  }

  /**
   * 计算文本相似度
   */
  private calculateTextSimilarity(text1: string, text2: string): number {
    const words1 = new Set(text1.toLowerCase().split(/\s+/));
    const words2 = new Set(text2.toLowerCase().split(/\s+/));

    const intersection = new Set(
      [...words1].filter((word) => words2.has(word))
    );
    const union = new Set([...words1, ...words2]);

    return union.size > 0 ? intersection.size / union.size : 0;
  }

  /**
   * 计算元数据相似度
   */
  private calculateMetadataSimilarity(
    metadata1: MemoryMetadata,
    metadata2: MemoryMetadata
  ): number {
    let similarity = 0;
    let comparisonCount = 0;

    const fields = ['type', 'category', 'tags', 'priority'] as const;

    fields.forEach((field) => {
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
   * 确定边类型
   */
  private determineEdgeType(similarity: number): KnowledgeEdge['type'] {
    if (similarity > 0.7) return 'semantic';
    if (similarity > 0.5) return 'associative';
    if (similarity > 0.3) return 'temporal';
    return 'causal';
  }

  /**
   * 计算节点权重
   */
  private calculateNodeWeight(memory: Memory): number {
    let weight = 0.5; // 基础权重

    if (memory.content) {
      const complexity = this.assessMemoryComplexity(memory);
      weight += complexity * 0.3;
    }

    if (memory.metadata?.priority) {
      const priorityWeight =
        {
          low: 0.1,
          medium: 0.3,
          high: 0.5,
        }[memory.metadata.priority] || 0.1;
      weight += priorityWeight;
    }

    return Math.min(weight, 1);
  }

  /**
   * 提取记忆标签
   */
  private extractMemoryLabel(memory: Memory): string {
    if (memory.metadata?.title) {
      return memory.metadata.title;
    }

    if (memory.content) {
      const firstSentence = memory.content.split(/[.!?]/)[0];
      return firstSentence.length > 50
        ? firstSentence.substring(0, 47) + '...'
        : firstSentence;
    }

    return `记忆-${memory.id.substring(0, 8)}`;
  }

  /**
   * 计算中心性
   */
  private calculateCentrality(
    nodes: KnowledgeNode[],
    edges: KnowledgeEdge[]
  ): Record<string, number> {
    const centrality: Record<string, number> = {};

    nodes.forEach((node) => {
      const connectedEdges = edges.filter(
        (edge) => edge.sourceId === node.nodeId || edge.targetId === node.nodeId
      );

      centrality[node.nodeId] = connectedEdges.reduce(
        (sum, edge) => sum + edge.weight,
        0
      );
    });

    return centrality;
  }

  /**
   * 识别聚类
   */
  private identifyClusters(
    nodes: KnowledgeNode[],
    edges: KnowledgeEdge[]
  ): KnowledgeCluster[] {
    const clusters: KnowledgeCluster[] = [];

    // 简化实现：基于强连接识别聚类
    const visited = new Set<string>();

    nodes.forEach((node) => {
      if (!visited.has(node.nodeId)) {
        const clusterNodes = this.findConnectedNodes(
          node.nodeId,
          edges,
          visited
        );

        if (clusterNodes.length >= 2) {
          const cluster: KnowledgeCluster = {
            clusterId: `cluster-${clusters.length + 1}`,
            name: `知识聚类 ${clusters.length + 1}`,
            description: `包含 ${clusterNodes.length} 个相关记忆的知识聚类`,
            nodes: clusterNodes,
            centroid: this.findCentroid(clusterNodes, edges),
            cohesion: this.calculateClusterCohesion(clusterNodes, edges),
            size: clusterNodes.length,
          };
          clusters.push(cluster);
        }
      }
    });

    return clusters;
  }

  /**
   * 查找连通节点
   */
  private findConnectedNodes(
    startNodeId: string,
    edges: KnowledgeEdge[],
    visited: Set<string>
  ): string[] {
    const connected: string[] = [startNodeId];
    visited.add(startNodeId);

    const queue = [startNodeId];

    while (queue.length > 0) {
      const currentNodeId = queue.shift()!;

      edges.forEach((edge) => {
        if (edge.weight > 0.5) {
          // 强连接阈值
          const neighborId =
            edge.sourceId === currentNodeId
              ? edge.targetId
              : edge.targetId === currentNodeId
                ? edge.sourceId
                : null;

          if (neighborId && !visited.has(neighborId)) {
            connected.push(neighborId);
            visited.add(neighborId);
            queue.push(neighborId);
          }
        }
      });
    }

    return connected;
  }

  /**
   * 查找聚类中心
   */
  private findCentroid(nodeIds: string[], edges: KnowledgeEdge[]): string {
    let maxCentrality = -1;
    let centroid = nodeIds[0];

    nodeIds.forEach((nodeId) => {
      const centrality = edges.filter(
        (edge) => edge.sourceId === nodeId || edge.targetId === nodeId
      ).length;

      if (centrality > maxCentrality) {
        maxCentrality = centrality;
        centroid = nodeId;
      }
    });

    return centroid;
  }

  /**
   * 计算聚类内聚度
   */
  private calculateClusterCohesion(
    nodeIds: string[],
    edges: KnowledgeEdge[]
  ): number {
    const internalEdges = edges.filter(
      (edge) =>
        nodeIds.includes(edge.sourceId) && nodeIds.includes(edge.targetId)
    );

    const maxPossibleEdges = (nodeIds.length * (nodeIds.length - 1)) / 2;

    return maxPossibleEdges > 0 ? internalEdges.length / maxPossibleEdges : 0;
  }

  /**
   * 计算图密度
   */
  private calculateGraphDensity(
    nodes: KnowledgeNode[],
    edges: KnowledgeEdge[]
  ): number {
    const n = nodes.length;
    const maxPossibleEdges = (n * (n - 1)) / 2;

    return maxPossibleEdges > 0 ? edges.length / maxPossibleEdges : 0;
  }

  /**
   * 分析复杂度趋势
   */
  private analyzeComplexityTrend(memories: Memory[]): {
    direction: 'increasing' | 'decreasing' | 'stable';
    strength: number;
  } {
    if (memories.length < 3) return { direction: 'stable', strength: 0 };

    const complexities = memories.map((memory) =>
      this.assessMemoryComplexity(memory)
    );
    let increasingCount = 0;
    let decreasingCount = 0;

    for (let i = 1; i < complexities.length; i++) {
      if (complexities[i] > complexities[i - 1]) increasingCount++;
      if (complexities[i] < complexities[i - 1]) decreasingCount++;
    }

    const totalComparisons = complexities.length - 1;
    const increasingRatio = increasingCount / totalComparisons;
    const decreasingRatio = decreasingCount / totalComparisons;

    if (increasingRatio > 0.6)
      return { direction: 'increasing', strength: increasingRatio };
    if (decreasingRatio > 0.6)
      return { direction: 'decreasing', strength: decreasingRatio };
    return {
      direction: 'stable',
      strength: Math.max(increasingRatio, decreasingRatio),
    };
  }

  /**
   * 检测异常
   */
  private detectAnomalies(
    memories: Memory[]
  ): Array<{ memoryId: string; reason: string }> {
    const anomalies: Array<{ memoryId: string; reason: string }> = [];

    if (memories.length < 3) return anomalies;

    const complexities = memories.map((memory) =>
      this.assessMemoryComplexity(memory)
    );
    const avgComplexity =
      complexities.reduce((sum, c) => sum + c, 0) / complexities.length;

    memories.forEach((memory, index) => {
      const complexity = complexities[index];

      if (Math.abs(complexity - avgComplexity) > 0.3) {
        // 异常阈值
        anomalies.push({
          memoryId: memory.id,
          reason: `复杂度异常 (${complexity.toFixed(2)} vs 平均 ${avgComplexity.toFixed(2)})`,
        });
      }
    });

    return anomalies;
  }

  /**
   * 评估记忆复杂度
   */
  private assessMemoryComplexity(memory: Memory): number {
    if (!memory.content) return 0;

    const contentLength = memory.content.length;
    const wordCount = memory.content.split(/\s+/).length;

    // 基于长度和词汇量的复杂度评估
    const lengthComplexity = Math.min(contentLength / 1000, 1);
    const wordComplexity = Math.min(wordCount / 200, 1);

    return lengthComplexity * 0.6 + wordComplexity * 0.4;
  }

  /**
   * 计算平均复杂度
   */
  private calculateAverageComplexity(memories: Memory[]): number {
    if (memories.length === 0) return 0;

    const totalComplexity = memories.reduce(
      (sum, memory) => sum + this.assessMemoryComplexity(memory),
      0
    );

    return totalComplexity / memories.length;
  }

  /**
   * 计算模式置信度
   */
  private calculatePatternConfidence(
    memories: Memory[],
    pattern: MemoryPattern
  ): number {
    const baseConfidence = pattern.confidence;
    const memoryCountFactor = Math.min(memories.length / 10, 1);

    return Math.min(0.95, baseConfidence * 0.7 + memoryCountFactor * 0.3);
  }

  /**
   * 查找共同主题
   */
  private findCommonThemes(memories: Memory[]): string[] {
    const allThemes = this.extractAllThemes(memories);
    const themeCounts = this.countThemeOccurrences(allThemes);

    return Object.entries(themeCounts)
      .filter(([_, count]) => count >= memories.length * 0.5) // 50%以上记忆共享
      .map(([theme]) => theme);
  }

  /**
   * 提取所有主题
   */
  private extractAllThemes(memories: Memory[]): string[] {
    const themes: string[] = [];

    memories.forEach((memory) => {
      if (memory.content) {
        const memoryThemes = this.extractKeyThemes(memory.content);
        themes.push(...memoryThemes);
      }
    });

    return themes;
  }

  /**
   * 提取关键主题
   */
  private extractKeyThemes(text: string): string[] {
    // 简化实现：提取名词性词汇作为主题
    const words = text.toLowerCase().split(/\s+/);
    const nouns = words.filter((word) => word.length > 2); // 简单的名词过滤

    return [...new Set(nouns)].slice(0, 5); // 最多返回5个主题
  }

  /**
   * 统计主题出现次数
   */
  private countThemeOccurrences(themes: string[]): Record<string, number> {
    const counts: Record<string, number> = {};

    themes.forEach((theme) => {
      counts[theme] = (counts[theme] || 0) + 1;
    });

    return counts;
  }

  /**
   * 获取所有模式
   */
  getAllPatterns(): MemoryPattern[] {
    return Array.from(this.memoryPatterns.values());
  }

  /**
   * 添加自定义模式
   */
  addCustomPattern(pattern: Omit<MemoryPattern, 'patternId'>): void {
    const patternId = `custom-${Date.now()}`;
    this.memoryPatterns.set(patternId, {
      patternId,
      ...pattern,
    });
  }

  /**
   * 设置分析窗口
   */
  setAnalysisWindow(days: number): void {
    this.analysisWindow = days * 24 * 60 * 60 * 1000;
  }
}

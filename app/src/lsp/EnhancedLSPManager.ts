//
/**
 * 增强LSP管理器
 * 提供高级LSP功能、性能优化和智能诊断
 */

import type { LSPClient, LSPServerConfig, LSPConnection } from './types.js';

import type { LSPServerManager } from './LSPServerManager.js';
import { createLSPServerManager } from './LSPServerManager.js';
import { LSPClient as BaseLSPClient } from './LSPClient.js';
import type { LSPServerInstance } from './LSPServerInstance.js';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';

export interface EnhancedLSPManagerConfig {
  enableAdvancedFeatures: boolean;
  enablePerformanceOptimization: boolean;
  enableIntelligentDiagnostics: boolean;
  enableMultiLanguageSupport: boolean;
  maxConcurrentConnections: number;
  connectionTimeout: number; // 毫秒
  responseTimeout: number; // 毫秒
  cacheSize: number; // 缓存条目数
}

export interface LSPPerformanceMetrics {
  connectionId: string;
  language: string;
  responseTime: number;
  throughput: number; // 请求/秒
  errorRate: number;
  cacheHitRate: number;
  memoryUsage: number;
  lastActivity: number;
}

export interface IntelligentCompletion {
  completionId: string;
  text: string;
  type: 'keyword' | 'function' | 'variable' | 'class' | 'import' | 'snippet';
  relevance: number;
  confidence: number;
  context: string[];
  documentation?: string;
  examples?: string[];
  priority: 'low' | 'medium' | 'high';
}

export interface CodeAnalysisResult {
  analysisId: string;
  documentUri: string;
  language: string;
  complexity: number;
  qualityScore: number;
  issues: CodeIssue[];
  suggestions: CodeSuggestion[];
  metrics: CodeMetrics;
  timestamp: number;
}

export interface CodeIssue {
  issueId: string;
  type: 'error' | 'warning' | 'info' | 'hint';
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  location: {
    line: number;
    character: number;
    endLine?: number;
    endCharacter?: number;
  };
  code?: string;
  source?: string;
  suggestions: string[];
}

export interface CodeSuggestion {
  suggestionId: string;
  type: 'refactor' | 'optimize' | 'simplify' | 'document';
  description: string;
  code: string;
  confidence: number;
  effort: 'low' | 'medium' | 'high';
  impact: 'minor' | 'moderate' | 'major';
}

export interface CodeMetrics {
  linesOfCode: number;
  complexity: number;
  maintainability: number;
  duplication: number;
  testCoverage?: number;
  documentationCoverage?: number;
}

export interface LSPConnectionStatus {
  connectionId: string;
  language: string;
  status: 'connected' | 'connecting' | 'disconnected' | 'error';
  lastActivity: number;
  responseTime: number;
  errorCount: number;
  throughput: number;
}

export class EnhancedLSPManager {
  private config: EnhancedLSPManagerConfig;
  private baseManager: LSPServerManager;
  private performanceMetrics: Map<string, LSPPerformanceMetrics> = new Map();
  private connectionStatus: Map<string, LSPConnectionStatus> = new Map();
  private completionCache: Map<string, IntelligentCompletion[]> = new Map();
  private analysisCache: Map<string, CodeAnalysisResult> = new Map();

  constructor(config?: Partial<EnhancedLSPManagerConfig>) {
    this.config = {
      enableAdvancedFeatures: true,
      enablePerformanceOptimization: true,
      enableIntelligentDiagnostics: true,
      enableMultiLanguageSupport: true,
      maxConcurrentConnections: 5,
      connectionTimeout: 30000, // 30秒
      responseTimeout: 5000, // 5秒
      cacheSize: 1000,
      ...config,
    };

    this.baseManager = createLSPServerManager();
  }

  /**
   * 增强的LSP连接管理
   */
  async connectEnhanced(
    language: string,
    serverConfig: LSPServerConfig
  ): Promise<{
    connection: LSPConnection;
    status: LSPConnectionStatus;
    performance: LSPPerformanceMetrics;
  }> {
    const startTime = Date.now();

    // 检查并发连接限制
    if (
      this.getActiveConnectionCount() >= this.config.maxConcurrentConnections
    ) {
      throw new AppError(
        `超过最大并发连接数限制: ${this.config.maxConcurrentConnections}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    try {
      // 建立连接
      const connection = await (
        this.baseManager as unknown as {
          connect: (
            lang: string,
            config: LSPServerConfig
          ) => Promise<LSPConnection>;
        }
      ).connect(language, serverConfig);

      const connectionId = this.generateConnectionId(language);
      const connectionTime = Date.now() - startTime;

      // 初始化连接状态
      const status: LSPConnectionStatus = {
        connectionId,
        language,
        status: 'connected',
        lastActivity: Date.now(),
        responseTime: connectionTime,
        errorCount: 0,
        throughput: 0,
      };

      // 初始化性能指标
      const performance: LSPPerformanceMetrics = {
        connectionId,
        language,
        responseTime: connectionTime,
        throughput: 0,
        errorRate: 0,
        cacheHitRate: 0,
        memoryUsage: 0,
        lastActivity: Date.now(),
      };

      this.connectionStatus.set(connectionId, status);
      this.performanceMetrics.set(connectionId, performance);

      return {
        connection,
        status,
        performance,
      };
    } catch (error) {
      const connectionTime = Date.now() - startTime;

      // 记录连接失败
      const connectionId = this.generateConnectionId(language);
      const status: LSPConnectionStatus = {
        connectionId,
        language,
        status: 'error',
        lastActivity: Date.now(),
        responseTime: connectionTime,
        errorCount: 1,
        throughput: 0,
      };

      this.connectionStatus.set(connectionId, status);

      throw error;
    }
  }

  /**
   * 智能代码补全
   */
  async getIntelligentCompletions(
    documentUri: string,
    language: string,
    position: { line: number; character: number },
    context?: Record<string, unknown>
  ): Promise<{
    completions: IntelligentCompletion[];
    cacheHit: boolean;
    performance: LSPPerformanceMetrics;
  }> {
    const cacheKey = this.generateCacheKey(documentUri, language, position);

    // 检查缓存
    if (this.config.enablePerformanceOptimization) {
      const cachedCompletions = this.completionCache.get(cacheKey);
      if (cachedCompletions) {
        this.updateCacheHitRate(cacheKey, true);
        return {
          completions: cachedCompletions,
          cacheHit: true,
          performance: this.getPerformanceMetrics(language),
        };
      }
    }

    const startTime = Date.now();

    try {
      // 获取基础补全
      const baseCompletions = await (
        this.baseManager as unknown as {
          getCompletions: (
            lang: string,
            uri: string,
            pos: { line: number; character: number }
          ) => Promise<Record<string, unknown>[]>;
        }
      ).getCompletions(language, documentUri, position);

      // 智能处理补全结果
      const intelligentCompletions = await this.enhanceCompletions(
        baseCompletions,
        language,
        context
      );

      const responseTime = Date.now() - startTime;

      // 更新缓存
      if (this.config.enablePerformanceOptimization) {
        this.cacheCompletions(cacheKey, intelligentCompletions);
        this.updateCacheHitRate(cacheKey, false);
      }

      // 更新性能指标
      this.updatePerformanceMetrics(language, responseTime, true);

      return {
        completions: intelligentCompletions,
        cacheHit: false,
        performance: this.getPerformanceMetrics(language),
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;

      // 更新错误率
      this.updatePerformanceMetrics(language, responseTime, false);

      throw error;
    }
  }

  /**
   * 智能代码分析
   */
  async analyzeCodeIntelligently(
    documentUri: string,
    language: string,
    code: string
  ): Promise<CodeAnalysisResult> {
    const cacheKey = this.generateAnalysisCacheKey(documentUri, language, code);

    // 检查缓存
    if (this.config.enablePerformanceOptimization) {
      const cachedAnalysis = this.analysisCache.get(cacheKey);
      if (cachedAnalysis) {
        return cachedAnalysis;
      }
    }

    const startTime = Date.now();

    try {
      // 获取基础诊断
      const baseDiagnostics = await (
        this.baseManager as unknown as {
          getDiagnostics: (
            lang: string,
            uri: string
          ) => Promise<Record<string, unknown>[]>;
        }
      ).getDiagnostics(language, documentUri);

      // 智能分析代码
      const analysis = await this.performIntelligentAnalysis(
        documentUri,
        language,
        code,
        baseDiagnostics
      );

      // 更新缓存
      if (this.config.enablePerformanceOptimization) {
        this.cacheAnalysis(cacheKey, analysis);
      }

      // 更新性能指标
      this.updatePerformanceMetrics(language, Date.now() - startTime, true);

      return analysis;
    } catch (error) {
      this.updatePerformanceMetrics(language, Date.now() - startTime, false);
      throw error;
    }
  }

  /**
   * 增强补全结果
   */
  private async enhanceCompletions(
    baseCompletions: Record<string, unknown>[],
    language: string,
    context?: Record<string, unknown>
  ): Promise<IntelligentCompletion[]> {
    const enhancedCompletions: IntelligentCompletion[] = [];

    for (const baseCompletion of baseCompletions) {
      const intelligentCompletion: IntelligentCompletion = {
        completionId: `comp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        text: (baseCompletion.label as string) || '',
        type: this.determineCompletionType(baseCompletion),
        relevance: this.calculateRelevance(baseCompletion, context),
        confidence: this.calculateConfidence(baseCompletion, language),
        context: this.extractContext(baseCompletion),
        documentation: baseCompletion.documentation as string | undefined,
        examples: this.generateExamples(baseCompletion, language),
        priority: this.determinePriority(baseCompletion),
      };

      enhancedCompletions.push(intelligentCompletion);
    }

    // 按相关性和置信度排序
    return enhancedCompletions.sort((a, b) => {
      const scoreA = a.relevance * 0.6 + a.confidence * 0.4;
      const scoreB = b.relevance * 0.6 + b.confidence * 0.4;
      return scoreB - scoreA; // 降序排列
    });
  }

  /**
   * 确定补全类型
   */
  private determineCompletionType(
    completion: Record<string, unknown>
  ): IntelligentCompletion['type'] {
    const label = (completion.label as string) || '';

    if (label.includes('(') && label.includes(')')) return 'function';
    if (label.startsWith('@') || label.startsWith('import')) return 'import';
    if (label.match(/^[A-Z]/)) return 'class';
    if (label.includes('{') && label.includes('}')) return 'snippet';

    return 'variable';
  }

  /**
   * 计算相关性
   */
  private calculateRelevance(
    completion: Record<string, unknown>,
    context?: Record<string, unknown>
  ): number {
    let relevance = 0.5; // 基础相关性

    if (context?.currentWord) {
      const currentWord = (context.currentWord as string).toLowerCase();
      const completionText = (completion.label as string).toLowerCase();

      if (completionText.startsWith(currentWord)) {
        relevance += 0.3;
      } else if (completionText.includes(currentWord)) {
        relevance += 0.2;
      }
    }

    if (completion.kind) {
      const kindWeights = {
        1: 0.1,
        2: 0.2,
        3: 0.3,
        4: 0.4,
        5: 0.5,
        6: 0.6,
        7: 0.7,
        8: 0.8,
        9: 0.9,
        10: 1.0,
      };

      relevance +=
        ((kindWeights as Record<number, number>)[completion.kind as number] ||
          0.1) * 0.2;
    }

    return Math.min(relevance, 1);
  }

  /**
   * 计算置信度
   */
  private calculateConfidence(
    completion: Record<string, unknown>,
    language: string
  ): number {
    let confidence = 0.5;

    if (completion.detail) confidence += 0.2;
    if (completion.documentation) confidence += 0.3;

    if (language === 'typescript' || language === 'javascript') {
      if ((completion.label as string).includes('.')) confidence += 0.1;
    }

    return Math.min(confidence, 1);
  }

  /**
   * 提取上下文信息
   */
  private extractContext(completion: Record<string, unknown>): string[] {
    const context: string[] = [];

    if (completion.detail) {
      context.push(`类型: ${completion.detail as string}`);
    }

    if (completion.kind) {
      const kindNames = {
        1: '文本',
        2: '方法',
        3: '函数',
        4: '构造函数',
        5: '字段',
        6: '变量',
        7: '类',
        8: '接口',
        9: '模块',
        10: '属性',
      };
      context.push(
        `种类: ${(kindNames as Record<number, string>)[completion.kind as number] || '未知'}`
      );
    }

    return context;
  }

  /**
   * 生成示例
   */
  private generateExamples(
    completion: Record<string, unknown>,
    language: string
  ): string[] {
    const examples: string[] = [];

    if (completion.label && completion.kind === 3) {
      examples.push(`${completion.label as string}();`);
    }

    if (
      language === 'typescript' &&
      (completion.label as string)?.includes('.')
    ) {
      examples.push(`const result = ${completion.label as string};`);
    }

    return examples.slice(0, 2);
  }

  /**
   * 确定优先级
   */
  private determinePriority(
    completion: Record<string, unknown>
  ): IntelligentCompletion['priority'] {
    const relevance = this.calculateRelevance(completion);
    const confidence = this.calculateConfidence(completion, '');
    const score = relevance * 0.6 + confidence * 0.4;

    if (score > 0.8) return 'high';
    if (score > 0.6) return 'medium';
    return 'low';
  }

  /**
   * 执行智能分析
   */
  private async performIntelligentAnalysis(
    documentUri: string,
    language: string,
    code: string,
    baseDiagnostics: Record<string, unknown>[]
  ): Promise<CodeAnalysisResult> {
    const analysis: CodeAnalysisResult = {
      analysisId: `analysis-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      documentUri,
      language,
      complexity: this.calculateCodeComplexity(code),
      qualityScore: this.calculateQualityScore(code, baseDiagnostics),
      issues: this.enhanceDiagnostics(baseDiagnostics),
      suggestions: this.generateSuggestions(code, language),
      metrics: this.calculateCodeMetrics(code),
      timestamp: Date.now(),
    };

    return analysis;
  }

  /**
   * 计算代码复杂度
   */
  private calculateCodeComplexity(code: string): number {
    const lines = code.split('\n').length;
    const words = code.split(/\s+/).length;

    // 简化复杂度计算
    const lineComplexity = Math.min(lines / 100, 1);
    const wordComplexity = Math.min(words / 500, 1);

    return lineComplexity * 0.6 + wordComplexity * 0.4;
  }

  /**
   * 计算质量分数
   */
  private calculateQualityScore(
    code: string,
    diagnostics: Record<string, unknown>[]
  ): number {
    let baseScore = 0.8; // 基础分数

    // 基于诊断结果调整分数
    const errorCount = diagnostics.filter(
      (d) => (d.severity as number) === 1
    ).length;
    const warningCount = diagnostics.filter(
      (d) => (d.severity as number) === 2
    ).length;

    baseScore -= errorCount * 0.1;
    baseScore -= warningCount * 0.05;

    // 基于代码长度调整分数
    const codeLength = code.length;
    if (codeLength > 1000) baseScore -= 0.1;
    if (codeLength > 5000) baseScore -= 0.2;

    return Math.max(0, Math.min(baseScore, 1));
  }

  /**
   * 增强诊断信息
   */
  private enhanceDiagnostics(
    baseDiagnostics: Record<string, unknown>[]
  ): CodeIssue[] {
    return baseDiagnostics.map((diagnostic) => {
      const range = diagnostic.range as
        | {
            start?: { line: number; character: number };
            end?: { line: number; character: number };
          }
        | undefined;
      return {
        issueId: `issue-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        type: this.mapSeverityToType(diagnostic.severity as number),
        severity: this.mapSeverityToLevel(diagnostic.severity as number),
        message: (diagnostic.message as string) || '未知问题',
        location: {
          line: range?.start?.line || 0,
          character: range?.start?.character || 0,
          endLine: range?.end?.line,
          endCharacter: range?.end?.character,
        },
        code: diagnostic.code as string | undefined,
        source: diagnostic.source as string | undefined,
        suggestions: this.generateIssueSuggestions(diagnostic),
      };
    });
  }

  /**
   * 映射严重程度到类型
   */
  private mapSeverityToType(severity: number): CodeIssue['type'] {
    switch (severity) {
      case 1:
        return 'error';
      case 2:
        return 'warning';
      case 3:
        return 'info';
      case 4:
        return 'hint';
      default:
        return 'info';
    }
  }

  /**
   * 映射严重程度到级别
   */
  private mapSeverityToLevel(severity: number): CodeIssue['severity'] {
    switch (severity) {
      case 1:
        return 'critical';
      case 2:
        return 'high';
      case 3:
        return 'medium';
      case 4:
        return 'low';
      default:
        return 'medium';
    }
  }

  /**
   * 生成问题建议
   */
  private generateIssueSuggestions(
    diagnostic: Record<string, unknown>
  ): string[] {
    const suggestions: string[] = [];
    const message = (diagnostic.message as string) || '';

    if (message.includes('未定义')) {
      suggestions.push('检查变量或函数是否已定义');
      suggestions.push('确认导入语句是否正确');
    }

    if (message.includes('类型')) {
      suggestions.push('检查类型声明和赋值');
      suggestions.push('确认类型兼容性');
    }

    if (message.includes('语法')) {
      suggestions.push('检查语法错误');
      suggestions.push('确认括号和引号匹配');
    }

    return suggestions.slice(0, 3);
  }

  /**
   * 生成代码建议
   */
  private generateSuggestions(
    code: string,
    language: string
  ): CodeSuggestion[] {
    const suggestions: CodeSuggestion[] = [];

    // 简化建议生成逻辑
    if (code.length > 500) {
      suggestions.push({
        suggestionId: `suggest-${Date.now()}-1`,
        type: 'simplify',
        description: '代码过长，建议拆分为更小的函数',
        code: '// 将长函数拆分为多个小函数',
        confidence: 0.7,
        effort: 'medium',
        impact: 'moderate',
      });
    }

    if (code.includes('// TODO') || code.includes('// FIXME')) {
      suggestions.push({
        suggestionId: `suggest-${Date.now()}-2`,
        type: 'document',
        description: '发现TODO/FIXME注释，建议及时处理',
        code: '// 处理TODO/FIXME任务',
        confidence: 0.9,
        effort: 'low',
        impact: 'minor',
      });
    }

    return suggestions;
  }

  /**
   * 计算代码指标
   */
  private calculateCodeMetrics(code: string): CodeMetrics {
    const lines = code.split('\n').length;

    return {
      linesOfCode: lines,
      complexity: this.calculateCodeComplexity(code),
      maintainability: this.calculateMaintainability(code),
      duplication: this.estimateDuplication(code),
      documentationCoverage: this.estimateDocumentationCoverage(code),
    };
  }

  /**
   * 计算可维护性
   */
  private calculateMaintainability(code: string): number {
    const complexity = this.calculateCodeComplexity(code);

    // 简化可维护性计算
    return Math.max(0, 1 - complexity * 0.8);
  }

  /**
   * 估计重复率
   */
  private estimateDuplication(code: string): number {
    // 简化重复率估计
    const lines = code.split('\n');
    const uniqueLines = new Set(lines.map((line) => line.trim()));

    return Math.max(0, 1 - uniqueLines.size / lines.length);
  }

  /**
   * 估计文档覆盖率
   */
  private estimateDocumentationCoverage(code: string): number {
    const lines = code.split('\n');
    const commentLines = lines.filter(
      (line) =>
        line.trim().startsWith('//') ||
        line.trim().startsWith('/*') ||
        line.trim().startsWith('*')
    ).length;

    return lines.length > 0 ? commentLines / lines.length : 0;
  }

  /**
   * 生成连接ID
   */
  private generateConnectionId(language: string): string {
    return `conn-${language}-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  }

  /**
   * 生成缓存键
   */
  private generateCacheKey(
    documentUri: string,
    language: string,
    position: { line: number; character: number }
  ): string {
    return `comp-${language}-${documentUri}-${position.line}-${position.character}`;
  }

  /**
   * 生成分析缓存键
   */
  private generateAnalysisCacheKey(
    documentUri: string,
    language: string,
    code: string
  ): string {
    const codeHash = this.simpleHash(code);
    return `analysis-${language}-${documentUri}-${codeHash}`;
  }

  /**
   * 简单哈希函数
   */
  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // 转换为32位整数
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * 缓存补全结果
   */
  private cacheCompletions(
    key: string,
    completions: IntelligentCompletion[]
  ): void {
    if (this.completionCache.size >= this.config.cacheSize) {
      // 简单的LRU缓存淘汰
      const firstKey = this.completionCache.keys().next().value;
      this.completionCache.delete(firstKey!);
    }
    this.completionCache.set(key, completions);
  }

  /**
   * 缓存分析结果
   */
  private cacheAnalysis(key: string, analysis: CodeAnalysisResult): void {
    if (this.analysisCache.size >= this.config.cacheSize) {
      const firstKey = this.analysisCache.keys().next().value;
      this.analysisCache.delete(firstKey!);
    }
    this.analysisCache.set(key, analysis);
  }

  /**
   * 更新缓存命中率
   */
  private updateCacheHitRate(key: string, hit: boolean): void {
    // 简化实现：更新全局性能指标
    const metrics = this.getPerformanceMetrics('global');
    if (hit) {
      metrics.cacheHitRate = Math.min(1, metrics.cacheHitRate + 0.01);
    } else {
      metrics.cacheHitRate = Math.max(0, metrics.cacheHitRate - 0.005);
    }
  }

  /**
   * 更新性能指标
   */
  private updatePerformanceMetrics(
    language: string,
    responseTime: number,
    success: boolean
  ): void {
    const metrics = this.getPerformanceMetrics(language);

    metrics.responseTime = (metrics.responseTime + responseTime) / 2;
    metrics.lastActivity = Date.now();

    if (success) {
      metrics.throughput = Math.min(1000, metrics.throughput + 1);
    } else {
      metrics.errorRate = Math.min(1, metrics.errorRate + 0.01);
    }
  }

  /**
   * 获取性能指标
   */
  private getPerformanceMetrics(language: string): LSPPerformanceMetrics {
    const key = `metrics-${language}`;
    if (!this.performanceMetrics.has(key)) {
      this.performanceMetrics.set(key, {
        connectionId: key,
        language,
        responseTime: 0,
        throughput: 0,
        errorRate: 0,
        cacheHitRate: 0.5,
        memoryUsage: 0,
        lastActivity: Date.now(),
      });
    }
    return this.performanceMetrics.get(key)!;
  }

  /**
   * 获取活跃连接数
   */
  private getActiveConnectionCount(): number {
    return Array.from(this.connectionStatus.values()).filter(
      (status) => status.status === 'connected'
    ).length;
  }

  /**
   * 获取配置
   */
  getConfig(): EnhancedLSPManagerConfig {
    return { ...this.config };
  }

  /**
   * 更新配置
   */
  updateConfig(newConfig: Partial<EnhancedLSPManagerConfig>): void {
    Object.assign(this.config, newConfig);
  }

  /**
   * 清空缓存
   */
  clearCache(): void {
    this.completionCache.clear();
    this.analysisCache.clear();
  }

  /**
   * 获取连接状态
   */
  getConnectionStatus(language: string): LSPConnectionStatus | undefined {
    return Array.from(this.connectionStatus.values()).find(
      (status) => status.language === language && status.status === 'connected'
    );
  }

  /**
   * 获取所有连接状态
   */
  getAllConnectionStatus(): LSPConnectionStatus[] {
    return Array.from(this.connectionStatus.values());
  }
}

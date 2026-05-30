/**
 * AgentTemplateMarket - Agent 模板市场
 *
 * 提供 Agent 模板的浏览、搜索、安装和管理功能：
 * - 内置模板库
 * - 模板搜索与筛选
 * - 模板安装与卸载
 * - 本地模板持久化存储
 * - 评分与评价
 */

import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';
import {
  AgentTemplate,
  TemplateMetadata,
  TemplateCategory,
  TemplateSource,
  TemplateFilter,
  TemplateSearchResult,
  TemplateInstallConfig,
  TemplateInstallResult,
  TemplateReview,
  LocalTemplateRepoConfig,
  TemplateStep,
} from './types';

/**
 * 构建内置模板
 */
function createBuiltinTemplates(): AgentTemplate[] {
  return [
    {
      metadata: {
        id: 'builtin-code-review',
        name: '代码审查',
        description: '自动审查代码变更，检查潜在问题、安全漏洞和最佳实践',
        category: 'code-review',
        source: 'built-in',
        author: 'Liri',
        version: '1.0.0',
        tags: ['code', 'review', 'quality'],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        downloadCount: 0,
        rating: 0,
        ratingCount: 0,
        icon: '👁️',
      },
      steps: [
        {
          name: '分析变更',
          description: '分析代码变更的范围和影响',
          agentType: 'explore',
          systemPrompt:
            '分析以下代码变更，总结变更范围和影响：\n\n{{previousOutput}}',
          onError: 'abort',
        },
        {
          name: '审查代码',
          description: '逐行审查代码质量',
          agentType: 'code',
          systemPrompt:
            '请对以下代码进行审查，检查：\n1. 潜在bug\n2. 安全漏洞\n3. 性能问题\n4. 代码风格\n5. 最佳实践\n\n代码：\n{{previousOutput}}',
          onError: 'skip',
        },
        {
          name: '生成报告',
          description: '汇总审查结果',
          agentType: 'general',
          systemPrompt:
            '将以下代码审查结果整理为结构化报告：\n\n{{previousOutput}}',
        },
      ],
      defaultInputHint: '粘贴代码变更(diff)或文件路径',
    },
    {
      metadata: {
        id: 'builtin-test-generation',
        name: '测试生成',
        description: '根据源代码自动生成单元测试和集成测试',
        category: 'test-writing',
        source: 'built-in',
        author: 'Liri',
        version: '1.0.0',
        tags: ['test', 'generation', 'quality'],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        downloadCount: 0,
        rating: 0,
        ratingCount: 0,
        icon: '🧪',
      },
      steps: [
        {
          name: '分析代码',
          description: '理解代码结构和逻辑',
          agentType: 'explore',
          systemPrompt:
            '分析以下代码的结构、输入输出和边界条件：\n\n{{previousOutput}}',
        },
        {
          name: '生成测试用例',
          description: '创建测试用例列表',
          agentType: 'plan',
          systemPrompt:
            '根据以下代码分析，列出需要测试的用例：\n\n{{previousOutput}}',
        },
        {
          name: '编写测试代码',
          description: '生成实际测试代码',
          agentType: 'code',
          systemPrompt:
            '根据以下测试用例生成完整的测试代码：\n\n{{previousOutput}}',
        },
      ],
      defaultInputHint: '粘贴需要测试的源代码',
    },
    {
      metadata: {
        id: 'builtin-exploration',
        name: '代码库探索',
        description: '深入探索代码库，理解模块关系和架构设计',
        category: 'exploration',
        source: 'built-in',
        author: 'Liri',
        version: '1.0.0',
        tags: ['explore', 'architecture', 'analysis'],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        downloadCount: 0,
        rating: 0,
        ratingCount: 0,
        icon: '🔍',
      },
      steps: [
        {
          name: '目录结构分析',
          description: '分析项目目录结构',
          agentType: 'explore',
          systemPrompt:
            '分析以下项目的目录结构，总结模块组织方式：\n\n{{previousOutput}}',
        },
        {
          name: '依赖分析',
          description: '分析模块间依赖关系',
          agentType: 'explore',
          systemPrompt:
            '分析以下代码的依赖关系和模块耦合度：\n\n{{previousOutput}}',
        },
        {
          name: '架构总结',
          description: '生成架构文档',
          agentType: 'general',
          systemPrompt:
            '根据以下分析结果，生成简洁的架构文档：\n\n{{previousOutput}}',
        },
      ],
      defaultInputHint: '粘贴项目根目录描述或关键文件列表',
    },
    {
      metadata: {
        id: 'builtin-refactoring',
        name: '代码重构',
        description: '分析代码质量问题并提供重构建议和执行方案',
        category: 'refactoring',
        source: 'built-in',
        author: 'Liri',
        version: '1.0.0',
        tags: ['refactor', 'quality', 'improvement'],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        downloadCount: 0,
        rating: 0,
        ratingCount: 0,
        icon: '🔧',
      },
      steps: [
        {
          name: '代码分析',
          description: '分析代码质量',
          agentType: 'code',
          systemPrompt:
            '分析以下代码的质量问题：\n1. 代码异味\n2. 重复代码\n3. 过长方法\n4. 复杂条件\n\n代码：\n{{previousOutput}}',
        },
        {
          name: '重构方案',
          description: '制定重构计划',
          agentType: 'plan',
          systemPrompt: '根据以下分析结果制定重构方案：\n{{previousOutput}}',
        },
        {
          name: '执行重构',
          description: '执行重构操作',
          agentType: 'code',
          systemPrompt: '按照以下方案执行重构：\n{{previousOutput}}',
        },
      ],
      defaultInputHint: '粘贴需要重构的代码',
    },
    {
      metadata: {
        id: 'builtin-debugging',
        name: '故障排查',
        description: '分析错误日志和异常信息，定位根因并提供修复方案',
        category: 'debugging',
        source: 'built-in',
        author: 'Liri',
        version: '1.0.0',
        tags: ['debug', 'error', 'troubleshoot'],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        downloadCount: 0,
        rating: 0,
        ratingCount: 0,
        icon: '🐛',
      },
      steps: [
        {
          name: '错误分析',
          description: '分析错误信息',
          agentType: 'explore',
          systemPrompt:
            '分析以下错误信息，提取关键线索：\n\n{{previousOutput}}',
        },
        {
          name: '根因定位',
          description: '定位根本原因',
          agentType: 'code',
          systemPrompt:
            '根据以下分析结果，定位问题的根本原因：\n\n{{previousOutput}}',
        },
        {
          name: '修复方案',
          description: '生成修复方案',
          agentType: 'plan',
          systemPrompt: '根据以下分析生成修复方案：\n\n{{previousOutput}}',
        },
      ],
      defaultInputHint: '粘贴错误日志或异常堆栈',
    },
    {
      metadata: {
        id: 'builtin-deployment',
        name: '部署检查',
        description: '检查部署配置、依赖和环境准备情况',
        category: 'deployment',
        source: 'built-in',
        author: 'Liri',
        version: '1.0.0',
        tags: ['deploy', 'devops', 'config'],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        downloadCount: 0,
        rating: 0,
        ratingCount: 0,
        icon: '🚀',
      },
      steps: [
        {
          name: '配置检查',
          description: '检查部署配置',
          agentType: 'explore',
          systemPrompt:
            '检查以下部署配置的完整性和正确性：\n\n{{previousOutput}}',
        },
        {
          name: '依赖验证',
          description: '验证依赖项',
          agentType: 'general',
          systemPrompt: '验证以下依赖是否满足部署要求：\n\n{{previousOutput}}',
        },
        {
          name: '部署计划',
          description: '生成部署计划',
          agentType: 'plan',
          systemPrompt:
            '根据以下信息生成详细的部署计划：\n\n{{previousOutput}}',
        },
      ],
      defaultInputHint: '粘贴部署配置或环境信息',
    },
  ];
}

/**
 * Agent 模板市场
 */
export class AgentTemplateMarket extends EventEmitter {
  private templates: Map<string, AgentTemplate> = new Map();
  private installedTemplates: Set<string> = new Set();
  private reviews: Map<string, TemplateReview[]> = new Map();
  private config: LocalTemplateRepoConfig;

  /**
   * @param config 本地仓库配置
   */
  constructor(config?: Partial<LocalTemplateRepoConfig>) {
    super();
    this.config = {
      baseDir: '',
      maxCachedTemplates: 100,
      syncIntervalMs: 3600000,
      ...config,
    };
    this.loadBuiltinTemplates();
  }

  /**
   * 加载内置模板
   */
  private loadBuiltinTemplates(): void {
    const builtins = createBuiltinTemplates();
    for (const template of builtins) {
      this.templates.set(template.metadata.id, template);
    }
  }

  /**
   * 搜索模板
   */
  search(filter?: TemplateFilter): TemplateSearchResult {
    let results = Array.from(this.templates.values());

    if (filter) {
      if (filter.category) {
        results = results.filter(
          (t) => t.metadata.category === filter.category
        );
      }

      if (filter.source) {
        results = results.filter((t) => t.metadata.source === filter.source);
      }

      if (filter.query) {
        const q = filter.query.toLowerCase();
        results = results.filter(
          (t) =>
            t.metadata.name.toLowerCase().includes(q) ||
            t.metadata.description.toLowerCase().includes(q) ||
            t.metadata.tags.some((tag) => tag.toLowerCase().includes(q))
        );
      }

      if (filter.tags && filter.tags.length > 0) {
        results = results.filter((t) =>
          filter.tags!.some((tag) => t.metadata.tags.includes(tag))
        );
      }

      if (filter.minRating) {
        results = results.filter((t) => t.metadata.rating >= filter.minRating!);
      }

      if (filter.sortBy) {
        results.sort((a, b) => {
          let cmp = 0;
          switch (filter.sortBy) {
            case 'name':
              cmp = a.metadata.name.localeCompare(b.metadata.name);
              break;
            case 'rating':
              cmp = a.metadata.rating - b.metadata.rating;
              break;
            case 'downloads':
              cmp = a.metadata.downloadCount - b.metadata.downloadCount;
              break;
            case 'created':
              cmp = a.metadata.createdAt - b.metadata.createdAt;
              break;
            case 'updated':
              cmp = a.metadata.updatedAt - b.metadata.updatedAt;
              break;
          }
          return filter.sortOrder === 'desc' ? -cmp : cmp;
        });
      }
    }

    const total = results.length;
    const offset = filter?.offset ?? 0;
    const limit = filter?.limit ?? 20;
    const paged = results.slice(offset, offset + limit);

    return { templates: paged, total, offset, limit };
  }

  /**
   * 获取模板详情
   */
  getTemplate(templateId: string): AgentTemplate | undefined {
    return this.templates.get(templateId);
  }

  /**
   * 按分类列出模板
   */
  listByCategory(category: TemplateCategory): AgentTemplate[] {
    return Array.from(this.templates.values()).filter(
      (t) => t.metadata.category === category
    );
  }

  /**
   * 获取所有分类及其模板数量
   */
  getCategories(): {
    category: TemplateCategory;
    count: number;
    name: string;
  }[] {
    const counts = new Map<TemplateCategory, number>();
    for (const template of this.templates.values()) {
      counts.set(
        template.metadata.category,
        (counts.get(template.metadata.category) || 0) + 1
      );
    }
    return Array.from(counts.entries()).map(([category, count]) => ({
      category,
      count,
      name: this.getCategoryName(category),
    }));
  }

  /**
   * 获取分类显示名称
   */
  private getCategoryName(category: TemplateCategory): string {
    const names: Record<TemplateCategory, string> = {
      'code-review': '代码审查',
      'test-writing': '测试编写',
      exploration: '代码探索',
      planning: '任务规划',
      refactoring: '代码重构',
      documentation: '文档生成',
      debugging: '故障排查',
      deployment: '部署检查',
      monitoring: '监控告警',
      custom: '自定义',
    };
    return names[category] || category;
  }

  /**
   * 注册自定义模板
   */
  registerTemplate(
    template: Omit<AgentTemplate, 'metadata'> & {
      metadata?: Partial<TemplateMetadata>;
    }
  ): AgentTemplate {
    const fullTemplate: AgentTemplate = {
      metadata: {
        id: template.metadata?.id || `custom-${randomUUID().substring(0, 8)}`,
        name: template.metadata?.name || 'Unnamed Template',
        description: template.metadata?.description || '',
        category: template.metadata?.category || 'custom',
        source: 'custom',
        author: template.metadata?.author || 'anonymous',
        version: template.metadata?.version || '1.0.0',
        tags: template.metadata?.tags || [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        downloadCount: 0,
        rating: 0,
        ratingCount: 0,
        icon: template.metadata?.icon || '📦',
      },
      steps: template.steps,
      defaultInputHint: template.defaultInputHint,
      config: template.config,
    };

    this.templates.set(fullTemplate.metadata.id, fullTemplate);
    this.emit('template:registered', fullTemplate);

    return fullTemplate;
  }

  /**
   * 安装模板
   */
  installTemplate(
    templateId: string,
    config?: TemplateInstallConfig
  ): TemplateInstallResult {
    const template = this.templates.get(templateId);
    if (!template) {
      return {
        success: false,
        templateId,
        error: `Template ${templateId} not found`,
      };
    }

    if (this.installedTemplates.has(templateId) && !config?.overwrite) {
      return {
        success: false,
        templateId,
        error: `Template ${templateId} is already installed`,
      };
    }

    template.metadata.downloadCount++;
    this.installedTemplates.add(templateId);

    this.emit('template:installed', { templateId, config });

    return {
      success: true,
      templateId,
      installPath: this.config.baseDir
        ? `${this.config.baseDir}/${templateId}.json`
        : undefined,
    };
  }

  /**
   * 卸载模板
   */
  uninstallTemplate(templateId: string): boolean {
    const removed = this.installedTemplates.delete(templateId);
    if (removed) {
      this.emit('template:uninstalled', { templateId });
    }
    return removed;
  }

  /**
   * 获取已安装模板列表
   */
  getInstalledTemplates(): AgentTemplate[] {
    return Array.from(this.installedTemplates)
      .map((id) => this.templates.get(id))
      .filter((t): t is AgentTemplate => t !== undefined);
  }

  /**
   * 检查模板是否已安装
   */
  isInstalled(templateId: string): boolean {
    return this.installedTemplates.has(templateId);
  }

  /**
   * 添加评分
   */
  addReview(
    templateId: string,
    review: Omit<TemplateReview, 'templateId' | 'createdAt'>
  ): TemplateReview | null {
    const template = this.templates.get(templateId);
    if (!template) return null;

    const fullReview: TemplateReview = {
      ...review,
      templateId,
      createdAt: Date.now(),
    };

    if (!this.reviews.has(templateId)) {
      this.reviews.set(templateId, []);
    }
    this.reviews.get(templateId)!.push(fullReview);

    this.updateRating(templateId);

    this.emit('template:reviewed', { templateId, review: fullReview });

    return fullReview;
  }

  /**
   * 获取模板评价列表
   */
  getReviews(templateId: string): TemplateReview[] {
    return this.reviews.get(templateId) || [];
  }

  /**
   * 更新模板评分
   */
  private updateRating(templateId: string): void {
    const template = this.templates.get(templateId);
    if (!template) return;

    const reviews = this.reviews.get(templateId) || [];
    if (reviews.length === 0) return;

    const total = reviews.reduce((sum, r) => sum + r.rating, 0);
    template.metadata.rating = Math.round((total / reviews.length) * 10) / 10;
    template.metadata.ratingCount = reviews.length;
  }

  /**
   * 删除模板
   */
  deleteTemplate(templateId: string): boolean {
    const existed = this.templates.delete(templateId);
    if (existed) {
      this.installedTemplates.delete(templateId);
      this.reviews.delete(templateId);
      this.emit('template:deleted', { templateId });
    }
    return existed;
  }

  /**
   * 获取模板总数
   */
  getTemplateCount(): number {
    return this.templates.size;
  }

  /**
   * 获取已安装模板数
   */
  getInstalledCount(): number {
    return this.installedTemplates.size;
  }

  /**
   * 将模板导出为 JSON
   */
  exportTemplate(templateId: string): string | undefined {
    const template = this.templates.get(templateId);
    if (!template) return undefined;
    return JSON.stringify(template, null, 2);
  }

  /**
   * 从 JSON 导入模板
   */
  importTemplate(json: string): AgentTemplate | null {
    try {
      const data = JSON.parse(json) as AgentTemplate;
      if (!data.metadata || !data.steps) {
        return null;
      }
      return this.registerTemplate(data);
    } catch {
      return null;
    }
  }

  /**
   * 重置所有状态
   */
  reset(): void {
    this.templates.clear();
    this.installedTemplates.clear();
    this.reviews.clear();
    this.removeAllListeners();
    this.loadBuiltinTemplates();
  }
}

export const agentTemplateMarket = new AgentTemplateMarket();

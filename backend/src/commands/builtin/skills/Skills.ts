/**
 * Skills命令实现
 * 技能管理和展示
 */
import type { CommandImplementation } from '../../types/index.js';

/**
 * 技能数据定义
 */
interface SkillData {
  /** 技能名称 */
  name: string;
  /** 技能描述 */
  description: string;
  /** 技能类别 */
  category: string;
  /** 技能等级 */
  level: 'beginner' | 'intermediate' | 'advanced' | 'expert';
  /** 使用频率 */
  usageFrequency: 'low' | 'medium' | 'high' | 'very-high';
  /** 最后使用时间 */
  lastUsed: Date;
  /** 技能标签 */
  tags: string[];
  /** 相关命令 */
  relatedCommands: string[];
  /** 学习资源 */
  learningResources: Array<{
    type: 'documentation' | 'tutorial' | 'example' | 'video';
    title: string;
    url: string;
    description: string;
  }>;
}

/**
 * 技能统计数据定义
 */
interface SkillsStats {
  /** 总体统计 */
  overall: {
    totalSkills: number;
    activeSkills: number;
    beginnerSkills: number;
    intermediateSkills: number;
    advancedSkills: number;
    expertSkills: number;
  };
  /** 类别统计 */
  categories: Array<{
    category: string;
    skillCount: number;
    averageLevel: string;
    mostUsedSkill: string;
  }>;
  /** 使用频率统计 */
  usageStats: {
    highFrequency: number;
    mediumFrequency: number;
    lowFrequency: number;
    totalUsage: number;
  };
  /** 技能趋势 */
  trends: {
    newlyAdded: Array<{
      skill: string;
      addedDate: Date;
      category: string;
    }>;
    recentlyUsed: Array<{
      skill: string;
      lastUsed: Date;
      usageCount: number;
    }>;
    skillGrowth: Array<{
      period: string;
      skillsAdded: number;
      skillsImproved: number;
    }>;
  };
}

/**
 * Skills命令实现类
 */
export class Skills implements CommandImplementation {
  /**
   * 执行skills命令
   * @param args 命令参数
   * @param context 命令上下文
   * @returns 命令执行结果
   */
  async execute(args: string, context: any): Promise<any> {
    try {
      // 解析参数
      const params = this.parseArgs(args);
      
      // 根据参数显示不同的技能信息
      if (params.showStats) {
        return await this.showSkillsStats(context);
      } else if (params.showCategories) {
        return await this.showSkillsByCategory(context);
      } else if (params.showUsage) {
        return await this.showSkillsUsage(context);
      } else if (params.showTrends) {
        return await this.showSkillsTrends(context);
      } else if (params.searchSkill) {
        return await this.searchSkills(context, params.searchSkill);
      } else {
        // 默认显示所有技能
        return await this.showAllSkills(context);
      }
    } catch (error) {
      return {
        success: false,
        error: `Failed to execute skills command: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * 解析命令参数
   * @param args 命令参数
   * @returns 解析后的参数
   */
  private parseArgs(args: string): {
    showStats: boolean;
    showCategories: boolean;
    showUsage: boolean;
    showTrends: boolean;
    searchSkill: string;
  } {
    const params = {
      showStats: false,
      showCategories: false,
      showUsage: false,
      showTrends: false,
      searchSkill: '',
    };

    // 使用正则表达式精确匹配参数
    const statsRegex = /(^|\s)(--stats|-s)(\s|$)/;
    const categoriesRegex = /(^|\s)(--categories|-c)(\s|$)/;
    const usageRegex = /(^|\s)(--usage|-u)(\s|$)/;
    const trendsRegex = /(^|\s)(--trends|-t)(\s|$)/;
    
    // 搜索参数处理
    const searchMatch = args.match(/--search=([^\s]+)|-s=([^\s]+)/);
    if (searchMatch) {
      params.searchSkill = searchMatch[1] || searchMatch[2] || '';
    }

    if (statsRegex.test(args)) {
      params.showStats = true;
    }
    
    if (categoriesRegex.test(args)) {
      params.showCategories = true;
    }

    if (usageRegex.test(args)) {
      params.showUsage = true;
    }

    if (trendsRegex.test(args)) {
      params.showTrends = true;
    }

    return params;
  }

  /**
   * 显示所有技能
   * @param context 命令上下文
   * @returns 所有技能结果
   */
  private async showAllSkills(context: any): Promise<any> {
    const skillsData = await this.collectSkillsData(context);
    
    const allSkills = {
      title: '可用技能列表',
      sections: [
        {
          title: '技能概览',
          content: `总技能数: ${skillsData.length}\n` +
                   `按类别分组: ${this.getCategoryCount(skillsData)}`
        },
        {
          title: '技能列表',
          content: this.formatSkillsList(skillsData)
        },
        {
          title: '技能等级分布',
          content: this.formatSkillsLevelDistribution(skillsData)
        }
      ]
    };

    return {
      success: true,
      type: 'skills',
      data: allSkills,
      display: 'table'
    };
  }

  /**
   * 显示技能统计
   * @param context 命令上下文
   * @returns 技能统计结果
   */
  private async showSkillsStats(context: any): Promise<any> {
    const skillsData = await this.collectSkillsData(context);
    const stats = this.analyzeSkillsStats(skillsData);
    
    const skillsStats = {
      title: '技能统计分析',
      sections: [
        {
          title: '总体统计',
          content: `总技能数: ${stats.overall.totalSkills}\n` +
                   `活跃技能: ${stats.overall.activeSkills}\n` +
                   `初学者: ${stats.overall.beginnerSkills} | 中级: ${stats.overall.intermediateSkills}\n` +
                   `高级: ${stats.overall.advancedSkills} | 专家: ${stats.overall.expertSkills}`
        },
        {
          title: '类别统计',
          content: this.formatCategoryStats(stats.categories)
        },
        {
          title: '使用频率',
          content: `高频使用: ${stats.usageStats.highFrequency}\n` +
                   `中频使用: ${stats.usageStats.mediumFrequency}\n` +
                   `低频使用: ${stats.usageStats.lowFrequency}\n` +
                   `总使用次数: ${stats.usageStats.totalUsage}`
        }
      ]
    };

    return {
      success: true,
      type: 'skills',
      data: skillsStats,
      display: 'table'
    };
  }

  /**
   * 按类别显示技能
   * @param context 命令上下文
   * @returns 按类别分类的技能结果
   */
  private async showSkillsByCategory(context: any): Promise<any> {
    const skillsData = await this.collectSkillsData(context);
    
    const skillsByCategory = {
      title: '按类别分类的技能',
      sections: this.formatSkillsByCategory(skillsData)
    };

    return {
      success: true,
      type: 'skills',
      data: skillsByCategory,
      display: 'table'
    };
  }

  /**
   * 显示技能使用情况
   * @param context 命令上下文
   * @returns 技能使用情况结果
   */
  private async showSkillsUsage(context: any): Promise<any> {
    const skillsData = await this.collectSkillsData(context);
    
    const skillsUsage = {
      title: '技能使用情况',
      sections: [
        {
          title: '最常用技能',
          content: this.formatMostUsedSkills(skillsData)
        },
        {
          title: '最近使用技能',
          content: this.formatRecentlyUsedSkills(skillsData)
        },
        {
          title: '使用频率分析',
          content: this.formatUsageAnalysis(skillsData)
        }
      ]
    };

    return {
      success: true,
      type: 'skills',
      data: skillsUsage,
      display: 'table'
    };
  }

  /**
   * 显示技能趋势
   * @param context 命令上下文
   * @returns 技能趋势结果
   */
  private async showSkillsTrends(context: any): Promise<any> {
    const skillsData = await this.collectSkillsData(context);
    const stats = this.analyzeSkillsStats(skillsData);
    
    const skillsTrends = {
      title: '技能发展趋势',
      sections: [
        {
          title: '新添加技能',
          content: this.formatNewlyAddedSkills(stats.trends.newlyAdded)
        },
        {
          title: '最近使用技能',
          content: this.formatRecentlyUsedTrends(stats.trends.recentlyUsed)
        },
        {
          title: '技能增长趋势',
          content: this.formatSkillGrowthTrends(stats.trends.skillGrowth)
        }
      ]
    };

    return {
      success: true,
      type: 'skills',
      data: skillsTrends,
      display: 'table'
    };
  }

  /**
   * 搜索技能
   * @param context 命令上下文
   * @param searchTerm 搜索关键词
   * @returns 搜索结果
   */
  private async searchSkills(context: any, searchTerm: string): Promise<any> {
    const skillsData = await this.collectSkillsData(context);
    const searchResults = this.performSkillsSearch(skillsData, searchTerm);
    
    const searchReport = {
      title: `技能搜索: "${searchTerm}"`,
      sections: [
        {
          title: '搜索结果',
          content: searchResults.length > 0 ? 
            this.formatSearchResults(searchResults) : 
            `未找到包含 "${searchTerm}" 的技能`
        },
        {
          title: '搜索统计',
          content: `找到 ${searchResults.length} 个相关技能`
        }
      ]
    };

    return {
      success: true,
      type: 'skills',
      data: searchReport,
      display: 'table'
    };
  }

  /**
   * 收集技能数据
   * @param context 命令上下文
   * @returns 技能数据
   */
  private async collectSkillsData(context: any): Promise<SkillData[]> {
    // 这里应该从实际的技能管理系统中获取数据
    // 目前使用模拟数据，后续需要集成真实的技能管理系统
    
    return [
      {
        name: '代码审查',
        description: '分析和改进代码质量，识别潜在问题',
        category: '开发',
        level: 'advanced',
        usageFrequency: 'high',
        lastUsed: new Date(),
        tags: ['代码质量', '最佳实践', '审查'],
        relatedCommands: ['/review', '/analyze'],
        learningResources: [
          {
            type: 'documentation',
            title: '代码审查指南',
            url: 'https://example.com/code-review',
            description: '完整的代码审查流程和最佳实践'
          }
        ]
      },
      {
        name: '性能优化',
        description: '分析和优化系统性能，提升响应速度',
        category: '性能',
        level: 'expert',
        usageFrequency: 'medium',
        lastUsed: new Date(Date.now() - 86400000),
        tags: ['性能', '优化', '监控'],
        relatedCommands: ['/optimize', '/profile'],
        learningResources: [
          {
            type: 'tutorial',
            title: '性能优化教程',
            url: 'https://example.com/performance',
            description: '系统性能优化的实用技巧'
          }
        ]
      },
      {
        name: '数据库管理',
        description: '管理和优化数据库操作，确保数据安全',
        category: '数据库',
        level: 'intermediate',
        usageFrequency: 'high',
        lastUsed: new Date(Date.now() - 172800000),
        tags: ['数据库', 'SQL', '优化'],
        relatedCommands: ['/db', '/query'],
        learningResources: [
          {
            type: 'example',
            title: '数据库最佳实践',
            url: 'https://example.com/database',
            description: '数据库设计和优化的实际案例'
          }
        ]
      },
      {
        name: '网络调试',
        description: '诊断和解决网络连接问题',
        category: '网络',
        level: 'intermediate',
        usageFrequency: 'medium',
        lastUsed: new Date(Date.now() - 259200000),
        tags: ['网络', '调试', '连接'],
        relatedCommands: ['/network', '/debug'],
        learningResources: [
          {
            type: 'video',
            title: '网络调试视频教程',
            url: 'https://example.com/network-debug',
            description: '网络问题诊断的实战演示'
          }
        ]
      },
      {
        name: '安全审计',
        description: '检查系统安全漏洞，提供修复建议',
        category: '安全',
        level: 'advanced',
        usageFrequency: 'low',
        lastUsed: new Date(Date.now() - 604800000),
        tags: ['安全', '审计', '漏洞'],
        relatedCommands: ['/security', '/audit'],
        learningResources: [
          {
            type: 'documentation',
            title: '安全审计手册',
            url: 'https://example.com/security-audit',
            description: '完整的安全审计流程和方法'
          }
        ]
      },
      {
        name: '自动化测试',
        description: '编写和执行自动化测试用例',
        category: '测试',
        level: 'beginner',
        usageFrequency: 'high',
        lastUsed: new Date(),
        tags: ['测试', '自动化', '质量'],
        relatedCommands: ['/test', '/automate'],
        learningResources: [
          {
            type: 'tutorial',
            title: '自动化测试入门',
            url: 'https://example.com/automated-testing',
            description: '从零开始学习自动化测试'
          }
        ]
      }
    ];
  }

  /**
   * 分析技能统计
   */
  private analyzeSkillsStats(skills: SkillData[]): SkillsStats {
    const overall = {
      totalSkills: skills.length,
      activeSkills: skills.filter(s => this.isSkillActive(s)).length,
      beginnerSkills: skills.filter(s => s.level === 'beginner').length,
      intermediateSkills: skills.filter(s => s.level === 'intermediate').length,
      advancedSkills: skills.filter(s => s.level === 'advanced').length,
      expertSkills: skills.filter(s => s.level === 'expert').length
    };

    const categories = this.analyzeCategories(skills);
    const usageStats = this.analyzeUsageStats(skills);
    const trends = this.analyzeTrends(skills);

    return {
      overall,
      categories,
      usageStats,
      trends
    };
  }

  /**
   * 分析类别
   */
  private analyzeCategories(skills: SkillData[]): Array<any> {
    const categoryMap = new Map();
    
    skills.forEach(skill => {
      if (!categoryMap.has(skill.category)) {
        categoryMap.set(skill.category, {
          category: skill.category,
          skillCount: 0,
          levels: []
        });
      }
      
      const categoryData = categoryMap.get(skill.category);
      categoryData.skillCount++;
      categoryData.levels.push(skill.level);
    });

    return Array.from(categoryMap.values()).map(category => ({
      category: category.category,
      skillCount: category.skillCount,
      averageLevel: this.calculateAverageLevel(category.levels),
      mostUsedSkill: this.getMostUsedSkillInCategory(skills, category.category)
    }));
  }

  /**
   * 分析使用统计
   */
  private analyzeUsageStats(skills: SkillData[]): any {
    return {
      highFrequency: skills.filter(s => s.usageFrequency === 'high' || s.usageFrequency === 'very-high').length,
      mediumFrequency: skills.filter(s => s.usageFrequency === 'medium').length,
      lowFrequency: skills.filter(s => s.usageFrequency === 'low').length,
      totalUsage: skills.length
    };
  }

  /**
   * 分析趋势
   */
  private analyzeTrends(skills: SkillData[]): any {
    // 模拟趋势数据
    return {
      newlyAdded: [
        { skill: '自动化测试', addedDate: new Date(Date.now() - 86400000), category: '测试' },
        { skill: '安全审计', addedDate: new Date(Date.now() - 172800000), category: '安全' }
      ],
      recentlyUsed: [
        { skill: '代码审查', lastUsed: new Date(), usageCount: 15 },
        { skill: '性能优化', lastUsed: new Date(Date.now() - 86400000), usageCount: 8 }
      ],
      skillGrowth: [
        { period: '本月', skillsAdded: 2, skillsImproved: 3 },
        { period: '本季度', skillsAdded: 5, skillsImproved: 8 }
      ]
    };
  }

  /**
   * 搜索技能
   */
  private performSkillsSearch(skills: SkillData[], searchTerm: string): SkillData[] {
    const lowerSearchTerm = searchTerm.toLowerCase();
    return skills.filter(skill => 
      skill.name.toLowerCase().includes(lowerSearchTerm) ||
      skill.description.toLowerCase().includes(lowerSearchTerm) ||
      skill.tags.some(tag => tag.toLowerCase().includes(lowerSearchTerm)) ||
      skill.category.toLowerCase().includes(lowerSearchTerm)
    );
  }

  /**
   * 检查技能是否活跃
   */
  private isSkillActive(skill: SkillData): boolean {
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    return skill.lastUsed > oneWeekAgo;
  }

  /**
   * 计算平均等级
   */
  private calculateAverageLevel(levels: string[]): string {
    const levelWeights = {
      'beginner': 1,
      'intermediate': 2,
      'advanced': 3,
      'expert': 4
    };
    
    const averageWeight = levels.reduce((sum, level) => sum + levelWeights[level as keyof typeof levelWeights], 0) / levels.length;
    
    if (averageWeight >= 3.5) return 'expert';
    if (averageWeight >= 2.5) return 'advanced';
    if (averageWeight >= 1.5) return 'intermediate';
    return 'beginner';
  }

  /**
   * 获取类别中最常用的技能
   */
  private getMostUsedSkillInCategory(skills: SkillData[], category: string): string {
    const categorySkills = skills.filter(s => s.category === category);
    if (categorySkills.length === 0) return '无';
    
    const usageWeights = {
      'very-high': 4,
      'high': 3,
      'medium': 2,
      'low': 1
    };
    
    return categorySkills.reduce((mostUsed, skill) => {
      const currentWeight = usageWeights[skill.usageFrequency as keyof typeof usageWeights];
      const mostUsedWeight = usageWeights[mostUsed.usageFrequency as keyof typeof usageWeights];
      return currentWeight > mostUsedWeight ? skill : mostUsed;
    }).name;
  }

  /**
   * 格式化技能列表
   */
  private formatSkillsList(skills: SkillData[]): string {
    return skills.map(skill => 
      `${this.getLevelIcon(skill.level)} ${skill.name} (${skill.category}) - ${skill.description}`
    ).join('\n');
  }

  /**
   * 格式化技能等级分布
   */
  private formatSkillsLevelDistribution(skills: SkillData[]): string {
    const levelCounts = {
      beginner: skills.filter(s => s.level === 'beginner').length,
      intermediate: skills.filter(s => s.level === 'intermediate').length,
      advanced: skills.filter(s => s.level === 'advanced').length,
      expert: skills.filter(s => s.level === 'expert').length
    };
    
    return `初学者: ${levelCounts.beginner} | 中级: ${levelCounts.intermediate}\n` +
           `高级: ${levelCounts.advanced} | 专家: ${levelCounts.expert}`;
  }

  /**
   * 获取类别数量
   */
  private getCategoryCount(skills: SkillData[]): string {
    const categories = new Set(skills.map(s => s.category));
    return `${categories.size} 个类别`;
  }

  /**
   * 格式化类别统计
   */
  private formatCategoryStats(categories: any[]): string {
    return categories.map(cat => 
      `${cat.category}: ${cat.skillCount}个技能 (平均等级: ${cat.averageLevel})`
    ).join('\n');
  }

  /**
   * 按类别格式化技能
   */
  private formatSkillsByCategory(skills: SkillData[]): any[] {
    const categoryMap = new Map();
    
    skills.forEach(skill => {
      if (!categoryMap.has(skill.category)) {
        categoryMap.set(skill.category, []);
      }
      categoryMap.get(skill.category).push(skill);
    });
    
    return Array.from(categoryMap.entries()).map(([category, categorySkills]) => ({
      title: category,
      content: categorySkills.map(skill => 
        `${this.getLevelIcon(skill.level)} ${skill.name} - ${skill.description}`
      ).join('\n')
    }));
  }

  /**
   * 格式化最常用技能
   */
  private formatMostUsedSkills(skills: SkillData[]): string {
    const sortedSkills = [...skills].sort((a, b) => {
      const usageWeights = { 'very-high': 4, 'high': 3, 'medium': 2, 'low': 1 };
      return usageWeights[b.usageFrequency as keyof typeof usageWeights] - usageWeights[a.usageFrequency as keyof typeof usageWeights];
    });
    
    return sortedSkills.slice(0, 5).map((skill, index) => 
      `${index + 1}. ${skill.name} (${skill.usageFrequency})`
    ).join('\n');
  }

  /**
   * 格式化最近使用技能
   */
  private formatRecentlyUsedSkills(skills: SkillData[]): string {
    const sortedSkills = [...skills].sort((a, b) => b.lastUsed.getTime() - a.lastUsed.getTime());
    
    return sortedSkills.slice(0, 5).map(skill => 
      `${skill.name} - ${this.formatRelativeTime(skill.lastUsed)}`
    ).join('\n');
  }

  /**
   * 格式化使用分析
   */
  private formatUsageAnalysis(skills: SkillData[]): string {
    const usageCounts = {
      high: skills.filter(s => s.usageFrequency === 'high' || s.usageFrequency === 'very-high').length,
      medium: skills.filter(s => s.usageFrequency === 'medium').length,
      low: skills.filter(s => s.usageFrequency === 'low').length
    };
    
    return `高频使用: ${usageCounts.high}个技能\n` +
           `中频使用: ${usageCounts.medium}个技能\n` +
           `低频使用: ${usageCounts.low}个技能`;
  }

  /**
   * 格式化新添加技能
   */
  private formatNewlyAddedSkills(newSkills: any[]): string {
    return newSkills.map(skill => 
      `${skill.skill} (${skill.category}) - 添加于 ${this.formatDate(skill.addedDate)}`
    ).join('\n') || '暂无新添加技能';
  }

  /**
   * 格式化最近使用趋势
   */
  private formatRecentlyUsedTrends(recentlyUsed: any[]): string {
    return recentlyUsed.map(skill => 
      `${skill.skill}: ${skill.usageCount}次使用`
    ).join('\n');
  }

  /**
   * 格式化技能增长趋势
   */
  private formatSkillGrowthTrends(growth: any[]): string {
    return growth.map(period => 
      `${period.period}: 新增${period.skillsAdded}个技能，改进${period.skillsImproved}个技能`
    ).join('\n');
  }

  /**
   * 格式化搜索结果
   */
  private formatSearchResults(results: SkillData[]): string {
    return results.map(skill => 
      `${this.getLevelIcon(skill.level)} ${skill.name} (${skill.category})\n` +
      `  描述: ${skill.description}\n` +
      `  标签: ${skill.tags.join(', ')}`
    ).join('\n\n');
  }

  /**
   * 获取等级图标
   */
  private getLevelIcon(level: string): string {
    switch (level) {
      case 'beginner': return '🟢';
      case 'intermediate': return '🟡';
      case 'advanced': return '🟠';
      case 'expert': return '🔴';
      default: return '⚪';
    }
  }

  /**
   * 格式化相对时间
   */
  private formatRelativeTime(date: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) return '今天';
    if (diffDays === 1) return '昨天';
    if (diffDays < 7) return `${diffDays}天前`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)}周前`;
    return `${Math.floor(diffDays / 30)}月前`;
  }

  /**
   * 格式化日期
   */
  private formatDate(date: Date): string {
    return date.toLocaleDateString('zh-CN');
  }
}
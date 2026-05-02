/**
 * Plugins命令实现
 * 插件管理和配置
 */
import type { CommandImplementation } from '../../types/index.js';

/**
 * 插件数据定义
 */
interface PluginData {
  /** 插件名称 */
  name: string;
  /** 插件描述 */
  description: string;
  /** 插件版本 */
  version: string;
  /** 插件作者 */
  author: string;
  /** 插件类型 */
  type: 'utility' | 'integration' | 'ui' | 'analytics' | 'security' | 'custom';
  /** 插件状态 */
  status: 'enabled' | 'disabled' | 'error' | 'loading';
  /** 插件路径 */
  path: string;
  /** 插件配置 */
  config: Record<string, any>;
  /** 依赖关系 */
  dependencies: string[];
  /** 冲突插件 */
  conflicts: string[];
  /** 插件钩子 */
  hooks: Array<{
    name: string;
    type: string;
    description: string;
    enabled: boolean;
  }>;
  /** 插件命令 */
  commands: Array<{
    name: string;
    description: string;
    enabled: boolean;
  }>;
  /** 性能指标 */
  metrics: {
    loadTime: number;
    memoryUsage: number;
    cpuUsage: number;
    errorCount: number;
    lastError?: string;
  };
  /** 使用统计 */
  usageStats: {
    totalUses: number;
    successfulUses: number;
    failedUses: number;
    lastUsed?: Date;
  };
}

/**
 * 插件管理数据定义
 */
interface PluginsManagementData {
  /** 总体统计 */
  overall: {
    totalPlugins: number;
    enabledPlugins: number;
    disabledPlugins: number;
    errorPlugins: number;
    totalHooks: number;
    totalCommands: number;
    averageLoadTime: number;
  };
  /** 插件列表 */
  plugins: PluginData[];
  /** 类型统计 */
  typeStats: Array<{
    type: string;
    count: number;
    enabledCount: number;
    errorRate: number;
  }>;
  /** 依赖关系图 */
  dependencyGraph: Array<{
    plugin: string;
    dependsOn: string[];
    requiredBy: string[];
  }>;
  /** 性能统计 */
  performanceStats: Array<{
    plugin: string;
    loadTime: number;
    memoryUsage: number;
    errorCount: number;
  }>;
  /** 最近活动 */
  recentActivity: Array<{
    plugin: string;
    action: string;
    timestamp: Date;
    details: string;
  }>;
}

/**
 * Plugins命令实现类
 */
export class Plugins implements CommandImplementation {
  /**
   * 执行plugins命令
   * @param args 命令参数
   * @param context 命令上下文
   * @returns 命令执行结果
   */
  async execute(args: string, context: any): Promise<any> {
    try {
      // 解析参数
      const params = this.parseArgs(args);
      
      // 根据参数执行不同的插件操作
      if (params.listPlugins) {
        return await this.listPlugins(context);
      } else if (params.showStatus) {
        return await this.showPluginsStatus(context);
      } else if (params.managePlugins) {
        return await this.managePlugins(context);
      } else if (params.showDependencies) {
        return await this.showDependencies(context);
      } else if (params.testPlugins) {
        return await this.testPlugins(context);
      } else if (params.searchPlugin) {
        return await this.searchPlugins(context, params.searchPlugin);
      } else {
        // 默认显示插件概览
        return await this.showPluginsOverview(context);
      }
    } catch (error) {
      return {
        success: false,
        error: `Failed to execute plugins command: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * 解析命令参数
   * @param args 命令参数
   * @returns 解析后的参数
   */
  private parseArgs(args: string): {
    listPlugins: boolean;
    showStatus: boolean;
    managePlugins: boolean;
    showDependencies: boolean;
    testPlugins: boolean;
    searchPlugin: string;
  } {
    const params = {
      listPlugins: false,
      showStatus: false,
      managePlugins: false,
      showDependencies: false,
      testPlugins: false,
      searchPlugin: '',
    };

    // 使用正则表达式精确匹配参数
    const listRegex = /(^|\s)(--list|-l)(\s|$)/;
    const statusRegex = /(^|\s)(--status|-s)(\s|$)/;
    const manageRegex = /(^|\s)(--manage|-m)(\s|$)/;
    const dependenciesRegex = /(^|\s)(--dependencies|-d)(\s|$)/;
    const testRegex = /(^|\s)(--test|-t)(\s|$)/;
    
    // 搜索插件参数处理
    const searchMatch = args.match(/--search=([^\s]+)|-e=([^\s]+)/);
    if (searchMatch) {
      params.searchPlugin = searchMatch[1] || searchMatch[2] || '';
    }

    // 设置参数优先级：search > test > manage > dependencies > status > list > overview
    if (searchMatch) {
      params.searchPlugin = searchMatch[1] || searchMatch[2] || '';
    } else if (testRegex.test(args)) {
      params.testPlugins = true;
    } else if (manageRegex.test(args)) {
      params.managePlugins = true;
    } else if (dependenciesRegex.test(args)) {
      params.showDependencies = true;
    } else if (statusRegex.test(args)) {
      params.showStatus = true;
    } else if (listRegex.test(args)) {
      params.listPlugins = true;
    }

    return params;
  }

  /**
   * 显示插件概览
   * @param context 命令上下文
   * @returns 插件概览结果
   */
  private async showPluginsOverview(context: any): Promise<any> {
    const pluginsData = await this.collectPluginsData(context);
    
    const pluginsOverview = {
      title: '插件系统概览',
      sections: [
        {
          title: '系统状态',
          content: `总插件数: ${pluginsData.overall.totalPlugins}\n` +
                   `启用插件: ${pluginsData.overall.enabledPlugins}\n` +
                   `禁用插件: ${pluginsData.overall.disabledPlugins}\n` +
                   `错误插件: ${pluginsData.overall.errorPlugins}\n` +
                   `总钩子数: ${pluginsData.overall.totalHooks}\n` +
                   `总命令数: ${pluginsData.overall.totalCommands}`
        },
        {
          title: '类型分布',
          content: this.formatTypeDistribution(pluginsData.typeStats)
        },
        {
          title: '最近活动',
          content: this.formatRecentActivity(pluginsData.recentActivity)
        }
      ]
    };

    return {
      success: true,
      type: 'plugins',
      data: pluginsOverview,
      display: 'table'
    };
  }

  /**
   * 列出插件
   * @param context 命令上下文
   * @returns 插件列表结果
   */
  private async listPlugins(context: any): Promise<any> {
    const pluginsData = await this.collectPluginsData(context);
    
    const pluginsList = {
      title: '插件列表',
      sections: [
        {
          title: '插件概览',
          content: `总插件数: ${pluginsData.plugins.length}\n` +
                   `按类型分组: ${pluginsData.typeStats.length} 种类型`
        },
        {
          title: '插件详情',
          content: this.formatPluginsList(pluginsData.plugins)
        },
        {
          title: '性能统计',
          content: this.formatPerformanceStats(pluginsData.performanceStats)
        }
      ]
    };

    return {
      success: true,
      type: 'plugins',
      data: pluginsList,
      display: 'table'
    };
  }

  /**
   * 显示插件状态
   * @param context 命令上下文
   * @returns 插件状态结果
   */
  private async showPluginsStatus(context: any): Promise<any> {
    const pluginsData = await this.collectPluginsData(context);
    
    const statusReport = {
      title: '插件状态报告',
      sections: [
        {
          title: '总体状态',
          content: this.formatOverallStatus(pluginsData.overall)
        },
        {
          title: '插件状态',
          content: this.formatPluginsStatus(pluginsData.plugins)
        },
        {
          title: '健康度分析',
          content: this.formatHealthAnalysis(pluginsData.plugins)
        }
      ]
    };

    return {
      success: true,
      type: 'plugins',
      data: statusReport,
      display: 'table'
    };
  }

  /**
   * 管理插件
   * @param context 命令上下文
   * @returns 插件管理结果
   */
  private async managePlugins(context: any): Promise<any> {
    const pluginsData = await this.collectPluginsData(context);
    const managementResults = await this.performPluginsManagement(pluginsData.plugins);
    
    const managementReport = {
      title: '插件管理报告',
      sections: [
        {
          title: '管理操作',
          content: managementResults.operations.join('\n')
        },
        {
          title: '状态变更',
          content: managementResults.statusChanges.join('\n') || '无状态变更'
        },
        {
          title: '优化建议',
          content: managementResults.recommendations.join('\n')
        }
      ]
    };

    return {
      success: true,
      type: 'plugins',
      data: managementReport,
      display: 'table'
    };
  }

  /**
   * 显示依赖关系
   * @param context 命令上下文
   * @returns 依赖关系结果
   */
  private async showDependencies(context: any): Promise<any> {
    const pluginsData = await this.collectPluginsData(context);
    
    const dependenciesReport = {
      title: '插件依赖关系',
      sections: [
        {
          title: '依赖概览',
          content: `总插件数: ${pluginsData.plugins.length}\n` +
                   `总依赖关系: ${pluginsData.dependencyGraph.reduce((sum, d) => sum + d.dependsOn.length, 0)} 个`
        },
        {
          title: '依赖关系图',
          content: this.formatDependencyGraph(pluginsData.dependencyGraph)
        },
        {
          title: '冲突检测',
          content: this.formatConflictDetection(pluginsData.plugins)
        }
      ]
    };

    return {
      success: true,
      type: 'plugins',
      data: dependenciesReport,
      display: 'table'
    };
  }

  /**
   * 测试插件
   * @param context 命令上下文
   * @returns 插件测试结果
   */
  private async testPlugins(context: any): Promise<any> {
    const pluginsData = await this.collectPluginsData(context);
    const testResults = await this.runPluginsTests(pluginsData.plugins);
    
    const testReport = {
      title: '插件测试报告',
      sections: [
        {
          title: '测试概览',
          content: this.formatTestOverview(testResults)
        },
        {
          title: '详细结果',
          content: this.formatTestDetails(testResults)
        },
        {
          title: '问题汇总',
          content: this.formatTestIssues(testResults)
        }
      ]
    };

    return {
      success: true,
      type: 'plugins',
      data: testReport,
      display: 'table'
    };
  }

  /**
   * 搜索插件
   * @param context 命令上下文
   * @param searchTerm 搜索关键词
   * @returns 搜索结果
   */
  private async searchPlugins(context: any, searchTerm: string): Promise<any> {
    const pluginsData = await this.collectPluginsData(context);
    const searchResults = this.performPluginsSearch(pluginsData.plugins, searchTerm);
    
    const searchReport = {
      title: `插件搜索: "${searchTerm}"`,
      sections: [
        {
          title: '搜索结果',
          content: this.formatSearchResults(searchResults)
        },
        {
          title: '搜索统计',
          content: `找到 ${searchResults.length} 个相关插件`
        }
      ]
    };

    return {
      success: true,
      type: 'plugins',
      data: searchReport,
      display: 'table'
    };
  }

  /**
   * 收集插件数据
   * @param context 命令上下文
   * @returns 插件数据
   */
  private async collectPluginsData(context: any): Promise<PluginsManagementData> {
    // 这里应该从实际的插件管理系统中获取数据
    // 目前使用模拟数据，后续需要集成真实的插件管理系统
    
    const plugins: PluginData[] = [
      {
        name: 'file-manager',
        description: '文件管理插件',
        version: '1.2.0',
        author: '系统团队',
        type: 'utility',
        status: 'enabled',
        path: '/plugins/file-manager',
        config: { maxFileSize: 10485760, allowedExtensions: ['txt', 'json', 'md'] },
        dependencies: ['utils', 'security'],
        conflicts: ['legacy-file-manager'],
        hooks: [
          { name: 'pre-file-upload', type: 'pre-execution', description: '文件上传前检查', enabled: true },
          { name: 'post-file-save', type: 'post-execution', description: '文件保存后处理', enabled: true }
        ],
        commands: [
          { name: 'file-list', description: '列出文件', enabled: true },
          { name: 'file-upload', description: '上传文件', enabled: true }
        ],
        metrics: {
          loadTime: 120,
          memoryUsage: 5242880,
          cpuUsage: 2.5,
          errorCount: 3,
          lastError: '权限不足'
        },
        usageStats: {
          totalUses: 450,
          successfulUses: 445,
          failedUses: 5,
          lastUsed: new Date()
        }
      },
      {
        name: 'database-connector',
        description: '数据库连接插件',
        version: '2.1.0',
        author: '数据团队',
        type: 'integration',
        status: 'enabled',
        path: '/plugins/database-connector',
        config: { timeout: 30000, maxConnections: 10, retryCount: 3 },
        dependencies: ['utils', 'network'],
        conflicts: [],
        hooks: [
          { name: 'pre-db-query', type: 'pre-execution', description: '数据库查询前处理', enabled: true },
          { name: 'post-db-result', type: 'post-execution', description: '数据库结果后处理', enabled: true }
        ],
        commands: [
          { name: 'db-query', description: '执行数据库查询', enabled: true },
          { name: 'db-schema', description: '查看数据库结构', enabled: true }
        ],
        metrics: {
          loadTime: 250,
          memoryUsage: 10485760,
          cpuUsage: 5.2,
          errorCount: 12,
          lastError: '连接超时'
        },
        usageStats: {
          totalUses: 320,
          successfulUses: 308,
          failedUses: 12,
          lastUsed: new Date(Date.now() - 3600000)
        }
      },
      {
        name: 'analytics-tracker',
        description: '数据分析插件',
        version: '1.0.5',
        author: '分析团队',
        type: 'analytics',
        status: 'disabled',
        path: '/plugins/analytics-tracker',
        config: { trackEvents: true, anonymizeData: true, retentionDays: 90 },
        dependencies: ['utils', 'storage'],
        conflicts: [],
        hooks: [
          { name: 'track-event', type: 'custom', description: '事件跟踪', enabled: false }
        ],
        commands: [
          { name: 'analytics-report', description: '生成分析报告', enabled: false }
        ],
        metrics: {
          loadTime: 0,
          memoryUsage: 0,
          cpuUsage: 0,
          errorCount: 0
        },
        usageStats: {
          totalUses: 0,
          successfulUses: 0,
          failedUses: 0
        }
      },
      {
        name: 'security-scanner',
        description: '安全扫描插件',
        version: '1.3.2',
        author: '安全团队',
        type: 'security',
        status: 'error',
        path: '/plugins/security-scanner',
        config: { scanInterval: 3600, reportLevel: 'high', autoFix: false },
        dependencies: ['utils', 'file-manager'],
        conflicts: ['old-scanner'],
        hooks: [
          { name: 'pre-security-scan', type: 'pre-execution', description: '安全扫描前处理', enabled: false }
        ],
        commands: [
          { name: 'security-scan', description: '执行安全扫描', enabled: false }
        ],
        metrics: {
          loadTime: 0,
          memoryUsage: 0,
          cpuUsage: 0,
          errorCount: 5,
          lastError: '依赖插件未找到'
        },
        usageStats: {
          totalUses: 0,
          successfulUses: 0,
          failedUses: 5,
          lastUsed: new Date(Date.now() - 86400000)
        }
      }
    ];

    const overall = this.analyzeOverallStats(plugins);
    const typeStats = this.analyzeTypeStats(plugins);
    const dependencyGraph = this.buildDependencyGraph(plugins);
    const performanceStats = this.getPerformanceStats(plugins);
    const recentActivity = this.getRecentActivity(plugins);

    return {
      overall,
      plugins,
      typeStats,
      dependencyGraph,
      performanceStats,
      recentActivity
    };
  }

  /**
   * 分析总体统计
   */
  private analyzeOverallStats(plugins: PluginData[]): any {
    const totalPlugins = plugins.length;
    const enabledPlugins = plugins.filter(p => p.status === 'enabled').length;
    const disabledPlugins = plugins.filter(p => p.status === 'disabled').length;
    const errorPlugins = plugins.filter(p => p.status === 'error').length;
    
    const totalHooks = plugins.reduce((sum, p) => sum + p.hooks.length, 0);
    const totalCommands = plugins.reduce((sum, p) => sum + p.commands.length, 0);
    const averageLoadTime = plugins.length > 0 ? 
      plugins.reduce((sum, p) => sum + p.metrics.loadTime, 0) / plugins.length : 0;

    return {
      totalPlugins,
      enabledPlugins,
      disabledPlugins,
      errorPlugins,
      totalHooks,
      totalCommands,
      averageLoadTime
    };
  }

  /**
   * 分析类型统计
   */
  private analyzeTypeStats(plugins: PluginData[]): Array<any> {
    const typeMap = new Map();
    
    plugins.forEach(plugin => {
      if (!typeMap.has(plugin.type)) {
        typeMap.set(plugin.type, {
          type: plugin.type,
          count: 0,
          enabledCount: 0,
          errorCount: 0
        });
      }
      
      const typeData = typeMap.get(plugin.type);
      typeData.count++;
      if (plugin.status === 'enabled') {
        typeData.enabledCount++;
      }
      if (plugin.status === 'error') {
        typeData.errorCount++;
      }
    });

    return Array.from(typeMap.values()).map(typeData => ({
      type: typeData.type,
      count: typeData.count,
      enabledCount: typeData.enabledCount,
      errorRate: typeData.count > 0 ? (typeData.errorCount / typeData.count) * 100 : 0
    }));
  }

  /**
   * 构建依赖关系图
   */
  private buildDependencyGraph(plugins: PluginData[]): Array<any> {
    return plugins.map(plugin => ({
      plugin: plugin.name,
      dependsOn: plugin.dependencies,
      requiredBy: plugins
        .filter(p => p.dependencies.includes(plugin.name))
        .map(p => p.name)
    }));
  }

  /**
   * 获取性能统计
   */
  private getPerformanceStats(plugins: PluginData[]): Array<any> {
    return plugins.map(plugin => ({
      plugin: plugin.name,
      loadTime: plugin.metrics.loadTime,
      memoryUsage: plugin.metrics.memoryUsage,
      errorCount: plugin.metrics.errorCount
    }));
  }

  /**
   * 获取最近活动
   */
  private getRecentActivity(plugins: PluginData[]): Array<any> {
    const activities: Array<any> = [];
    
    plugins.forEach(plugin => {
      if (plugin.usageStats.lastUsed) {
        activities.push({
          plugin: plugin.name,
          action: '使用',
          timestamp: plugin.usageStats.lastUsed,
          details: `使用次数: ${plugin.usageStats.totalUses}`
        });
      }
      
      if (plugin.metrics.lastError) {
        activities.push({
          plugin: plugin.name,
          action: '错误',
          timestamp: new Date(),
          details: `错误信息: ${plugin.metrics.lastError}`
        });
      }
    });

    return activities.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime()).slice(0, 5);
  }

  /**
   * 执行插件管理
   */
  private async performPluginsManagement(plugins: PluginData[]): Promise<any> {
    const operations: string[] = [];
    const statusChanges: string[] = [];
    const recommendations: string[] = [];

    // 检查错误插件
    const errorPlugins = plugins.filter(p => p.status === 'error');
    if (errorPlugins.length > 0) {
      operations.push(`发现 ${errorPlugins.length} 个错误插件需要修复`);
      recommendations.push('检查错误插件的依赖关系和配置');
    }

    // 检查禁用插件
    const disabledPlugins = plugins.filter(p => p.status === 'disabled');
    if (disabledPlugins.length > 0) {
      operations.push(`发现 ${disabledPlugins.length} 个禁用插件`);
      recommendations.push('考虑启用有用的禁用插件');
    }

    // 检查性能问题
    const slowPlugins = plugins.filter(p => p.metrics.loadTime > 200);
    if (slowPlugins.length > 0) {
      operations.push(`发现 ${slowPlugins.length} 个加载缓慢的插件`);
      recommendations.push('优化慢速插件的加载性能');
    }

    return { operations, statusChanges, recommendations };
  }

  /**
   * 运行插件测试
   */
  private async runPluginsTests(plugins: PluginData[]): Promise<any[]> {
    return plugins.map(plugin => ({
      plugin: plugin.name,
      status: plugin.status === 'error' ? 'failed' : 'passed',
      loadTime: plugin.metrics.loadTime,
      issues: plugin.status === 'error' ? ['插件状态异常'] : []
    }));
  }

  /**
   * 执行插件搜索
   */
  private performPluginsSearch(plugins: PluginData[], searchTerm: string): PluginData[] {
    return plugins.filter(plugin => 
      plugin.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      plugin.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
      plugin.author.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }

  /**
   * 格式化类型分布
   */
  private formatTypeDistribution(typeStats: any[]): string {
    return typeStats.map(stat => 
      `${stat.type}: ${stat.count}个插件 (${stat.enabledCount}启用, ${stat.errorRate.toFixed(1)}%错误率)`
    ).join('\n');
  }

  /**
   * 格式化最近活动
   */
  private formatRecentActivity(activities: any[]): string {
    return activities.map(activity => 
      `${activity.plugin}: ${activity.action} - ${this.formatRelativeTime(activity.timestamp)}`
    ).join('\n') || '无最近活动';
  }

  /**
   * 格式化插件列表
   */
  private formatPluginsList(plugins: PluginData[]): string {
    return plugins.map(plugin => 
      `${this.getPluginStatusIcon(plugin.status)} ${plugin.name} v${plugin.version} - ${plugin.description}`
    ).join('\n');
  }

  /**
   * 格式化性能统计
   */
  private formatPerformanceStats(performanceStats: any[]): string {
    return performanceStats.map(stat => 
      `${stat.plugin}: ${stat.loadTime}ms加载, ${this.formatMemoryUsage(stat.memoryUsage)}内存, ${stat.errorCount}错误`
    ).join('\n');
  }

  /**
   * 格式化总体状态
   */
  private formatOverallStatus(overall: any): string {
    return `插件总数: ${overall.totalPlugins}\n` +
           `启用插件: ${overall.enabledPlugins}\n` +
           `禁用插件: ${overall.disabledPlugins}\n` +
           `错误插件: ${overall.errorPlugins}\n` +
           `平均加载时间: ${overall.averageLoadTime.toFixed(1)}ms`;
  }

  /**
   * 格式化插件状态
   */
  private formatPluginsStatus(plugins: PluginData[]): string {
    return plugins.map(plugin => 
      `${plugin.name}: ${plugin.status} - ${plugin.metrics.errorCount}错误 - ${plugin.usageStats.totalUses}次使用`
    ).join('\n');
  }

  /**
   * 格式化健康度分析
   */
  private formatHealthAnalysis(plugins: PluginData[]): string {
    const healthyPlugins = plugins.filter(p => p.status === 'enabled' && p.metrics.errorCount === 0).length;
    const totalPlugins = plugins.length;
    const healthPercentage = totalPlugins > 0 ? (healthyPlugins / totalPlugins) * 100 : 0;
    
    return `健康插件: ${healthyPlugins}/${totalPlugins} (${healthPercentage.toFixed(1)}%)\n` +
           `平均错误数: ${plugins.reduce((sum, p) => sum + p.metrics.errorCount, 0) / totalPlugins}`;
  }

  /**
   * 格式化依赖关系图
   */
  private formatDependencyGraph(dependencyGraph: any[]): string {
    return dependencyGraph.map(item => 
      `${item.plugin}: 依赖 ${item.dependsOn.length}个, 被 ${item.requiredBy.length}个依赖`
    ).join('\n');
  }

  /**
   * 格式化冲突检测
   */
  private formatConflictDetection(plugins: PluginData[]): string {
    const conflicts = plugins.filter(p => p.conflicts.length > 0);
    if (conflicts.length === 0) return '无冲突检测';
    
    return conflicts.map(plugin => 
      `${plugin.name}: 冲突插件 ${plugin.conflicts.join(', ')}`
    ).join('\n');
  }

  /**
   * 格式化测试概览
   */
  private formatTestOverview(results: any[]): string {
    const passed = results.filter(r => r.status === 'passed').length;
    const failed = results.filter(r => r.status === 'failed').length;
    
    return `测试插件数: ${results.length}\n` +
           `通过: ${passed} | 失败: ${failed}\n` +
           `通过率: ${((passed / results.length) * 100).toFixed(1)}%`;
  }

  /**
   * 格式化测试详情
   */
  private formatTestDetails(results: any[]): string {
    return results.map(result => 
      `${this.getTestStatusIcon(result.status)} ${result.plugin}: ${result.status} (${result.loadTime}ms)`
    ).join('\n');
  }

  /**
   * 格式化测试问题
   */
  private formatTestIssues(results: any[]): string {
    const failedTests = results.filter(r => r.status === 'failed');
    if (failedTests.length === 0) return '所有测试通过';
    
    return failedTests.map(test => 
      `${test.plugin}: ${test.issues.join(', ')}`
    ).join('\n');
  }

  /**
   * 格式化搜索结果
   */
  private formatSearchResults(results: PluginData[]): string {
    if (results.length === 0) return '未找到相关插件';
    
    return results.map(plugin => 
      `${this.getPluginStatusIcon(plugin.status)} ${plugin.name} - ${plugin.description}`
    ).join('\n');
  }

  /**
   * 获取插件状态图标
   */
  private getPluginStatusIcon(status: string): string {
    switch (status) {
      case 'enabled': return '✅';
      case 'disabled': return '⚪';
      case 'error': return '❌';
      case 'loading': return '🔄';
      default: return '❓';
    }
  }

  /**
   * 获取测试状态图标
   */
  private getTestStatusIcon(status: string): string {
    switch (status) {
      case 'passed': return '✅';
      case 'failed': return '❌';
      default: return '⚠️';
    }
  }

  /**
   * 格式化内存使用
   */
  private formatMemoryUsage(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / 1048576).toFixed(1)}MB`;
  }

  /**
   * 格式化相对时间
   */
  private formatRelativeTime(date: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffMinutes = Math.floor(diffMs / (1000 * 60));

    if (diffDays > 0) {
      return `${diffDays}天前`;
    } else if (diffHours > 0) {
      return `${diffHours}小时前`;
    } else if (diffMinutes > 0) {
      return `${diffMinutes}分钟前`;
    } else {
      return '刚刚';
    }
  }
}
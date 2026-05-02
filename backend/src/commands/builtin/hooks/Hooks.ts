/**
 * Hooks命令实现
 * 钩子管理和执行
 */
import type { CommandImplementation } from '../../types/index.js';

/**
 * 钩子数据定义
 */
interface HookData {
  /** 钩子名称 */
  name: string;
  /** 钩子描述 */
  description: string;
  /** 钩子类型 */
  type: 'pre-command' | 'post-command' | 'pre-execution' | 'post-execution' | 'custom';
  /** 触发事件 */
  trigger: string;
  /** 执行条件 */
  condition?: string;
  /** 钩子脚本 */
  script: string;
  /** 执行状态 */
  status: 'active' | 'inactive' | 'error';
  /** 最后执行时间 */
  lastExecuted?: Date;
  /** 执行结果 */
  lastResult?: 'success' | 'failure' | 'skipped';
  /** 执行统计 */
  stats: {
    totalExecutions: number;
    successfulExecutions: number;
    failedExecutions: number;
    skippedExecutions: number;
    averageExecutionTime: number;
  };
  /** 依赖关系 */
  dependencies: string[];
  /** 配置参数 */
  config: Record<string, any>;
}

/**
 * 钩子执行结果定义
 */
interface HookExecutionResult {
  /** 钩子名称 */
  hook: string;
  /** 执行状态 */
  status: 'success' | 'failure' | 'skipped';
  /** 执行时间（毫秒） */
  executionTime: number;
  /** 输出结果 */
  output?: string;
  /** 错误信息 */
  error?: string;
  /** 触发事件 */
  triggeredBy: string;
}

/**
 * 钩子管理数据定义
 */
interface HooksManagementData {
  /** 总体统计 */
  overall: {
    totalHooks: number;
    activeHooks: number;
    inactiveHooks: number;
    errorHooks: number;
    totalExecutions: number;
    successRate: number;
  };
  /** 钩子列表 */
  hooks: HookData[];
  /** 类型统计 */
  typeStats: Array<{
    type: string;
    count: number;
    successRate: number;
    averageTime: number;
  }>;
  /** 最近执行记录 */
  recentExecutions: HookExecutionResult[];
  /** 钩子依赖图 */
  dependencyGraph: Array<{
    hook: string;
    dependsOn: string[];
    requiredBy: string[];
  }>;
}

/**
 * Hooks命令实现类
 */
export class Hooks implements CommandImplementation {
  /**
   * 执行hooks命令
   * @param args 命令参数
   * @param context 命令上下文
   * @returns 命令执行结果
   */
  async execute(args: string, context: any): Promise<any> {
    try {
      // 解析参数
      const params = this.parseArgs(args);
      
      // 根据参数执行不同的钩子操作
      if (params.listHooks) {
        return await this.listAllHooks(context);
      } else if (params.showStats) {
        return await this.showHooksStats(context);
      } else if (params.executeHook) {
        return await this.executeSpecificHook(context, params.executeHook);
      } else if (params.testHooks) {
        return await this.testHooks(context);
      } else if (params.manageHooks) {
        return await this.manageHooks(context);
      } else {
        // 默认显示钩子概览
        return await this.showHooksOverview(context);
      }
    } catch (error) {
      return {
        success: false,
        error: `Failed to execute hooks command: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * 解析命令参数
   * @param args 命令参数
   * @returns 解析后的参数
   */
  private parseArgs(args: string): {
    listHooks: boolean;
    showStats: boolean;
    executeHook: string;
    testHooks: boolean;
    manageHooks: boolean;
  } {
    const params = {
      listHooks: false,
      showStats: false,
      executeHook: '',
      testHooks: false,
      manageHooks: false,
    };

    // 使用正则表达式精确匹配参数
    const listRegex = /(^|\s)(--list|-l)(\s|$)/;
    const statsRegex = /(^|\s)(--stats|-s)(\s|$)/;
    const testRegex = /(^|\s)(--test|-t)(\s|$)/;
    const manageRegex = /(^|\s)(--manage|-m)(\s|$)/;
    
    // 执行特定钩子参数处理
    const executeMatch = args.match(/--execute=([^\s]+)|-e=([^\s]+)/);
    if (executeMatch) {
      params.executeHook = executeMatch[1] || executeMatch[2] || '';
    }

    // 设置参数优先级：execute > test > manage > stats > list > overview
    if (executeMatch) {
      // execute参数优先级最高
      params.executeHook = executeMatch[1] || executeMatch[2] || '';
    } else if (testRegex.test(args)) {
      params.testHooks = true;
    } else if (manageRegex.test(args)) {
      params.manageHooks = true;
    } else if (statsRegex.test(args)) {
      params.showStats = true;
    } else if (listRegex.test(args)) {
      params.listHooks = true;
    }

    return params;
  }

  /**
   * 显示钩子概览
   * @param context 命令上下文
   * @returns 钩子概览结果
   */
  private async showHooksOverview(context: any): Promise<any> {
    const hooksData = await this.collectHooksData(context);
    
    const hooksOverview = {
      title: '钩子系统概览',
      sections: [
        {
          title: '系统状态',
          content: `总钩子数: ${hooksData.overall.totalHooks}\n` +
                   `活跃钩子: ${hooksData.overall.activeHooks}\n` +
                   `非活跃钩子: ${hooksData.overall.inactiveHooks}\n` +
                   `错误钩子: ${hooksData.overall.errorHooks}\n` +
                   `成功率: ${hooksData.overall.successRate.toFixed(1)}%`
        },
        {
          title: '类型分布',
          content: this.formatTypeDistribution(hooksData.typeStats)
        },
        {
          title: '最近执行',
          content: this.formatRecentExecutions(hooksData.recentExecutions)
        }
      ]
    };

    return {
      success: true,
      type: 'hooks',
      data: hooksOverview,
      display: 'table'
    };
  }

  /**
   * 列出所有钩子
   * @param context 命令上下文
   * @returns 钩子列表结果
   */
  private async listAllHooks(context: any): Promise<any> {
    const hooksData = await this.collectHooksData(context);
    
    const hooksList = {
      title: '所有钩子列表',
      sections: [
        {
          title: '钩子概览',
          content: `总钩子数: ${hooksData.hooks.length}\n` +
                   `按类型分组: ${hooksData.typeStats.length} 种类型`
        },
        {
          title: '钩子详情',
          content: this.formatHooksList(hooksData.hooks)
        },
        {
          title: '依赖关系',
          content: this.formatDependencyGraph(hooksData.dependencyGraph)
        }
      ]
    };

    return {
      success: true,
      type: 'hooks',
      data: hooksList,
      display: 'table'
    };
  }

  /**
   * 显示钩子统计
   * @param context 命令上下文
   * @returns 钩子统计结果
   */
  private async showHooksStats(context: any): Promise<any> {
    const hooksData = await this.collectHooksData(context);
    
    const hooksStats = {
      title: '钩子统计分析',
      sections: [
        {
          title: '执行统计',
          content: this.formatExecutionStats(hooksData.overall)
        },
        {
          title: '类型性能',
          content: this.formatTypePerformance(hooksData.typeStats)
        },
        {
          title: '性能分析',
          content: this.formatPerformanceAnalysis(hooksData.hooks)
        }
      ]
    };

    return {
      success: true,
      type: 'hooks',
      data: hooksStats,
      display: 'table'
    };
  }

  /**
   * 执行特定钩子
   * @param context 命令上下文
   * @param hookName 钩子名称
   * @returns 执行结果
   */
  private async executeSpecificHook(context: any, hookName: string): Promise<any> {
    const hooksData = await this.collectHooksData(context);
    const hook = hooksData.hooks.find(h => h.name === hookName);
    
    if (!hook) {
      return {
        success: false,
        error: `钩子 "${hookName}" 不存在`
      };
    }
    
    const executionResult = await this.executeHook(hook, context);
    
    const executionReport = {
      title: `钩子执行报告: ${hookName}`,
      sections: [
        {
          title: '执行结果',
          content: this.formatExecutionResult(executionResult)
        },
        {
          title: '钩子信息',
          content: this.formatHookInfo(hook)
        },
        {
          title: '执行详情',
          content: executionResult.output || '无输出'
        }
      ]
    };

    return {
      success: true,
      type: 'hooks',
      data: executionReport,
      display: 'table'
    };
  }

  /**
   * 测试钩子
   * @param context 命令上下文
   * @returns 测试结果
   */
  private async testHooks(context: any): Promise<any> {
    const hooksData = await this.collectHooksData(context);
    const testResults = await this.runHookTests(hooksData.hooks, context);
    
    const testReport = {
      title: '钩子测试报告',
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
      type: 'hooks',
      data: testReport,
      display: 'table'
    };
  }

  /**
   * 管理钩子
   * @param context 命令上下文
   * @returns 管理结果
   */
  private async manageHooks(context: any): Promise<any> {
    const hooksData = await this.collectHooksData(context);
    const managementResults = await this.performHookManagement(hooksData.hooks);
    
    const managementReport = {
      title: '钩子管理报告',
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
      type: 'hooks',
      data: managementReport,
      display: 'table'
    };
  }

  /**
   * 收集钩子数据
   * @param context 命令上下文
   * @returns 钩子数据
   */
  private async collectHooksData(context: any): Promise<HooksManagementData> {
    // 这里应该从实际的钩子管理系统中获取数据
    // 目前使用模拟数据，后续需要集成真实的钩子管理系统
    
    const hooks: HookData[] = [
      {
        name: 'pre-command-validation',
        description: '命令执行前的参数验证',
        type: 'pre-command',
        trigger: 'command.execute',
        condition: 'params.length > 0',
        script: 'validateCommandParams(params)',
        status: 'active',
        lastExecuted: new Date(),
        lastResult: 'success',
        stats: {
          totalExecutions: 150,
          successfulExecutions: 148,
          failedExecutions: 2,
          skippedExecutions: 0,
          averageExecutionTime: 45
        },
        dependencies: ['utils'],
        config: { timeout: 5000 }
      },
      {
        name: 'post-command-logging',
        description: '命令执行后的日志记录',
        type: 'post-command',
        trigger: 'command.completed',
        script: 'logCommandExecution(result)',
        status: 'active',
        lastExecuted: new Date(Date.now() - 3600000),
        lastResult: 'success',
        stats: {
          totalExecutions: 150,
          successfulExecutions: 150,
          failedExecutions: 0,
          skippedExecutions: 0,
          averageExecutionTime: 25
        },
        dependencies: ['logger'],
        config: { logLevel: 'info' }
      },
      {
        name: 'pre-execution-security',
        description: '执行前的安全检查',
        type: 'pre-execution',
        trigger: 'execution.start',
        condition: 'isSensitiveOperation(operation)',
        script: 'checkSecurityPermissions(user, operation)',
        status: 'active',
        lastExecuted: new Date(Date.now() - 7200000),
        lastResult: 'success',
        stats: {
          totalExecutions: 85,
          successfulExecutions: 85,
          failedExecutions: 0,
          skippedExecutions: 15,
          averageExecutionTime: 120
        },
        dependencies: ['security', 'auth'],
        config: { requireAuth: true }
      },
      {
        name: 'post-execution-cleanup',
        description: '执行后的资源清理',
        type: 'post-execution',
        trigger: 'execution.completed',
        script: 'cleanupResources(resources)',
        status: 'inactive',
        lastExecuted: new Date(Date.now() - 86400000),
        lastResult: 'success',
        stats: {
          totalExecutions: 120,
          successfulExecutions: 118,
          failedExecutions: 2,
          skippedExecutions: 0,
          averageExecutionTime: 65
        },
        dependencies: ['resources'],
        config: { cleanupTimeout: 10000 }
      },
      {
        name: 'custom-notification',
        description: '自定义通知钩子',
        type: 'custom',
        trigger: 'notification.required',
        script: 'sendNotification(message, recipients)',
        status: 'error',
        lastExecuted: new Date(Date.now() - 172800000),
        lastResult: 'failure',
        stats: {
          totalExecutions: 45,
          successfulExecutions: 40,
          failedExecutions: 5,
          skippedExecutions: 0,
          averageExecutionTime: 180
        },
        dependencies: ['notifications', 'network'],
        config: { retryCount: 3 }
      }
    ];

    const overall = this.analyzeOverallStats(hooks);
    const typeStats = this.analyzeTypeStats(hooks);
    const recentExecutions = this.getRecentExecutions(hooks);
    const dependencyGraph = this.buildDependencyGraph(hooks);

    return {
      overall,
      hooks,
      typeStats,
      recentExecutions,
      dependencyGraph
    };
  }

  /**
   * 分析总体统计
   */
  private analyzeOverallStats(hooks: HookData[]): any {
    const totalHooks = hooks.length;
    const activeHooks = hooks.filter(h => h.status === 'active').length;
    const inactiveHooks = hooks.filter(h => h.status === 'inactive').length;
    const errorHooks = hooks.filter(h => h.status === 'error').length;
    
    const totalExecutions = hooks.reduce((sum, h) => sum + h.stats.totalExecutions, 0);
    const successfulExecutions = hooks.reduce((sum, h) => sum + h.stats.successfulExecutions, 0);
    const successRate = totalExecutions > 0 ? (successfulExecutions / totalExecutions) * 100 : 0;

    return {
      totalHooks,
      activeHooks,
      inactiveHooks,
      errorHooks,
      totalExecutions,
      successRate
    };
  }

  /**
   * 分析类型统计
   */
  private analyzeTypeStats(hooks: HookData[]): Array<any> {
    const typeMap = new Map();
    
    hooks.forEach(hook => {
      if (!typeMap.has(hook.type)) {
        typeMap.set(hook.type, {
          type: hook.type,
          count: 0,
          totalExecutions: 0,
          successfulExecutions: 0,
          totalTime: 0
        });
      }
      
      const typeData = typeMap.get(hook.type);
      typeData.count++;
      typeData.totalExecutions += hook.stats.totalExecutions;
      typeData.successfulExecutions += hook.stats.successfulExecutions;
      typeData.totalTime += hook.stats.averageExecutionTime * hook.stats.totalExecutions;
    });

    return Array.from(typeMap.values()).map(typeData => ({
      type: typeData.type,
      count: typeData.count,
      successRate: typeData.totalExecutions > 0 ? 
        (typeData.successfulExecutions / typeData.totalExecutions) * 100 : 0,
      averageTime: typeData.totalExecutions > 0 ? 
        typeData.totalTime / typeData.totalExecutions : 0
    }));
  }

  /**
   * 获取最近执行记录
   */
  private getRecentExecutions(hooks: HookData[]): HookExecutionResult[] {
    const executions: HookExecutionResult[] = [];
    
    hooks.forEach(hook => {
      if (hook.lastExecuted) {
        executions.push({
          hook: hook.name,
          status: hook.lastResult || 'skipped',
          executionTime: hook.stats.averageExecutionTime,
          triggeredBy: hook.trigger,
          output: `最后执行: ${this.formatRelativeTime(hook.lastExecuted!)}`
        });
      }
    });

    return executions.sort((a, b) => {
      const hookA = hooks.find(h => h.name === a.hook);
      const hookB = hooks.find(h => h.name === b.hook);
      return (hookB?.lastExecuted?.getTime() || 0) - (hookA?.lastExecuted?.getTime() || 0);
    }).slice(0, 5);
  }

  /**
   * 构建依赖关系图
   */
  private buildDependencyGraph(hooks: HookData[]): Array<any> {
    return hooks.map(hook => ({
      hook: hook.name,
      dependsOn: hook.dependencies,
      requiredBy: hooks
        .filter(h => h.dependencies.includes(hook.name))
        .map(h => h.name)
    }));
  }

  /**
   * 执行钩子
   */
  private async executeHook(hook: HookData, context: any): Promise<HookExecutionResult> {
    // 模拟钩子执行
    const startTime = Date.now();
    
    // 添加微小延迟以确保执行时间大于0
    await new Promise(resolve => setTimeout(resolve, 1));
    
    const success = Math.random() > 0.1; // 90%成功率
    const executionTime = Date.now() - startTime;
    
    return {
      hook: hook.name,
      status: success ? 'success' : 'failure',
      executionTime,
      output: success ? '钩子执行成功' : '钩子执行失败',
      error: success ? undefined : '模拟执行错误',
      triggeredBy: 'manual'
    };
  }

  /**
   * 运行钩子测试
   */
  private async runHookTests(hooks: HookData[], context: any): Promise<any[]> {
    return hooks.map(hook => ({
      hook: hook.name,
      status: hook.status === 'error' ? 'failed' : 'passed',
      executionTime: hook.stats.averageExecutionTime,
      issues: hook.status === 'error' ? ['钩子状态异常'] : []
    }));
  }

  /**
   * 执行钩子管理
   */
  private async performHookManagement(hooks: HookData[]): Promise<any> {
    const operations: string[] = [];
    const statusChanges: string[] = [];
    const recommendations: string[] = [];

    // 检查错误钩子
    const errorHooks = hooks.filter(h => h.status === 'error');
    if (errorHooks.length > 0) {
      operations.push(`发现 ${errorHooks.length} 个错误钩子需要修复`);
      recommendations.push('建议检查错误钩子的配置和依赖关系');
    }

    // 检查非活跃钩子
    const inactiveHooks = hooks.filter(h => h.status === 'inactive');
    if (inactiveHooks.length > 0) {
      operations.push(`发现 ${inactiveHooks.length} 个非活跃钩子`);
      recommendations.push('考虑激活有用的非活跃钩子或清理无用钩子');
    }

    // 检查性能问题
    const slowHooks = hooks.filter(h => h.stats.averageExecutionTime > 100);
    if (slowHooks.length > 0) {
      operations.push(`发现 ${slowHooks.length} 个执行缓慢的钩子`);
      recommendations.push('优化慢速钩子的执行效率');
    }

    return { operations, statusChanges, recommendations };
  }

  /**
   * 格式化类型分布
   */
  private formatTypeDistribution(typeStats: any[]): string {
    return typeStats.map(stat => 
      `${stat.type}: ${stat.count}个钩子 (${stat.successRate.toFixed(1)}%成功率)`
    ).join('\n');
  }

  /**
   * 格式化最近执行
   */
  private formatRecentExecutions(executions: HookExecutionResult[]): string {
    return executions.map(exec => 
      `${this.getStatusIcon(exec.status)} ${exec.hook}: ${exec.status} (${exec.executionTime}ms)`
    ).join('\n') || '无最近执行记录';
  }

  /**
   * 格式化钩子列表
   */
  private formatHooksList(hooks: HookData[]): string {
    return hooks.map(hook => 
      `${this.getStatusIcon(hook.status)} ${hook.name} (${hook.type}) - ${hook.description}`
    ).join('\n');
  }

  /**
   * 格式化依赖关系图
   */
  private formatDependencyGraph(graph: any[]): string {
    return graph.map(item => 
      `${item.hook}: 依赖 ${item.dependsOn.length}个, 被 ${item.requiredBy.length}个依赖`
    ).join('\n');
  }

  /**
   * 格式化执行统计
   */
  private formatExecutionStats(overall: any): string {
    return `总执行次数: ${overall.totalExecutions}\n` +
           `成功率: ${overall.successRate.toFixed(1)}%\n` +
           `活跃钩子: ${overall.activeHooks}/${overall.totalHooks}`;
  }

  /**
   * 格式化类型性能
   */
  private formatTypePerformance(typeStats: any[]): string {
    return typeStats.map(stat => 
      `${stat.type}: ${stat.averageTime.toFixed(1)}ms (${stat.successRate.toFixed(1)}%)`
    ).join('\n');
  }

  /**
   * 格式化性能分析
   */
  private formatPerformanceAnalysis(hooks: HookData[]): string {
    const slowHooks = hooks.filter(h => h.stats.averageExecutionTime > 100);
    const errorHooks = hooks.filter(h => h.status === 'error');
    
    return `慢速钩子: ${slowHooks.length}个\n` +
           `错误钩子: ${errorHooks.length}个\n` +
           `平均执行时间: ${hooks.reduce((sum, h) => sum + h.stats.averageExecutionTime, 0) / hooks.length}ms`;
  }

  /**
   * 格式化执行结果
   */
  private formatExecutionResult(result: HookExecutionResult): string {
    return `钩子: ${result.hook}\n` +
           `状态: ${result.status}\n` +
           `执行时间: ${result.executionTime}ms\n` +
           `触发事件: ${result.triggeredBy}`;
  }

  /**
   * 格式化钩子信息
   */
  private formatHookInfo(hook: HookData): string {
    return `类型: ${hook.type}\n` +
           `触发条件: ${hook.trigger}\n` +
           `状态: ${hook.status}\n` +
           `最后执行: ${hook.lastExecuted ? this.formatRelativeTime(hook.lastExecuted) : '从未执行'}`;
  }

  /**
   * 格式化测试概览
   */
  private formatTestOverview(results: any[]): string {
    const passed = results.filter(r => r.status === 'passed').length;
    const failed = results.filter(r => r.status === 'failed').length;
    
    return `测试钩子数: ${results.length}\n` +
           `通过: ${passed} | 失败: ${failed}\n` +
           `通过率: ${((passed / results.length) * 100).toFixed(1)}%`;
  }

  /**
   * 格式化测试详情
   */
  private formatTestDetails(results: any[]): string {
    return results.map(result => 
      `${this.getTestStatusIcon(result.status)} ${result.hook}: ${result.status} (${result.executionTime}ms)`
    ).join('\n');
  }

  /**
   * 格式化测试问题
   */
  private formatTestIssues(results: any[]): string {
    const failedTests = results.filter(r => r.status === 'failed');
    if (failedTests.length === 0) return '所有测试通过';
    
    return failedTests.map(test => 
      `${test.hook}: ${test.issues.join(', ')}`
    ).join('\n');
  }

  /**
   * 获取状态图标
   */
  private getStatusIcon(status: string): string {
    switch (status) {
      case 'active': return '✅';
      case 'inactive': return '⚪';
      case 'error': return '❌';
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

  /**
   * 格式化日期
   */
  private formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    return `${year}年${month}月${day}日`;
  }
}
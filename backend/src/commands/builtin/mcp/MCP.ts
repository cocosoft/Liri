/**
 * MCP命令实现
 * MCP（Model Context Protocol）管理和配置
 */
import type { CommandImplementation } from '../../types/index.js';
import { mcpConnectionManager } from '../../../services/mcp/MCPConnectionManager.js';

/**
 * MCP服务器数据定义
 */
interface MCPServerData {
  /** 服务器名称 */
  name: string;
  /** 服务器描述 */
  description: string;
  /** 服务器类型 */
  type: 'file' | 'database' | 'api' | 'custom';
  /** 服务器状态 */
  status: 'running' | 'stopped' | 'error' | 'unknown';
  /** 服务器地址 */
  address: string;
  /** 服务器端口 */
  port?: number;
  /** 协议版本 */
  protocolVersion: string;
  /** 连接状态 */
  connectionStatus: 'connected' | 'disconnected' | 'connecting' | 'error';
  /** 最后连接时间 */
  lastConnected?: Date;
  /** 配置参数 */
  config: Record<string, any>;
  /** 支持的资源类型 */
  supportedResources: string[];
  /** 支持的工具 */
  supportedTools: string[];
  /** 性能指标 */
  metrics: {
    uptime: number;
    requestCount: number;
    errorCount: number;
    averageResponseTime: number;
    lastResponseTime: number;
  };
}

/**
 * MCP资源数据定义
 */
interface MCPResourceData {
  /** 资源名称 */
  name: string;
  /** 资源类型 */
  type: string;
  /** 资源描述 */
  description: string;
  /** 所属服务器 */
  server: string;
  /** 资源URI */
  uri: string;
  /** 资源内容 */
  content?: string;
  /** 资源大小 */
  size?: number;
  /** 最后更新时间 */
  lastUpdated?: Date;
  /** 访问权限 */
  permissions: string[];
  /** 元数据 */
  metadata: Record<string, any>;
}

/**
 * MCP工具数据定义
 */
interface MCPToolData {
  /** 工具名称 */
  name: string;
  /** 工具描述 */
  description: string;
  /** 所属服务器 */
  server: string;
  /** 工具参数 */
  parameters: Array<{
    name: string;
    type: string;
    description: string;
    required: boolean;
  }>;
  /** 工具返回值 */
  returns: {
    type: string;
    description: string;
  };
  /** 工具状态 */
  status: 'available' | 'unavailable' | 'error';
  /** 最后使用时间 */
  lastUsed?: Date;
  /** 使用统计 */
  usageStats: {
    totalUses: number;
    successfulUses: number;
    failedUses: number;
    averageExecutionTime: number;
  };
}

/**
 * MCP管理数据定义
 */
interface MCPManagementData {
  /** 总体统计 */
  overall: {
    totalServers: number;
    runningServers: number;
    connectedServers: number;
    totalResources: number;
    totalTools: number;
    averageResponseTime: number;
  };
  /** 服务器列表 */
  servers: MCPServerData[];
  /** 资源列表 */
  resources: MCPResourceData[];
  /** 工具列表 */
  tools: MCPToolData[];
  /** 连接状态 */
  connectionStatus: Array<{
    server: string;
    status: string;
    lastConnected: Date;
    responseTime: number;
  }>;
  /** 性能统计 */
  performanceStats: Array<{
    server: string;
    uptime: number;
    requestCount: number;
    errorRate: number;
    averageResponseTime: number;
  }>;
}

/**
 * MCP命令实现类
 */
export class MCP implements CommandImplementation {
  /**
   * 执行mcp命令
   * @param args 命令参数
   * @param context 命令上下文
   * @returns 命令执行结果
   */
  async execute(args: string, context: any): Promise<any> {
    try {
      // 解析参数
      const params = this.parseArgs(args);
      
      // 根据参数执行不同的MCP操作
      if (params.listServers) {
        return await this.listMCPServers(context);
      } else if (params.showStatus) {
        return await this.showMCPStatus(context);
      } else if (params.manageServers) {
        return await this.manageMCPServers(context);
      } else if (params.showResources) {
        return await this.showMCPResources(context);
      } else if (params.showTools) {
        return await this.showMCPTools(context);
      } else if (params.testConnection) {
        return await this.testMCPConnection(context);
      } else {
        // 默认显示MCP概览
        return await this.showMCPOverview(context);
      }
    } catch (error) {
      return {
        success: false,
        error: `Failed to execute mcp command: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * 解析命令参数
   * @param args 命令参数
   * @returns 解析后的参数
   */
  private parseArgs(args: string): {
    listServers: boolean;
    showStatus: boolean;
    manageServers: boolean;
    showResources: boolean;
    showTools: boolean;
    testConnection: boolean;
  } {
    const params = {
      listServers: false,
      showStatus: false,
      manageServers: false,
      showResources: false,
      showTools: false,
      testConnection: false,
    };

    // 使用正则表达式精确匹配参数
    const listRegex = /(^|\s)(--list|-l)(\s|$)/;
    const statusRegex = /(^|\s)(--status|-s)(\s|$)/;
    const manageRegex = /(^|\s)(--manage|-m)(\s|$)/;
    const resourcesRegex = /(^|\s)(--resources|-r)(\s|$)/;
    const toolsRegex = /(^|\s)(--tools|-t)(\s|$)/;
    const testRegex = /(^|\s)(--test|-e)(\s|$)/;

    // 设置参数优先级：test > manage > tools > resources > status > list > overview
    if (testRegex.test(args)) {
      params.testConnection = true;
    } else if (manageRegex.test(args)) {
      params.manageServers = true;
    } else if (toolsRegex.test(args)) {
      params.showTools = true;
    } else if (resourcesRegex.test(args)) {
      params.showResources = true;
    } else if (statusRegex.test(args)) {
      params.showStatus = true;
    } else if (listRegex.test(args)) {
      params.listServers = true;
    }

    return params;
  }

  /**
   * 显示MCP概览
   * @param context 命令上下文
   * @returns MCP概览结果
   */
  private async showMCPOverview(context: any): Promise<any> {
    const mcpData = await this.collectMCPData(context);
    
    const mcpOverview = {
      title: 'MCP系统概览',
      sections: [
        {
          title: '系统状态',
          content: `总服务器数: ${mcpData.overall.totalServers}\n` +
                   `运行中服务器: ${mcpData.overall.runningServers}\n` +
                   `已连接服务器: ${mcpData.overall.connectedServers}\n` +
                   `总资源数: ${mcpData.overall.totalResources}\n` +
                   `总工具数: ${mcpData.overall.totalTools}`
        },
        {
          title: '连接状态',
          content: this.formatConnectionStatus(mcpData.connectionStatus)
        },
        {
          title: '性能统计',
          content: this.formatPerformanceStats(mcpData.performanceStats)
        }
      ]
    };

    return {
      success: true,
      type: 'mcp',
      data: mcpOverview,
      display: 'table'
    };
  }

  /**
   * 列出MCP服务器
   * @param context 命令上下文
   * @returns MCP服务器列表结果
   */
  private async listMCPServers(context: any): Promise<any> {
    const mcpData = await this.collectMCPData(context);
    
    const serversList = {
      title: 'MCP服务器列表',
      sections: [
        {
          title: '服务器概览',
          content: `总服务器数: ${mcpData.servers.length}\n` +
                   `运行中: ${mcpData.servers.filter(s => s.status === 'running').length}\n` +
                   `已连接: ${mcpData.servers.filter(s => s.connectionStatus === 'connected').length}`
        },
        {
          title: '服务器详情',
          content: this.formatServersList(mcpData.servers)
        },
        {
          title: '服务器统计',
          content: this.formatServersStats(mcpData.servers)
        }
      ]
    };

    return {
      success: true,
      type: 'mcp',
      data: serversList,
      display: 'table'
    };
  }

  /**
   * 显示MCP状态
   * @param context 命令上下文
   * @returns MCP状态结果
   */
  private async showMCPStatus(context: any): Promise<any> {
    const mcpData = await this.collectMCPData(context);
    
    const statusReport = {
      title: 'MCP状态报告',
      sections: [
        {
          title: '总体状态',
          content: this.formatOverallStatus(mcpData.overall)
        },
        {
          title: '服务器状态',
          content: this.formatServersStatus(mcpData.servers)
        },
        {
          title: '连接健康度',
          content: this.formatConnectionHealth(mcpData.connectionStatus)
        }
      ]
    };

    return {
      success: true,
      type: 'mcp',
      data: statusReport,
      display: 'table'
    };
  }

  /**
   * 管理MCP服务器
   * @param context 命令上下文
   * @returns MCP管理结果
   */
  private async manageMCPServers(context: any): Promise<any> {
    const mcpData = await this.collectMCPData(context);
    const managementResults = await this.performMCPManagement(mcpData.servers);
    
    const managementReport = {
      title: 'MCP服务器管理报告',
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
      type: 'mcp',
      data: managementReport,
      display: 'table'
    };
  }

  /**
   * 显示MCP资源
   * @param context 命令上下文
   * @returns MCP资源结果
   */
  private async showMCPResources(context: any): Promise<any> {
    const mcpData = await this.collectMCPData(context);
    
    const resourcesReport = {
      title: 'MCP资源列表',
      sections: [
        {
          title: '资源概览',
          content: `总资源数: ${mcpData.resources.length}\n` +
                   `按类型分组: ${new Set(mcpData.resources.map(r => r.type)).size} 种类型`
        },
        {
          title: '资源详情',
          content: this.formatResourcesList(mcpData.resources)
        },
        {
          title: '资源统计',
          content: this.formatResourcesStats(mcpData.resources)
        }
      ]
    };

    return {
      success: true,
      type: 'mcp',
      data: resourcesReport,
      display: 'table'
    };
  }

  /**
   * 显示MCP工具
   * @param context 命令上下文
   * @returns MCP工具结果
   */
  private async showMCPTools(context: any): Promise<any> {
    const mcpData = await this.collectMCPData(context);
    
    const toolsReport = {
      title: 'MCP工具列表',
      sections: [
        {
          title: '工具概览',
          content: `总工具数: ${mcpData.tools.length}\n` +
                   `可用工具: ${mcpData.tools.filter(t => t.status === 'available').length}\n` +
                   `按服务器分组: ${new Set(mcpData.tools.map(t => t.server)).size} 个服务器`
        },
        {
          title: '工具详情',
          content: this.formatToolsList(mcpData.tools)
        },
        {
          title: '工具统计',
          content: this.formatToolsStats(mcpData.tools)
        }
      ]
    };

    return {
      success: true,
      type: 'mcp',
      data: toolsReport,
      display: 'table'
    };
  }

  /**
   * 测试MCP连接
   * @param context 命令上下文
   * @returns MCP连接测试结果
   */
  private async testMCPConnection(context: any): Promise<any> {
    const mcpData = await this.collectMCPData(context);
    const testResults = await this.runMCPConnectionTests(mcpData.servers);
    
    const testReport = {
      title: 'MCP连接测试报告',
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
      type: 'mcp',
      data: testReport,
      display: 'table'
    };
  }

  /**
   * 收集MCP数据
   * @param context 命令上下文
   * @returns MCP数据
   */
  private async collectMCPData(context: any): Promise<MCPManagementData> {
    const realServers = mcpConnectionManager.getServers();

    const servers: MCPServerData[] = realServers.map(conn => {
      const tools = mcpConnectionManager.getServerTools(conn.name);
      return {
        name: conn.name,
        description: `${conn.type} MCP server`,
        type: 'custom',
        status: conn.type === 'connected' ? 'running' : conn.type === 'failed' ? 'error' : 'stopped',
        address: 'mcp',
        protocolVersion: (conn as any).serverInfo?.version || '1.0.0',
        connectionStatus: conn.type === 'connected' ? 'connected' : conn.type === 'failed' ? 'error' : 'disconnected',
        config: (conn.config as any) || {},
        supportedResources: [],
        supportedTools: tools.map(t => t.name),
        metrics: {
          uptime: conn.type === 'connected' ? (process.uptime() || 1) * 100 : 0,
          requestCount: 0,
          errorCount: conn.type === 'failed' ? 1 : 0,
          averageResponseTime: 0,
          lastResponseTime: 0
        }
      };
    });

    const resources: MCPResourceData[] = [];

    const tools: MCPToolData[] = [];
    for (const conn of realServers) {
      const serverTools = mcpConnectionManager.getServerTools(conn.name);
      for (const t of serverTools) {
        tools.push({
          name: t.name,
          description: t.description || '',
          server: conn.name,
          parameters: [],
          returns: { type: 'object', description: 'Tool result' },
          status: conn.type === 'connected' ? 'available' : 'unavailable',
          usageStats: {
            totalUses: 0,
            successfulUses: 0,
            failedUses: conn.type === 'failed' ? 1 : 0,
            averageExecutionTime: 0
          }
        });
      }
    }

    const overall = this.analyzeOverallStats(servers, resources, tools);
    const connectionStatus = this.getConnectionStatus(servers);
    const performanceStats = this.getPerformanceStats(servers);

    return {
      overall,
      servers,
      resources,
      tools,
      connectionStatus,
      performanceStats
    };
  }

  /**
   * 分析总体统计
   */
  private analyzeOverallStats(servers: MCPServerData[], resources: MCPResourceData[], tools: MCPToolData[]): any {
    const totalServers = servers.length;
    const runningServers = servers.filter(s => s.status === 'running').length;
    const connectedServers = servers.filter(s => s.connectionStatus === 'connected').length;
    const totalResources = resources.length;
    const totalTools = tools.length;
    
    const averageResponseTime = servers.length > 0 ? 
      servers.reduce((sum, s) => sum + s.metrics.averageResponseTime, 0) / servers.length : 0;

    return {
      totalServers,
      runningServers,
      connectedServers,
      totalResources,
      totalTools,
      averageResponseTime
    };
  }

  /**
   * 获取连接状态
   */
  private getConnectionStatus(servers: MCPServerData[]): Array<any> {
    return servers.map(server => ({
      server: server.name,
      status: server.connectionStatus,
      lastConnected: server.lastConnected || new Date(0),
      responseTime: server.metrics.lastResponseTime
    }));
  }

  /**
   * 获取性能统计
   */
  private getPerformanceStats(servers: MCPServerData[]): Array<any> {
    return servers.map(server => ({
      server: server.name,
      uptime: server.metrics.uptime,
      requestCount: server.metrics.requestCount,
      errorRate: server.metrics.requestCount > 0 ? 
        (server.metrics.errorCount / server.metrics.requestCount) * 100 : 0,
      averageResponseTime: server.metrics.averageResponseTime
    }));
  }

  /**
   * 执行MCP管理
   */
  private async performMCPManagement(servers: MCPServerData[]): Promise<any> {
    const operations: string[] = [];
    const statusChanges: string[] = [];
    const recommendations: string[] = [];

    // 检查停止的服务器
    const stoppedServers = servers.filter(s => s.status === 'stopped');
    if (stoppedServers.length > 0) {
      operations.push(`发现 ${stoppedServers.length} 个停止的服务器`);
      recommendations.push('考虑启动有用的停止服务器');
    }

    // 检查连接错误的服务器
    const errorServers = servers.filter(s => s.connectionStatus === 'error');
    if (errorServers.length > 0) {
      operations.push(`发现 ${errorServers.length} 个连接错误的服务器`);
      recommendations.push('检查错误服务器的配置和网络连接');
    }

    // 检查性能问题
    const slowServers = servers.filter(s => s.metrics.averageResponseTime > 100);
    if (slowServers.length > 0) {
      operations.push(`发现 ${slowServers.length} 个响应缓慢的服务器`);
      recommendations.push('优化慢速服务器的性能配置');
    }

    return { operations, statusChanges, recommendations };
  }

  /**
   * 运行MCP连接测试
   */
  private async runMCPConnectionTests(servers: MCPServerData[]): Promise<any[]> {
    return servers.map(server => ({
      server: server.name,
      status: server.connectionStatus === 'connected' ? 'passed' : 'failed',
      responseTime: server.metrics.lastResponseTime,
      issues: server.connectionStatus !== 'connected' ? ['服务器连接异常'] : []
    }));
  }

  /**
   * 格式化连接状态
   */
  private formatConnectionStatus(connectionStatus: any[]): string {
    return connectionStatus.map(conn => 
      `${this.getConnectionStatusIcon(conn.status)} ${conn.server}: ${conn.status} (${conn.responseTime}ms)`
    ).join('\n');
  }

  /**
   * 格式化性能统计
   */
  private formatPerformanceStats(performanceStats: any[]): string {
    return performanceStats.map(stat => 
      `${stat.server}: ${stat.uptime}s运行, ${stat.requestCount}请求, ${stat.errorRate.toFixed(1)}%错误率`
    ).join('\n');
  }

  /**
   * 格式化服务器列表
   */
  private formatServersList(servers: MCPServerData[]): string {
    return servers.map(server => 
      `${this.getServerStatusIcon(server.status)} ${server.name} (${server.type}) - ${server.description}`
    ).join('\n');
  }

  /**
   * 格式化服务器统计
   */
  private formatServersStats(servers: MCPServerData[]): string {
    const runningCount = servers.filter(s => s.status === 'running').length;
    const connectedCount = servers.filter(s => s.connectionStatus === 'connected').length;
    const avgResponseTime = servers.reduce((sum, s) => sum + s.metrics.averageResponseTime, 0) / servers.length;
    
    return `运行中: ${runningCount}/${servers.length}\n` +
           `已连接: ${connectedCount}/${servers.length}\n` +
           `平均响应时间: ${avgResponseTime.toFixed(1)}ms`;
  }

  /**
   * 格式化总体状态
   */
  private formatOverallStatus(overall: any): string {
    return `服务器: ${overall.totalServers}个 (${overall.runningServers}运行中)\n` +
           `资源: ${overall.totalResources}个\n` +
           `工具: ${overall.totalTools}个\n` +
           `平均响应时间: ${overall.averageResponseTime.toFixed(1)}ms`;
  }

  /**
   * 格式化服务器状态
   */
  private formatServersStatus(servers: MCPServerData[]): string {
    return servers.map(server => 
      `${server.name}: ${server.status} (${server.connectionStatus}) - ${server.metrics.averageResponseTime}ms`
    ).join('\n');
  }

  /**
   * 格式化连接健康度
   */
  private formatConnectionHealth(connectionStatus: any[]): string {
    const healthyConnections = connectionStatus.filter(c => c.status === 'connected').length;
    const totalConnections = connectionStatus.length;
    const healthPercentage = totalConnections > 0 ? (healthyConnections / totalConnections) * 100 : 0;
    
    return `健康连接: ${healthyConnections}/${totalConnections} (${healthPercentage.toFixed(1)}%)\n` +
           `平均响应时间: ${connectionStatus.reduce((sum, c) => sum + c.responseTime, 0) / totalConnections}ms`;
  }

  /**
   * 格式化资源列表
   */
  private formatResourcesList(resources: MCPResourceData[]): string {
    return resources.map(resource => 
      `${resource.name} (${resource.type}) - ${resource.server} - ${this.formatRelativeTime(resource.lastUpdated!)}`
    ).join('\n');
  }

  /**
   * 格式化资源统计
   */
  private formatResourcesStats(resources: MCPResourceData[]): string {
    const typeCounts = resources.reduce((counts, r) => {
      counts[r.type] = (counts[r.type] || 0) + 1;
      return counts;
    }, {} as Record<string, number>);
    
    const typeStats = Object.entries(typeCounts).map(([type, count]) => 
      `${type}: ${count}个`
    ).join('\n');
    
    return `按类型统计:\n${typeStats}`;
  }

  /**
   * 格式化工具列表
   */
  private formatToolsList(tools: MCPToolData[]): string {
    return tools.map(tool => 
      `${this.getToolStatusIcon(tool.status)} ${tool.name} - ${tool.server} - ${tool.description}`
    ).join('\n');
  }

  /**
   * 格式化工具统计
   */
  private formatToolsStats(tools: MCPToolData[]): string {
    const availableCount = tools.filter(t => t.status === 'available').length;
    const totalUses = tools.reduce((sum, t) => sum + t.usageStats.totalUses, 0);
    const avgExecutionTime = tools.reduce((sum, t) => sum + t.usageStats.averageExecutionTime, 0) / tools.length;
    
    return `可用工具: ${availableCount}/${tools.length}\n` +
           `总使用次数: ${totalUses}\n` +
           `平均执行时间: ${avgExecutionTime.toFixed(1)}ms`;
  }

  /**
   * 格式化测试概览
   */
  private formatTestOverview(results: any[]): string {
    const passed = results.filter(r => r.status === 'passed').length;
    const failed = results.filter(r => r.status === 'failed').length;
    
    return `测试服务器数: ${results.length}\n` +
           `通过: ${passed} | 失败: ${failed}\n` +
           `通过率: ${((passed / results.length) * 100).toFixed(1)}%`;
  }

  /**
   * 格式化测试详情
   */
  private formatTestDetails(results: any[]): string {
    return results.map(result => 
      `${this.getTestStatusIcon(result.status)} ${result.server}: ${result.status} (${result.responseTime}ms)`
    ).join('\n');
  }

  /**
   * 格式化测试问题
   */
  private formatTestIssues(results: any[]): string {
    const failedTests = results.filter(r => r.status === 'failed');
    if (failedTests.length === 0) return '所有测试通过';
    
    return failedTests.map(test => 
      `${test.server}: ${test.issues.join(', ')}`
    ).join('\n');
  }

  /**
   * 获取连接状态图标
   */
  private getConnectionStatusIcon(status: string): string {
    switch (status) {
      case 'connected': return '✅';
      case 'disconnected': return '⚪';
      case 'connecting': return '🔄';
      case 'error': return '❌';
      default: return '❓';
    }
  }

  /**
   * 获取服务器状态图标
   */
  private getServerStatusIcon(status: string): string {
    switch (status) {
      case 'running': return '✅';
      case 'stopped': return '⚪';
      case 'error': return '❌';
      case 'unknown': return '❓';
      default: return '❓';
    }
  }

  /**
   * 获取工具状态图标
   */
  private getToolStatusIcon(status: string): string {
    switch (status) {
      case 'available': return '✅';
      case 'unavailable': return '⚪';
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
}
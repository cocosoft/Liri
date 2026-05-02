/**
 * Cost命令实现
 * 显示API调用成本和使用统计
 */
import type { CommandImplementation } from '../../types/index.js';

/**
 * 成本数据类型定义
 */
interface CostData {
  /** 总成本 */
  totalCost: number;
  
  /** 成本明细 */
  costBreakdown: Array<{
    service: string;
    calls: number;
    cost: number;
    percentage: number;
  }>;
  
  /** 使用统计 */
  usageStats: {
    totalCalls: number;
    successfulCalls: number;
    failedCalls: number;
    averageCostPerCall: number;
  };
  
  /** 时间范围统计 */
  timeRangeStats: {
    daily: {
      calls: number;
      cost: number;
    };
    weekly: {
      calls: number;
      cost: number;
    };
    monthly: {
      calls: number;
      cost: number;
    };
  };
  
  /** 订阅信息 */
  subscriptionInfo: {
    isSubscriber: boolean;
    usingOverage: boolean;
    rateLimit: string;
    nextReset: Date;
  };
}

/**
 * Cost命令实现类
 */
export class Cost implements CommandImplementation {
  /**
   * 执行cost命令
   * @param args 命令参数
   * @param context 命令上下文
   * @returns 命令执行结果
   */
  async execute(args: string, context: any): Promise<any> {
    try {
      // 解析参数
      const params = this.parseArgs(args);
      
      // 根据参数显示不同的成本信息
      if (params.showBreakdown) {
        return await this.showCostBreakdown(context);
      } else if (params.showUsage) {
        return await this.showUsageStats(context);
      } else if (params.showTimeRange) {
        return await this.showTimeRangeStats(context);
      } else {
        // 默认显示总成本
        return await this.showTotalCost(context);
      }
    } catch (error) {
      return {
        success: false,
        error: `Failed to execute cost command: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * 解析命令参数
   * @param args 命令参数
   * @returns 解析后的参数
   */
  private parseArgs(args: string): {
    showBreakdown: boolean;
    showUsage: boolean;
    showTimeRange: boolean;
  } {
    const params = {
      showBreakdown: false,
      showUsage: false,
      showTimeRange: false,
    };

    // 使用正则表达式精确匹配参数
    const breakdownRegex = /(^|\s)(--breakdown|-b)(\s|$)/;
    const usageRegex = /(^|\s)(--usage|-u)(\s|$)/;
    const timeRangeRegex = /(^|\s)(--time|-t)(\s|$)/;

    if (breakdownRegex.test(args)) {
      params.showBreakdown = true;
    }
    
    if (usageRegex.test(args)) {
      params.showUsage = true;
    }

    if (timeRangeRegex.test(args)) {
      params.showTimeRange = true;
    }

    return params;
  }

  /**
   * 显示总成本信息
   * @param context 命令上下文
   * @returns 总成本信息结果
   */
  private async showTotalCost(context: any): Promise<any> {
    const costData = await this.collectCostData(context);
    
    const totalCost = {
      title: 'API调用成本总览',
      sections: [
        {
          title: '总成本',
          content: `总花费: $${costData.totalCost.toFixed(2)}\n` +
                   `总调用次数: ${costData.usageStats.totalCalls}\n` +
                   `平均每次调用成本: $${costData.usageStats.averageCostPerCall.toFixed(4)}`
        },
        {
          title: '订阅状态',
          content: this.formatSubscriptionInfo(costData.subscriptionInfo)
        },
        {
          title: '使用统计',
          content: `成功调用: ${costData.usageStats.successfulCalls}\n` +
                   `失败调用: ${costData.usageStats.failedCalls}\n` +
                   `成功率: ${((costData.usageStats.successfulCalls / costData.usageStats.totalCalls) * 100).toFixed(2)}%`
        }
      ]
    };

    return {
      success: true,
      type: 'cost',
      data: totalCost,
      display: 'table'
    };
  }

  /**
   * 显示成本明细
   * @param context 命令上下文
   * @returns 成本明细结果
   */
  private async showCostBreakdown(context: any): Promise<any> {
    const costData = await this.collectCostData(context);
    
    const breakdown = {
      title: 'API调用成本明细',
      sections: [
        {
          title: '服务成本明细',
          content: costData.costBreakdown.map(item => 
            `${item.service}: ${item.calls}次调用, $${item.cost.toFixed(2)} (${item.percentage.toFixed(1)}%)`
          ).join('\n')
        },
        {
          title: '总成本汇总',
          content: `总花费: $${costData.totalCost.toFixed(2)}\n` +
                   `总调用次数: ${costData.usageStats.totalCalls}`
        }
      ]
    };

    return {
      success: true,
      type: 'cost',
      data: breakdown,
      display: 'table'
    };
  }

  /**
   * 显示使用统计
   * @param context 命令上下文
   * @returns 使用统计结果
   */
  private async showUsageStats(context: any): Promise<any> {
    const costData = await this.collectCostData(context);
    
    const usage = {
      title: 'API使用统计',
      sections: [
        {
          title: '调用统计',
          content: `总调用次数: ${costData.usageStats.totalCalls}\n` +
                   `成功调用: ${costData.usageStats.successfulCalls}\n` +
                   `失败调用: ${costData.usageStats.failedCalls}\n` +
                   `成功率: ${((costData.usageStats.successfulCalls / costData.usageStats.totalCalls) * 100).toFixed(2)}%`
        },
        {
          title: '成本效率',
          content: `平均每次调用成本: $${costData.usageStats.averageCostPerCall.toFixed(4)}\n` +
                   `总成本: $${costData.totalCost.toFixed(2)}`
        }
      ]
    };

    return {
      success: true,
      type: 'cost',
      data: usage,
      display: 'table'
    };
  }

  /**
   * 显示时间范围统计
   * @param context 命令上下文
   * @returns 时间范围统计结果
   */
  private async showTimeRangeStats(context: any): Promise<any> {
    const costData = await this.collectCostData(context);
    
    const timeRange = {
      title: '时间范围成本统计',
      sections: [
        {
          title: '日统计',
          content: `调用次数: ${costData.timeRangeStats.daily.calls}\n` +
                   `成本: $${costData.timeRangeStats.daily.cost.toFixed(2)}`
        },
        {
          title: '周统计',
          content: `调用次数: ${costData.timeRangeStats.weekly.calls}\n` +
                   `成本: $${costData.timeRangeStats.weekly.cost.toFixed(2)}`
        },
        {
          title: '月统计',
          content: `调用次数: ${costData.timeRangeStats.monthly.calls}\n` +
                   `成本: $${costData.timeRangeStats.monthly.cost.toFixed(2)}`
        }
      ]
    };

    return {
      success: true,
      type: 'cost',
      data: timeRange,
      display: 'table'
    };
  }

  /**
   * 收集成本数据
   * @param context 命令上下文
   * @returns 成本数据
   */
  private async collectCostData(context: any): Promise<CostData> {
    // 这里应该从实际的成本跟踪系统中获取数据
    // 目前使用模拟数据，后续需要集成真实的成本跟踪系统
    
    return {
      totalCost: 45.67,
      costBreakdown: [
        { service: 'AI模型调用', calls: 1200, cost: 32.50, percentage: 71.2 },
        { service: '工具执行', calls: 850, cost: 8.25, percentage: 18.1 },
        { service: '文件处理', calls: 300, cost: 3.42, percentage: 7.5 },
        { service: '网络请求', calls: 150, cost: 1.50, percentage: 3.2 }
      ],
      usageStats: {
        totalCalls: 2500,
        successfulCalls: 2420,
        failedCalls: 80,
        averageCostPerCall: 0.0183
      },
      timeRangeStats: {
        daily: { calls: 85, cost: 1.56 },
        weekly: { calls: 595, cost: 10.92 },
        monthly: { calls: 2500, cost: 45.67 }
      },
      subscriptionInfo: {
        isSubscriber: true,
        usingOverage: false,
        rateLimit: '1000次/小时',
        nextReset: new Date(Date.now() + 2 * 60 * 60 * 1000) // 2小时后重置
      }
    };
  }

  /**
   * 格式化订阅信息
   * @param subscriptionInfo 订阅信息
   * @returns 格式化后的订阅信息
   */
  private formatSubscriptionInfo(subscriptionInfo: any): string {
    let info = '';
    
    if (subscriptionInfo.isSubscriber) {
      if (subscriptionInfo.usingOverage) {
        info = '您当前正在使用超额用量来支持您的使用。我们将在订阅限制重置时自动切换回您的订阅速率限制';
      } else {
        info = '您当前正在使用您的订阅来支持您的使用';
      }
      
      info += `\n速率限制: ${subscriptionInfo.rateLimit}\n`;
      info += `下次重置: ${this.formatTimeUntil(subscriptionInfo.nextReset)}`;
    } else {
      info = '您当前使用按量付费模式';
    }
    
    return info;
  }

  /**
   * 格式化时间差
   * @param targetTime 目标时间
   * @returns 格式化后的时间差
   */
  private formatTimeUntil(targetTime: Date): string {
    const now = new Date();
    const diffMs = targetTime.getTime() - now.getTime();
    
    if (diffMs <= 0) {
      return '已重置';
    }
    
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    
    if (hours > 0) {
      if (minutes > 0) {
        return `${hours}小时${minutes}分钟后`;
      } else {
        return `${hours}小时后`;
      }
    } else {
      return `${minutes}分钟后`;
    }
  }
}
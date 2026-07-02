/**
 * 工具错误收集器
 * 对标 Hermes agent_loop.py ToolError dataclass
 *
 * 结构化收集工具执行过程中的错误信息，支持按轮次查询和汇总统计。
 */
import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({
  module: 'query:toolErrorCollector',
  level: LogLevel.INFO,
});

/**
 * 结构化工具错误（对标 Hermes ToolError）
 */
export interface ToolErrorRecord {
  /** 发生错误的轮次 */
  turn: number;
  /** 工具名称 */
  toolName: string;
  /** 调用参数（截断到 200 字符） */
  arguments: string;
  /** 错误信息 */
  error: string;
  /** 返回给模型的错误结果 */
  toolResult: string;
  /** 错误发生时间戳 */
  timestamp: number;
}

/**
 * 工具错误汇总
 */
export interface ToolErrorSummary {
  /** 总错误数 */
  totalErrors: number;
  /** 按工具名称分类统计 */
  byTool: Record<string, number>;
  /** 按轮次分类统计 */
  byTurn: Record<string, number>;
  /** 最早错误时间 */
  firstErrorAt: number;
  /** 最近错误时间 */
  lastErrorAt: number;
  /** 最常见的错误工具 */
  topErrorTools: Array<{ toolName: string; count: number }>;
}

/**
 * 工具错误收集器
 * 在每个 Agent 循环中收集和查询工具执行错误
 */
export class ToolErrorCollector {
  private errors: ToolErrorRecord[] = [];

  /**
   * 记录一个工具错误
   * @param error 错误信息
   */
  record(error: ToolErrorRecord): void {
    this.errors.push(error);

    logger.debug('Tool error recorded', {
      turn: error.turn,
      tool: error.toolName,
      error: error.error.slice(0, 100),
    });
  }

  /**
   * 批量记录多个工具错误
   * @param errors 错误列表
   */
  recordBatch(errors: ToolErrorRecord[]): void {
    for (const error of errors) {
      this.record(error);
    }
  }

  /**
   * 获取指定轮次的所有错误
   * @param turn 轮次号
   */
  getByTurn(turn: number): ToolErrorRecord[] {
    return this.errors.filter((e) => e.turn === turn);
  }

  /**
   * 获取指定工具的所有错误
   * @param toolName 工具名称
   */
  getByTool(toolName: string): ToolErrorRecord[] {
    return this.errors.filter((e) => e.toolName === toolName);
  }

  /**
   * 获取所有错误
   */
  getAll(): ToolErrorRecord[] {
    return [...this.errors];
  }

  /**
   * 获取错误汇总统计
   */
  getSummary(): ToolErrorSummary {
    const byTool: Record<string, number> = {};
    const byTurn: Record<string, number> = {};

    for (const e of this.errors) {
      byTool[e.toolName] = (byTool[e.toolName] || 0) + 1;
      byTurn[String(e.turn)] = (byTurn[String(e.turn)] || 0) + 1;
    }

    const topErrorTools = Object.entries(byTool)
      .map(([toolName, count]) => ({ toolName, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    const timestamps = this.errors.map((e) => e.timestamp);

    return {
      totalErrors: this.errors.length,
      byTool,
      byTurn,
      firstErrorAt: timestamps.length > 0 ? Math.min(...timestamps) : 0,
      lastErrorAt: timestamps.length > 0 ? Math.max(...timestamps) : 0,
      topErrorTools,
    };
  }

  /**
   * 清空所有已收集的错误
   */
  clear(): void {
    this.errors = [];
  }

  /**
   * 生成可集成到 AgentResult 中的结果
   * @param turnsUsed 使用的轮次数
   */
  toAgentResult(turnsUsed: number): {
    toolErrors: ToolErrorRecord[];
    errorSummary: ToolErrorSummary;
  } {
    return {
      toolErrors: [...this.errors],
      errorSummary: this.getSummary(),
    };
  }

  /**
   * 错误总数
   */
  get count(): number {
    return this.errors.length;
  }

  /**
   * 是否有错误
   */
  get hasErrors(): boolean {
    return this.errors.length > 0;
  }
}

/**
 * 创建全局共享的工具错误收集器
 */
export function createToolErrorCollector(): ToolErrorCollector {
  return new ToolErrorCollector();
}

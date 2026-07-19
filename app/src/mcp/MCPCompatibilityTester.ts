/**
 * MCP 协议兼容性回归测试器
 */
import { EventEmitter } from 'events';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'mcp:MCPCompatibilityTester',
  level: LogLevel.INFO,
});

/**
 * 测试用例
 */
export interface MCPTestCase {
  name: string;
  category:
    | 'protocol'
    | 'transport'
    | 'tool'
    | 'authentication'
    | 'serialization';
  description: string;
  execute: () => Promise<MCPTestResult>;
}

/**
 * 测试结果
 */
export interface MCPTestResult {
  passed: boolean;
  name: string;
  durationMs: number;
  error?: string;
  details?: Record<string, unknown>;
}

/**
 * 兼容性报告
 */
export interface MCPCompatibilityReport {
  version: string;
  testedAt: number;
  totalTests: number;
  passed: number;
  failed: number;
  skipped: number;
  passRate: number;
  results: MCPTestResult[];
  summary: string;
}

/**
 * 回归测试配置
 */
export interface MCPRegressionConfig {
  version: string;
  timeoutPerTestMs: number;
  stopOnFirstFailure: boolean;
  retryFailedTests: boolean;
  maxRetries: number;
}

/**
 * 默认配置
 */
const DEFAULT_CONFIG: MCPRegressionConfig = {
  version: '2024-11-05',
  timeoutPerTestMs: 10_000,
  stopOnFirstFailure: false,
  retryFailedTests: true,
  maxRetries: 2,
};

/**
 * MCP 兼容性回归测试器
 */
export class MCPCompatibilityTester extends EventEmitter {
  private testCases: MCPTestCase[] = [];
  private config: MCPRegressionConfig;
  private lastReport: MCPCompatibilityReport | null = null;

  constructor(config?: Partial<MCPRegressionConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 注册测试用例
   * @param testCase 测试用例
   */
  registerTestCase(testCase: MCPTestCase): void {
    this.testCases.push(testCase);
  }

  /**
   * 注册多个测试用例
   * @param testCases 测试用例列表
   */
  registerTestCases(testCases: MCPTestCase[]): void {
    for (const tc of testCases) {
      this.registerTestCase(tc);
    }
  }

  /**
   * 运行全部回归测试
   * @returns 兼容性报告
   */
  async runAll(): Promise<MCPCompatibilityReport> {
    const results: MCPTestResult[] = [];
    let passed = 0;
    let failed = 0;
    let skipped = 0;

    for (const testCase of this.testCases) {
      this.emit('testStarted', { name: testCase.name });

      let result = await this.runWithTimeout(testCase);

      if (!result.passed && this.config.retryFailedTests) {
        for (let retry = 1; retry <= this.config.maxRetries; retry++) {
          this.emit('testRetry', { name: testCase.name, attempt: retry });

          result = await this.runWithTimeout(testCase);

          if (result.passed) break;
        }
      }

      results.push(result);

      if (result.passed) {
        passed++;
        this.emit('testPassed', {
          name: testCase.name,
          durationMs: result.durationMs,
        });
      } else {
        failed++;

        this.emit('testFailed', {
          name: testCase.name,
          error: result.error,
          durationMs: result.durationMs,
        });

        if (this.config.stopOnFirstFailure) {
          skipped = this.testCases.length - results.length;

          break;
        }
      }
    }

    skipped += this.testCases.length - results.length;

    const totalTests = results.length + skipped;

    const report: MCPCompatibilityReport = {
      version: this.config.version,
      testedAt: Date.now(),
      totalTests,
      passed,
      failed,
      skipped,
      passRate: totalTests > 0 ? (passed / totalTests) * 100 : 0,
      results,
      summary: this.buildSummary(passed, failed, skipped, totalTests),
    };

    this.lastReport = report;

    this.emit('completed', report);

    return report;
  }

  /**
   * 运行单个测试，带超时
   * @param testCase 测试用例
   * @returns 测试结果
   */
  private async runWithTimeout(testCase: MCPTestCase): Promise<MCPTestResult> {
    const startTime = Date.now();

    try {
      const result = await Promise.race([
        testCase.execute(),
        this.createTimeout(testCase.name, this.config.timeoutPerTestMs),
      ]);

      if (typeof result === 'object' && result !== null && 'passed' in result) {
        return result;
      }

      return result as MCPTestResult;
    } catch (err) {
      return {
        passed: false,
        name: testCase.name,
        durationMs: Date.now() - startTime,
        error: err instanceof Error ? err.message : '测试异常',
      };
    }
  }

  /**
   * 创建超时 Promise
   * @param name 测试名
   * @param ms 超时时间
   */
  private createTimeout(name: string, ms: number): Promise<MCPTestResult> {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          passed: false,
          name,
          durationMs: ms,
          error: `测试超时 (${ms}ms)`,
        });
      }, ms);
    });
  }

  /**
   * 生成报告摘要
   */
  private buildSummary(
    passed: number,
    failed: number,
    skipped: number,
    total: number
  ): string {
    if (total === 0) return '无测试用例';

    const passRate = ((passed / total) * 100).toFixed(1);

    if (failed === 0 && skipped === 0) {
      return `✅ MCP 协议兼容性测试全部通过: ${passed}/${total} (${passRate}%)`;
    }

    if (failed > 0) {
      return `❌ ${failed}/${total} 个测试失败 (${passRate}%), ${skipped} 个跳过`;
    }

    return `⚠️ ${passed}/${total} 通过 (${passRate}%), ${skipped} 个跳过`;
  }

  /**
   * 生成兼容性报告文本
   */
  formatReport(report?: MCPCompatibilityReport): string {
    const r = report || this.lastReport;
    if (!r) return '无报告';

    const lines: string[] = [];

    lines.push('=== MCP 协议兼容性回归报告 ===');
    lines.push(`MCP 版本: ${r.version}`);
    lines.push(`测试时间: ${new Date(r.testedAt).toISOString()}`);
    lines.push(
      `通过率: ${r.passRate.toFixed(1)}% (${r.passed}/${r.totalTests})`
    );
    lines.push('');

    if (r.failed > 0) {
      lines.push('失败项:');
      for (const result of r.results.filter((res) => !res.passed)) {
        lines.push(`  ❌ ${result.name}: ${result.error || '未知错误'}`);
      }
      lines.push('');
    }

    lines.push('全部结果:');
    for (const result of r.results) {
      const icon = result.passed ? '✅' : '❌';
      lines.push(`  ${icon} ${result.name} (${result.durationMs}ms)`);
    }

    return lines.join('\n');
  }

  /**
   * 获取上次报告
   */
  getLastReport(): MCPCompatibilityReport | null {
    return this.lastReport;
  }

  /**
   * 清空测试用例
   */
  clearTestCases(): void {
    this.testCases = [];
  }

  /**
   * 获取测试用例数量
   */
  getTestCaseCount(): number {
    return this.testCases.length;
  }
}

/**
 * 全局 MCP 兼容性测试器
 */
let globalTester: MCPCompatibilityTester | null = null;

/**
 * 获取全局 MCP 兼容性测试器
 */
export function getMCPCompatibilityTester(): MCPCompatibilityTester {
  if (!globalTester) {
    globalTester = new MCPCompatibilityTester();
  }

  return globalTester;
}

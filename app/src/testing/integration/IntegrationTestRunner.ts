import { handleError } from '@modules/error';
/**
 * IntegrationTestRunner 集成测试运行器
 * 对标 CC 的集成测试框架
 */

/**
 * 测试用例
 */
export interface TestCase {
  name: string;
  module: string;
  fn: () => Promise<void> | void;
  timeout?: number;
}

/**
 * 测试套件
 */
export interface TestSuite {
  name: string;
  description: string;
  beforeAll?: () => Promise<void>;
  afterAll?: () => Promise<void>;
  beforeEach?: () => Promise<void>;
  afterEach?: () => Promise<void>;
  tests: TestCase[];
}

/**
 * 测试结果
 */
export interface TestResult {
  suite: string;
  test: string;
  passed: boolean;
  duration: number;
  error?: string;
}

/**
 * 集成配置
 */
export interface IntegrationConfig {
  timeout: number;
  failFast: boolean;
  verbose: boolean;
}

/**
 * 集成测试运行器
 */
export class IntegrationTestRunner {
  private suites: TestSuite[] = [];
  private config: IntegrationConfig;

  constructor(config?: Partial<IntegrationConfig>) {
    this.config = {
      timeout: config?.timeout || 30000,
      failFast: config?.failFast || false,
      verbose: config?.verbose !== false,
    };
  }

  /**
   * 注册测试套件
   */
  register(suite: TestSuite): void {
    this.suites.push(suite);
  }

  /**
   * 运行所有套件
   */
  async runAll(): Promise<{
    results: TestResult[];
    summary: {
      total: number;
      passed: number;
      failed: number;
      duration: number;
    };
  }> {
    const allResults: TestResult[] = [];
    const startTime = Date.now();

    for (const suite of this.suites) {
      const results = await this.runSuite(suite);
      allResults.push(...results);

      if (this.config.failFast && results.some((r) => !r.passed)) {
        break;
      }
    }

    const passed = allResults.filter((r) => r.passed).length;

    return {
      results: allResults,
      summary: {
        total: allResults.length,
        passed,
        failed: allResults.length - passed,
        duration: Date.now() - startTime,
      },
    };
  }

  /**
   * 运行指定套件
   */
  async runSuite(suite: TestSuite): Promise<TestResult[]> {
    const results: TestResult[] = [];

    try {
      if (suite.beforeAll) await suite.beforeAll();
    } catch (err) {
      for (const test of suite.tests) {
        results.push({
          suite: suite.name,
          test: test.name,
          passed: false,
          duration: 0,
          error: `beforeAll 失败: ${err instanceof Error ? err.message : String(err)}`,
        });
      }

      return results;
    }

    for (const test of suite.tests) {
      if (this.config.failFast && results.some((r) => !r.passed)) break;

      const result = await this.runTest(suite, test);
      results.push(result);
    }

    try {
      if (suite.afterAll) await suite.afterAll();
    } catch (err) {
      void handleError(err, {
        module: 'testing:integration',
        action: 'catch_error',
      });
    }

    return results;
  }

  /**
   * 运行单个测试
   */
  private async runTest(suite: TestSuite, test: TestCase): Promise<TestResult> {
    const startTime = Date.now();

    try {
      if (suite.beforeEach) await suite.beforeEach();

      const timer = new Promise<never>((_, reject) => {
        setTimeout(
          () =>
            reject(new Error(`超时: ${test.timeout || this.config.timeout}ms`)),
          test.timeout || this.config.timeout
        );
      });

      await Promise.race([test.fn(), timer]);

      if (suite.afterEach) await suite.afterEach();

      return {
        suite: suite.name,
        test: test.name,
        passed: true,
        duration: Date.now() - startTime,
      };
    } catch (err) {
      return {
        suite: suite.name,
        test: test.name,
        passed: false,
        duration: Date.now() - startTime,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * 获取注册的套件
   */
  getSuites(): TestSuite[] {
    return [...this.suites];
  }

  /**
   * 清空套件
   */
  clear(): void {
    this.suites = [];
  }
}

export const integrationTestRunner = new IntegrationTestRunner();

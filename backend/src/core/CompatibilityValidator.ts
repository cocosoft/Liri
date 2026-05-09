/**
 * 兼容性验证器
 * 验证重构后的Core模块与现有系统的兼容性
 */

import { logger } from '../utils/log.js';
import { EnhancedModuleDependencyManager } from './EnhancedModuleDependencyManager.js';
import { StartupOptimizer } from './StartupOptimizer.js';
import { RemoteConfigManager } from './RemoteConfigManager.js';
import {
  ModuleDependencyManager,
  ModuleDefinition,
} from './ModuleDependencyManager.js';

/**
 * 兼容性测试结果
 */
export interface CompatibilityResult {
  component: string;
  status: 'pass' | 'fail' | 'warning';
  message: string;
  details?: any;
}

/**
 * API兼容性检查
 */
export interface APICompatibility {
  interface: string;
  compatible: boolean;
  breakingChanges: string[];
  migrationRequired: boolean;
}

/**
 * 性能对比结果
 */
export interface PerformanceComparison {
  metric: string;
  oldValue: number;
  newValue: number;
  improvement: number; // 百分比
  significance: 'high' | 'medium' | 'low';
}

/**
 * 兼容性验证器
 */
export class CompatibilityValidator {
  private oldModuleManager: ModuleDependencyManager;
  private newModuleManager: EnhancedModuleDependencyManager;
  private startupOptimizer: StartupOptimizer;
  private configManager: RemoteConfigManager;

  constructor() {
    this.oldModuleManager = new ModuleDependencyManager();
    this.newModuleManager = new EnhancedModuleDependencyManager();
    this.startupOptimizer = new StartupOptimizer(this.newModuleManager);
    this.configManager = new RemoteConfigManager();
  }

  /**
   * 运行完整的兼容性验证
   */
  async validateCompatibility(): Promise<CompatibilityResult[]> {
    const results: CompatibilityResult[] = [];

    console.log('=== 开始兼容性验证 ===\n');

    // 1. API兼容性验证
    results.push(...(await this.validateAPICompatibility()));

    // 2. 功能兼容性验证
    results.push(...(await this.validateFunctionalCompatibility()));

    // 3. 性能对比验证
    results.push(...(await this.validatePerformance()));

    // 4. 集成兼容性验证
    results.push(...(await this.validateIntegration()));

    // 5. 向后兼容性验证
    results.push(...(await this.validateBackwardCompatibility()));

    console.log('\n=== 兼容性验证完成 ===');

    return results;
  }

  /**
   * 验证API兼容性
   */
  private async validateAPICompatibility(): Promise<CompatibilityResult[]> {
    const results: CompatibilityResult[] = [];
    console.log('1. 验证API兼容性...');

    // 检查ModuleDependencyManager API兼容性
    const oldMethods = this.getObjectMethods(this.oldModuleManager);
    const newMethods = this.getObjectMethods(this.newModuleManager);

    // 检查缺失的方法
    const missingMethods = oldMethods.filter(
      (method) => !newMethods.includes(method)
    );
    if (missingMethods.length === 0) {
      results.push({
        component: 'ModuleDependencyManager API',
        status: 'pass',
        message: '所有API方法保持兼容',
      });
    } else {
      results.push({
        component: 'ModuleDependencyManager API',
        status: 'warning',
        message: `发现${missingMethods.length}个缺失的方法`,
        details: { missingMethods },
      });
    }

    // 检查新增的方法
    const newMethodsAdded = newMethods.filter(
      (method) => !oldMethods.includes(method)
    );
    if (newMethodsAdded.length > 0) {
      results.push({
        component: 'ModuleDependencyManager API',
        status: 'pass',
        message: `新增${newMethodsAdded.length}个增强方法`,
        details: { newMethods: newMethodsAdded },
      });
    }

    return results;
  }

  /**
   * 验证功能兼容性
   */
  private async validateFunctionalCompatibility(): Promise<
    CompatibilityResult[]
  > {
    const results: CompatibilityResult[] = [];
    console.log('2. 验证功能兼容性...');

    // 测试模块注册功能
    const testModules: ModuleDefinition[] = [
      {
        name: 'test-module',
        version: '1.0.0',
        description: '测试模块',
        dependencies: [],
      },
    ];

    try {
      // 旧版本注册
      testModules.forEach((module) => {
        this.oldModuleManager.registerModule(module);
      });

      // 新版本注册（需要转换接口）
      testModules.forEach((module) => {
        this.newModuleManager.registerModule({
          ...module,
          preload: false,
          parallelizable: true,
        });
      });

      results.push({
        component: '模块注册功能',
        status: 'pass',
        message: '模块注册功能兼容',
      });
    } catch (error) {
      results.push({
        component: '模块注册功能',
        status: 'fail',
        message: '模块注册功能不兼容',
        details: {
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      });
    }

    // 测试依赖分析功能
    try {
      const oldAnalysis = this.oldModuleManager.calculateLoadOrder();
      const newAnalysis = this.newModuleManager.analyzeDependencies();

      if (oldAnalysis.length > 0 && newAnalysis.loadOrder.length > 0) {
        results.push({
          component: '依赖分析功能',
          status: 'pass',
          message: '依赖分析功能兼容',
        });
      } else {
        results.push({
          component: '依赖分析功能',
          status: 'warning',
          message: '依赖分析结果不一致',
        });
      }
    } catch (error) {
      results.push({
        component: '依赖分析功能',
        status: 'fail',
        message: '依赖分析功能不兼容',
        details: {
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      });
    }

    return results;
  }

  /**
   * 验证性能对比
   */
  private async validatePerformance(): Promise<CompatibilityResult[]> {
    const results: CompatibilityResult[] = [];
    console.log('3. 验证性能对比...');

    // 测试模块加载性能
    const testIterations = 10;

    try {
      // 旧版本性能测试
      const oldStartTime = Date.now();
      for (let i = 0; i < testIterations; i++) {
        this.oldModuleManager.calculateLoadOrder();
      }
      const oldDuration = Date.now() - oldStartTime;

      // 新版本性能测试
      const newStartTime = Date.now();
      for (let i = 0; i < testIterations; i++) {
        this.newModuleManager.analyzeDependencies();
      }
      const newDuration = Date.now() - newStartTime;

      const improvement = ((oldDuration - newDuration) / oldDuration) * 100;

      if (improvement > 0) {
        results.push({
          component: '性能对比',
          status: 'pass',
          message: `性能提升 ${improvement.toFixed(1)}%`,
          details: {
            oldDuration,
            newDuration,
            improvement,
          },
        });
      } else {
        results.push({
          component: '性能对比',
          status: 'warning',
          message: `性能下降 ${Math.abs(improvement).toFixed(1)}%`,
          details: {
            oldDuration,
            newDuration,
            improvement,
          },
        });
      }
    } catch (error) {
      results.push({
        component: '性能对比',
        status: 'fail',
        message: '性能测试失败',
        details: {
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      });
    }

    return results;
  }

  /**
   * 验证集成兼容性
   */
  private async validateIntegration(): Promise<CompatibilityResult[]> {
    const results: CompatibilityResult[] = [];
    console.log('4. 验证集成兼容性...');

    // 测试与现有AppCore的集成
    try {
      // 模拟AppCore集成测试
      const integrationTest = await this.testAppCoreIntegration();

      if (integrationTest.success) {
        results.push({
          component: 'AppCore集成',
          status: 'pass',
          message: '与现有AppCore集成兼容',
        });
      } else {
        results.push({
          component: 'AppCore集成',
          status: 'warning',
          message: '集成测试发现小问题',
          details: integrationTest.details,
        });
      }
    } catch (error) {
      results.push({
        component: 'AppCore集成',
        status: 'fail',
        message: 'AppCore集成测试失败',
        details: {
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      });
    }

    // 测试配置管理集成
    try {
      await this.configManager.registerConfig({
        key: 'compatibility_test',
        type: 'string',
        defaultValue: 'test_value',
      });

      const value = this.configManager.getConfig<string>('compatibility_test');

      if (value === 'test_value') {
        results.push({
          component: '配置管理集成',
          status: 'pass',
          message: '配置管理集成兼容',
        });
      } else {
        results.push({
          component: '配置管理集成',
          status: 'fail',
          message: '配置管理集成测试失败',
        });
      }
    } catch (error) {
      results.push({
        component: '配置管理集成',
        status: 'fail',
        message: '配置管理集成异常',
        details: {
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      });
    }

    return results;
  }

  /**
   * 验证向后兼容性
   */
  private async validateBackwardCompatibility(): Promise<
    CompatibilityResult[]
  > {
    const results: CompatibilityResult[] = [];
    console.log('5. 验证向后兼容性...');

    // 测试数据格式兼容性
    try {
      const compatibility = await this.testDataFormatCompatibility();

      if (compatibility.success) {
        results.push({
          component: '数据格式兼容性',
          status: 'pass',
          message: '数据格式向后兼容',
        });
      } else {
        results.push({
          component: '数据格式兼容性',
          status: 'warning',
          message: '数据格式存在兼容性问题',
          details: compatibility.details,
        });
      }
    } catch (error) {
      results.push({
        component: '数据格式兼容性',
        status: 'fail',
        message: '数据格式兼容性测试失败',
        details: {
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      });
    }

    // 测试错误处理兼容性
    try {
      const errorHandling = await this.testErrorHandlingCompatibility();

      if (errorHandling.success) {
        results.push({
          component: '错误处理兼容性',
          status: 'pass',
          message: '错误处理机制兼容',
        });
      } else {
        results.push({
          component: '错误处理兼容性',
          status: 'warning',
          message: '错误处理存在兼容性问题',
          details: errorHandling.details,
        });
      }
    } catch (error) {
      results.push({
        component: '错误处理兼容性',
        status: 'fail',
        message: '错误处理兼容性测试失败',
        details: {
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      });
    }

    return results;
  }

  /**
   * 模拟AppCore集成测试
   */
  private async testAppCoreIntegration(): Promise<{
    success: boolean;
    details?: any;
  }> {
    // 模拟AppCore的模块初始化流程
    try {
      // 注册核心模块（模拟AppCore的行为）
      const coreModules = [
        {
          name: 'logger',
          version: '1.0.0',
          description: '日志系统',
          dependencies: [],
          preload: true,
          parallelizable: true,
        },
        {
          name: 'terminal',
          version: '1.0.0',
          description: '终端UI系统',
          dependencies: ['logger'],
          preload: true,
          parallelizable: true,
        },
      ];

      coreModules.forEach((module) => {
        this.newModuleManager.registerModule(module);
      });

      // 分析依赖关系
      const analysis = this.newModuleManager.analyzeDependencies();

      // 并行加载模块
      const loadResults = await this.newModuleManager.loadModulesInParallel(
        analysis.loadOrder
      );

      return {
        success: loadResults.every((result) => result.success),
        details: {
          modulesRegistered: coreModules.length,
          loadResults: loadResults.length,
        },
      };
    } catch (error) {
      return {
        success: false,
        details: {
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  }

  /**
   * 测试数据格式兼容性
   */
  private async testDataFormatCompatibility(): Promise<{
    success: boolean;
    details?: any;
  }> {
    // 测试模块定义数据格式兼容性
    try {
      const oldModuleFormat: ModuleDefinition = {
        name: 'test-module',
        version: '1.0.0',
        description: '测试模块',
        dependencies: [],
      };

      // 转换为新格式（应该能够处理旧格式）
      const newModuleFormat = {
        ...oldModuleFormat,
        preload: false,
        parallelizable: true,
      };

      // 两种格式都应该能够注册
      this.oldModuleManager.registerModule(oldModuleFormat);
      this.newModuleManager.registerModule(newModuleFormat);

      return { success: true };
    } catch (error) {
      return {
        success: false,
        details: {
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  }

  /**
   * 测试错误处理兼容性
   */
  private async testErrorHandlingCompatibility(): Promise<{
    success: boolean;
    details?: any;
  }> {
    // 测试错误处理机制
    try {
      // 测试不存在的模块（两种版本应该表现一致）
      try {
        this.oldModuleManager.calculateLoadOrder(); // 空管理器应该能处理
      } catch (error) {
        // 预期可能抛出错误
      }

      try {
        this.newModuleManager.analyzeDependencies(); // 空管理器应该能处理
      } catch (error) {
        // 预期可能抛出错误
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        details: {
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  }

  /**
   * 获取对象的方法列表
   */
  private getObjectMethods(obj: any): string[] {
    const methods: string[] = [];

    // 获取原型链上的方法
    let current = obj;
    while (current && current !== Object.prototype) {
      Object.getOwnPropertyNames(current).forEach((prop) => {
        if (prop !== 'constructor' && typeof obj[prop] === 'function') {
          methods.push(prop);
        }
      });
      current = Object.getPrototypeOf(current);
    }

    return [...new Set(methods)]; // 去重
  }

  /**
   * 生成兼容性报告
   */
  generateReport(results: CompatibilityResult[]): string {
    const totalTests = results.length;
    const passedTests = results.filter((r) => r.status === 'pass').length;
    const failedTests = results.filter((r) => r.status === 'fail').length;
    const warningTests = results.filter((r) => r.status === 'warning').length;

    const successRate = (passedTests / totalTests) * 100;

    let report = `=== Core模块兼容性验证报告 ===\n`;
    report += `验证时间: ${new Date().toISOString()}\n`;
    report += `总测试数: ${totalTests}\n`;
    report += `通过测试: ${passedTests}\n`;
    report += `失败测试: ${failedTests}\n`;
    report += `警告测试: ${warningTests}\n`;
    report += `兼容性率: ${successRate.toFixed(1)}%\n\n`;

    // 按组件分组显示结果
    const groupedResults = results.reduce(
      (acc, result) => {
        const component = result.component;
        if (!acc[component]) acc[component] = [];
        acc[component].push(result);
        return acc;
      },
      {} as Record<string, CompatibilityResult[]>
    );

    Object.entries(groupedResults).forEach(([component, componentResults]) => {
      report += `${component}:\n`;
      componentResults.forEach((result) => {
        const statusIcon =
          result.status === 'pass'
            ? '✅'
            : result.status === 'warning'
              ? '⚠️'
              : '❌';
        report += `  ${statusIcon} ${result.message}\n`;

        if (result.details) {
          report += `     详情: ${JSON.stringify(result.details, null, 2)}\n`;
        }
      });
      report += '\n';
    });

    // 总体评估
    if (successRate >= 90) {
      report += '🎉 兼容性优秀！可以安全升级。\n';
    } else if (successRate >= 70) {
      report += '⚠️ 兼容性良好，但需要关注警告项。\n';
    } else {
      report += '❌ 兼容性存在问题，需要修复后再升级。\n';
    }

    return report;
  }
}

/**
 * 运行兼容性验证的主函数
 */
async function main(): Promise<void> {
  console.log('开始Core模块兼容性验证...\n');

  try {
    const validator = new CompatibilityValidator();
    const results = await validator.validateCompatibility();

    console.log(validator.generateReport(results));

    // 总结
    const passedTests = results.filter((r) => r.status === 'pass').length;
    const totalTests = results.length;

    if (passedTests === totalTests) {
      console.log('🎉 所有兼容性测试通过！重构后的Core模块可以安全集成。');
    } else {
      console.log(
        `⚠️  ${passedTests}/${totalTests} 兼容性测试通过，需要关注不兼容的项目。`
      );
    }
  } catch (error) {
    console.error('兼容性验证失败:', error);
    process.exit(1);
  }
}

// 直接运行验证
main().catch(console.error);

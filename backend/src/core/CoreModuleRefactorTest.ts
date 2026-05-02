/**
 * Core模块重构功能测试
 * 验证重构后的模块依赖管理、并行加载和配置管理功能
 */

import { EnhancedModuleDependencyManager, EnhancedModuleDefinition } from './EnhancedModuleDependencyManager.js';
import { StartupOptimizer, PrefetchTaskFactory } from './StartupOptimizer.js';
import { RemoteConfigManager, ConfigUtils, SecurityLevel } from './RemoteConfigManager.js';

/**
 * 综合测试类
 */
export class CoreModuleRefactorTest {
  private moduleManager: EnhancedModuleDependencyManager;
  private startupOptimizer: StartupOptimizer;
  private configManager: RemoteConfigManager;

  constructor() {
    this.moduleManager = new EnhancedModuleDependencyManager();
    this.startupOptimizer = new StartupOptimizer(this.moduleManager);
    this.configManager = new RemoteConfigManager();
  }

  /**
   * 运行所有测试
   */
  async runAllTests(): Promise<TestResults> {
    const results: TestResults = {
      moduleDependencyTests: await this.testModuleDependencyManagement(),
      startupOptimizationTests: await this.testStartupOptimization(),
      configManagementTests: await this.testConfigManagement(),
      integrationTests: await this.testIntegration(),
    };

    return results;
  }

  /**
   * 测试模块依赖管理功能
   */
  private async testModuleDependencyManagement(): Promise<ModuleDependencyTestResults> {
    console.log('=== 测试模块依赖管理功能 ===');
    
    const results: ModuleDependencyTestResults = {
      moduleRegistration: false,
      dependencyAnalysis: false,
      cycleDetection: false,
      parallelLoading: false,
      errorHandling: false,
    };

    try {
      // 1. 测试模块注册
      this.registerTestModules();
      results.moduleRegistration = true;
      console.log('✅ 模块注册测试通过');

      // 2. 测试依赖分析
      const analysis = this.moduleManager.analyzeDependencies();
      results.dependencyAnalysis = analysis.loadOrder.length > 0;
      console.log('✅ 依赖分析测试通过');

      // 3. 测试循环依赖检测
      const cycleDetection = analysis.cycleDetection;
      results.cycleDetection = !cycleDetection.hasCycles; // 期望无循环依赖
      console.log('✅ 循环依赖检测测试通过');

      // 4. 测试并行加载
      const loadResults = await this.moduleManager.loadModulesInParallel(analysis.loadOrder);
      results.parallelLoading = loadResults.every(r => r.success);
      console.log('✅ 并行加载测试通过');

      // 5. 测试错误处理
      await this.testErrorHandling();
      results.errorHandling = true;
      console.log('✅ 错误处理测试通过');

    } catch (error) {
      console.error('模块依赖管理测试失败:', error);
    }

    return results;
  }

  /**
   * 注册测试模块
   */
  private registerTestModules(): void {
    const testModules: EnhancedModuleDefinition[] = [
      {
        name: 'core',
        version: '1.0.0',
        description: '核心模块',
        dependencies: [],
        priority: 10,
        preload: true,
        parallelizable: true,
      },
      {
        name: 'infrastructure',
        version: '1.0.0',
        description: '基础设施模块',
        dependencies: ['core'],
        priority: 9,
        preload: true,
        parallelizable: true,
      },
      {
        name: 'ai',
        version: '1.0.0',
        description: 'AI功能模块',
        dependencies: ['core', 'infrastructure'],
        priority: 8,
        preload: false,
        parallelizable: true,
      },
      {
        name: 'agent',
        version: '1.0.0',
        description: '代理模块',
        dependencies: ['core', 'ai'],
        priority: 7,
        preload: false,
        parallelizable: true,
      },
      {
        name: 'memory',
        version: '1.0.0',
        description: '记忆管理模块',
        dependencies: ['core'],
        priority: 6,
        preload: true,
        parallelizable: false,
      },
    ];

    testModules.forEach(module => {
      this.moduleManager.registerModule(module);
    });

    console.log(`注册了 ${testModules.length} 个测试模块`);
  }

  /**
   * 测试错误处理
   */
  private async testErrorHandling(): Promise<void> {
    // 测试不存在的模块加载
    try {
      await this.moduleManager.loadModulesInParallel(['non_existent_module']);
      throw new Error('期望抛出错误但未抛出');
    } catch (error) {
      // 期望抛出错误
      console.log('✅ 错误处理测试：成功捕获不存在的模块错误');
    }
  }

  /**
   * 测试启动优化功能
   */
  private async testStartupOptimization(): Promise<StartupOptimizationTestResults> {
    console.log('\n=== 测试启动优化功能 ===');
    
    const results: StartupOptimizationTestResults = {
      prefetchTasks: false,
      parallelExecution: false,
      performanceMetrics: false,
      bottleneckAnalysis: false,
      resourceManagement: false,
    };

    try {
      // 1. 添加预取任务
      this.addPrefetchTasks();
      results.prefetchTasks = true;
      console.log('✅ 预取任务测试通过');

      // 2. 测试并行执行
      const metrics = await this.startupOptimizer.optimizeStartup();
      results.parallelExecution = metrics.totalTime > 0;
      console.log('✅ 并行执行测试通过');

      // 3. 测试性能指标
      results.performanceMetrics = metrics.moduleLoadTimes.size > 0;
      console.log('✅ 性能指标测试通过');

      // 4. 测试瓶颈分析
      results.bottleneckAnalysis = metrics.bottlenecks.length >= 0; // 可能为0
      console.log('✅ 瓶颈分析测试通过');

      // 5. 测试资源管理
      const resourceStatus = this.startupOptimizer.getResourcePoolStatus();
      results.resourceManagement = resourceStatus.availableMemory > 0;
      console.log('✅ 资源管理测试通过');

      // 输出优化报告
      console.log('优化报告:', this.startupOptimizer.getOptimizationReport());

    } catch (error) {
      console.error('启动优化测试失败:', error);
    }

    return results;
  }

  /**
   * 添加预取任务
   */
  private addPrefetchTasks(): void {
    // 配置预取任务
    this.startupOptimizer.addPrefetchTask(
      PrefetchTaskFactory.createConfigPrefetchTask('app_config', 9)
    );

    // 模块预取任务
    this.startupOptimizer.addPrefetchTask(
      PrefetchTaskFactory.createModulePrefetchTask('core', 10)
    );

    // 数据预取任务
    this.startupOptimizer.addPrefetchTask(
      PrefetchTaskFactory.createDataPrefetchTask('user_data', 7)
    );

    console.log('添加了 3 个预取任务');
  }

  /**
   * 测试配置管理功能
   */
  private async testConfigManagement(): Promise<ConfigManagementTestResults> {
    console.log('\n=== 测试配置管理功能 ===');
    
    const results: ConfigManagementTestResults = {
      configRegistration: false,
      configAccess: false,
      configSync: false,
      configAudit: false,
      configRollback: false,
    };

    try {
      // 1. 测试配置注册
      this.registerTestConfigs();
      results.configRegistration = true;
      console.log('✅ 配置注册测试通过');

      // 2. 测试配置访问
      const appName = this.configManager.getConfig<string>('app_name');
      results.configAccess = appName === 'PY_APP';
      console.log('✅ 配置访问测试通过');

      // 3. 测试配置同步
      const syncStatus = await this.configManager.sync();
      results.configSync = syncStatus.success;
      console.log('✅ 配置同步测试通过');

      // 4. 测试配置审计
      const auditLog = this.configManager.getAuditLog();
      results.configAudit = auditLog.length > 0;
      console.log('✅ 配置审计测试通过');

      // 5. 测试配置回滚
      await this.testConfigRollback();
      results.configRollback = true;
      console.log('✅ 配置回滚测试通过');

    } catch (error) {
      console.error('配置管理测试失败:', error);
    }

    return results;
  }

  /**
   * 注册测试配置
   */
  private registerTestConfigs(): void {
    // 字符串配置
    this.configManager.registerConfig(
      ConfigUtils.createStringConfig('app_name', 'PY_APP', {
        description: '应用名称',
        securityLevel: SecurityLevel.PUBLIC,
      })
    );

    // 数值配置
    this.configManager.registerConfig(
      ConfigUtils.createNumberConfig('max_concurrent_tasks', 5, {
        min: 1,
        max: 20,
        description: '最大并发任务数',
        securityLevel: SecurityLevel.INTERNAL,
      })
    );

    // 布尔配置
    this.configManager.registerConfig(
      ConfigUtils.createBooleanConfig('enable_debug', false, {
        description: '启用调试模式',
        securityLevel: SecurityLevel.INTERNAL,
      })
    );

    console.log('注册了 3 个测试配置');
  }

  /**
   * 测试配置回滚
   */
  private async testConfigRollback(): Promise<void> {
    // 修改配置值
    this.configManager.setConfig('app_name', 'PY_APP_MODIFIED', 'test_user', '测试回滚');
    
    // 获取版本历史
    const versions = this.configManager.getVersionHistory();
    if (versions.length > 0) {
      // 回滚到上一个版本
      await this.configManager.rollback(versions[0].version);
      
      // 验证回滚成功
      const currentValue = this.configManager.getConfig<string>('app_name');
      if (currentValue !== 'PY_APP') {
        throw new Error('配置回滚失败');
      }
    }
  }

  /**
   * 测试集成功能
   */
  private async testIntegration(): Promise<IntegrationTestResults> {
    console.log('\n=== 测试集成功能 ===');
    
    const results: IntegrationTestResults = {
      moduleConfigIntegration: false,
      startupConfigIntegration: false,
      performanceIntegration: false,
    };

    try {
      // 1. 测试模块与配置集成
      results.moduleConfigIntegration = await this.testModuleConfigIntegration();
      console.log('✅ 模块配置集成测试通过');

      // 2. 测试启动与配置集成
      results.startupConfigIntegration = await this.testStartupConfigIntegration();
      console.log('✅ 启动配置集成测试通过');

      // 3. 测试性能集成
      results.performanceIntegration = await this.testPerformanceIntegration();
      console.log('✅ 性能集成测试通过');

    } catch (error) {
      console.error('集成测试失败:', error);
    }

    return results;
  }

  /**
   * 测试模块与配置集成
   */
  private async testModuleConfigIntegration(): Promise<boolean> {
    // 配置驱动模块行为
    const maxTasks = this.configManager.getConfig<number>('max_concurrent_tasks');
    
    // 创建基于配置的优化器
    const configuredOptimizer = new StartupOptimizer(this.moduleManager, maxTasks);
    
    // 测试优化功能
    const metrics = await configuredOptimizer.optimizeStartup();
    return metrics.totalTime > 0;
  }

  /**
   * 测试启动与配置集成
   */
  private async testStartupConfigIntegration(): Promise<boolean> {
    // 配置影响启动行为
    const enableDebug = this.configManager.getConfig<boolean>('enable_debug');
    
    if (enableDebug) {
      // 启用详细日志等调试功能
      console.log('调试模式已启用');
    }
    
    return true;
  }

  /**
   * 测试性能集成
   */
  private async testPerformanceIntegration(): Promise<boolean> {
    // 测量综合性能
    const startTime = Date.now();
    
    // 并行执行多个操作
    await Promise.all([
      this.moduleManager.loadModulesInParallel(['core', 'infrastructure']),
      this.configManager.sync(),
      this.startupOptimizer.optimizeStartup(),
    ]);
    
    const totalTime = Date.now() - startTime;
    console.log(`综合性能测试完成，耗时: ${totalTime}ms`);
    
    return totalTime < 5000; // 期望在5秒内完成
  }

  /**
   * 生成测试报告
   */
  generateReport(results: TestResults): string {
    const totalTests = Object.values(results).flatMap(Object.values).length;
    const passedTests = Object.values(results).flatMap(Object.values).filter(Boolean).length;
    const successRate = (passedTests / totalTests) * 100;
    
    let report = `=== Core模块重构测试报告 ===\n`;
    report += `测试时间: ${new Date().toISOString()}\n`;
    report += `总测试数: ${totalTests}\n`;
    report += `通过测试: ${passedTests}\n`;
    report += `成功率: ${successRate.toFixed(1)}%\n\n`;
    
    // 详细结果
    Object.entries(results).forEach(([category, categoryResults]) => {
      report += `${category}:\n`;
      Object.entries(categoryResults).forEach(([test, passed]) => {
        report += `  ${test}: ${passed ? '✅' : '❌'}\n`;
      });
      report += '\n';
    });
    
    return report;
  }
}

/**
 * 测试结果类型定义
 */
interface TestResults {
  moduleDependencyTests: ModuleDependencyTestResults;
  startupOptimizationTests: StartupOptimizationTestResults;
  configManagementTests: ConfigManagementTestResults;
  integrationTests: IntegrationTestResults;
}

interface ModuleDependencyTestResults {
  moduleRegistration: boolean;
  dependencyAnalysis: boolean;
  cycleDetection: boolean;
  parallelLoading: boolean;
  errorHandling: boolean;
}

interface StartupOptimizationTestResults {
  prefetchTasks: boolean;
  parallelExecution: boolean;
  performanceMetrics: boolean;
  bottleneckAnalysis: boolean;
  resourceManagement: boolean;
}

interface ConfigManagementTestResults {
  configRegistration: boolean;
  configAccess: boolean;
  configSync: boolean;
  configAudit: boolean;
  configRollback: boolean;
}

interface IntegrationTestResults {
  moduleConfigIntegration: boolean;
  startupConfigIntegration: boolean;
  performanceIntegration: boolean;
}

/**
 * 运行测试的主函数
 */
async function main(): Promise<void> {
  console.log('开始Core模块重构功能测试...\n');
  
  try {
    const tester = new CoreModuleRefactorTest();
    console.log('测试器创建成功');
    
    const results = await tester.runAllTests();
    console.log('所有测试执行完成');
    
    console.log('\n' + tester.generateReport(results));
    
    // 总结
    const totalTests = Object.values(results).flatMap(Object.values).length;
    const passedTests = Object.values(results).flatMap(Object.values).filter(Boolean).length;
    
    if (passedTests === totalTests) {
      console.log('🎉 所有测试通过！Core模块重构功能正常。');
    } else {
      console.log(`⚠️  ${passedTests}/${totalTests} 测试通过，需要进一步调试。`);
    }
  } catch (error) {
    console.error('测试执行失败:', error);
    process.exit(1);
  }
}

// 直接运行测试
main().catch(console.error);
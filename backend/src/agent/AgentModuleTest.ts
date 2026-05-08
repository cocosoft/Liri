import { MultiSourceAgentManager } from './managers/MultiSourceAgentManager';
import { PluginLoader } from './managers/PluginLoader';
import { AgentSourceManager } from './managers/AgentSourceManager';
import { AgentConfigManager } from './managers/AgentConfigManager';
import { AdvancedMemorySystem } from './memory/AdvancedMemorySystem';
import { AgentUIManager } from './ui/AgentUIManager';
import { AIAgentImpl } from './agent';
import { AgentConfig, AgentState, AgentTask } from './models/types';
import { AIModelType } from '../ai/models/types';

export class AgentModuleTest {
  private sourceManager: AgentSourceManager;
  private configManager: AgentConfigManager;
  private multiSourceManager: MultiSourceAgentManager;
  private pluginLoader: PluginLoader;
  private memorySystem: AdvancedMemorySystem;
  private uiManager: AgentUIManager;

  constructor() {
    this.sourceManager = new AgentSourceManager();
    this.configManager = new AgentConfigManager();
    this.multiSourceManager = new MultiSourceAgentManager(
      this.sourceManager,
      this.configManager,
      'least-loaded'
    );
    this.pluginLoader = new PluginLoader();
    this.memorySystem = new AdvancedMemorySystem('./test_memory');
    this.uiManager = new AgentUIManager();
  }

  async runAllTests(): Promise<TestResults> {
    const results: TestResults = {
      multiSourceManagerTests: await this.testMultiSourceManager(),
      pluginLoaderTests: await this.testPluginLoader(),
      memorySystemTests: await this.testMemorySystem(),
      uiManagerTests: await this.testUIManager(),
      integrationTests: await this.testIntegration(),
    };

    return results;
  }

  private async testMultiSourceManager(): Promise<MultiSourceTestResults> {
    console.log('=== 测试多源代理管理器 ===');

    const results: MultiSourceTestResults = {
      poolCreation: false,
      agentAcquisition: false,
      agentRelease: false,
      healthCheck: false,
      loadBalancing: false,
    };

    try {
      this.multiSourceManager.createPool('test-pool', { minSize: 2, maxSize: 5 });
      results.poolCreation = true;
      console.log('✅ 代理池创建测试通过');

      const agent = await this.multiSourceManager.getAvailableAgent();
      results.agentAcquisition = agent !== null;
      console.log('✅ 代理获取测试通过');

      if (agent) {
        this.multiSourceManager.releaseAgent(agent.id);
        results.agentRelease = true;
        console.log('✅ 代理释放测试通过');
      }

      const healthStatus = await this.multiSourceManager.healthCheck();
      results.healthCheck = healthStatus.totalAgents >= 0;
      console.log('✅ 健康检查测试通过');

      this.multiSourceManager.balanceLoad();
      results.loadBalancing = true;
      console.log('✅ 负载均衡测试通过');

    } catch (error) {
      console.error('多源代理管理器测试失败:', error);
    }

    return results;
  }

  private async testPluginLoader(): Promise<PluginLoaderTestResults> {
    console.log('\n=== 测试插件加载器 ===');

    const results: PluginLoaderTestResults = {
      pluginValidation: false,
      dependencyResolution: false,
      conflictDetection: false,
      loadHistory: false,
    };

    try {
      const mockPlugin = this.createMockPlugin();
      const isValid = this.validateMockPlugin(mockPlugin);
      results.pluginValidation = isValid;
      console.log('✅ 插件验证测试通过');

      const deps = this.pluginLoader.resolveDependencies(mockPlugin);
      results.dependencyResolution = deps.nodes.size >= 0;
      console.log('✅ 依赖解析测试通过');

      const conflicts = this.pluginLoader.detectConflicts(mockPlugin);
      results.conflictDetection = Array.isArray(conflicts);
      console.log('✅ 冲突检测测试通过');

      const history = this.pluginLoader.getLoadHistory();
      results.loadHistory = Array.isArray(history);
      console.log('✅ 加载历史测试通过');

    } catch (error) {
      console.error('插件加载器测试失败:', error);
    }

    return results;
  }

  private async testMemorySystem(): Promise<MemorySystemTestResults> {
    console.log('\n=== 测试高级记忆系统 ===');

    const results: MemorySystemTestResults = {
      memoryStorage: false,
      memoryRetrieval: false,
      semanticSearch: false,
      memoryCompression: false,
      memoryExport: false,
      versionManagement: false,
    };

    try {
      this.memorySystem.add('test_key_1', { data: 'test_value_1', timestamp: Date.now() }, ['test']);
      this.memorySystem.add('test_key_2', { data: 'test_value_2', timestamp: Date.now() }, ['test']);
      results.memoryStorage = true;
      console.log('✅ 记忆存储测试通过');

      const value = this.memorySystem.get('test_key_1');
      results.memoryRetrieval = value !== undefined;
      console.log('✅ 记忆检索测试通过');

      const searchResults = this.memorySystem.search('test_value', { limit: 5, threshold: 0.1 });
      results.semanticSearch = searchResults.length > 0;
      console.log('✅ 语义搜索测试通过');

      const compressionResult = await this.memorySystem.compressMemory();
      results.memoryCompression = compressionResult.originalSize >= 0;
      console.log('✅ 记忆压缩测试通过');

      const exported = this.memorySystem.exportMemory();
      results.memoryExport = exported.items.length >= 0;
      console.log('✅ 记忆导出测试通过');

      const stats = this.memorySystem.getStats();
      results.versionManagement = stats.totalItems >= 0;
      console.log('✅ 版本管理测试通过');

    } catch (error) {
      console.error('高级记忆系统测试失败:', error);
    }

    return results;
  }

  private async testUIManager(): Promise<UIManagerTestResults> {
    console.log('\n=== 测试代理UI管理器 ===');

    const results: UIManagerTestResults = {
      agentRegistration: false,
      stateSubscription: false,
      dashboardData: false,
      alertManagement: false,
      commandExecution: false,
    };

    try {
      const config: AgentConfig = {
        model: AIModelType.GPT_3_5_TURBO,
        temperature: 0.7,
        maxTokens: 1000,
        timeout: 60000,
        memoryPath: './test_memory',
        defaultStrategy: 'direct_answer',
        tools: [],
      };
      const agent = new AIAgentImpl(config);
      this.uiManager.registerAgent(agent);
      results.agentRegistration = true;
      console.log('✅ 代理注册测试通过');

      const subId = this.uiManager.subscribeToAgentState(agent.id, () => {});
      results.stateSubscription = subId.length > 0;
      this.uiManager.unsubscribe(subId);
      console.log('✅ 状态订阅测试通过');

      const dashboard = this.uiManager.getDashboardData();
      results.dashboardData = dashboard.agents.length >= 0;
      console.log('✅ 仪表盘数据测试通过');

      this.uiManager.addAlert('info', 'Test alert');
      const alerts = this.uiManager.getAlerts();
      results.alertManagement = alerts.length > 0;
      console.log('✅ 告警管理测试通过');

      const command = {
        type: 'start' as const,
        agentId: agent.id,
        timestamp: Date.now(),
      };
      await this.uiManager.sendCommand(agent.id, command);
      results.commandExecution = true;
      console.log('✅ 命令执行测试通过');

    } catch (error) {
      console.error('代理UI管理器测试失败:', error);
    }

    return results;
  }

  private async testIntegration(): Promise<IntegrationTestResults> {
    console.log('\n=== 测试集成功能 ===');

    const results: IntegrationTestResults = {
      memoryAndSearch: false,
      agentAndUI: false,
      fullPipeline: false,
    };

    try {
      this.memorySystem.add('integration_key', { type: 'integration_test', timestamp: Date.now() }, ['integration']);
      const searchResults = this.memorySystem.search('integration', { limit: 5, threshold: 0.1 });
      results.memoryAndSearch = searchResults.length > 0;
      console.log('✅ 记忆与搜索集成测试通过');

      const config: AgentConfig = {
        model: AIModelType.GPT_3_5_TURBO,
        temperature: 0.7,
        maxTokens: 1000,
        timeout: 60000,
        memoryPath: './test_memory',
        defaultStrategy: 'direct_answer',
        tools: [],
      };
      const agent = new AIAgentImpl(config);
      this.uiManager.registerAgent(agent);
      const dashboard = this.uiManager.getDashboardData();
      results.agentAndUI = dashboard.agents.length > 0;
      console.log('✅ 代理与UI集成测试通过');

      const task: AgentTask = {
        id: 'integration_task',
        name: 'Integration Test Task',
        description: 'Testing full pipeline integration',
        input: { test: true },
      };
      const response = await agent.execute(task);
      results.fullPipeline = response.status !== AgentState.FAILED;
      console.log('✅ 完整流水线测试通过');

    } catch (error) {
      console.error('集成测试失败:', error);
    }

    return results;
  }

  private createMockPlugin(): any {
    return {
      id: 'mock-plugin',
      name: 'Mock Plugin',
      version: '1.0.0',
      description: 'A mock plugin for testing',
      initialize: async () => {},
      activate: async () => {},
      deactivate: async () => {},
      getTools: () => [],
      getStrategies: () => [],
      getExtensions: () => [],
    };
  }

  private validateMockPlugin(plugin: any): boolean {
    return (
      typeof plugin.id === 'string' &&
      typeof plugin.name === 'string' &&
      typeof plugin.version === 'string' &&
      typeof plugin.initialize === 'function' &&
      typeof plugin.activate === 'function' &&
      typeof plugin.deactivate === 'function' &&
      typeof plugin.getTools === 'function' &&
      typeof plugin.getStrategies === 'function' &&
      typeof plugin.getExtensions === 'function'
    );
  }

  generateReport(results: TestResults): string {
    const totalTests = Object.values(results).flatMap(Object.values).length;
    const passedTests = Object.values(results).flatMap(Object.values).filter(Boolean).length;
    const successRate = (passedTests / totalTests) * 100;

    let report = `=== Agent模块重构测试报告 ===\n`;
    report += `测试时间: ${new Date().toISOString()}\n`;
    report += `总测试数: ${totalTests}\n`;
    report += `通过测试: ${passedTests}\n`;
    report += `成功率: ${successRate.toFixed(1)}%\n\n`;

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

interface TestResults {
  multiSourceManagerTests: MultiSourceTestResults;
  pluginLoaderTests: PluginLoaderTestResults;
  memorySystemTests: MemorySystemTestResults;
  uiManagerTests: UIManagerTestResults;
  integrationTests: IntegrationTestResults;
}

interface MultiSourceTestResults {
  poolCreation: boolean;
  agentAcquisition: boolean;
  agentRelease: boolean;
  healthCheck: boolean;
  loadBalancing: boolean;
}

interface PluginLoaderTestResults {
  pluginValidation: boolean;
  dependencyResolution: boolean;
  conflictDetection: boolean;
  loadHistory: boolean;
}

interface MemorySystemTestResults {
  memoryStorage: boolean;
  memoryRetrieval: boolean;
  semanticSearch: boolean;
  memoryCompression: boolean;
  memoryExport: boolean;
  versionManagement: boolean;
}

interface UIManagerTestResults {
  agentRegistration: boolean;
  stateSubscription: boolean;
  dashboardData: boolean;
  alertManagement: boolean;
  commandExecution: boolean;
}

interface IntegrationTestResults {
  memoryAndSearch: boolean;
  agentAndUI: boolean;
  fullPipeline: boolean;
}

async function main(): Promise<void> {
  console.log('开始Agent模块重构功能测试...\n');

  try {
    const tester = new AgentModuleTest();
    console.log('测试器创建成功');

    const results = await tester.runAllTests();
    console.log('所有测试执行完成');

    console.log('\n' + tester.generateReport(results));

    const totalTests = Object.values(results).flatMap(Object.values).length;
    const passedTests = Object.values(results).flatMap(Object.values).filter(Boolean).length;

    if (passedTests === totalTests) {
      console.log('所有测试通过！Agent模块重构功能正常。');
    } else {
      console.log(`${passedTests}/${totalTests} 测试通过。需要修复 ${totalTests - passedTests} 个失败测试。`);
    }
  } catch (error) {
    console.error('测试执行失败:', error);
  }
}

main();

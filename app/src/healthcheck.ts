/**
 * 健康检查脚本
 * 用于检查应用的健康状态
 */

import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { getMonitoringService } from './monitoring/index.js';
import { getExtensibilityService } from './core/extensibility/index.js';
import { pluginSystem } from './plugins/index.js';

const logger = new Logger({ level: LogLevel.INFO });

async function healthCheck() {
  console.log('=== Liri 健康检查 ===');

  try {
    // 检查监控服务
    const monitoringService = getMonitoringService();
    const status = monitoringService.getSystemStatus();

    console.log('1. 系统状态:');
    console.log(`   - 运行时间: ${(status.uptime / 60).toFixed(2)} 分钟`);
    console.log(
      `   - 内存使用: ${(status.memory.heapUsed / 1024 / 1024).toFixed(2)} MB`
    );
    console.log(
      `   - CPU 使用: ${((status.cpu.user + status.cpu.system) / 1000).toFixed(2)}%`
    );
    console.log(`   - 环境: ${status.process.env}`);

    // 检查可扩展性服务
    const extensibilityService = getExtensibilityService();
    const moduleManager = extensibilityService.getModuleManager();

    console.log('\n2. 模块状态:');
    const modules = ['skills', 'remote', 'security', 'performance'];
    for (const moduleName of modules) {
      try {
        const module = await moduleManager.getModule(moduleName);
        console.log(`   - ${moduleName}: ${module?.state || '未加载'}`);
      } catch (error) {
        console.log(
          `   - ${moduleName}: 错误 - ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    // 检查插件系统（通过 plugins/ PluginSystem 统一查询，消除双轨运行）
    const plugins = pluginSystem.getAllPlugins();
    console.log(`\n3. 插件状态:`);
    console.log(`   - 加载的插件数: ${plugins.length}`);
    plugins.forEach((plugin) => {
      console.log(`   - ${plugin.name}: ${plugin.state}`);
    });

    // 检查配置系统
    const configManager = extensibilityService.getConfigManager();
    const configs = configManager.listConfigs();
    console.log(`\n4. 配置状态:`);
    console.log(`   - 注册的配置数: ${configs.length}`);

    // 检查事件总线
    const eventBus = extensibilityService.getEventBus();
    console.log(`\n5. 事件总线状态:`);
    console.log(`   - 事件总线已初始化`);

    // 检查告警
    const alerts = monitoringService.getAlerts();
    console.log(`\n6. 告警状态:`);
    if (alerts.length > 0) {
      console.log(`   - 有 ${alerts.length} 个告警`);
      alerts.slice(-5).forEach((alert) => {
        console.log(`     - ${alert}`);
      });
    } else {
      console.log(`   - 无告警`);
    }

    console.log('\n=== 健康检查完成 ===');
    console.log('应用状态: 正常');
    process.exit(0);
  } catch (error) {
    logger.error(
      '健康检查失败:',
      error instanceof Error ? error.message : String(error)
    );
    console.log('应用状态: 异常');
    process.exit(1);
  }
}

healthCheck();

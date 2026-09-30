/**
 * 健康检查脚本
 * 用于检查应用的健康状态
 */

import { getLogger } from '@modules/monitoring';
import { getMonitoringService } from './monitoring/index.js';
import { pluginSystem } from './plugins/index.js';

const logger = getLogger('healthcheck');

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

    // 2026-09-30（台账 D-83）：原「模块状态」段依赖已删除的 `ExtensibilityService`
    // （其 `init()` 自 2026-08-06 起无调用方 ⇒ 模块从未注册、该段输出恒为"未加载"，属误导）
    // ⇒ 整段移除；插件相关信息统一走下方 PluginSystem。

    // 检查插件系统（通过 plugins/ PluginSystem 统一查询，消除双轨运行）
    const plugins = pluginSystem.getAllPlugins();
    console.log(`\n2. 插件状态:`);
    console.log(`   - 加载的插件数: ${plugins.length}`);
    plugins.forEach((plugin) => {
      console.log(`   - ${plugin.name}: ${plugin.state}`);
    });

    // 2026-09-30（台账 D-83）：原「配置状态」「事件总线状态」两段同属已删除的 `ExtensibilityService`
    // ⇒ 一并移除（其中"事件总线已初始化"为无信息量的硬编码输出）。

    // 检查告警
    const alerts = monitoringService.getAlerts();
    console.log(`\n3. 告警状态:`);
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

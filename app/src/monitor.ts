/**
 * 监控脚本
 * 用于显示监控数据和性能报告
 */

import { handleError } from '@modules/error';
import { getMonitoringService } from './monitoring/index.js';
import { getProcessCpuPercent } from '@modules/monitoring';

function monitor() {
  console.log('=== Liri 监控面板 ===');

  try {
    const monitoringService = getMonitoringService();

    // 显示系统状态
    console.log('1. 系统状态:');
    const status = monitoringService.getSystemStatus();
    console.log(`   - 运行时间: ${(status.uptime / 60).toFixed(2)} 分钟`);
    console.log(
      `   - 内存使用: ${(status.memory.heapUsed / 1024 / 1024).toFixed(2)} MB / ${(status.memory.heapTotal / 1024 / 1024).toFixed(2)} MB`
    );
    console.log(`   - CPU 使用: ${getProcessCpuPercent().toFixed(2)}%`);
    console.log(`   - 环境: ${status.process.env}`);

    // 显示性能报告
    console.log('\n2. 性能报告:');
    const performanceReport = monitoringService.getPerformanceReport();
    console.log(performanceReport);

    // 显示指标数据
    console.log('\n3. 指标数据:');
    const metrics = monitoringService.getMetrics();
    for (const [name, values] of Object.entries(metrics)) {
      if (values.length > 0) {
        const avg = values.reduce((a, b) => a + b, 0) / values.length;
        const max = Math.max(...values);
        const min = Math.min(...values);
        console.log(
          `   - ${name}: avg=${avg.toFixed(2)}, max=${max.toFixed(2)}, min=${min.toFixed(2)}`
        );
      }
    }

    // 显示告警
    console.log('\n4. 告警:');
    const alerts = monitoringService.getAlerts();
    if (alerts.length > 0) {
      console.log(`   - 有 ${alerts.length} 个告警`);
      alerts.forEach((alert) => {
        console.log(`     - ${alert}`);
      });
    } else {
      console.log(`   - 无告警`);
    }

    console.log('\n=== 监控面板结束 ===');
  } catch (error) {
    void handleError(error, { module: 'monitor', action: 'display_dashboard' });
  }
}

monitor();

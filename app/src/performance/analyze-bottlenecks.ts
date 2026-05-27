/**
 * 系统瓶颈分析脚本
 * 用于分析应用的性能瓶颈
 */

import {
  performanceAnalyzer,
  generateDetailedPerformanceReport,
  getPerformanceSuggestions,
} from './PerformanceAnalyzer.js';
import { getSlowOperationStats } from './SlowOperations.js';
import { getPhaseTimes } from './StartupProfiler.js';

/**
 * 分析系统瓶颈
 */
async function analyzeBottlenecks() {
  console.log('开始分析系统瓶颈...');

  // 启动性能分析器
  performanceAnalyzer.start();

  // 模拟一些操作，以便收集性能数据
  await simulateOperations();

  // 生成详细性能报告
  const report = generateDetailedPerformanceReport();
  console.log(report);

  // 获取性能建议
  const suggestions = getPerformanceSuggestions();
  console.log('\n=== 性能优化建议 ===');
  suggestions.forEach((suggestion, index) => {
    console.log(`${index + 1}. ${suggestion}`);
  });

  // 分析启动时间
  console.log('\n=== 启动时间分析 ===');
  const phaseTimes = getPhaseTimes();
  for (const [phase, time] of Object.entries(phaseTimes)) {
    console.log(`${phase}: ${time.toFixed(2)}ms`);
  }

  // 分析慢操作
  console.log('\n=== 慢操作分析 ===');
  const slowOperations = getSlowOperationStats();
  console.log(`慢操作总数: ${slowOperations.total}`);
  if (Object.keys(slowOperations.byType).length > 0) {
    console.log('按类型分布:');
    for (const [type, count] of Object.entries(slowOperations.byType)) {
      console.log(`  ${type}: ${count}`);
    }
  }
  if (Object.keys(slowOperations.byDuration).length > 0) {
    console.log('按持续时间分布:');
    for (const [duration, count] of Object.entries(slowOperations.byDuration)) {
      console.log(`  ${duration}ms: ${count}`);
    }
  }

  // 停止性能分析器
  performanceAnalyzer.stop();

  console.log('\n系统瓶颈分析完成！');
}

/**
 * 模拟一些操作，以便收集性能数据
 */
async function simulateOperations() {
  console.log('模拟操作中...');

  // 模拟CPU密集型操作
  await simulateCpuIntensiveOperation();

  // 模拟内存密集型操作
  await simulateMemoryIntensiveOperation();

  // 模拟I/O操作
  await simulateIOOperation();

  // 模拟网络请求
  await simulateNetworkRequest();
}

/**
 * 模拟CPU密集型操作
 */
async function simulateCpuIntensiveOperation() {
  const end = performanceAnalyzer.recordEvent('CPU密集型操作', 'cpu');

  // 执行一些CPU密集型计算
  let result = 0;
  for (let i = 0; i < 100000000; i++) {
    result += Math.sqrt(i);
  }

  end();
}

/**
 * 模拟内存密集型操作
 */
async function simulateMemoryIntensiveOperation() {
  const end = performanceAnalyzer.recordEvent('内存密集型操作', 'memory');

  // 分配一些内存
  const array = [];
  for (let i = 0; i < 1000000; i++) {
    array.push({ id: i, value: Math.random() });
  }

  // 释放内存
  array.length = 0;

  end();
}

/**
 * 模拟I/O操作
 */
async function simulateIOOperation() {
  const end = performanceAnalyzer.recordEvent('I/O操作', 'io');

  // 模拟文件读写操作
  const fs = require('fs');
  const path = require('path');

  // 创建临时文件
  const tempFile = path.join(__dirname, 'temp.txt');
  fs.writeFileSync(tempFile, '测试内容');

  // 读取临时文件
  const content = fs.readFileSync(tempFile, 'utf8');

  // 删除临时文件
  fs.unlinkSync(tempFile);

  end();
}

/**
 * 模拟网络请求
 */
async function simulateNetworkRequest() {
  const end = performanceAnalyzer.recordEvent('网络请求', 'network');

  // 模拟网络延迟
  await new Promise((resolve) => setTimeout(resolve, 100));

  end();
}

// 运行分析
if (require.main === module) {
  analyzeBottlenecks().catch(console.error);
}

/**
 * 导出分析函数
 */
export { analyzeBottlenecks };

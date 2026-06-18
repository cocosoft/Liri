/**
 * 性能基线采集脚本（Phase 1 Step 0）
 *
 * 在 DI 统一重构前采集启动性能基线，用于后续对比。
 * 基线数据写入 dev_docs/performance-baseline.json
 *
 * 用法: bun run scripts/collect-baseline.ts
 */

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

interface BaselineData {
  /** 采集时间 */
  collectedAt: string;
  /** 采集环境 */
  environment: {
    nodeVersion: string;
    platform: string;
    arch: string;
    cpuCores: number;
    totalMemoryMB: number;
  };
  /** 启动性能基线 */
  startup: {
    /** 总启动耗时 (ms) */
    totalDuration: number;
    /** DI 初始化耗时 (ms) */
    diInitDuration: number;
    /** 模块注册耗时 (ms) */
    moduleRegistrationDuration: number;
  };
  /** 内存基线 */
  memory: {
    /** 启动后 RSS 内存 (MB) */
    rssMB: number;
    /** 堆内存 (MB) */
    heapUsedMB: number;
  };
  /** 源代码基线 */
  source: {
    /** 总源文件数 */
    totalFiles: number;
    /** 总代码行数 (近似) */
    totalLines: number;
  };
}

function formatMB(bytes: number): number {
  return Math.round(bytes / 1024 / 1024 * 100) / 100;
}

async function main(): Promise<void> {
  console.log('=== 性能基线采集 ===');
  console.log('DI 统一重构前基线数据\n');

  // ── 环境信息 ──
  const env: BaselineData['environment'] = {
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    cpuCores: require('node:os').cpus().length,
    totalMemoryMB: formatMB(require('node:os').totalmem()),
  };
  console.log(`Node: ${env.nodeVersion} | ${env.platform} ${env.arch} | ${env.cpuCores} cores | ${env.totalMemoryMB}MB RAM`);

  // ── 启动耗时测量 ──
  console.log('\n--- 启动耗时测量 ---');

  const startTime = performance.now();

  // 模拟启动的关键阶段
  // 阶段 1: 配置加载
  const configLoadStart = performance.now();

  // 尝试加载配置模块（如果存在）
  let configModule: any = null;
  try {
    configModule = await import('../app/src/config/index.ts');
  } catch {
    try {
      configModule = await import('../app/src/config/ConfigManager.ts');
    } catch {
      console.log('  [warn] 配置模块加载失败，跳过');
    }
  }
  const configLoadTime = performance.now() - configLoadStart;

  // 阶段 2: DI 容器加载
  const diLoadStart = performance.now();
  let diContainer: any = null;
  try {
    diContainer = await import('../app/src/core/DIContainer.ts');
  } catch (e) {
    console.log('  [warn] DIContainer 加载失败:', String(e));
  }
  const diLoadTime = performance.now() - diLoadStart;

  // 阶段 3: 模块注册加载
  const moduleRegStart = performance.now();
  let moduleRegistry: any = null;
  try {
    moduleRegistry = await import('../app/src/modules/ModuleRegistry.ts');
  } catch {
    // ModuleRegistry 可能不存在或已合并
  }
  // 加载 AppCore
  try {
    await import('../app/src/core/AppCore.ts');
  } catch {
    // AppCore 可能不存在
  }
  const moduleRegTime = performance.now() - moduleRegStart;

  const totalTime = performance.now() - startTime;

  // ── 内存测量 ──
  // 等待 GC 稳定
  await new Promise(resolve => setTimeout(resolve, 500));

  const mem = process.memoryUsage();

  // ── 源文件统计 ──
  console.log('\n--- 源文件统计 ---');
  let totalFiles = 0;
  let totalLines = 0;

  const srcDir = resolve(import.meta.dirname, '..', 'app', 'src');
  try {
    // 使用简单的目录遍历
    const { execSync } = require('node:child_process');
    const fileCountOutput = execSync(
      `dir /s /b "${srcDir}\\*.ts" 2>nul | find /c /v ""`,
      { shell: true, encoding: 'utf-8' }
    ).trim();
    totalFiles = parseInt(fileCountOutput, 10) || 0;

    // 统计代码行数（近似）
    const lineCountOutput = execSync(
      `type "${srcDir}\\*.ts" 2>nul | find /c /v ""`,
      { shell: true, encoding: 'utf-8' }
    ).trim();
    totalLines = parseInt(lineCountOutput, 10) || 0;

    console.log(`  TypeScript 源文件数: ${totalFiles}`);
    console.log(`  总代码行数 (近似): ${totalLines}`);
  } catch (e) {
    console.log('  [warn] 文件统计失败:', String(e));
    totalFiles = 0;
    totalLines = 0;
  }

  // ── 组装基线数据 ──
  const baseline: BaselineData = {
    collectedAt: new Date().toISOString(),
    environment: env,
    startup: {
      totalDuration: Math.round(totalTime * 100) / 100,
      diInitDuration: Math.round(diLoadTime * 100) / 100,
      moduleRegistrationDuration: Math.round(moduleRegTime * 100) / 100,
    },
    memory: {
      rssMB: formatMB(mem.rss),
      heapUsedMB: formatMB(mem.heapUsed),
    },
    source: {
      totalFiles,
      totalLines,
    },
  };

  // ── 输出结果 ──
  console.log('\n=== 基线数据 ===');
  console.log(JSON.stringify(baseline, null, 2));

  // ── 保存到文件 ──
  const docsDir = resolve(import.meta.dirname, '..', 'dev_docs');
  if (!existsSync(docsDir)) {
    mkdirSync(docsDir, { recursive: true });
  }

  const outputPath = join(docsDir, 'performance-baseline.json');
  writeFileSync(outputPath, JSON.stringify(baseline, null, 2), 'utf-8');
  console.log(`\n基线数据已保存到: ${outputPath}`);
}

main().catch(err => {
  console.error('基线采集失败:', err);
  process.exit(1);
});

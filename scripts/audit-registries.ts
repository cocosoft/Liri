/**
 * Phase 1 Step 1: 审计现有注册 — 三表对比
 *
 * 列出 DIContainer / AppCore.lazyModuleLoader / ModuleRegistry 中
 * 各注册了哪些模块/服务，输出对比清单。
 *
 * 用法: bun run scripts/audit-registries.ts
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';

interface AuditEntry {
  source: 'DIContainer' | 'AppCore' | 'ModuleRegistry';
  name: string;
  type: 'service' | 'module';
  details: string;
}

const RESULTS: AuditEntry[] = [];

// ──────────────────────────────────────────────
// 1. 读取 DIContainer 注册的服务
// ──────────────────────────────────────────────
async function auditDIContainer(): Promise<void> {
  console.log('\n=== DIContainer 审计 ===');

  const appSrc = resolve(import.meta.dirname, '..', 'app', 'src');

  // 搜索所有对 DIContainer.register/registerInstance/registerDescriptor 的调用
  const { execSync } = await import('node:child_process');

  // PowerShell-based search for service registration patterns
  try {
    const output = execSync(
      `Select-String -Path "${appSrc}\\**\\*.ts" -Pattern "(container|getDIContainer)\\(\\)\\.(register|registerInstance|registerDescriptor)\\(" -List -CaseSensitive 2>nul`,
      { shell: 'powershell', encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
    );
    console.log('DIContainer 注册调用文件:');
    console.log(output || '(无)');
  } catch {
    console.log('  (搜索方式失败，改用 grep)');
  }

  // 作为后备，检查关键文件中是否有 DIContainer 注册
  const keyFiles = [
    'modules/ModuleRegistry.ts',
    'modules/ModuleInitializer.ts',
    'entrypoints/init.ts',
    'bootstrap.ts',
    'main.ts',
  ];

  for (const relPath of keyFiles) {
    const fullPath = join(appSrc, relPath);
    if (!existsSync(fullPath)) continue;
    const content = readFileSync(fullPath, 'utf-8');
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('.register(') || lines[i].includes('.registerInstance(')) {
        RESULTS.push({
          source: 'DIContainer',
          name: `(in ${relPath}:${i + 1})`,
          type: 'service',
          details: lines[i].trim(),
        });
      }
    }
  }

  console.log(`  发现 ${RESULTS.filter(r => r.source === 'DIContainer').length} 条 DIContainer 注册线索`);
}

// ──────────────────────────────────────────────
// 2. AppCore 模块审计
// ──────────────────────────────────────────────
async function auditAppCore(): Promise<void> {
  console.log('\n=== AppCore 审计 ===');

  const appSrc = resolve(import.meta.dirname, '..', 'app', 'src');
  const appCorePath = join(appSrc, 'core', 'AppCore.ts');
  const mdMgrPath = join(appSrc, 'core', 'ModuleDependencyManager.ts');

  // 从 AppCore.initializeCoreModules() 读取硬编码模块
  const appCoreContent = readFileSync(appCorePath, 'utf-8');
  const coreModulesMatch = appCoreContent.match(/const coreModules: ModuleDefinition\[\] = \[([\s\S]*?)\];/);
  if (coreModulesMatch) {
    const moduleBlock = coreModulesMatch[1];
    const moduleNames = moduleBlock.match(/name:\s*'([^']+)'/g);
    if (moduleNames) {
      for (const m of moduleNames) {
        const name = m.match(/'([^']+)'/)?.[1];
        if (name) {
          RESULTS.push({
            source: 'AppCore',
            name,
            type: 'module',
            details: `AppCore.initializeCoreModules()`,
          });
        }
      }
    }
  }

  // 从 AppCore.lazyModuleLoader 读取
  const lazyLoaders = appCoreContent.match(/this\.lazy\w+\s*=\s*new\s+LazyModuleLoader/g);
  if (lazyLoaders) {
    console.log(`  LazyModuleLoader 数量: ${lazyLoaders.length}`);
  }

  // ModuleDependencyManager 中的所有注册
  const mdContent = readFileSync(mdMgrPath, 'utf-8');
  const registerCalls = mdContent.match(/registerModule\(\{[\s\S]*?name:\s*'([^']+)'/g);
  if (registerCalls) {
    for (const call of registerCalls) {
      const name = call.match(/name:\s*'([^']+)'/)?.[1];
      if (name) {
        RESULTS.push({
          source: 'AppCore',
          name,
          type: 'module',
          details: 'ModuleDependencyManager.registerModule()',
        });
      }
    }
  }

  console.log(`  发现 ${RESULTS.filter(r => r.source === 'AppCore').length} 条 AppCore 模块`);
}

// ──────────────────────────────────────────────
// 3. ModuleRegistry 审计
// ──────────────────────────────────────────────
async function auditModuleRegistry(): Promise<void> {
  console.log('\n=== ModuleRegistry 审计 ===');

  const appSrc = resolve(import.meta.dirname, '..', 'app', 'src');

  // 读取 ModuleDefinitions.ts 中所有的模块定义
  const defsPath = join(appSrc, 'modules', 'ModuleDefinitions.ts');
  if (existsSync(defsPath)) {
    const content = readFileSync(defsPath, 'utf-8');
    const moduleIds = content.match(/id:\s*'([^']+)'/g);
    if (moduleIds) {
      const uniqueIds = new Set(moduleIds.map(m => m.match(/'([^']+)'/)?.[1] || ''));
      for (const id of uniqueIds) {
        RESULTS.push({
          source: 'ModuleRegistry',
          name: id,
          type: 'module',
          details: 'ModuleDefinitions.ts — full definition',
        });
      }
    }
  }

  // 查找 ModuleRegistry.register() 调用
  try {
    const { execSync } = await import('node:child_process');
    const output = execSync(
      `Select-String -Path "${appSrc}\\**\\*.ts" -Pattern "moduleRegistry\\.register\\(" -List -CaseSensitive 2>nul`,
      { shell: 'powershell', encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
    );
    if (output.trim()) {
      console.log('  ModuleRegistry.register() 调用文件:');
      console.log(output);
    }
  } catch {
    console.log('  (搜索 ModuleRegistry.register 失败)');
  }

  console.log(`  发现 ${RESULTS.filter(r => r.source === 'ModuleRegistry').length} 条 ModuleRegistry 注册`);
}

// ──────────────────────────────────────────────
// 主流程
// ──────────────────────────────────────────────
async function main() {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║  DI 容器 / AppCore / ModuleRegistry 审计  ║');
  console.log('╚══════════════════════════════════════════╝');

  await auditDIContainer();
  await auditAppCore();
  await auditModuleRegistry();

  // ── 输出汇总 ──
  console.log('\n\n╔══════════════════════════════════════════╗');
  console.log('║              审计汇总                    ║');
  console.log('╚══════════════════════════════════════════╝');

  const bySource = {
    'DIContainer': RESULTS.filter(r => r.source === 'DIContainer'),
    'AppCore': RESULTS.filter(r => r.source === 'AppCore'),
    'ModuleRegistry': RESULTS.filter(r => r.source === 'ModuleRegistry'),
  };

  console.log(`\nDIContainer:     ${bySource['DIContainer'].length} 条`);
  console.log(`AppCore:         ${bySource['AppCore'].length} 条`);
  console.log(`ModuleRegistry:  ${bySource['ModuleRegistry'].length} 条`);

  // 输出重叠分析
  const diNames = new Set(bySource['DIContainer'].map(r => r.name));
  const appCoreNames = new Set(bySource['AppCore'].map(r => r.name));
  const moduleRegNames = new Set(bySource['ModuleRegistry'].map(r => r.name));

  const overlapDI_AC = [...diNames].filter(n => appCoreNames.has(n));
  const overlapDI_MR = [...diNames].filter(n => moduleRegNames.has(n));
  const overlapAC_MR = [...appCoreNames].filter(n => moduleRegNames.has(n));

  console.log(`\n重叠: DIContainer ∩ AppCore:               ${overlapDI_AC.length} 项`);
  console.log(`重叠: DIContainer ∩ ModuleRegistry:         ${overlapDI_MR.length} 项`);
  console.log(`重叠: AppCore ∩ ModuleRegistry:             ${overlapAC_MR.length} 项`);

  // 保存详细报告
  const reportPath = resolve(import.meta.dirname, '..', 'dev_docs', 'registry-audit-report.json');
  writeFileSync(reportPath, JSON.stringify({
    collectedAt: new Date().toISOString(),
    summary: {
      diContainer: bySource['DIContainer'].length,
      appCore: bySource['AppCore'].length,
      moduleRegistry: bySource['ModuleRegistry'].length,
      overlapDI_AC: overlapDI_AC.length,
      overlapDI_MR: overlapDI_MR.length,
      overlapAC_MR: overlapAC_MR.length,
    },
    details: RESULTS,
    diNames: [...diNames],
    appCoreNames: [...appCoreNames],
    moduleRegNames: [...moduleRegNames],
  }, null, 2));

  console.log(`\n详细报告已保存: ${reportPath}`);
}

main().catch(err => {
  console.error('审计失败:', err);
  process.exit(1);
});

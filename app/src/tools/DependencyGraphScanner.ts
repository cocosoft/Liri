/**
 * O-01 阶段一：依赖图扫描工具
 *
 * 扫描 app/src/ 下所有 .ts 文件的 import 语句，
 * 构建实际依赖图，并与 ModuleDefinitions 声明的依赖关系对比，
 * 输出差异报告。
 */

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
} from 'fs';
import { join, relative, resolve, dirname, sep } from 'path';
import { fileURLToPath } from 'url';
import {
  MODULE_DEFINITIONS,
  MODULE_INITIALIZATION_ORDER,
} from '../modules/ModuleDefinitions';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { resolveCacheDir } from '@modules/config/paths';

const logger = new Logger({ level: LogLevel.INFO });

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SRC_ROOT = resolve(__dirname, '..');

/** 
 * 已知风险：使用 __dirname 扫描源码目录
 * 此工具仅开发时使用，编译为独立 exe 前需移除 __dirname 依赖
 */
/** @modules/xxx 到 module ID 的映射（基于 tsconfig paths） */
const MODULE_ALIAS_MAP: Record<string, string> = {
  core: 'core',
  constants: '__unmapped__',
  'plugin-sdk': 'plugin-sdk',
  ai: 'ai',
  agent: 'agent',
  lsp: 'lsp',
  mcp: 'mcp',
  plugins: 'plugins',
  skills: '__unmapped__',
  tools: 'tools',
  cli: 'cli',
  chat: 'chat',
  channels: 'channels',
  memory: 'memory',
  cache: 'cache',
  security: 'security',
  config: 'config',
  context: 'context',
  errors: 'error',
  modules: 'modules',
  oauth: 'oauth',
  infrastructure: 'infrastructure',
  bridge: 'bridge',
  permission: 'permission',
  commands: 'commands',
  featureflags: 'featureflags',
  sandbox: 'sandbox',
  services: 'services',
  analytics: 'analytics',
  buddy: 'buddy',
  chronos: 'chronos',
  cost: 'cost',
  docs: 'docs',
  hooks: 'hooks',
  query: 'query',
  session: 'session',
  state: 'system/state',
  streaming: 'streaming',
  task: 'task',
  tasks: 'tasks',
  ui: 'ui',
  ink: 'ink',
  models: 'models',
  monitoring: 'monitoring',
  utils: 'utils',
  diagnostics: 'diagnostics',
  remote: 'remote',
  daemon: 'daemon',
  error: 'error',
  bootstrap: 'bootstrap',
};

/** 目录到 module ID 的映射 */
const DIR_TO_MODULE: Record<string, string> = {
  core: 'core',
  infrastructure: 'infrastructure',
  ai: 'ai',
  agent: 'agent',
  bridge: 'bridge',
  ink: 'ink',
  ui: 'ui',
  cli: 'cli',
  tools: 'tools',
  commands: 'commands',
  memory: 'memory',
  cache: 'cache',
  security: 'security',
  oauth: 'oauth',
  permission: 'permission',
  performance: 'performance',
  monitoring: 'monitoring',
  featureflags: 'featureflags',
  analytics: 'analytics',
  buddy: 'buddy',
  chat: 'chat',
  chronos: 'chronos',
  config: 'config',
  context: 'context',
  cost: 'cost',
  docs: 'docs',
  daemon: 'daemon',
  error: 'error',
  hooks: 'hooks',
  lsp: 'lsp',
  mcp: 'mcp',
  modules: 'modules',
  plugins: 'plugins',
  query: 'query',
  remote: 'remote',
  sandbox: 'sandbox',
  services: 'services',
  streaming: 'streaming',
  utils: 'utils',
  voice: 'voice',
  keybindings: 'keybindings',
  bootstrap: 'bootstrap',
  session: 'session',
  channels: 'channels',
  models: 'models',
  skills: 'skills',
  task: 'task',
  tasks: 'tasks',
  system: '__unmapped__',
  tests: '__unmapped__',
  entrypoints: 'core',
};

interface ScanResult {
  file: string;
  moduleId: string;
  imports: string[];
}

interface ModuleDependencyInfo {
  declared: string[];
  optionalDeclared: string[];
  actual: Set<string>;
  actualOptional: Set<string>;
  files: string[];
}

interface DiffReport {
  /** 声明了依赖，但实际代码中未直接 import */
  declaredButNotActual: { moduleId: string; depId: string }[];
  /** 实际有 import，但未在 ModuleDefinitions 中声明 */
  actualButNotDeclared: { moduleId: string; depId: string }[];
  /** 完全未在 ModuleDefinitions 中定义的模块 */
  undeclaredModules: string[];
  /** 严重不一致模块列表 */
  criticalInconsistencies: { moduleId: string; issue: string }[];
  /** ModuleDefinitions 中存在但源代码中未发现文件的模块 */
  definedButNoSourceFiles: string[];
}

/**
 * 递归扫描目录下所有 .ts 文件
 */
function* walkTsFiles(dir: string): Generator<string> {
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (
          entry.name === 'node_modules' ||
          entry.name === '__tests__' ||
          entry.name === 'dist' ||
          entry.name.startsWith('.')
        ) {
          continue;
        }
        yield* walkTsFiles(fullPath);
      } else if (
        entry.name.endsWith('.ts') &&
        !entry.name.endsWith('.test.ts') &&
        !entry.name.endsWith('.spec.ts')
      ) {
        yield fullPath;
      }
    }
  } catch {
    // 跳过无法读取的目录
  }
}

/**
 * 从文件路径映射到 module ID
 */
function filePathToModuleId(filePath: string): string {
  const relativePath = relative(SRC_ROOT, filePath);
  const parts = relativePath.split(sep);
  if (parts.length === 0) return parts[0];
  return DIR_TO_MODULE[parts[0]] || parts[0];
}

/**
 * 从 import 路径解析目标 module ID
 */
function resolveImportToModuleId(
  importPath: string,
  sourceFile: string
): string | null {
  // 处理 @modules/xxx 别名
  if (importPath.startsWith('@modules/')) {
    const alias = importPath.replace('@modules/', '').split('/')[0];
    const mapped = MODULE_ALIAS_MAP[alias];
    if (mapped === '__unmapped__') return null;
    return mapped || null;
  }

  // 外部 npm 包 → 忽略
  if (!importPath.startsWith('.') && !importPath.startsWith('/')) {
    return null;
  }

  // 相对路径 → 解析为绝对路径
  try {
    const sourceDir = dirname(sourceFile);
    const resolved = resolve(sourceDir, importPath);
    const relativePath = relative(SRC_ROOT, resolved);
    // 只处理 src/ 内部的引用
    if (!relativePath.startsWith('..')) {
      const parts = relativePath.split(sep);
      if (parts.length > 0) {
        const dir = parts[0];
        const mapped = DIR_TO_MODULE[dir];
        if (mapped === '__unmapped__') return null;
        return mapped || null;
      }
    }
  } catch {
    // 解析失败
  }

  return null;
}

/**
 * 从文件内容中提取所有 import 语句
 */
function extractImports(filePath: string): string[] {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const imports: string[] = [];
    const importRegex =
      /(?:import\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]|require\s*\(\s*['"]([^'"]+)['"]\s*\))/g;

    let match: RegExpExecArray | null;
    while ((match = importRegex.exec(content)) !== null) {
      const path = match[1] || match[2];
      if (path && !imports.includes(path)) {
        imports.push(path);
      }
    }

    // 也捕获动态 import()
    const dynamicImportRegex = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    while ((match = dynamicImportRegex.exec(content)) !== null) {
      if (match[1] && !imports.includes(match[1])) {
        imports.push(match[1]);
      }
    }

    return imports;
  } catch {
    return [];
  }
}

/**
 * 扫描单个文件
 */
function scanFile(filePath: string): ScanResult {
  const moduleId = filePathToModuleId(filePath);
  const rawImports = extractImports(filePath);
  const resolvedImports: string[] = [];

  for (const rawImport of rawImports) {
    const resolved = resolveImportToModuleId(rawImport, filePath);
    if (resolved && resolved !== moduleId) {
      resolvedImports.push(resolved);
    }
  }

  return {
    file: relative(SRC_ROOT, filePath),
    moduleId,
    imports: [...new Set(resolvedImports)],
  };
}

/**
 * 构建实际依赖图
 */
function buildActualDependencyGraph(
  scanResults: ScanResult[]
): Map<string, ModuleDependencyInfo> {
  const graph = new Map<string, ModuleDependencyInfo>();

  // 初始化所有模块
  const allModuleIds = new Set(Object.keys(MODULE_DEFINITIONS));
  for (const result of scanResults) {
    allModuleIds.add(result.moduleId);
  }

  for (const moduleId of allModuleIds) {
    graph.set(moduleId, {
      declared: MODULE_DEFINITIONS[moduleId]?.dependencies || [],
      optionalDeclared:
        MODULE_DEFINITIONS[moduleId]?.optionalDependencies || [],
      actual: new Set(),
      actualOptional: new Set(),
      files: [],
    });
  }

  // 填充实际依赖和文件列表
  for (const result of scanResults) {
    const info = graph.get(result.moduleId);
    if (!info) continue;

    info.files.push(result.file);
    for (const depId of result.imports) {
      info.actual.add(depId);
    }
  }

  return graph;
}

/**
 * 生成差异报告
 */
function generateDiffReport(
  graph: Map<string, ModuleDependencyInfo>
): DiffReport {
  const report: DiffReport = {
    declaredButNotActual: [],
    actualButNotDeclared: [],
    undeclaredModules: [],
    criticalInconsistencies: [],
    definedButNoSourceFiles: [],
  };

  for (const [moduleId, info] of graph) {
    // 检查 ModuleDefinitions 中存在但未发现源文件的模块
    if (MODULE_DEFINITIONS[moduleId] && info.files.length === 0) {
      report.definedButNoSourceFiles.push(moduleId);
    }

    // 跳过未在 ModuleDefinitions 中定义的模块
    if (!MODULE_DEFINITIONS[moduleId]) {
      if (info.files.length > 0) {
        report.undeclaredModules.push(moduleId);
      }
      continue;
    }

    // 声明了但实际没有的直接 import
    const allDeclared = new Set([...info.declared, ...info.optionalDeclared]);
    for (const depId of allDeclared) {
      if (!info.actual.has(depId) && !info.actualOptional.has(depId)) {
        report.declaredButNotActual.push({ moduleId, depId });
      }
    }

    // 实际有 import 但未声明
    for (const depId of info.actual) {
      if (!allDeclared.has(depId)) {
        report.actualButNotDeclared.push({ moduleId, depId });
      }
    }
  }

  // 严重不一致：某个模块的 declared 依赖中，大部分实际文件都不 import 它
  const depCount = new Map<string, number>();
  for (const item of report.declaredButNotActual) {
    depCount.set(item.depId, (depCount.get(item.depId) || 0) + 1);
  }
  for (const [depId, count] of depCount) {
    if (count >= 3) {
      report.criticalInconsistencies.push({
        moduleId: depId,
        issue: `${count} 个模块声明依赖 ${depId} 但实际代码未 import`,
      });
    }
  }

  return report;
}

/**
 * 打印扫描报告
 */
function printReport(
  graph: Map<string, ModuleDependencyInfo>,
  diff: DiffReport,
  scanResults: ScanResult[]
): void {
  const totalModules = graph.size;
  const definedModules = Object.keys(MODULE_DEFINITIONS).length;

  console.log('\n' + '='.repeat(72));
  console.log('  O-01 模块系统双轨制消除 — 阶段一：依赖图扫描报告');
  console.log('='.repeat(72));

  console.log('\n📊 概览');
  console.log('-'.repeat(40));
  console.log(`  扫描文件数:        ${scanResults.length}`);
  console.log(`  ModuleDefinitions 定义: ${definedModules}`);
  console.log(`  发现模块数:        ${totalModules}`);
  console.log(`  未在定义中的模块:   ${diff.undeclaredModules.length}`);
  console.log(`  已定义但无源文件:   ${diff.definedButNoSourceFiles.length}`);
  console.log(`  声明未实际:         ${diff.declaredButNotActual.length}`);
  console.log(`  实际未声明:         ${diff.actualButNotDeclared.length}`);
  console.log(`  严重不一致:         ${diff.criticalInconsistencies.length}`);

  // 未定义但有源文件的模块
  if (diff.undeclaredModules.length > 0) {
    console.log('\n⚠️ 未在 ModuleDefinitions 中定义的模块（有源文件）');
    console.log('-'.repeat(50));
    for (const moduleId of diff.undeclaredModules.sort()) {
      const info = graph.get(moduleId)!;
      console.log(`  ${moduleId} (${info.files.length} 文件)`);
      if (info.actual.size > 0) {
        console.log(`    实际依赖: ${[...info.actual].join(', ')}`);
      }
    }
  }

  // 已定义但无源文件
  if (diff.definedButNoSourceFiles.length > 0) {
    console.log('\n⚠️ 定义存在但未发现源文件的模块');
    console.log('-'.repeat(50));
    for (const moduleId of diff.definedButNoSourceFiles.sort()) {
      console.log(`  ${moduleId}`);
    }
  }

  // 声明未实际
  if (diff.declaredButNotActual.length > 0) {
    console.log('\n🔴 声明了依赖但实际代码中未直接 import');
    console.log('-'.repeat(50));
    const grouped = new Map<string, string[]>();
    for (const item of diff.declaredButNotActual) {
      const list = grouped.get(item.moduleId) || [];
      list.push(item.depId);
      grouped.set(item.moduleId, list);
    }
    for (const [moduleId, deps] of [...grouped.entries()].sort()) {
      console.log(`  ${moduleId}:`);
      for (const depId of deps) {
        console.log(`    └─ ${depId}`);
      }
    }
  }

  // 实际未声明
  if (diff.actualButNotDeclared.length > 0) {
    console.log('\n🟡 实际 import 了但未在 ModuleDefinitions 中声明');
    console.log('-'.repeat(50));

    // 过滤掉 undefined / unknown
    const meaningful = diff.actualButNotDeclared.filter(
      (x) => x.depId && x.depId !== 'undefined' && x.depId !== '__unmapped__'
    );

    // 统计每个模块的未声明依赖数
    const grouped = new Map<string, Map<string, number>>();
    for (const item of meaningful) {
      const byDep = grouped.get(item.moduleId) || new Map();
      byDep.set(item.depId, (byDep.get(item.depId) || 0) + 1);
      grouped.set(item.moduleId, byDep);
    }

    for (const [moduleId, deps] of [...grouped.entries()].sort()) {
      const totalDeps = [...deps.values()].reduce((a, b) => a + b, 0);
      console.log(`  ${moduleId} (${totalDeps} 处):`);
      for (const [depId, count] of [...deps.entries()].sort(
        (a, b) => b[1] - a[1]
      )) {
        console.log(`    ├─ ${depId} (${count}次)`);
      }
    }
  }

  // 严重不一致
  if (diff.criticalInconsistencies.length > 0) {
    console.log('\n🚨 严重不一致');
    console.log('-'.repeat(50));
    for (const item of diff.criticalInconsistencies) {
      console.log(`  ${item.moduleId}: ${item.issue}`);
    }
  }

  console.log('\n' + '='.repeat(72));
  console.log('  扫描完成');
  console.log('='.repeat(72) + '\n');
}

/**
 * 主入口
 */
async function main(): Promise<void> {
  logger.info('开始依赖图扫描...');
  const startTime = Date.now();

  // 扫描所有文件
  const scanResults: ScanResult[] = [];
  let fileCount = 0;

  for (const filePath of walkTsFiles(SRC_ROOT)) {
    fileCount++;
    const result = scanFile(filePath);
    if (result.imports.length > 0 || result.moduleId) {
      scanResults.push(result);
    }
  }

  // 构建实际依赖图
  const graph = buildActualDependencyGraph(scanResults);

  // 生成差异报告
  const diff = generateDiffReport(graph);

  // 打印报告
  printReport(graph, diff, scanResults);

  const duration = Date.now() - startTime;
  logger.info(`扫描完成，耗时 ${duration}ms，扫描 ${fileCount} 个文件`);

  // 输出 JSON 报告供程序化处理
  const reportPath = join(resolveCacheDir(), 'dependency-scan-report.json');
  const reportDir = dirname(reportPath);
  if (!existsSync(reportDir)) {
    mkdirSync(reportDir, { recursive: true });
  }

  const jsonReport = {
    scannedFiles: scanResults.length,
    declaredModules: Object.keys(MODULE_DEFINITIONS).length,
    actualModules: graph.size,
    undeclaredModules: diff.undeclaredModules,
    definedButNoSourceFiles: diff.definedButNoSourceFiles,
    declaredButNotActual: diff.declaredButNotActual,
    actualButNotDeclared: diff.actualButNotDeclared,
    criticalInconsistencies: diff.criticalInconsistencies,
  };

  writeFileSync(reportPath, JSON.stringify(jsonReport, null, 2), 'utf-8');
  logger.info(`JSON 报告已保存: ${reportPath}`);
}

main().catch((err) => {
  console.error('扫描失败:', err);
  process.exit(1);
});

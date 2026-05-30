/**
 * analyze-deps.ts — 模块依赖图谱分析脚本
 *
 * 扫描 src/ 下所有 .ts/.tsx 文件，解析 import 语句，
 * 构建模块级依赖图，检测循环依赖。
 *
 * 用法: npx tsx scripts/analyze-deps.ts
 * 输出: deps-report.md
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SRC_DIR = path.resolve(__dirname, '..', 'src');
const OUTPUT_FILE = path.resolve(__dirname, '..', 'deps-report.md');

const MODULE_MAP: Record<string, string> = {
  'core': 'core',
  'ai': 'ai',
  'agent': 'agent',
  'bridge': 'bridge',
  'chat': 'chat',
  'cli': 'cli',
  'commands': 'commands',
  'config': 'config',
  'docs': 'docs',
  'error': 'error',
  'hooks': 'hooks',
  'ink': 'ink',
  'mcp': 'mcp',
  'memory': 'memory',
  'modules': 'modules',
  'monitoring': 'monitoring',
  'oauth': 'oauth',
  'performance': 'performance',
  'permission': 'permission',
  'plugins': 'plugins',
  'security': 'security',
  'services': 'services',
  'session': 'session',
  'skills': 'skills',
  'streaming': 'streaming',
  'tools': 'tools',
  'ui': 'ui',
  'utils': 'utils',
  'analytics': 'analytics',
  'buddy': 'buddy',
  'chronos': 'chronos',
  'components': 'components',
  'entrypoints': 'entrypoints',
  'governance': 'governance',
  'lsp': 'lsp',
  'promptSuggestion': 'promptSuggestion',
  'query': 'query',
  'remote': 'remote',
  'scripts': 'scripts',
  'subagent': 'subagent',
};

type DepGraph = Record<string, Set<string>>;

function resolveModule(filePath: string): string {
  const relative = path.relative(SRC_DIR, filePath).replace(/\\/g, '/');
  const topDir = relative.split('/')[0];

  return MODULE_MAP[topDir] || topDir;
}

function parseImports(filePath: string): string[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const imports: string[] = [];

  const importRegex = /import\s+(?:type\s+)?(?:(?:\{[^}]*\}|[^'{]*?)\s+from\s+)?['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;

  while ((match = importRegex.exec(content)) !== null) {
    const specifier = match[1];

    if (specifier.startsWith('.')) {
      const resolved = path.resolve(path.dirname(filePath), specifier);
      const candidates = [
        resolved + '.ts',
        resolved + '.tsx',
        path.join(resolved, 'index.ts'),
        path.join(resolved, 'index.tsx'),
      ];

      for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
          imports.push(candidate);
          break;
        }
      }
    } else if (specifier.startsWith('@modules/')) {
      const modulePath = specifier.replace('@modules/', '');
      const resolved = path.resolve(SRC_DIR, modulePath);
      const candidates = [
        resolved + '.ts',
        resolved + '.tsx',
        path.join(resolved, 'index.ts'),
        path.join(resolved, 'index.tsx'),
      ];

      for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
          imports.push(candidate);
          break;
        }
      }
    }
  }

  return imports;
}

function collectFiles(dir: string): string[] {
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'testing' || entry.name === '__tests__') {
        continue;
      }
      results.push(...collectFiles(fullPath));
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
      if (!entry.name.endsWith('.d.ts') && !entry.name.includes('.test.') && !entry.name.includes('.spec.')) {
        results.push(fullPath);
      }
    }
  }

  return results;
}

function buildGraph(files: string[]): { fileGraph: Map<string, Set<string>>; moduleGraph: DepGraph } {
  const fileGraph = new Map<string, Set<string>>();
  const moduleGraph: DepGraph = {};

  for (const file of files) {
    const moduleName = resolveModule(file);

    if (!moduleGraph[moduleName]) {
      moduleGraph[moduleName] = new Set();
    }

    const deps = parseImports(file);
    fileGraph.set(file, new Set());

    for (const dep of deps) {
      if (!dep.startsWith(SRC_DIR)) continue;

      fileGraph.get(file)!.add(dep);

      const depModule = resolveModule(dep);
      if (depModule !== moduleName) {
        moduleGraph[moduleName].add(depModule);
      }
    }
  }

  return { fileGraph, moduleGraph };
}

function findCycles(graph: DepGraph): string[][] {
  const cycles: string[][] = [];
  const visited = new Set<string>();
  const stack = new Set<string>();

  function dfs(node: string, path: string[]): void {
    visited.add(node);
    stack.add(node);
    path.push(node);

    const neighbors = graph[node] || new Set();
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        dfs(neighbor, [...path]);
      } else if (stack.has(neighbor)) {
        const cycleStart = path.indexOf(neighbor);
        if (cycleStart !== -1) {
          const cycle = path.slice(cycleStart);
          cycle.push(neighbor);
          cycles.push(cycle);
        }
      }
    }

    stack.delete(node);
  }

  for (const node of Object.keys(graph)) {
    if (!visited.has(node)) {
      dfs(node, []);
    }
  }

  return cycles;
}

function generateReport(
  moduleGraph: DepGraph,
  cycles: string[][],
  fileCount: number,
  moduleCount: number,
): string {
  const lines: string[] = [];

  lines.push('# Liri 模块依赖分析报告');
  lines.push('');
  lines.push(`> 生成时间: ${new Date().toISOString()}`);
  lines.push(`> 扫描文件: ${fileCount} 个 .ts/.tsx 文件`);
  lines.push(`> 识别模块: ${moduleCount} 个`);
  lines.push('');

  lines.push('## 1. 模块依赖矩阵');
  lines.push('');
  lines.push('| 模块 | 依赖数 | 被依赖数 | 依赖列表 |');
  lines.push('|------|--------|----------|----------|');

  const modules = Object.keys(moduleGraph).sort();
  const reverseDep: DepGraph = {};

  for (const mod of modules) {
    reverseDep[mod] = new Set();
  }

  for (const [mod, deps] of Object.entries(moduleGraph)) {
    for (const dep of deps) {
      if (reverseDep[dep]) {
        reverseDep[dep].add(mod);
      }
    }
  }

  for (const mod of modules) {
    const deps = moduleGraph[mod];
    const depCount = deps.size;
    const revCount = reverseDep[mod]?.size || 0;
    const depList = [...deps].sort().join(', ') || '—';

    lines.push(`| ${mod} | ${depCount} | ${revCount} | ${depList} |`);
  }

  lines.push('');

  lines.push('## 2. 循环依赖检测');
  lines.push('');

  if (cycles.length === 0) {
    lines.push('✅ 未检测到循环依赖。');
  } else {
    lines.push(`⚠️ 检测到 ${cycles.length} 个循环依赖：`);
    lines.push('');

    for (let i = 0; i < cycles.length; i++) {
      const cycle = cycles[i];
      lines.push(`### 循环 ${i + 1}`);
      lines.push('');
      lines.push('```');
      lines.push(cycle.join(' → '));
      lines.push('```');
      lines.push('');
    }
  }

  lines.push('');

  lines.push('## 3. 高耦合模块（被依赖数 ≥ 5）');
  lines.push('');

  const highCoupling = modules
    .filter((m) => (reverseDep[m]?.size || 0) >= 5)
    .sort((a, b) => (reverseDep[b]?.size || 0) - (reverseDep[a]?.size || 0));

  if (highCoupling.length === 0) {
    lines.push('无高耦合模块。');
  } else {
    lines.push('| 模块 | 被依赖数 | 依赖方 |');
    lines.push('|------|----------|--------|');

    for (const mod of highCoupling) {
      const revDeps = [...(reverseDep[mod] || [])].sort().join(', ');
      lines.push(`| ${mod} | ${reverseDep[mod]?.size || 0} | ${revDeps} |`);
    }
  }

  lines.push('');

  lines.push('## 4. 零依赖模块（叶节点）');
  lines.push('');

  const leafModules = modules.filter((m) => (moduleGraph[m]?.size || 0) === 0).sort();

  if (leafModules.length === 0) {
    lines.push('无零依赖模块。');
  } else {
    lines.push(`共 ${leafModules.length} 个叶节点模块：`);
    lines.push('');
    lines.push(leafModules.map((m) => `- ${m}`).join('\n'));
  }

  lines.push('');

  return lines.join('\n');
}

function main(): void {
  console.log('扫描源文件...');
  const files = collectFiles(SRC_DIR);
  console.log(`找到 ${files.length} 个源文件`);

  console.log('构建依赖图...');
  const { moduleGraph } = buildGraph(files);
  const moduleCount = Object.keys(moduleGraph).length;
  console.log(`识别 ${moduleCount} 个模块`);

  console.log('检测循环依赖...');
  const cycles = findCycles(moduleGraph);
  console.log(`发现 ${cycles.length} 个循环依赖`);

  console.log('生成报告...');
  const report = generateReport(moduleGraph, cycles, files.length, moduleCount);

  fs.writeFileSync(OUTPUT_FILE, report, 'utf-8');
  console.log(`报告已生成: ${OUTPUT_FILE}`);

  if (cycles.length > 0) {
    console.log('\n⚠️ 循环依赖详情:');
    for (const cycle of cycles) {
      console.log(`  ${cycle.join(' → ')}`);
    }
  }
}

main();
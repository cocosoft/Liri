/**
 * resolve-module-aliases.ts — 将 tsconfig paths 别名展开为相对路径
 *
 * 用于 Docker 构建：bun build --compile 不支持 tsconfig paths，
 * 因此在构建前用此脚本将 @modules/xxx → ./src/xxx 替换。
 *
 * 用法:
 *   bun run scripts/resolve-module-aliases.ts
 */

import { readdirSync, readFileSync, writeFileSync, statSync } from 'fs';
import { join, resolve, relative, dirname } from 'path';

const SRC_DIR = resolve(import.meta.dir, '..', 'src');

// tsconfig.json 中的 paths 映射（baseUrl: "./src"）
const ALIAS_MAP: Record<string, string> = {
  '@modules/core': 'core',
  '@modules/constants': 'constants',
  '@modules/plugin-sdk': 'plugin-sdk',
  '@modules/ai': 'ai',
  '@modules/agent': 'agent',
  '@modules/lsp': 'lsp',
  '@modules/mcp': 'mcp',
  '@modules/plugins': 'plugins',
  '@modules/skills': 'skills',
  '@modules/tools': 'tools',
  '@modules/cli': 'cli',
  '@modules/chat': 'chat',
  '@modules/channels': 'channels',
  '@modules/memory': 'memory',
  '@modules/cache': 'cache',
  '@modules/security': 'security',
  '@modules/config': 'config',
  '@modules/context': 'context',
  '@modules/errors': 'error',
  '@modules/modules': 'modules',
  '@modules/oauth': 'oauth',
  '@modules/infrastructure': 'infrastructure',
  '@modules/knowledge': 'knowledge',
  '@modules/bridge': 'bridge',
  '@modules/permission': 'permission',
  '@modules/commands': 'commands',
  '@modules/featureflags': 'featureflags',
  '@modules/sandbox': 'sandbox',
  '@modules/services': 'services',
  '@modules/analytics': 'analytics',
  '@modules/buddy': 'buddy',
  '@modules/chronos': 'chronos',
  '@modules/cost': 'cost',
  '@modules/docs': 'docs',
  '@modules/hooks': 'hooks',
  '@modules/query': 'query',
  '@modules/session': 'session',
  '@modules/state': 'system/state',
  '@modules/streaming': 'streaming',
  '@modules/tasks': 'tasks',
  '@modules/ui': 'ui',
  '@modules/ink': 'ink',
  '@modules/models': 'models',
  '@modules/monitoring': 'monitoring',
  '@modules/utils': 'utils',
  '@modules/diagnostics': 'diagnostics',
  '@modules/remote': 'remote',
  '@modules/daemon': 'daemon',
  '@modules/error': 'error',
};

const ALIAS_PREFIXES = Object.keys(ALIAS_MAP).sort((a, b) => b.length - a.length);

function resolveAlias(importPath: string, fileDir: string): string | null {
  for (const prefix of ALIAS_PREFIXES) {
    if (importPath === prefix) {
      return relative(fileDir, join(SRC_DIR, ALIAS_MAP[prefix])).replace(/\\/g, '/') || './';
    }
    if (importPath.startsWith(prefix + '/')) {
      const rest = importPath.slice(prefix.length + 1);
      return relative(fileDir, join(SRC_DIR, ALIAS_MAP[prefix], rest)).replace(/\\/g, '/');
    }
  }
  return null;
}

function processFile(filePath: string): boolean {
  let content = readFileSync(filePath, 'utf-8');
  const original = content;
  const fileDir = dirname(filePath);

  // 替换 import ... from '@modules/xxx'
  content = content.replace(
    /(from\s+['"])(@modules\/[^'"]+)(['"])/g,
    (_match, prefix, importPath, suffix) => {
      const resolved = resolveAlias(importPath, fileDir);
      if (resolved) {
        return `${prefix}${resolved.startsWith('.') ? resolved : './' + resolved}${suffix}`;
      }
      return _match;
    }
  );

  // 替换 import '@modules/xxx'
  content = content.replace(
    /(import\s+['"])(@modules\/[^'"]+)(['"])/g,
    (_match, prefix, importPath, suffix) => {
      const resolved = resolveAlias(importPath, fileDir);
      if (resolved) {
        return `${prefix}${resolved.startsWith('.') ? resolved : './' + resolved}${suffix}`;
      }
      return _match;
    }
  );

  if (content !== original) {
    writeFileSync(filePath, content, 'utf-8');
    return true;
  }
  return false;
}

function walkDir(dir: string, modified: string[]): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (entry.startsWith('.') || entry === 'node_modules') continue;
    const st = statSync(full);
    if (st.isDirectory()) {
      walkDir(full, modified);
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
      if (processFile(full)) {
        modified.push(full);
      }
    }
  }
}

function main(): void {
  console.log('Resolving @modules/* aliases to relative paths...\n');
  const modified: string[] = [];
  walkDir(SRC_DIR, modified);

  if (modified.length > 0) {
    console.log(`Modified ${modified.length} files:`);
    for (const f of modified.slice(0, 20)) {
      console.log(`  ${relative(SRC_DIR, f)}`);
    }
    if (modified.length > 20) console.log(`  ... and ${modified.length - 20} more`);
  } else {
    console.log('No files needed modification (already resolved?)');
  }

  console.log('\nDone.');
}

main();

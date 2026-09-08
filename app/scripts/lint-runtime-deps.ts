/**
 * lint-runtime-deps.ts — 运行期依赖候选审计（Phase1 #7，防"补丁式升级"复发）
 *
 * 扫描 app/src 与 app/packages 下的裸模块说明符（静态 import 与动态 import()），
 * 输出分类：
 *   A. 契约 externals（package-manifest.ts）确被使用的核对
 *   B. 仅动态 import 的第三方包候选（可能需按 dynamic-import 成因入契约/审计）
 *   C. 无法归类（既非常用内置/内部别名/契约成员）——审计清单
 *
 * 用法:
 *   bun run scripts/lint-runtime-deps.ts [--strict]
 * --strict: A 中契约成员未被任何 import 引用时按失败退出（exit 1）。
 */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { RUNTIME_DEPS, PACKAGE_MANIFEST } from './package-manifest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_DIR = path.resolve(__dirname, '..');

const BUILTINS = new Set([
  'bun', 'bun:sqlite', 'bun:ffi', 'bun:jsc', 'bun:test', 'bun:wrap',
  'node', 'fs', 'fs/promises', 'path', 'path/posix', 'path/win32',
  'os', 'util', 'stream', 'stream/promises', 'events', 'child_process',
  'url', 'module', 'crypto', 'http', 'https', 'net', 'tls', 'dns',
  'zlib', 'string_decoder', 'buffer', 'assert', 'querystring', 'readline',
  'timers', 'timers/promises', 'constants', 'perf_hooks', 'worker_threads',
  'repl', 'v8', 'vm', 'worker_threads', 'async_hooks', 'inspector', 'dgram', 'cluster',
]);
const INTERNAL_PREFIXES = ['@modules/', '@shared/', '@pyapp/', './', '../'];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    if (entry.name === 'node_modules' || entry.name === '__tests__' || entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mjs|cjs|js)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

/** 收集裸说明符：静态 import ... from 'x' 与动态 import('x') */
function collectBareSpecifiers(): { staticImports: Set<string>; dynamicImports: Set<string> } {
  const staticImports = new Set<string>();
  const dynamicImports = new Set<string>();
  const roots: string[] = [path.join(APP_DIR, 'src')];
  const pkgDir = path.join(APP_DIR, 'packages');
  if (fs.existsSync(pkgDir)) roots.push(pkgDir);

  const staticRe = /\bimport\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g;
  const dynamicRe = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const file of walk(root)) {
      const content = fs.readFileSync(file, 'utf-8');
      // 去掉注释行的匹配干扰（简化：注释中的 import 极可能不是真引用，容忍少量误报）
      for (const m of content.matchAll(staticRe)) {
        if (m[1] && !INTERNAL_PREFIXES.some((p) => m[1].startsWith(p)) && !BUILTINS.has(m[1])) {
          staticImports.add(m[1].split('/')[0]);
        }
      }
      for (const m of content.matchAll(dynamicRe)) {
        if (m[1] && !INTERNAL_PREFIXES.some((p) => m[1].startsWith(p)) && !BUILTINS.has(m[1])) {
          dynamicImports.add(m[1].split('/')[0]);
        }
      }
    }
  }
  return { staticImports, dynamicImports };
}

function main(): void {
  const strict = process.argv.includes('--strict');
  const { staticImports, dynamicImports } = collectBareSpecifiers();
  const all = new Set([...staticImports, ...dynamicImports]);

  console.log('=== 运行期依赖审计 ===');
  console.log(`契约 externals: ${RUNTIME_DEPS.join(', ')} (${PACKAGE_MANIFEST.externals.length})`);

  // A. 契约成员使用核对
  let contractUnused = false;
  for (const dep of RUNTIME_DEPS) {
    const used = all.has(dep);
    console.log(`  ${used ? '✅' : '⚠️'} ${dep} ${used ? '' : '(契约内但未在代码中检索到 import，需人工确认)'}`);
    if (!used) contractUnused = true;
  }

  // B. 仅动态 import 的第三方包（external 潜在候选，如 imapflow/nodemailer 模式）
  const dynamicOnly = [...dynamicImports].filter((p) => !staticImports.has(p) && !RUNTIME_DEPS.includes(p));
  console.log(`\n仅动态 import 候选（${dynamicOnly.length}）：${dynamicOnly.join(', ') || '无'}`);
  console.log('  → 若无法被 bundler 内联或需按需携带，应以 reason="dynamic-import" 加入契约');

  // C. 审计剩余静态依赖（bundler 内联类，通常无需分发，仅作变化可见性）
  const bundled = [...staticImports].filter((p) => !RUNTIME_DEPS.includes(p) && !BUILTINS.has(p));
  console.log(`\n静态引用第三方（bundler 内联，${bundled.length}）：${bundled.sort().join(', ') || '无'}`);

  if (strict && contractUnused) {
    console.error('\n[lint FAIL] --strict: 契约 externals 存在未被使用的成员');
    process.exit(1);
  }
  console.log('\n=== 审计完成 ===');
}

main();

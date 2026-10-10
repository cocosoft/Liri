#!/usr/bin/env bun
/**
 * 「测试禁用 `mock.module`」门禁（2026-10-10）
 *
 * **为什么需要**：Bun 的 `mock.module(…)` 是**进程级全局且不可撤销**（本仓已两处实测并记录：
 * `tests/voice/VoiceInputTool.test.ts:64`、`tests/ai/resolveModelRoute.test.ts:54` ——
 * `mock.restore()` **无效**、`--isolate` 亦拦不住）。全量 `bun test` 在**单进程**内按文件顺序
 * 执行 ⇒ 一个文件替换整个模块，会**泄漏给它之后加载的所有测试文件**。
 *
 * **实证事故（L-23）**：`__tests__/CoreAPIImpl.chatStream.test.ts` 把 `@modules/config` 桩成
 * `{ configManager: { env: () => undefined } }` ⇒ 其后所有读 `configManager.env(…)` 的测试恒拿
 * `undefined` ⇒ **A2A 侧车 5 例在全量跑中失败**（隔离运行则全绿），排查成本极高。
 *
 * **口径（P0-8）**：改用 **DI / 注入端口**（先例 `utils/spawnPort.ts` 的 `setSpawnImpl`、
 * `tests/ai/llama/LlamaCppServerManager.test.ts` 的 `setSpawnImpl(fake)`）。
 *
 * **零豁免**（2026-10-10）：存量 2 处已按 P0-8 口径迁移完毕（`CoreAPIImpl.chatStream.test.ts`
 * 的 12 处改用既有 DI 缝 `new CoreAPIImpl({chatManager})` + `setCoreApiAppDeps(...)`；
 * `ChatHelper.test.ts` 的 1 处系**陈旧死代码**，直接删除并改用真实缝 `setModelWindow`）
 * ⇒ 本门禁不再保留豁免表：**任何**活跃用法一律阻断（exit 1）。
 *
 * 负向自证：根目录可经 `NOMM_REPO_ROOT` 覆盖（`app/tests/gates/noModuleMockGate.test.ts`）。
 */

import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  type Dirent,
} from 'node:fs';
import { relative, resolve } from 'node:path';

const repoRoot = process.env.NOMM_REPO_ROOT
  ? resolve(process.env.NOMM_REPO_ROOT)
  : resolve(import.meta.dir, '..');

/** 扫描根：`app/tests` 整棵（含 helper）；`app/src` 仅测试文件 */
const SCAN_ROOTS = ['app/tests', 'app/src'];

/** 命中「真实用法」：`mock.module(` 且前面不是标识符/点（排除 `xxx.mock.module(` 这类伪命中） */
const USAGE_RE = /(^|[^\w.$])mock\.module\s*\(/;
/** 注释行不计（本仓多处注释里提到该 API） */
const COMMENT_RE = /^\s*(\/\/|\*|\/\*)/;

function walk(dir: string, out: string[]): string[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const abs = resolve(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== 'node_modules') walk(abs, out);
      continue;
    }
    if (e.name.endsWith('.ts')) out.push(abs);
  }
  return out;
}

/** 受检文件：`app/tests/**` 全部 `.ts`；其余根仅 `*.test.ts` / `*.spec.ts` */
function isInScope(abs: string): boolean {
  const rel = relative(repoRoot, abs).replace(/\\/g, '/');
  if (rel.startsWith('app/tests/')) return true;
  return rel.endsWith('.test.ts') || rel.endsWith('.spec.ts');
}

const offenders = new Map<string, number>();

for (const root of SCAN_ROOTS) {
  const absRoot = resolve(repoRoot, root);
  if (!existsSync(absRoot) || !statSync(absRoot).isDirectory()) continue;
  for (const file of walk(absRoot, [])) {
    if (!isInScope(file)) continue;
    const rel = relative(repoRoot, file).replace(/\\/g, '/');
    let hits = 0;
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      if (COMMENT_RE.test(line)) continue;
      if (USAGE_RE.test(line)) hits++;
    }
    if (hits > 0) offenders.set(rel, hits);
  }
}

console.log('=== 测试 `mock.module` 禁用门禁（P0-8 / L-23） ===');
console.log(`扫描根 ${SCAN_ROOTS.join(' · ')} ｜ **零豁免**`);
console.log('----------------------------------------');

if (offenders.size > 0) {
  console.error(
    '❌ 检出 `mock.module` 用法（进程级持久、不可撤销 ⇒ 跨文件污染）：'
  );
  for (const [file, hits] of offenders) {
    console.error(`  - ${file}（${hits} 处）`);
  }
  console.error(
    '  ⇒ 请改用 **DI / 注入端口**（先例：`utils/spawnPort.ts` 的 `setSpawnImpl`；' +
      'app 能力用 `setCoreApiAppDeps`）。'
  );
  process.exit(1);
}

console.log('✅ 全仓测试零 `mock.module`');

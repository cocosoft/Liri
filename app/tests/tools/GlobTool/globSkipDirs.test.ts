/**
 * glob 重目录跳过（2026-09-22）—— 修复 `chat-export-1790038432335.md` 暴露的性能异常。
 *
 * 背景：`GrepTool` 早有 `SKIP_DIRS` 跳过 `node_modules` 等重目录，**glob 侧完全没有**。
 * 从项目根执行双星前缀递归模式时会遍历两个 `node_modules`（本仓 6.5 万+ 文件）。
 * 实测（2026-09-22 本仓根）：`globAsync` 找单个文件耗时 **7960ms**（命中仅 1 个）；
 * 真机日志 2026-09-21T23:22:33Z 同批 4 个 glob 占满 55s 工具窗口。
 *
 * 本组用例锁定两件事：
 *  1. 默认**跳过**重目录（性能）；
 *  2. 模式**显式点名**该目录时仍可命中（不能用性能优化制造功能回归）。
 */
import { describe, test, expect, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { globAsync, glob } from '../../../src/tools/GlobTool/GlobTool';
import {
  SKIP_DIRS,
  resolveSkipDirs,
} from '../../../src/tools/utils/searchSkipDirs';

const created: string[] = [];

/** 建一棵含"重目录"的临时树：src/ 与 node_modules/ 下有同名文件 */
function makeTree(): string {
  const root = mkdtempSync(join(tmpdir(), 'glob-skip-'));
  created.push(root);
  for (const rel of [
    'src/a',
    'src/b',
    'node_modules/pkg',
    'dist',
    'target/debug',
  ]) {
    mkdirSync(join(root, rel), { recursive: true });
  }
  writeFileSync(join(root, 'src/a/Needle.ts'), 'export const a = 1;');
  writeFileSync(join(root, 'src/b/Other.ts'), 'export const b = 2;');
  writeFileSync(join(root, 'node_modules/pkg/Needle.ts'), '// dep');
  writeFileSync(join(root, 'dist/Needle.ts'), '// built');
  writeFileSync(join(root, 'target/debug/Needle.ts'), '// rust out');
  return root;
}

afterEach(() => {
  while (created.length > 0) {
    try {
      rmSync(created.pop()!, { recursive: true, force: true });
    } catch {
      // @ignore-catch — 清理临时目录失败不影响断言
    }
  }
});

describe('glob 重目录跳过：默认行为', () => {
  test('递归模式不再命中 node_modules / dist / target 下的同名文件', async () => {
    const root = makeTree();
    const result = await globAsync('**/Needle.ts', root);

    const rel = result.filenames.map((f) =>
      f.replace(/\\/g, '/').slice(root.replace(/\\/g, '/').length + 1)
    );
    expect(rel).toEqual(['src/a/Needle.ts']);
    // 修复前会同时命中 node_modules/pkg、dist、target/debug 三处
    expect(result.filenames.length).toBe(1);
  });

  test('同步 `glob()` 与异步语义一致（同一跳过清单）', () => {
    const root = makeTree();
    const result = glob('**/Needle.ts', root);
    expect(result.numFiles).toBe(1);
  });
});

describe('glob 重目录跳过：模式点名时豁免', () => {
  test('模式显式包含 node_modules ⇒ 该目录不再被跳过', async () => {
    const root = makeTree();
    const result = await globAsync('**/node_modules/**/Needle.ts', root);

    expect(result.filenames.length).toBe(1);
    expect(result.filenames[0].replace(/\\/g, '/')).toContain(
      '/node_modules/pkg/Needle.ts'
    );
  });

  test('点名 dist 只豁免 dist，其余重目录仍跳过', async () => {
    const root = makeTree();
    const result = await globAsync('**/dist/Needle.ts', root);

    expect(result.filenames.length).toBe(1);
    expect(result.filenames[0].replace(/\\/g, '/')).toContain(
      '/dist/Needle.ts'
    );
  });
});

describe('resolveSkipDirs 纯函数', () => {
  test('未点名任何目录 ⇒ 直接返回共享常量（零分配）', () => {
    expect(resolveSkipDirs('**/*.ts')).toBe(SKIP_DIRS);
  });

  test('点名 node_modules ⇒ 结果中不含该目录，其余仍在', () => {
    const effective = resolveSkipDirs('**/node_modules/**/*.ts');
    expect(effective.has('node_modules')).toBe(false);
    expect(effective.has('dist')).toBe(true);
    expect(effective.has('target')).toBe(true);
  });

  test('反斜杠模式同样能识别点名', () => {
    expect(resolveSkipDirs('**\\node_modules\\**').has('node_modules')).toBe(
      false
    );
  });
});

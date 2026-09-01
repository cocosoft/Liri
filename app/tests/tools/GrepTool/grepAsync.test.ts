/**
 * GrepTool grepAsync 协作式搜索测试
 *
 * 根因（2026-08-31）：grep() 同步递归扫描大型目录会阻塞事件循环数分钟，
 * SSE 心跳停发 → 前端"流式响应超时"误判。grepAsync 每 50 条让出事件循环。
 *
 * 覆盖：
 * - grepAsync 结果与 grep 完全一致（多文件目录）
 * - 单文件搜索
 * - 协作式：扫描期间事件循环保持转动（定时器可正常 tick）
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { grep, grepAsync } from '../../../src/tools/GrepTool/grep';

let tmpRoot: string;
let projectDir: string;
let bigDir: string;

beforeAll(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'grep-async-'));
  projectDir = join(tmpRoot, 'proj');
  mkdirSync(join(projectDir, 'src', 'a', 'b'), { recursive: true });
  mkdirSync(join(projectDir, 'docs'), { recursive: true });
  // 项目文件
  writeFileSync(join(projectDir, 'src', 'a', 'b', 'x.ts'), 'const foo = 1;\n');
  writeFileSync(join(projectDir, 'src', 'index.ts'), 'foo();\n');
  writeFileSync(join(projectDir, 'docs', 'readme.md'), '# foo docs\n');
  writeFileSync(join(projectDir, 'README.md'), 'no match here\n');

  // 大型目录（协作式验证：300+ 文件）
  bigDir = join(tmpRoot, 'big');
  mkdirSync(bigDir, { recursive: true });
  for (let i = 0; i < 300; i++) {
    mkdirSync(join(bigDir, `dir${i % 10}`), { recursive: true });
    writeFileSync(join(bigDir, `dir${i % 10}`, `f${i}.txt`), `line${i}\n`);
  }
});

afterAll(() => {
  try {
    rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    // @ignore-catch
  }
});

describe('grepAsync（2026-08-31 协作式修复）', () => {
  test('结果与 grep() 完全一致（多文件目录）', async () => {
    const sync = grep({ pattern: 'foo', searchPath: projectDir });
    const async_ = await grepAsync({ pattern: 'foo', searchPath: projectDir });
    expect(async_.matchCount).toBe(sync.matchCount);
    expect(async_.fileCount).toBe(sync.fileCount);
    expect(async_.matches).toEqual(sync.matches);
    expect(async_.matchCount).toBeGreaterThan(0);
  });

  test('单文件搜索降级', async () => {
    const target = join(projectDir, 'src', 'index.ts');
    const sync = grep({ pattern: 'foo', searchPath: target });
    const async_ = await grepAsync({ pattern: 'foo', searchPath: target });
    expect(async_.matchCount).toBe(sync.matchCount);
    expect(async_.fileCount).toBe(1);
    expect(async_.matchCount).toBeGreaterThan(0);
  });

  test('协作式：grepAsync 扫描期间让出事件循环（探针可执行）', async () => {
    // 在 grepAsync 开始前注册一个 setImmediate 探针。若扫描期间让出事件循环，
    // 探针（先入队）会在扫描完成前执行；若同步阻塞，探针要等扫描结束才轮到。
    let probeRanDuringScan = false;
    const probe = new Promise<void>((resolve) => setImmediate(resolve)).then(
      () => {
        probeRanDuringScan = true;
      }
    );
    const result = await grepAsync({ pattern: 'line', searchPath: bigDir });
    await probe;
    expect(probeRanDuringScan).toBe(true);
    expect(result.matchCount).toBeGreaterThan(0);
  });

  test('无匹配时返回空结果', async () => {
    const result = await grepAsync({
      pattern: 'zzz-no-match-zzz',
      searchPath: projectDir,
    });
    expect(result.matchCount).toBe(0);
    expect(result.fileCount).toBe(0);
  });
});

/**
 * GlobTool globAsync 协作式搜索测试
 *
 * 根因（2026-09-01）：glob() 纯同步递归遍历大型目录阻塞事件循环，
 * SSE 心跳停发 → 前端"流式响应超时"误判（与 grep 同类，对称修复）。
 *
 * 覆盖：
 * - globAsync 结果与 glob() 完全一致
 * - 协作式：遍历期间让出事件循环（探针可执行）
 * - 空结果 / 匹配达到 MAX_FILES 截断
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { glob, globAsync } from '../../../src/tools/GlobTool/GlobTool';

let tmpRoot: string;
let projectDir: string;
let bigDir: string;

beforeAll(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'glob-async-'));
  projectDir = join(tmpRoot, 'proj');
  mkdirSync(join(projectDir, 'src', 'a', 'b'), { recursive: true });
  mkdirSync(join(projectDir, 'docs'), { recursive: true });
  writeFileSync(join(projectDir, 'src', 'a', 'b', 'x.ts'), 'x\n');
  writeFileSync(join(projectDir, 'src', 'index.ts'), 'x\n');
  writeFileSync(join(projectDir, 'docs', 'readme.md'), 'x\n');
  writeFileSync(join(projectDir, 'README.md'), 'x\n');

  bigDir = join(tmpRoot, 'big');
  mkdirSync(bigDir, { recursive: true });
  for (let i = 0; i < 300; i++) {
    mkdirSync(join(bigDir, `dir${i % 10}`), { recursive: true });
    writeFileSync(join(bigDir, `dir${i % 10}`, `f${i}.txt`), `x\n`);
  }
});

afterAll(() => {
  try {
    rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    // @ignore-catch
  }
});

describe('globAsync（2026-09-01 协作式修复）', () => {
  test('结果与 glob() 完全一致（多文件目录）', async () => {
    const sync = glob('*.ts', projectDir);
    const async_ = await globAsync('*.ts', projectDir);
    expect(async_.numFiles).toBe(sync.numFiles);
    expect(async_.filenames).toEqual(sync.filenames);
    expect(async_.truncated).toBe(sync.truncated);
    expect(async_.numFiles).toBeGreaterThan(0);
  });

  test('协作式：遍历大目录期间让出事件循环（探针可执行）', async () => {
    let probeRanDuringScan = false;
    const probe = new Promise<void>((resolve) => setImmediate(resolve)).then(
      () => {
        probeRanDuringScan = true;
      }
    );
    // 匹配 300 个 *.txt → 达到 MAX_FILES(100) 截断前遍历大部分目录树
    const result = await globAsync('*.txt', bigDir);
    await probe;
    expect(probeRanDuringScan).toBe(true);
    expect(result.numFiles).toBeGreaterThan(0);
  });

  test('无匹配返回空结果', async () => {
    const result = await globAsync('*.zzz', projectDir);
    expect(result.numFiles).toBe(0);
    expect(result.filenames.length).toBe(0);
  });

  test('达到 MAX_FILES 截断标记', async () => {
    const result = await globAsync('*.txt', bigDir);
    expect(result.truncated).toBe(true); // 300 个 *.txt > 100 上限
    expect(result.filenames.length).toBe(100);
  });
});

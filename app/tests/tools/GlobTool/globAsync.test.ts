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
import { basename, join } from 'path';
import { glob, globAsync } from '../../../src/tools/GlobTool/GlobTool';

let tmpRoot: string;
let projectDir: string;
let bigDir: string;
let dotDir: string;

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

  // D10（台账 O29）点号条目样例：隐藏文件 / 隐藏目录 / VCS 目录
  dotDir = join(tmpRoot, 'dot');
  mkdirSync(join(dotDir, '.hidden'), { recursive: true });
  mkdirSync(join(dotDir, '.git'), { recursive: true });
  mkdirSync(join(dotDir, '.github', 'workflows'), { recursive: true });
  writeFileSync(join(dotDir, '.env'), 'JWT_SECRET=leak\n');
  writeFileSync(join(dotDir, '.env.example'), 'JWT_SECRET=\n');
  writeFileSync(join(dotDir, '.gitignore'), 'node_modules\n');
  writeFileSync(join(dotDir, '.foo.ts'), 'x\n');
  writeFileSync(join(dotDir, 'visible.ts'), 'x\n');
  writeFileSync(join(dotDir, '.hidden', 'cfg.ts'), 'x\n');
  writeFileSync(join(dotDir, '.git', 'config'), 'x\n');
  writeFileSync(join(dotDir, '.github', 'workflows', 'ci.yml'), 'x\n');
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

describe('点号条目（隐藏文件/目录）语义 —— 台账 O29 / 计划 D10', () => {
  test('显式点号模式能命中隐藏文件（修复前恒为空）', async () => {
    const names = (await globAsync('.env*', dotDir)).filenames.map((p) =>
      basename(p)
    );
    expect(names).toContain('.env');
    expect(names).toContain('.env.example');
  });

  test('`**/.env*` 同样命中（跨段通配 + 点号段）', async () => {
    const names = (await globAsync('**/.env*', dotDir)).filenames.map((p) =>
      basename(p)
    );
    expect(names).toContain('.env');
  });

  test('未显式请求点号时不返回隐藏文件（保持 dot:false 语义）', async () => {
    const names = (await globAsync('*.ts', dotDir)).filenames.map((p) =>
      basename(p)
    );
    expect(names).toContain('visible.ts');
    expect(names).not.toContain('.foo.ts');
    expect(names).not.toContain('cfg.ts'); // .hidden/ 是隐藏目录，未被遍历
  });

  test('显式请求隐藏目录时可下钻', async () => {
    const names = (await globAsync('.hidden/*.ts', dotDir)).filenames.map((p) =>
      basename(p)
    );
    expect(names).toContain('cfg.ts');
  });

  test('`.*` 命中隐藏文件但不泄漏 .git 内部文件', async () => {
    const found = (await globAsync('.*', dotDir)).filenames;
    expect(found.map((p) => basename(p))).toContain('.gitignore');
    expect(found.some((p) => p.replace(/\\/g, '/').includes('.git/'))).toBe(
      false
    );
  });

  test('同步 glob() 与 globAsync() 结果一致（点号语义）', async () => {
    const sync = glob('.env*', dotDir);
    const async_ = await globAsync('.env*', dotDir);
    expect(async_.filenames).toEqual(sync.filenames);
    expect(async_.numFiles).toBeGreaterThan(0);
  });
});

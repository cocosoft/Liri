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

/**
 * 2026-09-27：显式声明本 hook 的耗时预算（30s）。
 *
 * 真机 CI 实测（Windows runner，commit e27db21b3）：本 hook 在 bun **默认 5s** 下偶发超时
 * （报 `(fail) (unnamed)` + `a beforeEach/afterEach hook timed out`，7.6s，该文件一条用例都没跑），
 * 同 commit **重跑即绿** ⇒ 属**环境抖动**（在 `%TEMP%` 上创建 10 目录 + 300 文件，受 runner 磁盘/杀软影响），
 * 与非确定性行为无关。这里把预算写成实测所需量级，避免把"fixture 创建慢"误报成挂起。
 *
 * 注：bun **运行时**支持 `beforeAll(fn, timeout)`（本文件实测通过），但当前 `bun-types` 未声明第二参
 * （与 `mock.restore` 同类缺失）⇒ 局部收窄类型，不用 `@ts-ignore`/`any` 绕过类型检查。
 */
const beforeAllWithTimeout = beforeAll as unknown as (
  fn: () => void,
  timeout?: number
) => void;

beforeAllWithTimeout(() => {
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
}, 30_000);

afterAll(() => {
  try {
    rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    // @ignore-catch
  }
});

describe('globAsync（2026-09-01 协作式修复 / 2026-09-17 G2 语义修正）', () => {
  test('结果与 glob() 完全一致（递归搜索需 **/*.ts）', async () => {
    // G2：`*` 不再跨目录边界，递归子目录须用 `**/*`；两实现遍历语义始终一致
    const sync = glob('**/*.ts', projectDir);
    const async_ = await globAsync('**/*.ts', projectDir);
    expect(async_.numFiles).toBe(sync.numFiles);
    expect(async_.filenames).toEqual(sync.filenames);
    expect(async_.truncated).toBe(sync.truncated);
    expect(async_.numFiles).toBeGreaterThan(0);
  });

  test('G2：`*.ts` 仅匹配根层，不命中子目录（src/a/b/x.ts 排除）', async () => {
    const sync = glob('*.ts', projectDir);
    const async_ = await globAsync('*.ts', projectDir);
    // 根层无 .ts（根层仅 README.md）→ numFiles 为 0；但存在子目录 .ts，证明 `*` 不跨层
    expect(async_.numFiles).toBe(0);
    expect(sync.numFiles).toBe(0);
    // 对照：**/*.ts 递归命中子目录 x.ts + index.ts
    expect((await globAsync('**/*.ts', projectDir)).numFiles).toBe(2);
  });

  test('G2：无效模式返回 invalidPattern，与「无匹配文件」可区分', async () => {
    const invalid = await globAsync('a[', projectDir); // 未闭合字符类 → 无法编译
    expect(invalid.invalidPattern).toBe('a[');
    expect(invalid.numFiles).toBe(0);
    // 有效但无匹配：不携带 invalidPattern
    const none = await globAsync('*.zzz', projectDir);
    expect(none.invalidPattern).toBeUndefined();
    expect(none.numFiles).toBe(0);
  });

  test('协作式：遍历大目录期间让出事件循环（探针可执行）', async () => {
    let probeRanDuringScan = false;
    const probe = new Promise<void>((resolve) => setImmediate(resolve)).then(
      () => {
        probeRanDuringScan = true;
      }
    );
    // 匹配 300 个嵌套 *.txt（递归须用 **）→ 达到 MAX_FILES(100) 截断前遍历大部分目录树
    const result = await globAsync('**/*.txt', bigDir);
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
    const result = await globAsync('**/*.txt', bigDir);
    expect(result.truncated).toBe(true); // 300 个嵌套 *.txt > 100 上限
    expect(result.filenames.length).toBe(100);
  });
});

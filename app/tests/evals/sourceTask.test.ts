/**
 * A7（2026-09-26，《Liri 优化方案》）：**题目来源自动化**（把本仓代码库变成任务源）。
 *
 * 锁五件事：
 *  ① **候选发现**基于真实扫描（且"零运行时 import"这条资格线在真实结果上成立）；
 *  ② **起始点桩**由签名机械生成（无法提取签名 ⇒ 返回 null，绝不猜）；
 *  ③ **端到端自检**用**真实执行**：原始实现 5/5 成功、起始点 0 成功（"起点确实缺失"）；
 *  ④ **生成的题目有区分度**：原实现通过、错实现不通过、起始点不通过（离线 A/B，无需模型）；
 *  ⑤ **拒绝分支**：原始实现用例失败 / 无法提取签名 / 起始点已满足 ⇒ 一律 `rejected` 且给原因。
 */
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'bun:test';
import {
  bunCasesRunner,
  buildSourceTask,
  discoverSourceCandidates,
  resolveEvalRepoRoot,
  scanSourceLeaks,
  stubFromSource,
  type TsCasesRunner,
} from '../../src/evals/sourceTask';
import { sourceTaskSpecs } from '../../src/evals/tasks/source-derived';
import type {
  EvalContext,
  SourceCaseResult,
  SourceTaskSpec,
} from '../../src/evals/types';

const root = resolveEvalRepoRoot();
const scratchRoots: string[] = [];

function scratch(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratchRoots.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of scratchRoots) rmSync(dir, { recursive: true, force: true });
});

/** 零动作上下文（断言只用 workspace / runner） */
function ctxFor(workspace: string): EvalContext {
  return {
    workspace,
    home: join(workspace, 'home'),
    dataDir: join(workspace, 'data'),
    finalText: '',
    toolCalls: [],
    sessionId: 'source-task-test',
    model: 'n/a',
  };
}

const SAMPLE = 'app/src/chat/services/bareExplorationStripper.ts';
const SAMPLE_EXPORT = 'stripBareExploration';

describe('A7: 候选发现（真实扫描，非 mock）', () => {
  it('扫到本仓纯函数样本，且"零运行时 import"在真实结果上成立', () => {
    const candidates = discoverSourceCandidates(root);
    const hit = candidates.find((c) => c.path === SAMPLE);

    expect(hit).toBeDefined();
    expect(hit?.exports).toContain(SAMPLE_EXPORT);
    expect(candidates.length).toBeGreaterThan(50);

    // 资格线自证：逐条回读真实文件，确认**没有**运行时 import（不是只在过滤器里"声称"）
    for (const candidate of candidates) {
      const source = readFileSync(join(root, candidate.path), 'utf-8');
      const runtimeImports = source
        .split('\n')
        .filter(
          (line) =>
            /^\s*import\b/.test(line) &&
            !/^\s*import\s+type\b/.test(line) &&
            !/^\s*import\s*\{\s*type\b/.test(line)
        );
      expect(runtimeImports).toEqual([]);
    }
  });

  it('目录不存在时返回空（不臆造候选）', () => {
    expect(
      discoverSourceCandidates(root, ['app/src/definitely-not-here'])
    ).toEqual([]);
  });
});

describe('A7: 起始点桩由签名机械生成', () => {
  it('真实样本：保留签名、实现体换成抛错、且零 import', () => {
    const source = readFileSync(join(root, SAMPLE), 'utf-8');
    const stub = stubFromSource(source, SAMPLE_EXPORT);

    expect(stub).not.toBeNull();
    expect(stub).toContain(
      `export function ${SAMPLE_EXPORT}(content: string): string {`
    );
    expect(stub).toContain('throw new Error');
    expect(stub?.split('\n').some((l) => /^\s*import\b/.test(l))).toBe(false);
  });

  it('无法机械提取签名（箭头函数形式）⇒ 返回 null，绝不猜', () => {
    expect(
      stubFromSource('export const add = (a: number) => a + 1;\n', 'add')
    ).toBeNull();
  });

  it('返回类型是**内联对象字面量**时桩仍可运行并以 Not implemented 收场（曾生成不可解析的桩）', async () => {
    const dir = scratch('a7-stub-inline-object-');
    const src =
      'export function f(input: string): {\n  name: string;\n  args: string;\n} {\n' +
      '  return { name: input, args: "" };\n}\n';
    const stub = stubFromSource(src, 'f');

    expect(stub).not.toBeNull();
    expect(stub).toContain(
      'export function f(input: string): {\n  name: string;\n  args: string;\n} {'
    );

    // 关键：把它**真的跑起来**——修复前这里拿到的是"启动器失败（error: Backtrack）"，
    // 即桩语法错误；而自检会把这种失败当成"起始态已失败"⇒ 坏题静默放过。
    writeFileSync(join(dir, 'stub.ts'), stub!, 'utf-8');
    const got = await bunCasesRunner({
      implPath: join(dir, 'stub.ts'),
      exportName: 'f',
      cases: [{ name: 'x', args: ['a'] }],
    });

    expect(got[0].ok).toBe(false);
    expect(got[0].error).toBe('Not implemented');
  }, 30_000);

  it('泛型实参里的内联类型花括号同样不被误认为函数体', () => {
    const stub = stubFromSource(
      'export function g(): Promise<{ a: string }> {\n  throw new Error("x");\n}\n',
      'g'
    );
    expect(stub).toContain('export function g(): Promise<{ a: string }> {');
    expect(stub).toContain('Not implemented');
  });
});

describe('A7: 端到端自检（真实执行原始实现 + 真实执行桩）', () => {
  it('样本规格 ⇒ ready；golden 全成功、起始点 0 成功、泄漏面报出仓库内原件', async () => {
    const spec = sourceTaskSpecs[0];
    const { build, task } = await buildSourceTask(spec, { root });

    expect(build.status).toBe('ready');
    expect(build.reasons).toEqual([]);
    expect(build.goldens).toHaveLength(spec.cases.length);
    expect(build.goldens.every((g) => g.ok)).toBe(true);
    expect(build.stub.every((s) => !s.ok)).toBe(true);
    expect(task).toBeDefined();

    const repoLeak = build.leaks.find((l) => l.kind === 'repo-source');
    expect(repoLeak?.path.replace(/\\/g, '/').endsWith('/' + SAMPLE)).toBe(
      true
    );
  }, 30_000);
});

describe('A7: 生成的题目有区分度（离线 A/B，无需模型）', () => {
  it('原实现 ⇒ 通过；错实现 ⇒ 不通过；起始点 ⇒ 不通过', async () => {
    const spec = sourceTaskSpecs[0];
    const { task } = await buildSourceTask(spec, { root });
    expect(task).toBeDefined();

    const originalSource = readFileSync(join(root, SAMPLE), 'utf-8');
    const ws = join(scratch('a7-task-'), 'ws');
    mkdirSync(join(ws, 'eval_out'), { recursive: true });
    const impl = join(ws, 'eval_out', 'impl.ts');
    const ctx = ctxFor(ws);

    // ① 参考解 = 原始实现（机械取自仓库，不是另外手写的"正确实现"）
    writeFileSync(impl, originalSource, 'utf-8');
    expect(await task!.assert(ctx)).toEqual({ pass: true });

    // ② 错误实现：原样返回输入（看似合理，但两处"应剥离"的用例会露馅）
    writeFileSync(
      impl,
      `export function ${SAMPLE_EXPORT}(content: string): string {\n  return content;\n}\n`,
      'utf-8'
    );
    const wrong = await task!.assert(ctx);
    expect(wrong.pass).toBe(false);
    expect(wrong.reason).toContain('输出不符');

    // ③ 起始点（未实现）不得通过
    writeFileSync(
      impl,
      stubFromSource(originalSource, SAMPLE_EXPORT)!,
      'utf-8'
    );
    const stubVerdict = await task!.assert(ctx);
    expect(stubVerdict.pass).toBe(false);
    expect(stubVerdict.reason).toContain('执行失败');
  }, 60_000);
});

describe('A7: 拒绝分支（不静默放过）', () => {
  it('原始实现有用例执行失败 ⇒ rejected（无法建立 golden）', async () => {
    const dir = scratch('a7-reject-boom-');
    writeFileSync(
      join(dir, 'boom.ts'),
      "export function boom(): number {\n  throw new Error('分支性失败');\n}\n",
      'utf-8'
    );
    const spec: SourceTaskSpec = {
      id: 'reject-boom',
      name: 'reject-boom',
      sourcePath: 'boom.ts',
      exportName: 'boom',
      behavior: ['（测试夹具）'],
      cases: [{ name: 'always-throws', args: [] }],
    };
    const { build, task } = await buildSourceTask(spec, { root: dir });

    expect(build.status).toBe('rejected');
    expect(task).toBeUndefined();
    expect(build.reasons.join('｜')).toContain('无法建立 golden');
  }, 30_000);

  it('无法机械提取签名 ⇒ rejected', async () => {
    const dir = scratch('a7-reject-arrow-');
    writeFileSync(
      join(dir, 'arrow.ts'),
      'export const add = (a: number) => a + 1;\n',
      'utf-8'
    );
    const spec: SourceTaskSpec = {
      id: 'reject-arrow',
      name: 'reject-arrow',
      sourcePath: 'arrow.ts',
      exportName: 'add',
      behavior: ['（测试夹具）'],
      cases: [{ name: 'one', args: [1] }],
    };
    const { build } = await buildSourceTask(spec, { root: dir });

    expect(build.status).toBe('rejected');
    expect(build.reasons.join('｜')).toContain('无法从源文件机械提取');
  }, 30_000);

  it('起始点已通过用例 ⇒ rejected（题目无区分度）', async () => {
    const dir = scratch('a7-reject-indistinct-');
    writeFileSync(
      join(dir, 'same.ts'),
      'export function same(x: number): number {\n  return x;\n}\n',
      'utf-8'
    );
    const spec: SourceTaskSpec = {
      id: 'reject-indistinct',
      name: 'reject-indistinct',
      sourcePath: 'same.ts',
      exportName: 'same',
      behavior: ['（测试夹具）'],
      cases: [{ name: 'one', args: [1] }],
    };
    // 假执行器：原始实现与桩**返回相同** ⇒ 必须被"无区分度"拒绝（该分支无法用真实桩触发：
    // 真桩一律抛错，故这里注入假执行器以确定性覆盖判据）
    const fakeRunner: TsCasesRunner = async ({ cases }) =>
      cases.map((c) => ({ name: c.name, ok: true, value: c.args[0] }));
    const { build } = await buildSourceTask(spec, {
      root: dir,
      runner: fakeRunner,
    });

    expect(build.status).toBe('rejected');
    expect(build.reasons.join('｜')).toContain('无区分度');
  });

  it('桩不可运行（启动器/解析失败）⇒ rejected（不把解析失败当成"起始态已失败"）', async () => {
    const dir = scratch('a7-reject-broken-stub-');
    writeFileSync(
      join(dir, 'f.ts'),
      'export function f(x: number): number {\n  return x;\n}\n',
      'utf-8'
    );
    const spec: SourceTaskSpec = {
      id: 'reject-broken-stub',
      name: 'reject-broken-stub',
      sourcePath: 'f.ts',
      exportName: 'f',
      behavior: ['（测试夹具）'],
      cases: [{ name: 'one', args: [1] }],
    };
    // 假执行器：第 1 次（原始实现）正常返回；第 2 次（桩）一律给"启动器失败"——
    // 模拟"桩语法错误"这一真实故障（该分支无法用真实桩触发：真桩现在保证可解析）
    let call = 0;
    const fakeRunner: TsCasesRunner = async ({ cases }) => {
      call += 1;
      return call === 1
        ? cases.map((c) => ({ name: c.name, ok: true, value: c.args[0] }))
        : cases.map((c) => ({
            name: c.name,
            ok: false,
            error: '启动器失败：Command failed',
          }));
    };
    const { build } = await buildSourceTask(spec, {
      root: dir,
      runner: fakeRunner,
    });

    expect(build.status).toBe('rejected');
    expect(build.reasons.join('｜')).toContain('未按预期运行');
  });
});

describe('A7: 执行器 fail-closed 与泄漏扫描的诚实性', () => {
  it('实现文件不存在 ⇒ 每条用例都记失败（不返回空数组）', async () => {
    const cases = [
      { name: 'a', args: [] },
      { name: 'b', args: [] },
    ];
    const got: SourceCaseResult[] = await bunCasesRunner({
      implPath: join(scratch('a7-missing-'), 'nope.ts'),
      exportName: 'missing',
      cases,
    });

    expect(got).toHaveLength(cases.length);
    expect(got.every((r) => !r.ok)).toBe(true);
  }, 30_000);

  it('源文件不存在时**不**报 repo-source（不臆造泄漏面）', () => {
    const leaks = scanSourceLeaks(
      root,
      'app/src/chat/services/definitely-not-here.ts'
    );
    expect(leaks.filter((l) => l.kind === 'repo-source')).toEqual([]);
  });
});

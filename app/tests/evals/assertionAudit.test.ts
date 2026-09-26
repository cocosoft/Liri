/**
 * A6（2026-09-26，《Liri 优化方案》）：**断言反向验证**（agent 检查器自检）。
 *
 * 锁四件事：
 *  ① **对照组**：`identical` 变形必须通过 —— 否则该报的是"基准解不合规"，不是"过度约束"；
 *  ② **能抓过度约束**：断言做**精确相等**时，尾随换行/CRLF/行尾空格/前置空行等**语义等价**的
 *     变形会让它失败 ⇒ 标为过度约束（这正是论文 §3.2 的"答案未支持的约束"）；
 *  ③ **不适用即跳过**（`json-key-order` 遇到非 JSON 内容）⇒ 记为 `inapplicable` 而**不**判失败；
 *  ④ **未声明参考解的题不参与**（`skipped`，不判失败）—— 不凭空编基准。
 */
import { mkdtempSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'bun:test';
import { auditAssertions } from '../../src/evals/assertionAudit';
import type { EvalTask, EquivalentVariantKind } from '../../src/evals/types';

const root = mkdtempSync(join(tmpdir(), 'a6-audit-'));
const ctx = {
  workspace: join(root, 'ws'),
  home: join(root, 'home'),
  dataDir: join(root, 'data'),
};
mkdirSync(ctx.workspace, { recursive: true });
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** 造一个"读产物文件"的任务；`assertImpl` 决定断言严格程度 */
function taskWith(
  id: string,
  reference: string,
  assertImpl: (content: string) => { pass: boolean; reason?: string },
  variants?: EquivalentVariantKind[]
): EvalTask {
  return {
    id,
    name: id,
    level: 'L2',
    assertionPolarity: 'positive',
    prompt: () => `task ${id}`,
    assertionAudit: {
      artifacts: [{ path: 'out.txt', content: reference }],
      ...(variants ? { variants } : {}),
    },
    async assert() {
      const content = readFileSync(join(ctx.workspace, 'out.txt'), 'utf-8');
      return assertImpl(content);
    },
  };
}

describe('A6: 宽容断言 ⇒ 全部等价变形通过', () => {
  it('includes 式断言：5 个变形全过、json-key-order 不适用被跳过', async () => {
    const task = taskWith('t-tolerant', '标题\n下一步：补充测试\n', (c) => ({
      pass: c.includes('下一步'),
    }));
    const report = await auditAssertions([task], ctx);

    expect(report.audited).toEqual(['t-tolerant']);
    expect(report.findings).toEqual([]);
    // 6 种内置变形 − 1 种不适用（json-key-order 对非 JSON 返回 null）
    expect(report.checks).toBe(5);
    expect(report.inapplicable).toEqual([
      { taskId: 't-tolerant', variant: 'json-key-order', artifact: 'out.txt' },
    ]);
  });
});

describe('A6: 能抓"过度约束"（精确相等断言）', () => {
  it('精确相等 ⇒ 尾随换行/CRLF/行尾空格/前置空行都失败，而 identical 通过', async () => {
    const reference = '标题\n下一步：补充测试\n';
    const task = taskWith('t-strict', reference, (c) => ({
      pass: c === reference,
      reason: `期望与参考解完全一致，实际长度 ${c.length}`,
    }));
    const report = await auditAssertions([task], ctx);

    const failed = report.findings.map((f) => f.variant).sort();
    expect(failed).toEqual(
      ['crlf', 'leading-blank-line', 'trailing-spaces'].sort()
    );
    // 对照组通过 ⇒ 结论是"断言过严"，不是"基准解不合规"
    expect(report.findings.some((f) => f.variant === 'identical')).toBe(false);
    expect(report.findings[0].reason).toContain('完全一致');
  });

  it('可只跑指定变形（variants 过滤）', async () => {
    const reference = 'x\n';
    const task = taskWith(
      't-pick',
      reference,
      (c) => ({ pass: c === reference }),
      ['identical', 'crlf']
    );
    const report = await auditAssertions([task], ctx);

    expect(report.checks).toBe(2);
    expect(report.findings.map((f) => f.variant)).toEqual(['crlf']);
  });
});

describe('A6: 基准解不合规时优先暴露对照组', () => {
  it('参考解与断言不一致 ⇒ identical 也失败（提示先排查基准解）', async () => {
    const task = taskWith('t-bad-ref', 'A', (c) => ({
      pass: c.includes('B'),
      reason: '未包含 B',
    }));
    const report = await auditAssertions([task], ctx);

    expect(report.findings.some((f) => f.variant === 'identical')).toBe(true);
  });
});

describe('A6: json-key-order 只对 JSON 对象适用', () => {
  it('JSON 对象 ⇒ 键序反转后仍通过且不算不适用', async () => {
    const reference = JSON.stringify({ a: 1, b: 2 });
    const task = taskWith('t-json', reference, (c) => {
      const parsed = JSON.parse(c) as Record<string, number>;
      return { pass: parsed.a === 1 && parsed.b === 2 };
    });
    const report = await auditAssertions([task], ctx);

    expect(report.findings).toEqual([]);
    expect(report.checks).toBe(6);
    expect(report.inapplicable).toEqual([]);
  });
});

describe('A6: 未声明参考解 ⇒ 不参与（不判失败）', () => {
  it('无 assertionAudit 的题进 skipped', async () => {
    const plain: EvalTask = {
      id: 't-plain',
      name: 't-plain',
      level: 'L1',
      assertionPolarity: 'positive',
      prompt: () => '',
      assert: async () => ({ pass: true }),
    };
    const report = await auditAssertions([plain], ctx);

    expect(report.skipped).toEqual(['t-plain']);
    expect(report.audited).toEqual([]);
    expect(report.findings).toEqual([]);
    expect(report.checks).toBe(0);
  });
});

describe('A6: 多产物部分不适用 ⇒ 整条变形跳过（逐产物记账）', () => {
  it('一个产物是 JSON、另一个不是 ⇒ json-key-order 记 inapplicable 且不执行该变形', async () => {
    const task: EvalTask = {
      id: 't-mixed',
      name: 't-mixed',
      level: 'L2',
      assertionPolarity: 'positive',
      prompt: () => '',
      assertionAudit: {
        artifacts: [
          { path: 'data.json', content: JSON.stringify({ a: 1, b: 2 }) },
          { path: 'note.txt', content: 'x\n' },
        ],
      },
      assert: async () => ({ pass: true }),
    };
    const report = await auditAssertions([task], ctx);

    // json-key-order 对 note.txt 不适用 ⇒ 该变形整体不执行 ⇒ 6−1=5 次
    expect(report.checks).toBe(5);
    expect(report.inapplicable).toEqual([
      { taskId: 't-mixed', variant: 'json-key-order', artifact: 'note.txt' },
    ]);
  });
});

describe('A6: 变形之间不互相污染', () => {
  it('每个变形读到的都是**本次**写入的内容（逐变形比对原样）', async () => {
    const reference = 'ab\n';
    const seen: string[] = [];
    const task = taskWith('t-fresh', reference, (c) => {
      seen.push(c);
      return { pass: true };
    });
    await auditAssertions([task], ctx);

    // 顺序 = EQUIVALENT_VARIANTS；`json-key-order` 对非 JSON 不适用 ⇒ 不执行（故 5 条）
    expect(seen).toEqual(['ab\n', 'ab\n', 'ab\r\n', 'ab \n', '\nab\n']);
  });
});

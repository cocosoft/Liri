/**
 * 学习种子 → evals 语料（M3，2026-11-15）
 *
 * 钉住四件事：
 * ① **跳过规则**：已撤销 / 无 `expectation` / 无 `input` 一律不成题（不编造判据）；
 * ② **确定性**：可成题与跳过清单都按 id 升序（落盘可 diff）；
 * ③ **判据口径**：L1「回答包含期望片段」（空白归一后逐字比对），不做语义相似度；
 * ④ **fail-closed**：语料文件存在但不是数组 ⇒ 抛出（不静默退化成空题集）。
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';

import type { EvalContext } from '@modules/evals/types';
import {
  buildLearningCaseTasks,
  learningCaseTaskId,
  loadLearningCaseRecords,
  normalizeCaseText,
  selectLearningCaseRecords,
  toLearningCaseTask,
  LEARNING_CASE_TASK_PREFIX,
  type LearningCaseRecord,
} from '@modules/evals/tasks/learning-cases';

/** 种子（默认可成题：有 input + expectation） */
function seed(over: Partial<LearningCaseRecord> = {}): LearningCaseRecord {
  return {
    id: 'abc123',
    sessionId: 's1',
    turnNumber: 3,
    category: 'tool_failure',
    score: 0.3,
    input: '为什么构建失败了？',
    expectation: 'EACCES',
    ...over,
  };
}

/** 最小断言上下文（本模块只读 `finalText`） */
function ctx(finalText: string): EvalContext {
  return {
    workspace: '',
    home: '',
    dataDir: '',
    finalText,
    toolCalls: [],
    sessionId: 's1',
    model: 'test',
  };
}

describe('selectLearningCaseRecords（跳过规则 + 确定性）', () => {
  it('三类跳过：已撤销 / 无期望 / 无输入，其余按 id 升序', () => {
    const { eligible, skipped } = selectLearningCaseRecords([
      seed({ id: 'b2', expectation: 'OK' }),
      seed({ id: 'a1', expectation: 'OK' }),
      seed({ id: 'r1', revokedAt: 100 }),
      seed({ id: 'e1', expectation: '   ' }),
      seed({ id: 'i1', input: null }),
    ]);
    expect(eligible.map((r) => r.id)).toEqual(['a1', 'b2']);
    expect(skipped.map((s) => `${s.id}:${s.reason}`)).toEqual([
      'e1:no-expectation',
      'i1:no-input',
      'r1:revoked',
    ]);
  });

  it('撤销优先于缺期望（同一行只报一个原因）', () => {
    const { skipped } = selectLearningCaseRecords([
      seed({ id: 'x', revokedAt: 1, expectation: null }),
    ]);
    expect(skipped).toEqual([{ id: 'x', reason: 'revoked' }]);
  });

  it('空输入/空期望的空白串等同缺失', () => {
    const { eligible } = selectLearningCaseRecords([
      seed({ id: 'w1', input: '   ' }),
    ]);
    expect(eligible).toHaveLength(0);
  });
});

describe('toLearningCaseTask（L1 断言口径）', () => {
  it('id 带前缀、L1/positive、提示词取 input', () => {
    const task = toLearningCaseTask(seed());
    expect(task.id).toBe(`${LEARNING_CASE_TASK_PREFIX}abc123`);
    expect(task.id).toBe(learningCaseTaskId('abc123'));
    expect(task.level).toBe('L1');
    expect(task.assertionPolarity).toBe('positive');
    expect(task.prompt('/ws')).toBe('为什么构建失败了？');
  });

  it('回答包含期望片段 ⇒ 通过；空白差异不影响（归一后比对）', async () => {
    const task = toLearningCaseTask(seed({ expectation: 'Permission denied' }));
    const pass = await task.assert(
      ctx('结果： Permission   denied  \n（Bash）')
    );
    expect(pass.pass).toBe(true);

    const fail = await task.assert(ctx('命令执行成功'));
    expect(fail.pass).toBe(false);
    expect(String(fail.reason)).toContain('Permission denied');
  });

  it('normalizeCaseText 只压空白（不改大小写/标点）', () => {
    expect(normalizeCaseText('  A  B\tC\nD ')).toBe('A B C D');
    expect(normalizeCaseText('OK')).not.toBe(normalizeCaseText('ok'));
  });
});

describe('buildLearningCaseTasks / loadLearningCaseRecords', () => {
  it('build：可成题 ↔ 题集一一对应，跳过清单随行', () => {
    const { tasks, skipped } = buildLearningCaseTasks([
      seed({ id: 'p1' }),
      seed({ id: 'p2', revokedAt: 9 }),
    ]);
    expect(tasks.map((t) => t.id)).toEqual([learningCaseTaskId('p1')]);
    expect(skipped).toEqual([{ id: 'p2', reason: 'revoked' }]);
  });

  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('语料文件不存在 ⇒ 空数组（尚未物料化属正常态）', () => {
    dir = mkdtempSync(join(tmpdir(), 'learn-eval-'));
    expect(loadLearningCaseRecords(join(dir, 'missing.json'))).toEqual([]);
  });

  it('语料文件是数组 ⇒ 原样读出', () => {
    dir = mkdtempSync(join(tmpdir(), 'learn-eval-'));
    const file = join(dir, 'learning-cases.json');
    writeFileSync(file, JSON.stringify([seed({ id: 'z9' })]), 'utf-8');
    expect(loadLearningCaseRecords(file).map((r) => r.id)).toEqual(['z9']);
  });

  it('语料文件不是数组 ⇒ 抛出（不静默退化为空题集）', () => {
    dir = mkdtempSync(join(tmpdir(), 'learn-eval-'));
    const file = join(dir, 'learning-cases.json');
    writeFileSync(file, '{"tasks":[]}', 'utf-8');
    expect(() => loadLearningCaseRecords(file)).toThrow('格式非法');
  });
});

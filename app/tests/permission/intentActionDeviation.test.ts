/**
 * 语义护栏「便宜版」· 意图-动作偏离（演进方案 §1.4 / §3 W5）
 *
 * 锁住「宁漏勿误」的四条口径：
 *  ① 只读意图 + 变更动作 ⇒ **偏离**；
 *  ② 混合意图（"分析并修复"）⇒ 变更词优先，**不判**；
 *  ③ 只读意图 + 只读动作（含只读 shell 命令）⇒ **不判**；
 *  ④ 目标文本缺失 / 过短 ⇒ **不判**（没有意图就不谈偏离）。
 */
import { describe, expect, it } from 'bun:test';

import {
  classifyAction,
  classifyIntent,
  detectIntentActionDeviation,
} from '../../src/utils/toolContract/intentActionDeviation.js';

describe('classifyIntent：意图分类', () => {
  it('只读词命中且无变更词 ⇒ read-only（中英文）', () => {
    expect(classifyIntent('帮我看看这个文件的实现')).toBe('read-only');
    expect(classifyIntent('总结一下这个模块的职责')).toBe('read-only');
    expect(classifyIntent('show me the config file')).toBe('read-only');
  });

  it('变更词优先（"分析并修复" ⇒ mutate，不误判只读）', () => {
    expect(classifyIntent('分析这个 bug 并修复它')).toBe('mutate');
    expect(classifyIntent('检查一下并更新文档')).toBe('mutate');
    expect(classifyIntent('review and fix the failing test')).toBe('mutate');
  });

  it('无关键词 / 过短 ⇒ unknown（不判）', () => {
    expect(classifyIntent('继续')).toBe('unclassified');
    expect(classifyIntent('')).toBe('unclassified');
    expect(classifyIntent(undefined)).toBe('unclassified');
  });
});

describe('classifyAction：动作分类', () => {
  it('写文件类工具 ⇒ mutate', () => {
    expect(classifyAction('file_write')).toBe('mutate');
    expect(classifyAction('replace_in_file')).toBe('mutate');
  });

  it('shell：只读命令 ⇒ read；变更命令 ⇒ mutate', () => {
    expect(classifyAction('bash', { command: 'ls -la' })).toBe('read');
    expect(classifyAction('bash', { command: 'git status' })).toBe('read');
    expect(classifyAction('bash', { command: 'rm -rf build' })).toBe('mutate');
    expect(classifyAction('bash', { command: 'git commit -m x' })).toBe(
      'mutate'
    );
    expect(classifyAction('bash', { command: 'echo hi > out.txt' })).toBe(
      'mutate'
    );
  });

  it('shell 读不到命令 ⇒ 按只读处理（宁漏勿误）', () => {
    expect(classifyAction('bash', {})).toBe('read');
  });

  it('普通读类工具 ⇒ read', () => {
    expect(classifyAction('read_file')).toBe('read');
  });
});

describe('detectIntentActionDeviation：偏离判定', () => {
  it('只读意图 + 写文件 ⇒ 偏离且带理由', () => {
    const result = detectIntentActionDeviation({
      goalText: '帮我查看一下这个配置',
      toolName: 'file_write',
      input: { path: 'a.ts', content: 'x' },
    });
    expect(result.deviated).toBe(true);
    expect(result.reason).toContain('意图-动作偏离');
  });

  it('只读意图 + 只读命令 ⇒ 不偏离', () => {
    expect(
      detectIntentActionDeviation({
        goalText: '看看当前目录有什么',
        toolName: 'bash',
        input: { command: 'ls' },
      }).deviated
    ).toBe(false);
  });

  it('混合意图（要修复）⇒ 不偏离', () => {
    expect(
      detectIntentActionDeviation({
        goalText: '分析并修复这个失败用例',
        toolName: 'file_write',
        input: { path: 'a.ts', content: 'x' },
      }).deviated
    ).toBe(false);
  });

  it('无目标文本 ⇒ 不偏离（不猜测）', () => {
    expect(
      detectIntentActionDeviation({ toolName: 'file_write' }).deviated
    ).toBe(false);
  });

  it('危险 shell 在只读意图下 ⇒ 偏离（rm）', () => {
    const result = detectIntentActionDeviation({
      goalText: '帮我看看磁盘占用',
      toolName: 'bash',
      input: { command: 'rm -rf /tmp/cache' },
    });
    expect(result.deviated).toBe(true);
  });
});

/**
 * P1-6（2026-09-25）：`/subagent-run status` 在**磁盘台账不可用**时必须降级而非崩溃。
 *
 * 背景（对标分析报告 §五 P1-6）：`AgentTool.getAgentStatus` 对磁盘故障是**明示抛出**
 * （刻意不伪装成 `not_found`，以免把环境故障说成"查无此 run"），但调用方**无任何降级** ——
 * 修复前 `handleAgentStatus` 直接 `await` ⇒ 磁盘故障时命令**直接崩溃**（未捕获异常穿透）。
 *
 * **覆盖边界（如实标注）**：本文件锁定**降级出口文案**（纯函数，修复前该函数不存在
 * ⇒ 用例必失败）。try/catch **接线**属静态接线，未在此做模块级模拟 ——
 * `mock.module` 是**进程级**替换，实测会跨测试文件泄漏（曾一次污染 73 例 AgentTool 用例），
 * 故本项目不采用该手法；接线由代码审查守护（`handleAgentStatus` 内 `try { status = await … }`）。
 */
import { describe, test, expect } from 'bun:test';
import { describeStatusQueryFailure } from '../../src/commands/tools/ai/agent';

describe('P1-6 状态查询降级出口', () => {
  test('文案含"查询失败"与原始错误，且**不含**"未找到"措辞（不把环境故障读成没有此 Agent）', () => {
    const msg = describeStatusQueryFailure(
      'agent-x',
      'SQLITE_CANTOPEN: unable to open database file'
    );

    expect(msg).toContain('状态查询失败');
    expect(msg).toContain('磁盘台账不可用');
    expect(msg).toContain('SQLITE_CANTOPEN');
    expect(msg).toContain('agent-x');
    // 关键：与"确实不存在"必须可区分
    expect(msg).not.toContain('Agent or task not found');
  });

  test('同一 id 的两种结论互不混同（查询失败 ≠ 未找到）', () => {
    const failure = describeStatusQueryFailure('same-id', 'disk down');

    expect(failure).not.toContain('Agent or task not found');
    expect(failure).toContain('已降级为内存/引擎视图');
    // 给出可执行的下一步（而非只说失败）
    expect(failure).toContain('~/.pyapp/data');
  });
});

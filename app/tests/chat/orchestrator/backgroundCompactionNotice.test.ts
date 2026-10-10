/**
 * P2-1n —— 后台压缩「水位状态块」构造契约测试（2026-10-10）。
 *
 * 依据：`.trae/specs/stream-message-flow-split.md` §5-P2-1n；实现见
 * `src/chat/orchestrator/streamMessageBackgroundCompaction.ts`。
 *
 * 锁定（项1，2026-08-13「后台预压缩」的前端可见性）：
 * 1. 水位 **未达 warn 阈值** ⇒ 返回 `null`（**不造无意义噪声状态块**）；
 * 2. 达到阈值 ⇒ 返回 `status / compaction / compacting` 状态块，文案含**四舍五入**后的水位百分比；
 * 3. `model` 缺省（`undefined`）⇒ 阈值取默认、窗口按缺省解析（**不抛错**）。
 *
 * ⚠️ **不用超大输入驱动"超水位"用例**（2026-10-10 实测教训）：全量套件上下文中 tiktoken 编码器
 * 已被其它测试加载 ⇒ 数百 KB 字符串会走 tiktoken 路径，**单测阻塞数分钟**（`bun test` 卡死、
 * `test:guarded` 超时）。改用模块提供的 **DI 缝** `estimateTokens` 注入确定性桩（P0-8）。
 */
import { describe, expect, it } from 'bun:test';

import { buildBackgroundCompactionNotice } from '../../../src/chat/orchestrator/streamMessageBackgroundCompaction.js';

/** 默认阈值 `default.warn` = 0.75；缺省窗口 = 128_000 ⇒ 96_000 tokens 恰为阈值线 */
const DEFAULT_MAX = 128_000;

describe('P2-1n 后台压缩水位状态块构造', () => {
  it('空消息 ⇒ 真实估算 0 ⇒ `null`（不造噪声块）', () => {
    const notice = buildBackgroundCompactionNotice({
      messages: [],
      model: undefined,
      sessionId: 's1',
    });
    expect(notice).toBeNull();
  });

  it('低水位（真实估算器，一条短消息）⇒ `null`', () => {
    const notice = buildBackgroundCompactionNotice({
      messages: [{ role: 'user', content: '你好' }],
      model: undefined,
      sessionId: 's1',
    });
    expect(notice).toBeNull();
  });

  it('注入估算 > 阈值 ⇒ 出 `status/compaction/compacting` 块，文案为四舍五入百分比', () => {
    const notice = buildBackgroundCompactionNotice({
      messages: [],
      model: undefined,
      sessionId: 's1',
      // 100000 / 128000 = 0.78125 ⇒ 78%
      estimateTokens: () => 100_000,
    });
    expect(notice).toEqual({
      type: 'status',
      statusType: 'compaction',
      phase: 'compacting',
      content: '上下文较长（78%），正在后台压缩历史...',
      sessionId: 's1',
    });
  });

  it('注入估算 < 阈值（0.75 线）⇒ `null`', () => {
    const belowThreshold = buildBackgroundCompactionNotice({
      messages: [],
      model: undefined,
      sessionId: 's1',
      estimateTokens: () => Math.floor(DEFAULT_MAX * 0.7), // 0.7 < 0.75
    });
    expect(belowThreshold).toBeNull();

    const atThreshold = buildBackgroundCompactionNotice({
      messages: [],
      model: undefined,
      sessionId: 's1',
      estimateTokens: () => Math.floor(DEFAULT_MAX * 0.75), // 恰在阈值线 ⇒ 出块（`>=`）
    });
    expect(atThreshold).not.toBeNull();
  });
});

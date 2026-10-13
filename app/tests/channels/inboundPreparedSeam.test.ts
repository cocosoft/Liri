/**
 * T1-9（通道治理 §2.4「入站 PREPARED 接缝」）源码守卫（2026-10-13）
 *
 * 为什么是源码守卫：`routeChannelMessage` 的依赖面极大（渠道/去重/限流/会话/LLM/出站/stub 十余个），
 * 端到端单测成本远超本接缝（**一行只读上报**）的价值；而本接缝的**唯一可证伪点**是
 * 「去重/帧验证通过后、进入 LLM 链路前**确有一次** `PREPARED` 只读上报」——
 * ⇒ 用**源码守卫**钉住接线（与 `tests/budget/sideChannelGuard.test.ts` 同法），
 *    并叠加对**投影载荷契约**的真实断言（见 `tests/execution/projectionBroadcast.test.ts`）。
 */
import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SRC = resolve(__dirname, '../../src/channels/routing/messageRouter.ts');

describe('T1-9 入站 PREPARED 只读接缝（源码守卫）', () => {
  const src = readFileSync(SRC, 'utf8');

  it('引用了四原语投影出口（复用既有 state 出口，不新建总线）', () => {
    expect(src).toContain('publishStateProjection');
    expect(src).toContain('state/engine/projectionBroker');
  });

  it('在 `routeChannelMessage` 内上报 `PREPARED`（domain=execution + sessionId）', () => {
    // 断言三要件同现（域 / 原语 / 会话键控）
    expect(src).toMatch(
      /publishStateProjection\(\{[\s\S]{0,200}domain:\s*'execution'[\s\S]{0,200}primitive:\s*'PREPARED'[\s\S]{0,200}sessionId:\s*sessionKey/
    );
  });

  it('接缝位置在「进入 LLM 链路」日志之前（= 去重/帧验证/限流通过后）', () => {
    const publishAt = src.indexOf("primitive: 'PREPARED'");
    const llmStageAt = src.indexOf(
      '阶段开始: llm (CoreAPI.chatStream 流式并轨)'
    );
    expect(publishAt).toBeGreaterThan(0);
    expect(llmStageAt).toBeGreaterThan(0);
    expect(publishAt).toBeLessThan(llmStageAt);
  });
});

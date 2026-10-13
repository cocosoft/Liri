/**
 * T1-6（通道治理 §1.3 收口）：**入站附件进入 R16 预留口径** —— 源码守卫（2026-10-13）
 *
 * 为什么是源码守卫：`routeChannelMessage` 的依赖面极大（渠道/去重/限流/会话/LLM/出站 + 十余个 stub），
 * 端到端单测成本远超本接线（**一次显式适配 + 一次求和**）的价值；本接线的**唯一可证伪点**是
 * 「通道附件**只以 `size`** 进入预算求和」—— ⇒ 用源码守卫钉住（与 `inboundPreparedSeam` 同法），
 * 并叠加对**求和语义**的真实断言（`estimateAttachmentsTokens` 双口径相加）。
 */
import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  estimateAttachmentsTokens,
  ATTACHMENT_BYTES_PER_TOKEN,
} from '../../src/query/attachmentBudget.js';

function read(rel: string): string {
  return readFileSync(resolve(__dirname, rel), 'utf8');
}

describe('T1-6 入站附件 → R16 预留口径（源码守卫 + 求和语义）', () => {
  it('渠道入站显式适配：只取 `size`，不携带 url/data（不构成模型可见输入）', () => {
    const src = read('../../src/channels/routing/messageRouter.ts');
    expect(src).toContain('attachmentSizes:');
    // 适配体只含 size（显式形状）
    expect(src).toMatch(/map\(\(a\) => \(\{\s*size: a\.size,/);
    // 不得把通道附件塞进多模态载体 `images`
    expect(src).not.toMatch(/images:\s*\(?message\.attachments/);
  });

  it('端口契约与会话选项均声明该入参（跨层显式适配，非类型互换）', () => {
    expect(
      read('../../src/channels/routing/messageRouterContract.ts')
    ).toContain('attachmentSizes?: readonly { size?: number }[]');
    expect(read('../../src/session/types/message/options.ts')).toContain(
      'attachmentSizes?: readonly { size?: number }[]'
    );
  });

  it('预算侧把 `images` 与 `attachmentSizes` **一并**计入预留', () => {
    const src = read('../../src/chat/orchestrator/preSendContextProtection.ts');
    expect(src).toMatch(
      /estimateAttachmentsTokens\(options\?\.images\)\s*\+\s*[\s\S]{0,200}estimateAttachmentsTokens\(options\?\.attachmentSizes\)/
    );
  });

  it('求和语义：两口径字节相加（保守下限 4 bytes/token）', () => {
    const images = [{ size: 400 }];
    const attachments = [{ size: 800 }, { size: 0 }, {}];
    const total =
      estimateAttachmentsTokens(images) +
      estimateAttachmentsTokens(attachments);
    expect(ATTACHMENT_BYTES_PER_TOKEN).toBe(4);
    expect(total).toBe(Math.ceil(400 / 4) + Math.ceil(800 / 4)); // 100 + 200（缺 size 按 0）
  });
});

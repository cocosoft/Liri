/**
 * BUG-08（2026-10-22，前端巡检衍生）：非流式 chat 的「供应商未就绪」响应契约
 *
 * 缺陷链：`getClientForModel()` 落空 ⇒ 静默回落默认供应商 ⇒ 上游 400 被折进正文
 * （HTTP 200 假成功）。修复后：
 *  - `AI_CRED_1001` 与预算一样**不折**（`ChatOrchestrator` 放行上抛）；
 *  - `buildChatErrorResponse` 带回 `errorMessage`；
 *  - `mapChatErrorResponse` 对 `AI_CRED_1001` 回显**可操作文案**（不再统一收口成通用 500 文案）。
 *
 * 本文件锁 HTTP 映射层契约（含"不泄露其它内部错误的 message"这条边界）。
 */
import { describe, it, expect } from 'bun:test';

import { mapChatErrorResponse } from '../../src/infrastructure/http/handlers/chat-handlers.js';

describe('mapChatErrorResponse：供应商未就绪（AI_CRED_1001）', () => {
  it('回显可操作文案 + 真实业务码（不再是通用「AI 服务返回错误」）', () => {
    const { status, body } = mapChatErrorResponse({
      errorCode: 'AI_CRED_1001',
      errorMessage:
        '供应商「智谱AI」当前不可用（API Key 未配置或供应商已停用），模型「glm-5.2」无法调用。请到「模型管理 → 供应商」检查该供应商配置后重试。',
    });

    expect(status).toBe(500);
    expect(body.error.code).toBe('AI_CRED_1001');
    expect(body.error.message).toContain('智谱AI');
    expect(body.error.message).toContain('模型管理');
  });

  it('缺文案时回落通用文案（仍保留业务码，便于前端分流）', () => {
    const { status, body } = mapChatErrorResponse({
      errorCode: 'AI_CRED_1001',
    });

    expect(status).toBe(500);
    expect(body.error.code).toBe('AI_CRED_1001');
    expect(body.error.message).toBe(
      'AI 服务返回错误，请检查 API 密钥和模型配置'
    );
  });

  it('其它业务码即便带 message 也不直出（避免泄露内部错误细节）', () => {
    const { status, body } = mapChatErrorResponse({
      errorCode: 'INTERNAL_THING',
      errorMessage: 'stack trace 之类不应出现',
    });

    expect(status).toBe(500);
    expect(body.error.message).toBe(
      'AI 服务返回错误，请检查 API 密钥和模型配置'
    );
    expect(body.error.code).toBe('INTERNAL_THING');
  });

  it('预算超限仍为 429 + 结构化放行入口（不回归）', () => {
    const { status, body } = mapChatErrorResponse({
      errorCode: 'DAILY_BUDGET_EXCEEDED',
      errorContext: { dailyLimit: 10, todayUsed: 10 },
    });

    expect(status).toBe(429);
    expect(body.error.type).toBe('budget_exceeded');
    expect(body.error.relief?.kinds).toEqual([
      'boost',
      'waive-once',
      'unlock-today',
    ]);
  });
});

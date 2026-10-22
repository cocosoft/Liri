/**
 * BUG-08（2026-10-22，前端巡检衍生）：模型有归属供应商、但供应商未注册时不得静默回落
 *
 * 缺陷现场：`getClientForModel()` 在 `providerRegistry.getByModel(model)` 落空时直接返回当前
 * 客户端 ⇒ 「智谱模型」被发给默认供应商 DeepSeek，上游返回 400「model not supported」，
 * 并被折叠成 HTTP 200 的正常回复（假成功），同时掩盖"凭据缺失"。
 *
 * 本文件锁判据边界：只拦「有映射但供应商不可用」；无映射 / 供应商可用 ⇒ 保持原行为。
 */
import { describe, it, expect } from 'bun:test';

import { resolveModelRoutingFailure } from '../../src/ai/providers/modelRoutingGuard.js';

describe('resolveModelRoutingFailure：路由失败判据', () => {
  it('有归属映射 + 供应商未注册 ⇒ 可读错误（含供应商名与修复路径，码 AI_CRED_1001）', () => {
    const failure = resolveModelRoutingFailure({
      model: 'glm-5.2',
      providerType: 'zhipu',
      providerLabel: '智谱AI',
      providerRegistered: false,
    });

    expect(failure).not.toBeNull();
    expect(failure!.code).toBe('AI_CRED_1001');
    expect(failure!.message).toContain('智谱AI');
    expect(failure!.message).toContain('glm-5.2');
    expect(failure!.message).toContain('模型管理');
  });

  it('供应商已注册可用 ⇒ 不拦（正常路由）', () => {
    expect(
      resolveModelRoutingFailure({
        model: 'deepseek-v4-flash',
        providerType: 'deepseek',
        providerLabel: 'DeepSeek',
        providerRegistered: true,
      })
    ).toBeNull();
  });

  it('模型无归属映射 ⇒ 不拦（保持既有回退，不改变供应商原生模型名的用法）', () => {
    expect(
      resolveModelRoutingFailure({
        model: 'some-native-model-name',
        providerRegistered: false,
      })
    ).toBeNull();
  });

  it('缺少供应商显示名 ⇒ 以类型名兜底（文案仍可读）', () => {
    const failure = resolveModelRoutingFailure({
      model: 'glm-5.2',
      providerType: 'zhipu',
      providerRegistered: false,
    });
    expect(failure!.message).toContain('zhipu');
  });
});

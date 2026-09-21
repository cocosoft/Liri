/**
 * 角色 `model` 合法性校验（T5 + v7.1 增强）
 *
 * 口径：**模型名**（`model_registry.modelId`）而非 UUID —— 下游
 * `providerRegistry.getByModel()` 按模型名精确匹配（`resolveModelRoute` 明确
 * "返回 UUID 会导致 getByModel(UUID) 匹配失败"），且该字符串会被原样作为
 * `chat({ model })` 的取值发给上游。
 *
 * v7.1 起共**三道判据**：可用性（活跃集）→ 类型（必须为对话模型）→ 归属（`providerId` 非空）。
 * 取数可注入 ⇒ 本测试不依赖真实 DB 内容。
 */
import { describe, test, expect } from 'bun:test';
import {
  validateAgentRoleModel,
  type AgentRoleModelInfo,
} from '../../../src/infrastructure/http/handlers/agent-role-handlers';

/** 造一个"对话模型"记录 */
function chatModel(modelId: string, over: Partial<AgentRoleModelInfo> = {}): AgentRoleModelInfo {
  return {
    modelId,
    type: 'chat',
    providerId: 'prov-1',
    capabilities: ['chat'],
    ...over,
  };
}

/** 仅包含指定模型的取数（未列出的 ⇒ 视为"未注册/停用"） */
function lookupOnly(
  models: AgentRoleModelInfo[]
): (modelId: string) => Promise<AgentRoleModelInfo | null> {
  return async (modelId: string) =>
    models.find((m) => m.modelId === modelId) ?? null;
}

const availableOnly = lookupOnly([chatModel('deepseek-v4-pro')]);

describe('validateAgentRoleModel（T5 / v7.1）', () => {
  test('未提交（undefined/null）⇒ 通过：部分更新不得动该字段', async () => {
    expect(await validateAgentRoleModel(undefined, availableOnly)).toBeNull();
    expect(await validateAgentRoleModel(null, availableOnly)).toBeNull();
  });

  test('空串 / 纯空白 ⇒ 通过（= 沿用任务分工默认模型）', async () => {
    expect(await validateAgentRoleModel('', availableOnly)).toBeNull();
    expect(await validateAgentRoleModel('   ', availableOnly)).toBeNull();
  });

  test('非字符串 ⇒ 拒绝（类型错误不静默）', async () => {
    expect(await validateAgentRoleModel(123, availableOnly)).toContain(
      '必须是字符串'
    );
    expect(
      await validateAgentRoleModel({ name: 'x' }, availableOnly)
    ).toContain('必须是字符串');
  });

  test('可用对话模型名 ⇒ 通过（首尾空白被 trim 后再匹配）', async () => {
    expect(
      await validateAgentRoleModel('  deepseek-v4-pro  ', availableOnly)
    ).toBeNull();
  });

  test('未注册 / 已停用 ⇒ 拒绝，且文案给出可操作指引', async () => {
    const error = await validateAgentRoleModel(
      'gpt-not-registered',
      availableOnly
    );
    expect(error).toContain('不可用');
    expect(error).toContain('gpt-not-registered');
    expect(error).toContain('模型管理');
  });

  test('v7.1 类型判据：非对话模型（如生图）⇒ 拒绝', async () => {
    const lookup = lookupOnly([
      chatModel('Tongyi-MAI/Z-Image', {
        type: 'image',
        capabilities: ['image_generation'],
      }),
    ]);

    const error = await validateAgentRoleModel('Tongyi-MAI/Z-Image', lookup);
    expect(error).toContain('不是对话模型');
    expect(error).toContain('image');
  });

  test('v7.1 类型判据：仅带 `text_to_video` ⇒ 拒绝（校验侧独立防线）', async () => {
    // 本用例**手工构造** `type: 'chat'`，测的是校验侧的独立防线 ——
    // 即使投影层把该模型报成 chat（N-40 修复前正是如此），校验侧也必须拦下。
    // 注：N-40 修复后 `deriveModelType` 已把 text_to_video 归为 video，
    // 本防线保留为纵深防御（防"投影未覆盖 → 模型被当成对话模型"再次发生）。
    const lookup = lookupOnly([
      chatModel('some-video-model', {
        type: 'chat',
        capabilities: ['text_to_video'],
      }),
    ]);

    expect(await validateAgentRoleModel('some-video-model', lookup)).toContain(
      '不是对话模型'
    );
  });

  test('v7.1 归属判据：`providerId` 为空 ⇒ 拒绝（数据不完整）', async () => {
    const lookup = lookupOnly([
      chatModel('orphan-model', { providerId: '' }),
    ]);

    const error = await validateAgentRoleModel('orphan-model', lookup);
    expect(error).toContain('缺少供应商归属');
  });
});

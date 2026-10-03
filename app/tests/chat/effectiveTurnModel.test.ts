// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * 发送前"本轮实际会用的模型"解析（2026-09-27，服务端自发轮次的模型归属）
 *
 * 背景：自发轮次（系统续跑 / 自唤醒 / 目标空闲续接 / PDCA）经
 * `_resumeSessionInternally → streamMessage(content, { sessionId, metadata })`，
 * **不带 `options.model`** ⇒ 发送前的窗口/压缩决策原先只读该字段 ⇒ `resolveMaxContextTokens('')`
 * 回落**硬编码 128_000**，与真实模型窗口不符（过压或欠保护）。
 *
 * 本文件只覆盖**纯读分支**（显式指定 / provider 级默认模型）——两者都不触碰 DB/路由；
 * 第三条链（`resolveModelRoute(CHAT, { sessionId, skipJudge: true })`）需要真实 DB 与
 * SmartRouter，**经真机验证**（日志 `compaction:ctx_start … model=<真实模型>`），不在单测内伪造。
 */
import { describe, it, expect } from 'bun:test';
import { resolveEffectiveTurnModel } from '../../src/chat/services/ChatHelper';
import { ToolAwareClient } from '../../src/ai/clients/ToolAwareClient';

describe('resolveEffectiveTurnModel（只读；发送前取实际模型）', () => {
  it('显式指定 ⇒ 直接采用，且**不**去问 provider（避免多余读取）', async () => {
    let askedProvider = false;
    const model = await resolveEffectiveTurnModel({
      explicitModel: 'model-explicit',
      client: {
        getConfiguredModel: () => {
          askedProvider = true;
          return 'model-configured';
        },
      },
    });
    expect(model).toBe('model-explicit');
    expect(askedProvider).toBe(false);
  });

  it('未显式指定 ⇒ 采用 provider 级默认模型（纯读、零副作用）', async () => {
    const model = await resolveEffectiveTurnModel({
      client: { getConfiguredModel: () => 'model-configured' },
    });
    expect(model).toBe('model-configured');
  });

  it('显式值为空白串 ⇒ 视为未指定（回落 provider 默认）', async () => {
    const model = await resolveEffectiveTurnModel({
      explicitModel: '   ',
      client: { getConfiguredModel: () => 'model-configured' },
    });
    expect(model).toBe('model-configured');
  });
});

describe('ToolAwareClient.getConfiguredModel（纯读 provider 默认模型）', () => {
  const clientOf = (provider: unknown) =>
    new ToolAwareClient(provider as never, null, null);

  it('优先 provider.config.model', () => {
    expect(
      clientOf({
        id: 'p1',
        config: { model: 'cfg-model' },
        options: { defaultModel: 'opt-model' },
      }).getConfiguredModel()
    ).toBe('cfg-model');
  });

  it('回落构造选项 defaultModel', () => {
    expect(
      clientOf({
        id: 'p1',
        options: { defaultModel: 'opt-model' },
      }).getConfiguredModel()
    ).toBe('opt-model');
  });

  it('两者皆无/空白 ⇒ undefined（不伪造模型名以免改变取价）', () => {
    expect(clientOf({ id: 'p1' }).getConfiguredModel()).toBeUndefined();
    expect(
      clientOf({ id: 'p1', config: { model: '   ' } }).getConfiguredModel()
    ).toBeUndefined();
  });
});

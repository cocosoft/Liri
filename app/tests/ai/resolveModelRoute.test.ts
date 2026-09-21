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
 * resolveModelRoute 优先级回归（N-46，2026-09-20）
 *
 * 背景：chat 类 route（chat / coding / translation / agent / scheduled）在
 * `SmartRouter.resolve` 里走 Judge/档位解析 ⇒「模型管理→任务分工」对它们的改动
 * **原先不生效**（UI 显示与实际使用不一致，违反数出同源；实测 `GET /v1/models/tasks`
 * 显示 agent→llama.cpp 而子代理实际用档位模型）。
 *
 * 用户决策㈠：**显式配置优先** —— 仅当该任务被用户显式保存过
 * （`ai_app_model_configs.source === 'user'`）时以任务分工为准；否则仍走档位解析。
 * 本测试固化三层优先级与"解析不出模型名时不得返回空/UUID"的口径。
 */

import { describe, expect, test, mock } from 'bun:test';
import { RouteKey } from '../../src/ai/router/routes';

/** 可变测试状态（各用例前重置） */
const state = {
  source: 'seed' as 'user' | 'seed',
  cfgModel: 'uuid-configured',
  /** ModelRouter.resolve 的返回值（已做 UUID→模型名映射） */
  mrModel: 'deepseek-v4-pro',
  /** SmartRouter 档位解析结果 */
  smartModel: 'deepseek-v4-flash',
  smartCalled: false,
};

mock.module('@modules/ai/models/AppModelConfigService.js', () => ({
  appModelConfigService: {
    initialize: async () => {},
    getConfig: async () => ({
      appType: 'agent',
      model: state.cfgModel,
      source: state.source,
      updatedAt: 0,
    }),
  },
}));

mock.module('@modules/runtime/api/CoreAPIImpl.js', () => ({
  getCoreAPI: () => ({
    getSmartRouter: () => ({
      resolve: async () => {
        state.smartCalled = true;
        return { model: state.smartModel };
      },
    }),
  }),
}));

mock.module('@modules/ai/modelRouter.js', () => ({
  ModelRouter: {
    getInstance: () => ({ resolve: () => state.mrModel }),
  },
}));

const { resolveModelRoute } =
  await import('../../src/ai/router/resolveModelRoute');

describe('resolveModelRoute — N-46 显式配置优先', () => {
  test('source=user ⇒ 以任务分工为准，且不调用 SmartRouter 档位解析', async () => {
    state.source = 'user';
    state.mrModel = 'deepseek-v4-pro';
    state.smartCalled = false;

    const model = await resolveModelRoute(RouteKey.AGENT);

    expect(model).toBe('deepseek-v4-pro');
    expect(state.smartCalled).toBe(false);
  });

  test('source=seed（系统播种）⇒ 仍走 SmartRouter 档位（不覆盖档位）', async () => {
    state.source = 'seed';
    state.smartCalled = false;

    const model = await resolveModelRoute(RouteKey.AGENT);

    expect(model).toBe('deepseek-v4-flash');
    expect(state.smartCalled).toBe(true);
  });

  test('source=user 但解析不出模型名 ⇒ 回退档位（不得返回空/UUID）', async () => {
    state.source = 'user';
    state.mrModel = ''; // UUID 未预载等场景
    state.smartCalled = false;

    const model = await resolveModelRoute(RouteKey.AGENT);

    expect(model).toBe('deepseek-v4-flash');
    expect(state.smartCalled).toBe(true);
  });

  test('非 chat 类 route（如 image）不受显式配置分支影响', async () => {
    state.source = 'user';
    state.mrModel = 'deepseek-v4-pro';
    state.smartCalled = false;

    const model = await resolveModelRoute(RouteKey.IMAGE_GENERATE);

    // 该 route 不在 EXPLICIT_CONFIG_PREFERRED_ROUTES ⇒ 直接进 SmartRouter 分支
    expect(model).toBe('deepseek-v4-flash');
    expect(state.smartCalled).toBe(true);
  });
});

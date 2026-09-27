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
 * 用量/成本**归因模型**回落链守卫（2026-09-27）
 *
 * ## 背景（真机实测，非推断）
 *
 * 自唤醒续跑（服务端自发轮次）调用的 6 次 `trackUsage` 全部记为
 * `LLM call recorded: unknown <in>/<out> tokens, $<cost>`：
 * 记账点写 `options?.model || 'unknown'`，而 `_resumeSessionInternally` →
 * `streamMessage(content, { sessionId, metadata })` **不带 `options.model`**。
 *
 * 后果不止"名字不好看"：`UsageTracker.trackUsage` 用 `params.model` 取价
 * （`getCanonicalModelName` → `costTracker.addCost` → `getModelPricing`），
 * 模型查不到时回落**兜底价** `$3/M in, $15/M out, $0.3 cacheRead, $3.75 cacheCreate`
 * 并置 `hasUnknownModelCost`。**实测算术精确吻合**：
 * - 11784/210/2304/9480 ⇒ $0.074743（= 兜底价公式）
 * - 23604/344/11776/11828 ⇒ $0.12386（= 兜底价公式）
 * ⇒ 归因与**金额**同时失真。
 *
 * ## 本文件锁两件事
 *
 * 1. 回落链语义：`response.model`（provider 回显）→ `options.model` → `'unknown'`；
 * 2. **三个记账点不得退回** `options?.model || 'unknown'`（防漂移，避免同一缺陷复发）。
 */

import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { extractModelFromResponse } from '../../src/ai/UsageTracker';

const APP_SRC = join(import.meta.dir, '..', '..', 'src');

/**
 * 去掉注释后再做"禁止写法"匹配 —— 否则**注释里引用旧写法**（本次修复的说明文字）会被误判为代码。
 * 仅用于守卫断言；不做词法级解析（够用即可）。
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

/**
 * 四个用量/归因记账点及各自的守卫口径。
 *
 * - 前三个文件：不得再出现 `model: options?.model || 'unknown'` 式**直接赋值**（本缺陷原形态）；
 *   注意用 `model:` 锚定 —— 合规写法 `extractModelFromResponse(resp, options?.model || 'unknown')`
 *   会把同一片段作为**回落参数**出现，用宽正则会误判。
 * - `streamMessageFlow.ts`：本批只修了 `logInferenceUsage` 调用点（记账/诊断口径），
 *   文件内**仍有多处**同类"诊断日志字段"（`model: options?.model ?? 'unknown'`）属同族、
 *   已登记台账待后续统一处理 ⇒ 此处只断言该调用点已改为 `extractModelFromResponse`。
 */
const STRICT_SITES = [
  'chat/ReActToolLoop.ts', // 工具轮（系统续跑 / 自唤醒 / PDCA 走这条）
  'chat/pipeline/StreamPipeline.ts', // 流式主路径（recordUsage + notifyUsage 预估价）
  'chat/orchestrator/sendMessageFlow.ts', // 非流式发送路径
] as const;

/** 只要求"经既有助手取模型"（豁免：文件内尚有同族日志字段待统一） */
const REQUIRED_ONLY_SITES = ['chat/orchestrator/streamMessageFlow.ts'] as const;

describe('用量归因模型回落链（extractModelFromResponse 的组合用法）', () => {
  it('响应回显模型名 ⇒ 取它（服务端自发轮次无 options.model 时的正解）', () => {
    expect(
      extractModelFromResponse({ model: 'deepseek-v4-flash' }, 'unknown')
    ).toBe('deepseek-v4-flash');
  });

  it('响应无 model ⇒ 回落调用方指定（正常用户轮次）', () => {
    expect(extractModelFromResponse({}, 'my-model')).toBe('my-model');
  });

  it('两者皆无 ⇒ unknown（显式标记，不伪造模型名以免静默改变取价）', () => {
    expect(extractModelFromResponse({}, 'unknown')).toBe('unknown');
  });
});

describe('防漂移：记账点必须经 provider 回显取模型', () => {
  for (const rel of STRICT_SITES) {
    it(`${rel} 使用 extractModelFromResponse 且不再直接写死 unknown`, () => {
      const code = stripComments(readFileSync(join(APP_SRC, rel), 'utf-8'));
      // 必须：经既有助手从响应取模型（回落 options.model → 'unknown'）
      expect(code).toMatch(/extractModelFromResponse\s*\(/);
      // 禁止：`model: options?.model || 'unknown'` 式直接赋值（本缺陷原形态；`model:` 锚定避免
      // 误伤合规写法里作为**回落参数**出现的同一片段）
      expect(code).not.toMatch(
        /model:\s*(?:this\.ctx\.)?options\?\.model\s*(?:\|\||\?\?)\s*'unknown'/
      );
    });
  }

  it('chat/orchestrator/streamMessageFlow.ts 的 logInferenceUsage 调用点已改取真实模型', () => {
    const code = stripComments(
      readFileSync(
        join(APP_SRC, 'chat/orchestrator/streamMessageFlow.ts'),
        'utf-8'
      )
    );
    expect(code).toMatch(/logInferenceUsage\(\s*session\.id,\s*extractModelFromResponse\(/);
  });
});

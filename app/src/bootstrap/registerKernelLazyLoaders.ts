// MIT License
// Copyright (c) 2026 Liri
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
 * 宿主侧：把「按需加载清单」推送给内核（core 独立包 P2）。
 *
 * 内核不再自持这张清单（否则物理上无法独立成包）。清单本体是**构建期生成物**
 * （`generatedLazyLoaders.ts`，由 `app/scripts/build-variant.ts` 按变体写出），
 * 因此「哪些模块被裁剪」在生成时就已确定，不依赖运行时 `feature()` 判断。
 *
 * 调用时机：入口（`main.ts`）在**任何** `requestModule()` 之前调用一次。
 * 幂等：重复调用直接返回（避免热重载/双入口触发「重复注册」的 fail-closed 抛错）。
 */
import { registerLazyLoaders } from '@modules/core';

import { LAZY_LOADERS } from './generatedLazyLoaders';

let registered = false;

export function registerKernelLazyLoaders(): void {
  if (registered) return;
  registerLazyLoaders(LAZY_LOADERS);
  registered = true;
}

/** 仅测试用：允许夹具重新注册 */
export function resetKernelLazyLoadersRegistration(): void {
  registered = false;
}

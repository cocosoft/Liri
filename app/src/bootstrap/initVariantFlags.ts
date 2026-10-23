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
 * 宿主侧：把**构建变体层**推送给内核（core 独立包 P3）。
 *
 * ⚠️ **本模块靠「被 import 的副作用」完成注入** —— 因此必须作为入口文件的**第一条 import**：
 * ES module 按 import 声明顺序求值，只有先于其它模块求值，才能保证其它模块顶层调用
 * `feature()` 时变体层已就位（否则触发 `CORE_VARIANT_FLAGS_NOT_INITIALIZED` 时序守卫）。
 *
 * 生成物：`generatedVariantFlags.ts`（由 `app/scripts/build-variant.ts` 按变体写出）。
 * 内核不再持有该文件 —— 包内出现「由消费者构建脚本重写的源文件」正是 P3 要消除的东西。
 */
import { setBuildVariantFlags } from '@modules/core';

import { BUILD_VARIANT_FLAGS } from './generatedVariantFlags';

setBuildVariantFlags(BUILD_VARIANT_FLAGS);

/** 供诊断/测试断言「注入模块确实被加载过」 */
export const VARIANT_FLAGS_INITIALIZED = true;

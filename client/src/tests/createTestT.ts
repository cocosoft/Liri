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
 * createTestT — 测试环境用的 i18n `t()` 实现（TR-15 根因修法，2026-09-22）
 *
 * ## 为什么需要它
 *
 * 测试基座（`src/tests/setup.ts`）曾把 `t` mock 成 `(k) => k`（返回**裸 key**）⇒
 * 组件在测试里渲染出 `chat.pendingApproval` 这样的 key，于是：
 *   - 字典**缺键**、**拼错**、**翻译写错** 永远不会被测试发现（i18n 等于只做了一半）；
 *   - 测试断言只能锁"裸 key"，反而把坏行为固化。
 *
 * ## 为什么不能用真实 i18n 实例
 *
 * 已实测失败（见 TR-15 附注）：改为"委托真实 i18n 实例"会**死锁** —— 异步 `vi.mock`
 * 工厂内 `await import("../i18n")`，而 `i18n/index.ts` 自身又 `import { initReactI18next }
 * from "react-i18next"`（正被 mock）⇒ 循环等待。
 *
 * ⇒ 本实现**只读原始字典**（`i18n/locales/*.ts` 是纯数据模块，不 import react-i18next）
 * ⇒ **无环**，且 `vi.mock` 工厂是同步的，可在工厂内直接使用。
 *
 * ## 行为（与 i18next 对齐）
 *
 * - 支持 `t(key)` / `t(key, defaultValue)` / `t(key, options)` / `t(key, defaultValue, options)`
 * - `{{name}}` 插值（参数取 `options[name]`）
 * - **缺键即报错**（无默认值时抛出，报错信息含 key）—— 这是本实现的核心价值：
 *   让"字典缺键"在 CI 中暴露，而不是变成静默的裸 key 渲染
 */

import zh from "@/i18n/locales/zh";

type Dict = Record<string, unknown>;
type TOptions = Record<string, unknown>;

/** 点分路径查表（`a.b.c`）；非字符串叶子返回 undefined */
function lookup(dict: Dict, path: string): string | undefined {
  const parts = path.split(".");
  let cur: unknown = dict;
  for (const p of parts) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Dict)[p];
  }
  return typeof cur === "string" ? cur : undefined;
}

/** `{{name}}` 插值；未提供参数时保留占位符（便于断言发现漏参） */
function interpolate(text: string, options?: TOptions): string {
  if (!options) return text;
  return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (whole, name: string) => {
    const v = options[name];
    return v === undefined ? whole : String(v);
  });
}

export interface CreateTestTOptions {
  /** 字典（默认中文）；传 `en` 可断言英文文案 */
  dict?: Dict;
  /** 缺键时的行为：`throw`（默认，暴露问题） / `warn`（打印后返回 key） */
  onMissing?: "throw" | "warn";
}

/**
 * 创建测试用 `t()`。
 *
 * ```ts
 * const t = createTestT();                 // 默认 zh，缺键抛错
 * t("trajectory.detail.timing");           // → "计时"
 * t("trajectory.list.count", { total: 3 });// → 插值结果
 * ```
 */
export function createTestT(options: CreateTestTOptions = {}) {
  const dict = options.dict ?? (zh as Dict);
  const onMissing = options.onMissing ?? "throw";

  return function t(
    key: string,
    arg2?: string | TOptions,
    arg3?: TOptions,
  ): string {
    const defaultValue = typeof arg2 === "string" ? arg2 : undefined;
    const vars = (typeof arg2 === "object" ? arg2 : arg3) ?? undefined;

    const raw = lookup(dict, key) ?? defaultValue;
    if (raw === undefined) {
      const msg = `[createTestT] 缺少 i18n 键: ${key}`;
      if (onMissing === "throw") throw new Error(msg);
      // eslint-disable-next-line no-console
      console.warn(msg);
      return key;
    }
    return interpolate(raw, vars);
  };
}

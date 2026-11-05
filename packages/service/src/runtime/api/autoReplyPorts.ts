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
 * 自动回复运行时 —— **服务层端口**（子批 C；2026-10-01 台账 D-202）
 *
 * **为什么需要**：`infrastructure/http/handlers/auto-reply-handlers.ts` 以**相对路径**
 * `'../../../auto-reply'` 静态导入 app 层 `autoReplyEngine` + `ReplyRule` / `StoredPattern`
 * ⇒ `infrastructure -> app` 倒挂。⚠️ 该边是**相对路径形式**（非 `@modules/*` 别名），
 * 静态清单最易漏（见 §3.3 分型表 `auto-reply` 行的 ⚠️ 标注）。
 *
 * 按 §3.3 ③ 预案，与 `toolsPorts.ts`（D-93）同构：**服务层声明端口（本文件）
 * + `CoreAPI` 只加 1 个取用方法**（`getAutoReplyPort()`），app 引用内聚到 `CoreAPIImpl`。
 *
 * ⚠️ 端口**禁止引用 app 类型**（`R00-001` 连类型导入也计）。
 */

/**
 * 自动回复规则（**最小投影 DTO** —— `auto-reply-handlers.ts` 的读取/写入面）
 *
 * 结构镜像自 app 层 `ReplyRule`（`auto-reply/AutoReplyEngine.ts:19-28`），
 * **非新契约**；以**不同导出名**承载，避免与 app 层类型同名而触发 R02-002
 * （同 `MediaTemplateDto` / `AgentRunDto` / `VideoTaskDto` 先例）。
 */
export interface AutoReplyRuleDto {
  id: string;
  name: string;
  pattern: RegExp | string;
  /**
   * 函数型 `response` 不参与 JSON 传输（handler 序列化为空串）；其余情况原样透传。
   *
   * ⚠️ 用 `unknown` 而非 `string | ((ctx: ReplyContext) => …)`：端口**不引 app 类型**，
   * 且 `strictFunctionTypes` 下"参数为 `unknown` 的函数类型"与 app 层签名**逆变不兼容**
   * ⇒ 如实承载为不透明值（同 D-200 `getRuntimeStatus()` 子字段用 `unknown` 的分界）。
   */
  response: unknown;
  priority: number;
  channel?: string | undefined;
  enabled: boolean;
  cooldown?: number | undefined;
}

/** 规则写入载荷（`registerRule` / `updateRule` 的入参；`id` 由实现侧生成） */
export type AutoReplyRuleInput = Omit<AutoReplyRuleDto, 'id'>;

/** 自动回复端口（5 个方法 = handler 的**实际调用面**；实现侧方法均为**同步**） */
export interface AutoReplyPort {
  /** 规则列表（按 `priority` 降序，同 app 层 `getAllRules()`） */
  getAllRules(): AutoReplyRuleDto[];
  /** 运行统计（原样进 JSON ⇒ `unknown`） */
  getStats(): unknown;
  /** 注册规则，返回新规则（含实现侧生成的 id） */
  registerRule(rule: AutoReplyRuleInput): AutoReplyRuleDto;
  /** 更新规则；返回 `null` 表示规则不存在（handler 据此回 404） */
  updateRule(
    ruleId: string,
    updates: Partial<AutoReplyRuleInput>
  ): AutoReplyRuleDto | null;
  /** 删除规则，返回是否命中 */
  deleteRule(ruleId: string): boolean;
}

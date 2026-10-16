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
 * toolVisibilityOverrides — 工具**可见性覆写层**（P2「可控性」，2026-10-16）
 *
 * 立项：`dev_docs/20261016/工具可见性治理方案-20261016.md` §3.2/§3.3/§3.4（用户已裁定 Q1–Q4）。
 *
 * ## 定位（**只做加/减，不参与任何自动决策**）
 * 用户对**具体工具**显式表达 `auto`（跟随默认）/ `on`（强制可见）/ `off`（强制不可见）。
 * 缺省 = `auto`；**默认空 ⇒ 本模块为恒等函数 ⇒ 零行为变更**（方案 P2 硬约束）。
 *
 * 与 `filterToolsByTask` 的关系（§3.3「外科手术」）：
 * - **切在 `filterToolsByTask` 之后**（调用方 `selectToolsForTurn` 内一处接入）⇒ 既有函数签名 /
 *   语义 / 测试**零改动**；
 * - `off` 在**后置移除**；`on` 在**后置补回**，且**必须从「已注册全量」取**（不是从被裁掉的
 *   列表取）—— 否则 `on` 只能"恢复被裁"、无法放开"类别白名单之外"（如 `computer_use`）。
 *
 * ## 三条硬边界（勿扩写）
 * 1. **可见性 ≠ 授权**（`toolCategories.ts:308-311` 原话）：本层只让工具对模型**可见**，
 *    命令执行 / 文件写入仍走审批与 PathGuard，**永不触碰** `toolEffects` / PathGuard / 沙箱。
 * 2. **`MANDATORY_TOOLS` 不可 `off`**（方案 L1 默认裁定）：`todo_write` / `agent` 是智能体主循环
 *    的组成部分，被移除会直接损坏主循环 ⇒ `off` 被忽略并告警（硬保护在此一处）。
 * 3. **重放一致性**（`✅-4` / 方案 R6）：调用方在**重放路径**（`forcedVisibleTools` 已给出）**不得**
 *    调用 `applyToolVisibilityOverrides` —— 重放工具面必须恒等于**落盘快照**
 *    （`execution/preparedSnapshot`），否则"运行期改设置 ⇒ 历史重放分叉"。
 */

import { configManager } from '@modules/config';
import { getLogger } from '@modules/monitoring';
import { MANDATORY_TOOLS } from './toolCategories';
import { TOOL_NAME_CONSTANTS } from './toolNameConstants';

const logger = getLogger('tools:visibilityOverrides');

/** 三态取值；缺省（不在表中）= `auto` */
export type ToolVisibilityOverrideValue = 'auto' | 'on' | 'off';

/** 已归一化的覆写表（**只含 `on`/`off`** —— `auto` 等于"不登记"，不占键） */
export type ToolVisibilityOverrides = Readonly<
  Record<string, ToolVisibilityOverrideValue>
>;

/**
 * 持久化落点：`~/.pyapp/config.json` 的 **`settings.tools`**（方案 §3.4，已裁定 Q2）。
 *
 * 读写**复用既有命名空间端点**（`GET/PUT /v1/settings/tools` ⇒ `config-handlers.ts` 的
 * `handleGet/Settings`）⇒ CS01：**不新建存储机制**。形状：`{ overrides: { [toolName]: 'on'|'off' } }`。
 */
export const TOOL_VISIBILITY_SETTINGS_KEY = 'settings.tools';

/** 生效名全集（`TOOL_NAME_CONSTANTS` 的值域）—— 用于剔除"未知工具名" */
const KNOWN_TOOL_NAMES: ReadonlySet<string> = new Set<string>(
  Object.values(TOOL_NAME_CONSTANTS)
);

/** 已告警键（一次性；避免每轮重复刷屏 —— 与 `toolProfile.ts` 同法） */
const warnedKeys = new Set<string>();

function warnOnce(key: string, message: string, meta: Record<string, unknown>) {
  if (warnedKeys.has(key)) return;
  warnedKeys.add(key);
  logger.warn(message, meta);
}

/**
 * 归一化**任意**入参（含手工编辑 config.json / HTTP 写入的未校验值）为合法覆写表。
 *
 * 口径（对齐方案 §3.4「失效兜底」）：
 * - 非对象 / 缺 `overrides` ⇒ `{}`（视为未配置）；
 * - 取值非 `'on'` / `'off'` ⇒ **丢弃**（含 `auto`：等于"不登记"，避免空键）；
 * - 未知工具名 ⇒ **丢弃 + 一次性告警**（不阻断；`lint:unconsts` 面外的名字不进可见性判定）；
 * - `MANDATORY_TOOLS` 的 `'off'` ⇒ **丢弃 + 一次性告警**（L1 硬保护）。
 *
 * 为什么在**读取侧**校验而不是写入侧：写入走的是通用 `PUT /v1/settings/{ns}`
 * （`config-handlers.ts` 原样落盘，service 层不引 app 类型）；**单一真源在本函数** ⇒
 * 手工改 config.json 也走同一口径（写入侧校验会留下"绕过端点即绕过校验"的缺口）。
 */
export function normalizeToolVisibilityOverrides(
  raw: unknown
): ToolVisibilityOverrides {
  if (typeof raw !== 'object' || raw === null) return {};
  const rawOverrides = (raw as { overrides?: unknown }).overrides;
  if (typeof rawOverrides !== 'object' || rawOverrides === null) return {};

  const out: Record<string, ToolVisibilityOverrideValue> = {};
  for (const [name, value] of Object.entries(
    rawOverrides as Record<string, unknown>
  )) {
    if (value !== 'on' && value !== 'off') {
      warnOnce(
        `value:${name}:${String(value)}`,
        '工具可见性覆写值非法 ⇒ 已忽略（合法值仅 on / off；auto 表示不登记）',
        { tool: name, value: String(value) }
      );
      continue;
    }
    if (!KNOWN_TOOL_NAMES.has(name)) {
      warnOnce(`unknown:${name}`, '工具可见性覆写指向未知工具名 ⇒ 已忽略', {
        tool: name,
      });
      continue;
    }
    if (MANDATORY_TOOLS.has(name) && value === 'off') {
      warnOnce(
        `mandatory:${name}`,
        '恒保留工具不可被 off（智能体主循环依赖）⇒ 已忽略该覆写',
        { tool: name }
      );
      continue;
    }
    out[name] = value;
  }
  return out;
}

/**
 * 读当前生效的覆写表（`settings.tools`，经 `ConfigManager` 内存缓存 ⇒ 无 IO）。
 *
 * ⚠️ 调用点**仅限**：本轮工具集选择（`selectToolsForTurn` 的**非重放**分支）、
 * `tool_search` 检索面、可见性报表。**重放路径严禁**读本函数（方案 R6）。
 */
export function readToolVisibilityOverrides(): ToolVisibilityOverrides {
  return normalizeToolVisibilityOverrides(
    configManager.getConfigValue(TOOL_VISIBILITY_SETTINGS_KEY)
  );
}

/** 与 `filterToolsByTask` 同形状的最小结构（名称位兼容 OpenAI 兼容结构） */
type NamedTool = { name?: string; function?: { name?: string } };

const nameOf = (t: NamedTool): string => t.name ?? t.function?.name ?? '';

/**
 * 在**裁剪结果**上叠加覆写（**默认空表 ⇒ 逐元素恒等**）。
 *
 * @param kept `filterToolsByTask` 的输出（已按 taskType / extraCategories 裁剪）
 * @param all **已注册全量**（`on` 的补回来源 —— 必须是裁剪**之前**的完整列表）
 * @param overrides 已归一化覆写表
 * @returns 最终可见集：`(all − off) ∩ (kept ∪ on)`，**顺序恒取自 `all`**（稳定、可 diff）
 */
export function applyToolVisibilityOverrides<T extends NamedTool>(
  kept: readonly T[],
  all: readonly T[],
  overrides: ToolVisibilityOverrides
): T[] {
  const keys = Object.keys(overrides);
  if (keys.length === 0) return [...kept]; // 恒等（默认路径）

  const keptNames = new Set(kept.map(nameOf));
  const finalNames = new Set<string>();
  for (const t of all) {
    const name = nameOf(t);
    if (name === '') continue;
    const value = overrides[name];
    if (value === 'off') continue;
    if (value === 'on' || keptNames.has(name)) finalNames.add(name);
  }
  return all.filter((t) => finalNames.has(nameOf(t)));
}

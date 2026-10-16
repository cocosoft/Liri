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
 * toolVisibilityReport — 工具**可见性报表**（P1「可解释性」，2026-10-16）
 *
 * 立项：`dev_docs/20261016/工具可见性治理方案-20261016.md` §3.2/§3.4（用户已裁定 Q1–Q4）。
 *
 * ## 为什么需要它
 * 内置工具存在**四道门**（注册 / 可见 / 延迟 / 检索），任一道不通过都会"静默消失"，而
 * **用户侧没有任何通路知道"为什么没了"**：`GET /v1/tools` 返回的是**注册表全量**，而模型
 * 真实看到的面是每轮按 `taskType + hasImages + toolProfile` **动态裁剪**出来的、**从不外露**
 * （取证：`chat/orchestrator/streamMessageToolSelection.ts:96-121`）。
 *
 * ## 本模块的口径（**全部派生，不新增手写清单**；CS01）
 * - 名字域 = `TOOL_NAME_CONSTANTS`（90，D11-B 唯一来源）
 * - 注册面 = 生成物 `TOOL_NAMES`（75，口径「**全量 ∧ 可实例化**」）⇒ 差集 15 个 = `conditional`
 * - 类别 = `getToolCategory()`；任务白名单 = `getTaskToolCategories()`；恒保留 = `MANDATORY_TOOLS`；
 *   有意归档 = `ARCHIVED_MISC_TOOLS`
 * - 判定口径与 `filterToolsByTask()` **逐条一致**（本模块只**解释**它，绝不改变它；
 *   `app/tests/tools/toolVisibilityReport.test.ts` 用"与 `filterToolsByTask` 全量交叉断言"钉死）
 *
 * ## 两条边界（如实标注，勿扩写）
 * - **P1 不报 flag 门控**：生成物口径是「全量 ∧ 可实例化」，被 `cond(coreFeature(...))` 关掉的
 *   工具在**生成期取不到名字**，无法可靠反推 flag 名 ⇒ 归入 `conditional`（文案不含具体 flag）。
 *   `flag-gated-off` 原因随 P2 的 policy 表补上（方案 §3.4「P1/P2 边界」）。
 * - **本模块只读**：不参与注册、裁剪、执行 ⇒ **零行为变更**（方案 P1 约束）。
 */

import {
  ARCHIVED_MISC_TOOLS,
  MANDATORY_TOOLS,
  TASK_TOOL_CATEGORIES,
  getTaskToolCategories,
  getToolCategory,
} from './toolCategories';
import type { ToolCategory } from './toolCategories';
import { TOOL_NAME_CONSTANTS } from './toolNameConstants';
import type { ToolVisibilityOverrides } from './toolVisibilityOverrides';
import { TOOL_NAMES } from '@modules/constants/toolNames.generated';

/** 可见/不可见的**结构化原因**（对齐方案 §3.2；P1 产出前 5 种，P2 追加后 2 种） */
export type ToolVisibilityReason =
  /** 恒保留（`MANDATORY_TOOLS`）⇒ **可见**（唯一"可见且带原因"的情形之一） */
  | 'mandatory'
  /** 有意归档（`ARCHIVED_MISC_TOOLS`）⇒ 默认不可见（裁剪 + 检索双封死；用户 `on` 可放开） */
  | 'archived'
  /** 未登记类别 ⇒ 落 `misc` 且非归档 ⇒ 任何任务下都被裁 */
  | 'unregistered-category'
  /** 类别已登记，但当前 `taskType` 的白名单不含它 ⇒ 换个任务才有 */
  | 'not-in-task-whitelist'
  /** ∉ 生成物 ⇒ 工厂实例化失败（未接线 / 工厂内门控关闭）⇒ 根本不在注册表里 */
  | 'conditional'
  /** P2：用户显式 `off`（`settings.tools`） */
  | 'user-off'
  /** P2：用户显式 `on` —— 覆盖了类别白名单 / 归档判定 ⇒ **可见** */
  | 'user-on-bypass';

export interface ToolVisibilityReport {
  name: string;
  category: ToolCategory;
  /** 注册面静态实况（P1 只区分「在不在生成物里」） */
  registration: 'registered' | 'conditional';
  /** 当前任务白名单下的可见性（**未叠加任何用户覆写**；覆写结果见 `effective`） */
  visibleByDefault: boolean;
  /** **覆写后**的最终判定（P1 无覆写 ⇒ 恒等于 `visibleByDefault`；P2 起可被改变） */
  effective: 'visible' | 'hidden';
  /**
   * 结构化原因：`effective === 'hidden'` ⇒ **必非空**；`visible` ⇒ 或为空（常规命中白名单）
   * 或含 `mandatory` / `user-on-bypass`（"可见但非默认"的两种情形，UI 可据此标注）。
   */
  reasons: ToolVisibilityReason[];
}

export interface ResolveToolVisibilityOptions {
  /** 任务类型（缺省 `'default'`，与 `filterToolsByTask` 同口径） */
  taskType?: string;
  /** 额外追加的类别（带图消息追加 `image` / 会话 `toolProfile` 映射），与调用方同口径 */
  extraCategories?: readonly ToolCategory[];
  /**
   * P2：用户可见性覆写（**须为 `normalizeToolVisibilityOverrides` 的产物**）。
   * 缺省 / 空表 ⇒ `effective` 恒等于 `visibleByDefault`（P1 语义不变）。
   */
  overrides?: ToolVisibilityOverrides;
}

/**
 * 产出**全量**工具（名字域 = 常量表 90 个）的可见性报表；按名字升序（稳定、可 diff）。
 *
 * @param options.taskType 缺省 `'default'`（`getTaskToolCategories` 的兜底键）
 */
export function resolveToolVisibilityReport(
  options: ResolveToolVisibilityOptions = {}
): ToolVisibilityReport[] {
  const allowed = new Set<ToolCategory>(
    getTaskToolCategories(options.taskType ?? 'default')
  );
  for (const c of options.extraCategories ?? []) allowed.add(c);
  const registered = new Set<string>(TOOL_NAMES);

  return Object.values(TOOL_NAME_CONSTANTS)
    .map<ToolVisibilityReport>((name) => {
      const category = getToolCategory(name);
      const conditional = !registered.has(name);
      const reasons: ToolVisibilityReason[] = [];
      let visible: boolean;

      if (MANDATORY_TOOLS.has(name)) {
        // 恒保留：即使类别不在白名单（如 todo_write 属 'task'）也仍可见
        visible = true;
        reasons.push('mandatory');
      } else if (ARCHIVED_MISC_TOOLS.has(name)) {
        visible = false;
        reasons.push('archived');
      } else if (category === 'misc') {
        visible = false;
        reasons.push('unregistered-category');
      } else if (!allowed.has(category)) {
        visible = false;
        reasons.push('not-in-task-whitelist');
      } else {
        visible = true;
      }
      // 未进生成物 ⇒ 无论类别是否命中白名单，**都不会出现在工具清单里**
      if (conditional) {
        visible = false;
        reasons.push('conditional');
      }

      // P2：叠加用户覆写（**只影响 `effective` 与原因，不改 `visibleByDefault`**）。
      // ⚠️ `on` 对 `conditional`（未进生成物 ⇒ 根本不在注册表）**无能为力** —— 覆写层只能
      // 改变"可见性判定"，无法凭空实例化工具 ⇒ 如实保持 hidden（不给假承诺）。
      let effective = visible;
      const override = options.overrides?.[name];
      if (override === 'off') {
        effective = false;
        reasons.push('user-off');
      } else if (override === 'on' && !conditional) {
        effective = true;
        if (!visible) reasons.push('user-on-bypass');
      }

      return {
        name,
        category,
        registration: conditional ? 'conditional' : 'registered',
        visibleByDefault: visible,
        effective: effective ? 'visible' : 'hidden',
        reasons,
      };
    })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/**
 * 把任意字符串**校验**为合法 `ToolCategory`（HTTP 入参用：只放行真实存在的类别，
 * 避免"任意字符串被塞进白名单 ⇒ 报表谎报可见"）。
 *
 * 合法集**派生**自 `TASK_TOOL_CATEGORIES` 的全部取值（不手写清单）。
 */
export function isKnownToolCategory(value: string): value is ToolCategory {
  return KNOWN_TOOL_CATEGORIES.has(value);
}

const KNOWN_TOOL_CATEGORIES: ReadonlySet<string> = new Set<string>(
  Object.values(TASK_TOOL_CATEGORIES).flat()
);

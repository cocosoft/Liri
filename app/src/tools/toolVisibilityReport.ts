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
 * - 名字域 = `TOOL_NAME_CONSTANTS`（**89**，D11-B 唯一来源）
 * - 注册面 = 生成物 `TOOL_NAMES`（**77**，口径「**全量 ∧ 可实例化**」）⇒ 差集 **12** 个 = `conditional`
 * - 类别 = `getToolCategory()`；任务白名单 = `getTaskToolCategories()`；恒保留 = `getMandatoryTools()`（随变体收敛）；
 *   有意归档 = `ARCHIVED_MISC_TOOLS`
 * - 判定口径与 `filterToolsByTask()` **逐条一致**（本模块只**解释**它，绝不改变它；
 *   `app/tests/tools/toolVisibilityReport.test.ts` 用"与 `filterToolsByTask` 全量交叉断言"钉死）
 *
 * ## 12 个 `conditional` 的处置（I-3 三分类，2026-10-18）
 * **删除 0 / 接线 0（本轮无可接线者）/ 保持条件化 12** —— 逐项理由与"再评估触发条件"见
 * `dev_docs/20261016/工具可见性治理-P4a-影子工具评估.md` §2.3；集合本身由
 * `app/tests/tools/toolNameLists.test.ts`（`KNOWN_CONDITIONAL_TOOL_NAMES`）钉死 ⇒ 新增未知差额即红。
 *
 * ## 两条边界（如实标注，勿扩写）
 * - **P1 不报 flag 门控**：生成物口径是「全量 ∧ 可实例化」，被 `cond(coreFeature(...))` 关掉的
 *   工具在**生成期取不到名字**，无法可靠反推 flag 名 ⇒ 归入 `conditional`（文案不含具体 flag）。
 *   `flag-gated-off` 原因随 P2 的 policy 表补上（方案 §3.4「P1/P2 边界」）。
 * - **本模块只读**：不参与注册、裁剪、执行 ⇒ **零行为变更**（方案 P1 约束）。
 */

import {
  ARCHIVED_MISC_TOOLS,
  TASK_TOOL_CATEGORIES,
  filterToolsByTask,
  getTaskToolCategories,
  getToolCategory,
  isMandatoryTool,
  isOutsideDefaultDisclosure,
} from './toolCategories';
import type { ToolCategory } from './toolCategories';
import { TOOL_NAME_CONSTANTS } from './toolNameConstants';
import type { ToolVisibilityOverrides } from './toolVisibilityOverrides';
import { deriveFromLegacyEffects } from './toolCapability';
import { resolveToolEffect } from './toolEffects';
import { TOOL_NAMES } from '@modules/constants/toolNames.generated';
import type { ToolRiskLevel } from '../utils/toolContract/Tool';
import type {
  SharedToolVisibilityReason,
  SharedShadowToolDisposition,
  SharedShadowToolReason,
} from '@shared/types';
import { getShadowToolDisposition } from './shadowToolDispositions';

/**
 * 可见/不可见的**结构化原因**。
 *
 * ⚠️ 枚举的**单一事实源在 `shared/types/tool-visibility.ts`**（双端共享，2026-10-16）：前端设置页
 * 必须对它做**穷尽渲染映射** ⇒ 若两侧各写一份联合，新增取值会在前端静默漏渲染。
 * 各取值语义见 shared 侧注释（P1 产出前 5 种，P2 追加 `user-off` / `user-on-bypass`）。
 */
export type ToolVisibilityReason = SharedToolVisibilityReason;

export interface ToolVisibilityReport {
  name: string;
  category: ToolCategory;
  /** 注册面静态实况（P1 只区分「在不在生成物里」） */
  registration: 'registered' | 'conditional';
  /**
   * 当前任务白名单下的可见性（**未叠加任何用户覆写**；覆写结果见 `effective`）。
   *
   * ⚠️ `conditional`（未进生成物）**恒为 false** —— 它根本不在注册表里，任何白名单都不可能让它出现；
   * 这是正确语义，不是"漏判"（I-4 ③）。
   */
  visibleByDefault: boolean;
  /** **覆写后**的最终判定（P1 无覆写 ⇒ 恒等于 `visibleByDefault`；P2 起可被改变） */
  effective: 'visible' | 'hidden';
  /**
   * 结构化原因：`effective === 'hidden'` ⇒ **必非空**；`visible` ⇒ 或为空（常规命中白名单）
   * 或含 `mandatory` / `user-on-bypass`（"可见但非默认"的两种情形，UI 可据此标注）。
   */
  reasons: ToolVisibilityReason[];
  /**
   * 风险级别（D5 能力契约，`utils/toolContract/Tool.ts:85`）—— 供设置页做**二次确认**分级。
   *
   * **派生口径（零新表）**：`TOOL_EFFECTS[name]`（`toolEffects.ts`，唯一事实源，`Record<ToolName,…>`
   * 受 typecheck 强制）经 `deriveFromLegacyEffects()`（`toolCapability.ts`，既有 D5 纯函数）派生：
   * `local`⇒`medium`、`external`⇒`high`、`none`⇒`low`。
   *
   * PR-4（2026-10-23）：**无 `TOOL_EFFECTS` 条目**（即 11 个未接线的 `conditional`）
   * ⇒ 判 **`unknown`（未评估）**，不再兜底 `high`。
   * 原口径"无法证明只读即视为对外写"会把 `agents_list`/`nodes` 等只读工具标成红色
   * "高风险"（实测 7/11 假阳性），与运行时"未声明风险"（PR-0 的 `UNDECLARED`）也不一致。
   */
  risk: ToolRiskLevel | 'unknown';
  /**
   * PR-4：`conditional` 工具的**未接线原因**（来自 `shadowToolDispositions` 登记表）。
   * 非 `conditional` 条目缺省。
   */
  conditionalReason?: SharedShadowToolReason;
  /** PR-4：`conditional` 工具的**处置方向**（`retire` / `rewrite` / `awaiting-provider`） */
  disposition?: SharedShadowToolDisposition;
  /**
   * 工具描述（C-3b T3，2026-10-18）：由调用方从 `Tool.getInfo().description` 注入
   * （与模型侧 `getToolSchemas()` 同一描述源）；`conditional` 未注册 ⇒ 缺省。
   * 本模块保持**纯函数**（不反向依赖 registry）。
   */
  description?: string;
}

/** 由既有声明派生风险级别（**纯函数**；输入为 `TOOL_EFFECTS`，无实例化） */
function deriveRiskOf(name: string): ToolRiskLevel | 'unknown' {
  const effect = resolveToolEffect(name);
  // PR-4：未声明效果（= 未接线的 conditional）⇒ 未评估，不再兜底 high
  if (!effect) return 'unknown';
  return deriveFromLegacyEffects({
    effect,
    // ⚠️ 该入参只在 `effect` **未声明**时被使用（见 toolCapability.ts 注释）⇒ 此处按保守口径取
    // "已声明为只读"（`sideEffect === 'none'`），未声明一律 `false`（⇒ 保守 high）。
    isReadOnly: effect.sideEffect === 'none',
  }).risk;
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
  const extraCategories = options.extraCategories ?? [];

  return Object.values(TOOL_NAME_CONSTANTS)
    .map<ToolVisibilityReport>((name) => {
      const category = getToolCategory(name);
      const conditional = !registered.has(name);
      const reasons: ToolVisibilityReason[] = [];

      // I-4（2026-10-18）：可见性**单一判定内核** = `filterToolsByTask`（真实裁剪同源）；
      // 下面的分支只负责**解释原因**，不再各写一套判定（防两套口径漂移）。
      if (isMandatoryTool(name)) {
        // 恒保留：即使类别不在白名单（如 todo_write 属 'task'）也仍可见
        reasons.push('mandatory');
      } else if (ARCHIVED_MISC_TOOLS.has(name)) {
        reasons.push('archived');
      } else if (category === 'misc') {
        reasons.push('unregistered-category');
      } else if (!allowed.has(category)) {
        reasons.push('not-in-task-whitelist');
      } else if (
        isOutsideDefaultDisclosure(name, options.taskType, extraCategories)
      ) {
        // AC-16（P4，2026-10-28）：类别命中却被**默认披露面白名单**收窄 ⇒ 如实给出原因
        // （否则该工具 hidden 但 reasons 为空，违反"hidden 必带原因"的界面契约）
        reasons.push('not-in-default-disclosure');
      }
      let visible =
        filterToolsByTask([{ name }], options.taskType, [...extraCategories])
          .length === 1;
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

      // PR-4：影子工具带出"未接线原因 + 处置方向"（来自登记表；未登记则留空由门禁报错）
      const shadow = conditional ? getShadowToolDisposition(name) : undefined;

      return {
        name,
        category,
        registration: conditional ? 'conditional' : 'registered',
        visibleByDefault: visible,
        effective: effective ? 'visible' : 'hidden',
        reasons,
        risk: deriveRiskOf(name),
        ...(shadow
          ? {
              conditionalReason: shadow.reason,
              disposition: shadow.disposition,
            }
          : {}),
      };
    })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/**
 * 为报表**附加工具描述**（C-3b T3，2026-10-18；纯函数）。
 *
 * 描述来源由调用方提供（`Tool.getInfo().description` ⇒ 与模型侧 `getToolSchemas()` 同源），
 * 本函数只做按名合并：缺失项保持原样、空表直接返回原引用（零拷贝）。
 */
export function attachToolDescriptions(
  report: ToolVisibilityReport[],
  descriptions: ReadonlyMap<string, string>
): ToolVisibilityReport[] {
  if (descriptions.size === 0) return report;
  return report.map((entry) => {
    const description = descriptions.get(entry.name);
    return description ? { ...entry, description } : entry;
  });
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

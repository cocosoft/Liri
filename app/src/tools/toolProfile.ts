/**
 * 会话级工具 profile —— **能力标签 → 追加工具类别**（TG-4 / `T1-13`，2026-10-13）。
 *
 * ## 定位（对齐原文，勿扩写）
 * `dev_docs/20261012/google ai 建议.md:78/152` + 工具治理方案 §5 阶段 3.3：**会话显式声明的
 * 能力**（如 `media` / `coding`）⇒ 把对应**工具类别**追加进该会话的可见白名单。落地方式 =
 * **复用**既有 `filterToolsByTask(tools, taskType, extraCategories)`（CS01：**不新建 Top-K 路由**）。
 *
 * ## 声明落点与默认行为
 * `session.metadata.toolProfile`（能力标签数组）。**未声明 ⇒ 返回空 ⇒ 零行为变更**
 * （不引入"无消费者开关"，CS03）。
 *
 * ## 两条硬边界
 * - **可见性 ≠ 授权**：追加类别只让工具对模型**可见**；命令执行 / 文件写入仍走既有审批与 PathGuard。
 * - **可复现性**（`✅-4`）：注入后的**最终可见集**由 `execution/preparedSnapshot.ts` 在
 *   **PREPARED 阶段随会话事件落盘**；重放**必须**经 `pickPreparedSnapshot` 读落盘快照，
 *   **严禁**直读当前 `toolProfile`（否则长任务运行期改 profile ⇒ 重放工具面与历史不一致）。
 *
 * 见 `.trae/specs/execution-prepared-snapshot-persistence.md` §10。
 */

import { getLogger } from '@modules/monitoring';
import type { ToolCategory } from './toolCategories';

const logger = getLogger('tools:profile');

/**
 * 能力标签 → 追加的**工具类别**（**唯一事实源**）。
 *
 * ⚠️ 只登记**有真实依据**的能力（下两条均被 `google ai 建议.md` 点名）；凭想象扩充即造需求。
 */
export const TOOL_PROFILE_CATEGORIES: Record<string, readonly ToolCategory[]> =
  {
    /** 媒体面：图像生成/分析、视频生成/分析、音频·PDF·二维码·媒体元数据 */
    media: ['image', 'video', 'media'],
    /** 开发面：代码/LSP/git（`shell` 已在 chat/default 保底集内 ⇒ 此处不重复追加） */
    coding: ['code'],
  };

/** 已告警的未知标签（一次性告警；避免长任务每轮重复告警） */
const warnedUnknownTags = new Set<string>();

/**
 * 是否为**已登记**的能力标签（P4b，2026-10-16：`toolProfile` 写入口的边界校验用）。
 *
 * 单一事实源 = `TOOL_PROFILE_CATEGORIES` 的键集（不另写清单）；消费者 = HTTP handler
 * （`PATCH /v1/sessions/{id}/meta` 的 `tool_profile` 字段）—— 该文件既有的
 * `isWorkMode` 同口径：**非法值 → 400，不静默忽略**（静默忽略正是本项要修的根因：
 * 原先 handler 有字段白名单，`toolProfile` 不在其中 ⇒ 传了也被丢掉且无任何提示）。
 */
export function isKnownToolProfileTag(tag: string): boolean {
  return Object.prototype.hasOwnProperty.call(TOOL_PROFILE_CATEGORIES, tag);
}

/**
 * 解析会话 profile 能力标签 → 追加的**工具类别**（去重）。
 *
 * 未登记标签 ⇒ **忽略 + 一次性告警**（不阻断主链路，亦**不臆造**类别）。空 / 未声明 ⇒ `[]`。
 */
export function resolveToolProfileCategories(
  profile?: readonly string[]
): ToolCategory[] {
  if (!profile || profile.length === 0) return [];

  const categories = new Set<ToolCategory>();
  for (const tag of profile) {
    const mapped = TOOL_PROFILE_CATEGORIES[tag];
    if (!mapped) {
      if (!warnedUnknownTags.has(tag)) {
        warnedUnknownTags.add(tag);
        logger.warn(
          '未知会话 profile 能力标签 ⇒ 已忽略（请在 TOOL_PROFILE_CATEGORIES 登记）',
          { tag }
        );
      }
      continue;
    }
    for (const c of mapped) categories.add(c);
  }
  return [...categories];
}

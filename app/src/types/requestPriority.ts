// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 请求优先级（跨会话资源治理 A5，2026-10-05）
 *
 * **单一事实源**（core 层 `types` 模块，纯类型、无出向依赖）：
 * - `session`（service 层）的 `StreamMessageOptions` 需要该字段；
 * - `resourceGovernor`（app 层）需要同一枚举。
 *
 * ⚠️ 若把该类型放在 app 层（如 `resourceGovernor`），则 `session`(service) 引用它即构成
 * **service → app 倒挂**（R00-001）⇒ 故落在 core，两侧引用均合法。
 *
 * CS02：优先级是**结构化枚举标记**，非用户可见文案，禁止用字符串匹配做业务判定。
 */

export const REQUEST_PRIORITIES = ['interactive', 'background'] as const;

/** 请求优先级：`interactive` = 人工实时对话；`background` = 渠道/定时/后台任务 */
export type RequestPriority = (typeof REQUEST_PRIORITIES)[number];

/** 缺省优先级（未显式声明时） */
export const DEFAULT_REQUEST_PRIORITY: RequestPriority = 'interactive';

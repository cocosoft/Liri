/**
 * 事件格式版本化 + 已知类型注册表（D2，2026-08-24）
 *
 * 对齐 deepseek-harness：
 *   - `KNOWN_SESSION_EVENT_TYPES`（known-event-types.ts）：读取端区分已知/未知类型
 *   - `SESSION_FORMAT_VERSION` 方向性拒绝（session-persistence/coordinator.ts）
 *
 * 设计决策（见 dev_docs/20260824/D2-格式版本化与ignorable-设计方案-20260824.md）：
 *   - 未知类型处理：逐事件跳过 + 告警（本项目事件不承载"必须解释才有意义"
 *     的强语义，chunk 已独立成事件）——区别于 deepseek-harness 的整日志拒绝
 *   - 版本兼容：存量日志 schemaVersion 缺省视为当前版本（零迁移）
 *   - ignorable 是唯一合法跳过通道：未知类型只有显式声明可跳过才放行
 */

import type { LiriEvent, LiriEventType } from './events';

/** 当前事件格式版本。无字段事件视为当前版本（兼容存量）。 */
export const LIRI_EVENT_FORMAT_VERSION = 1;

/**
 * 已知事件类型的**编译期清单**（P0-2，2026-09-22）。
 *
 * 此前本注册表为 `ReadonlySet<string>`，与 `LiriEventType` 联合**无类型链接** ⇒
 * 新增事件类型但漏登记时，只在**写入运行时**被 `assertEventWritable` 拒绝（难以及时发现）。
 * 改为从本数组派生后，两处漂移都会**编译失败**：
 * - 数组里写了不存在的类型 ⇒ `satisfies readonly LiriEventType[]` 报错；
 * - 联合新增成员但漏加进本数组 ⇒ 文件末的**穷尽断言**报错。
 *
 * 与 `LiriEventMap` 的强制方式互补（Map 由 `LiriEvent<T>.data: LiriEventMap[T]` 泛型索引强制）。
 */
const ALL_SESSION_EVENT_TYPES = [
  // ─── 对话核心 ───
  'turn/start',
  'turn/end',
  'user/message',
  'assistant/thinking',
  'assistant/text',
  'assistant/text-batch',
  'assistant/tool_call',
  'tool/result',
  'tool/canceled',
  // ─── 富块 ───
  'assistant/status',
  'assistant/progress',
  'assistant/question',
  'assistant/todo',
  'assistant/doc_workflow',
  'assistant/pdca_workflow',
  'assistant/truncation',
  // ─── Code Mode（CM-5，2026-08-25） ───
  'assistant/code_run',
  // ─── 交付物/diff ───
  'assistant/deliverable',
  'assistant/diff',
  // ─── 上下文管理 ───
  'context/compaction',
  'context/summary',
  // TR-12-B（2026-09-22）：模型输入快照（工具清单 + 系统提示词分段，引用式去重）
  'context/model-input',
  // D-1（2026-09-02）：会话远期摘要事件
  'session/summary',
  // ─── 系统与日志 ───
  'system/error',
  'system/warning',
  'system/info',
  'metric/timing',
  // ─── 通道 ───
  'channel/connect',
  'channel/disconnect',
  'channel/message',
  // ─── 请求边界（P2-2，2026-09-23） ───
  'request/start',
  // ─── 目标（Goal）生命周期（B2-2，2026-09-23） ───
  'goal/created',
  'goal/updated',
  'goal/status_changed',
  'goal/injected',
  // ─── 子代理恢复通路审计（B4-1，2026-09-23） ───
  'agent/recovery',
  // ─── 生命周期 ───
  'session/start',
  'session/end',
  // ─── 标题（D5，2026-08-24） ───
  'session/title',
] as const satisfies readonly LiriEventType[];

/**
 * 已知事件类型集合——**从 `ALL_SESSION_EVENT_TYPES` 派生**（不再手工维护两份）。
 *
 * **对外保持 `ReadonlySet<string>`**：读取端 `assertEventReadable` 面对的 `type`
 * 来自磁盘、类型上就是 `string`（未经验证），`.has()` 必须接受任意字符串
 * （若声明为 `ReadonlySet<LiriEventType>`，`has(string)` 会编译失败）。
 * 类型安全由清单的 `satisfies` 与文件末**穷尽断言**承担，而非由 Set 的类型参数承担。
 */
export const KNOWN_SESSION_EVENT_TYPES: ReadonlySet<string> = new Set<string>(
  ALL_SESSION_EVENT_TYPES
);

/**
 * 方向性版本拒绝：版本高于当前 → 提示升级；缺省/当前 → 可读。
 *
 * @param version 事件 schemaVersion（缺省=存量 v0 语义，视为当前）
 * @returns 拒绝原因（null = 可读）
 */
export function eventFormatVersionRefusal(
  version: number | undefined
): string | null {
  if (version === undefined || version <= LIRI_EVENT_FORMAT_VERSION) {
    return null;
  }
  return `事件格式 v${version} 高于当前支持 v${LIRI_EVENT_FORMAT_VERSION}，可能由更新版本写入——请升级应用后重试`;
}

/**
 * 读取端事件可接受性判定（D2）：
 *   - 版本超前 → 拒绝
 *   - 未知类型且未标记 ignorable → 拒绝（可能由更新版本写入）
 *   - 其余（已知类型 / 未知但 ignorable）→ 可读
 */
export function assertEventReadable(event: {
  type: string;
  schemaVersion?: number;
  ignorable?: true;
}): { ok: true } | { ok: false; reason: string } {
  const versionCheck = eventFormatVersionRefusal(event.schemaVersion);
  if (versionCheck !== null) {
    return { ok: false, reason: versionCheck };
  }
  if (!KNOWN_SESSION_EVENT_TYPES.has(event.type) && event.ignorable !== true) {
    return {
      ok: false,
      reason: `未知事件类型 "${event.type}" 且未标记 ignorable，可能由更新版本写入`,
    };
  }
  return { ok: true };
}

/**
 * 写入端事件类型校验（D2，防御性）：运行时发出未知类型 → 拒绝。
 * TS 层已保证 LiriEvent.type ∈ 联合类型，此处防御运行时动态构造。
 */
export function assertEventWritable(
  event: Pick<LiriEvent, 'type' | 'ignorable'>
):
  | {
      ok: true;
    }
  | { ok: false; reason: string } {
  if (!KNOWN_SESSION_EVENT_TYPES.has(event.type) && event.ignorable !== true) {
    return {
      ok: false,
      reason: `写入未知事件类型 "${event.type}" 且未标记 ignorable`,
    };
  }
  return { ok: true };
}

// ─── 编译期穷尽断言（P0-2，2026-09-22）───────────────────────────────────────

/**
 * 若 `LiriEventType` 新增成员却未加入 `ALL_SESSION_EVENT_TYPES`，`MissingEventType`
 * 不再是 `never` ⇒ 下方赋值**编译失败**。
 *
 * 这条断言是"模型可见 ⇔ 已落盘"约束在本仓的**可执行落点**：
 * 新增事件类型（即新增一类可落盘的模型可见输入）时，必须同时把它登记进类型联合、
 * `LiriEventMap` 载荷与本清单，否则构建不通过。
 */
type MissingEventType = Exclude<
  LiriEventType,
  (typeof ALL_SESSION_EVENT_TYPES)[number]
>;
const _assertAllEventTypesRegistered: MissingEventType extends never
  ? true
  : never = true;
void _assertAllEventTypesRegistered;

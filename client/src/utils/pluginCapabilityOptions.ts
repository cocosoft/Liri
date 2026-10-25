/**
 * 插件能力勾选的**纯展示逻辑**（T25-08 P2，市场页「能力」面板）。
 *
 * 为什么要单独抽出来：页面只做渲染，勾选可行性/顺序/去重这类判断放纯函数里，
 * 才能用单测钉住（前端此前没有插件相关测试，见 `tests/pluginCapabilityOptions.test.ts`）。
 *
 * 口径（与后端 `PluginCapabilityState` 一致）：
 * - **可勾选** = 在 `available`（已实现）里；`unimplemented` 一律不可勾（授权了也没有提供面）；
 * - 展示顺序：先按清单声明顺序，再补上"未声明但可授权"的能力（便于用户主动开启）；
 * - `checked` 只看 `granted`；`missing` 不参与渲染（它只是后端给出的拒绝原因）。
 */

export interface CapabilityOptionInput {
  declared: readonly string[];
  granted: readonly string[];
  available: readonly string[];
  unimplemented: readonly string[];
}

export interface CapabilityOption {
  name: string;
  checked: boolean;
  /** 是否可勾选（false = 未实现，展示为禁用） */
  selectable: boolean;
}

/** 生成面板选项（顺序稳定、无重复） */
export function buildCapabilityOptions(
  input: CapabilityOptionInput,
): CapabilityOption[] {
  const granted = new Set(input.granted);
  const available = new Set(input.available);
  const unimplemented = new Set(input.unimplemented);

  const ordered: string[] = [];
  const seen = new Set<string>();
  const push = (name: string): void => {
    if (!name || seen.has(name)) return;
    seen.add(name);
    ordered.push(name);
  };
  for (const name of input.declared) push(name);
  for (const name of input.available) push(name);
  for (const name of input.unimplemented) push(name);

  return ordered.map((name) => ({
    name,
    checked: granted.has(name),
    selectable: available.has(name) && !unimplemented.has(name),
  }));
}

/**
 * 切换某项后的授权集合（纯函数）。
 *
 * - 不可勾选的项**原样返回**（防 UI 误触发把未实现能力写进授权表）；
 * - 结果**只含 `available`**：PUT 接口对集合外的名字直接 400，若把历史遗留的
 *   `events` 等带上去，用户每次保存都会失败；
 * - 顺序按 `available` 声明顺序归一化，便于后端 diff 与日志阅读。
 */
export function toggleCapabilityGrant(
  granted: readonly string[],
  name: string,
  checked: boolean,
  available: readonly string[],
): string[] {
  if (!available.includes(name)) return [...granted];
  const next = new Set(granted);
  if (checked) next.add(name);
  else next.delete(name);
  return available.filter((cap) => next.has(cap));
}

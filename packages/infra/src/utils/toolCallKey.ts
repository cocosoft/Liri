/**
 * 工具调用参数的**归一化键**（2026-11-01）
 *
 * 用途：判断"同工具 + 同参数"的重复调用（循环守卫 / 纠偏注入 / 评测指标），必须用**同一口径**归一化，
 * 否则同一对调用在不同模块里会得到不同 key（CS01 归一化）。
 *
 * 口径（与既有 `ReActToolLoop` / 评测侧一致，未改语义）：
 *   · 键按字典序排序（对象字面量顺序不影响结果）；
 *   · 对象/数组值序列化为 JSON，其余 `String(v)`；
 *   · 序列化结果截断到 200 字符（超长参数不参与区分，避免签名爆炸）；
 *   · 序列化失败（循环引用 / BigInt）⇒ 返回空串（不参与区分）。
 */
export function toolCallArgsKey(
  args: Record<string, unknown> | undefined
): string {
  if (!args) return '';
  try {
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(args).sort()) {
      const v = args[k];
      sorted[k] =
        v !== null && typeof v === 'object' ? JSON.stringify(v) : String(v);
    }
    const json = JSON.stringify(sorted);
    return json.length > 200 ? json.slice(0, 200) : json;
  } catch {
    return '';
  }
}

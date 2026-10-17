// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 系统提示的**最终拼装**（纯函数，单一实现）
 *
 * 顺序固定（2026-10-17）：
 *   ① 基础组装（`getOrAssembleSystemPrompt` 的产物，含缓存）
 *   ② 用户自定义系统提示（`options.systemPrompt`）
 *   ③ 运行时补充（`options.runtimeSystemNote`，如通道投递契约）
 *
 * 为什么单独成函数：流式（`StreamPipeline`）与非流式（`sendMessageFlow`）此前各写了一遍
 * ①② 的拼接；接 ③ 时若再抄一遍，就会漂移（CS01）。两条路径共用本函数。
 *
 * ⚠️ ③ **不缓存**：它按请求注入（同一会话的不同入口可给出不同补充），
 *    故放在 `getOrAssembleSystemPrompt` 的缓存之外。
 */
export function composeSystemPrompt(args: {
  assembled: string;
  customPrompt?: string;
  runtimeNote?: string;
}): string {
  const parts = [args.assembled];
  if (args.customPrompt) {
    parts.push(`## 用户自定义系统提示\n${args.customPrompt}`);
  }
  if (args.runtimeNote) {
    parts.push(args.runtimeNote);
  }
  return parts.join('\n\n');
}

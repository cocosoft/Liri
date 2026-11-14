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
 * 推理模式检测 (Thinking Mode)
 *
 * - 检测模型是否支持推理模式（reasoning_content）
 * - 为流式调用提供正确的 thinking 参数
 * - 清理模型幻觉生成的工具调用标记
 *
 */

/**
 * 检测模型是否为推理模式模型
 *
 */
export function isThinkingModeModel(model: string): boolean {
  if (model.includes('reasoner') || model.includes('reasoning')) return true;
  // 广义推理模型启发式匹配（替换原本 hardcoded deepseek-v4-flash/pro）
  if (model.includes('-v4-') || model.match(/-pro$/i)) return true;
  return false;
}

/**
 * 获取模型的 thinking 参数值
 *
 * @returns 'enabled' | 'disabled' | undefined
 *   - 'enabled': 推理模型（reasoner / v4-pro / v4-flash）
 *   - 'disabled': 非推理模型
 *   - undefined: 第三方端点，跳过该字段
 */
export function thinkingModeForModel(
  model: string
): 'enabled' | 'disabled' | undefined {
  if (!model) return undefined;
  if (isThinkingModeModel(model)) return 'enabled';
  return 'disabled';
}

/**
 * 清理模型幻觉生成的工具调用标记
 *
 * 当 API 调用设置 `tools: undefined` 时，部分模型仍会在 content 中
 * 幻觉输出 DSML/XML 格式的工具调用标记，需要清理。
 */
export function stripHallucinatedToolMarkup(content: string): string {
  let out = content;

  // DeepSeek DSML 格式
  out = out.replace(
    /<｜DSML｜function_calls>[\s\S]*?<\/?｜DSML｜function_calls>/g,
    ''
  );
  out = out.replace(
    /<\|DSML\|function_calls>[\s\S]*?<\/?\|DSML\|function_calls>/g,
    ''
  );
  out = out.replace(/<function_calls>[\s\S]*?<\/function_calls>/g, '');

  // 未配对的 DSML 开头（模型截断导致）
  out = out.replace(/<｜DSML｜[\s\S]*$/g, '');

  return out.trim();
}

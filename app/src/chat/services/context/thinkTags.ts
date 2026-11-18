// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// `<think>/<response>` 标签规整（2026-11-18，从 `MessageContextPipeline` 外移）
//
// 只做**内容级**标签处理：补全、剥离、孤儿工具标签清理。不读会话、不碰消息数组，
// 因而被流式链路、恢复链路、终态判定与包外适配器共用（`@modules/chat` 再导出）。
// 对外符号与实现逐字搬迁，行为不变。

/**
 * 检测指定位置是否在 markdown fenced code block (```) 内部
 */
function isInsideFencedBlock(content: string, pos: number): boolean {
  const fenceRegex = /```/g;
  let inside = false;
  let match: RegExpExecArray | null;
  while ((match = fenceRegex.exec(content)) !== null) {
    if (match.index >= pos) break;
    inside = !inside;
  }
  return inside;
}

/**
 * 内容标签兜底处理：当模型未按要求使用 <think>/<response> 标签时，
 * 检测并补全标签结构，防止推理内容泄漏到用户可见回复中。
 *
 * 检测策略：
 * 1. 已有 <think> 或 <response> 标签 → 不作处理
 * 2. 无标签且内容以"规划语言"开头 → 尝试找到响应起点并分别包裹
 * 3. 无标签且无规划特征 → 包裹在 <response> 中
 *
 * @param content 原始累积内容
 * @returns 处理后的内容（可能被包裹在标签中）
 */
export function ensureThinkResponseTags(content: string): string {
  if (!content?.trim()) return content;

  // 已有标签 → 不处理
  if (/<think>/i.test(content) || /<response>/i.test(content)) {
    return content;
  }

  // 规划语言特征词（中英文混合）
  const planningPatterns = [
    /^(好的|OK|让我|我先|先看看|现在让我|我需要|我需要先|我来|I('ll| will)|Let me|First|Now let me)/,
    /^(用户想要|用户想让|用户要求|The user (want|ask|need))/,
  ];

  const hasPlanningPrefix = planningPatterns.some((p) =>
    p.test(content.trim())
  );

  if (!hasPlanningPrefix) {
    // 无规划特征 → 直接包裹为 <response>
    return `<response>${content}</response>`;
  }

  // 有规划前缀 → 尝试找到响应正文的起点
  // 常用分隔标记：markdown 标题、水平线、明确的"结论"段落
  const responseMarkers = [
    /\n(#{1,3}\s)/, // markdown heading: ## 标题
    /\n(---)/, // 水平线
    /\n(一句话结论|核心发现|总结|建议如下|报告|结果)\n/, // 中文结论标记
    /\n\*\*(结论|发现|建议|总结)\*\*/, // 粗体标记
  ];

  let splitIdx = -1;
  for (const marker of responseMarkers) {
    const m = content.match(marker);
    if (m?.index && m.index > 20 && !isInsideFencedBlock(content, m.index)) {
      splitIdx = m.index;
      break;
    }
  }

  if (splitIdx > 0) {
    const thinking = content.slice(0, splitIdx).trim();
    const response = content.slice(splitIdx).trim();
    return `<think>${thinking}</think>\n<response>${response}</response>`;
  }

  // 无法找到分隔点 → 整体包裹为 <response>（宁可漏过不可错杀）
  return `<response>${content}</response>`;
}

/**
 * 剥离 think/response 标签
 * - think 标签：移除标签及其内容（内部推理，用户不可见）
 * - response 标签：仅移除标签，保留内容（用户可见的最终回答）
 */
export function stripThinkResponseTags(content: string): string {
  if (!content?.trim()) return content;

  let result = content;

  // 移除 <think>...</think> 及变体标签（连同内容一起删除）
  // \1 反向引用匹配对应的结束标签名
  const thinkPattern =
    /<(think|thinking|reasoning|thought|reflection|analysis|internal)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
  result = result.replace(thinkPattern, '');

  // P3-7d（2026-09-02）：未闭合 think 块——<think> 开标签存在但无配对 </think>
  // （实测模型以 "</parameter>\n\n</tool_calls>" XML 残渣闭合思考内容，配对的 </think>
  // 永不出现），若不处理则整个思考草稿作为最终正文交付。负向前瞻
  // (?![\s\S]*?<\/\1\s*>) 确保仅在无配对闭合时剥离到末尾，已配对的不会被二次误伤。
  const unclosedThinkPattern =
    /<(think|thinking|reasoning|thought|reflection|analysis|internal)\b[^>]*>(?![\s\S]*?<\/\1\s*>)[\s\S]*$/gi;
  result = result.replace(unclosedThinkPattern, '');

  // 移除 <response>...</response> 标签（仅移除标签，保留内容）
  result = result.replace(/<response\b[^>]*>/gi, '');
  result = result.replace(/<\/response\s*>/gi, '');

  return result.trim();
}

/**
 * 剥离残留的工具调用 XML 标签（兜底清理）
 *
 * 当模型输出残缺工具调用（如仅输出 </parameter></invoke></tool_calls> 闭合标签、
 * 或被 scrubber 拒绝后残留的 <tool_calls> 开标签）时，这些标签不应暴露给用户
 * 或持久化到会话。StreamingToolCallScrubber 只擦除被验证为真实工具调用的块，
 * 孤立的闭合标签（</parameter>、</invoke>、</tool_calls>、</tool_call>）不在其擦除
 * 范围内，此处统一剥离，与前端 stripStructuralTags 行为对齐。
 */
export function stripOrphanToolTags(text: string): string {
  if (!text) return text;
  if (!text.trim()) return '';
  return (
    text
      .replace(/<\/?(?:parameter|invoke|tool_call|tool_calls)\b[^>]*>/gi, '')
      // 2026-11-06：DeepSeek 特殊 token 残渣（模型把工具调用写成正文时出现，
      // 形如 `</｜｜DSML｜｜ parameter>`）。不清掉会随 assistant 消息落盘，
      // 并被后续流程（如 PDCA 任务描述）当成正文继续使用。
      .replace(/<\/?\s*｜｜\s*DSML\s*｜｜[^>]*>/gi, '')
      .replace(/｜｜\s*DSML\s*｜｜/gi, '')
      .trim()
  );
}

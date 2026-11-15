// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * WebFetch 响应正文读取（从 `WebFetchTool.execute` 外移，纯 IO、行为逐字不变）
 *
 * 为什么外移：`execute` 是 IO 编排函数，`complexity` 告警 41（阈值 40）。正文读取与截断
 * 是**判据集中、无副作用耦合**的一段 ⇒ 抽成独立纯 IO 函数后既降复杂度，也获得可直接单测的
 * 接缝（此前只能整体跑工具）。
 *
 * 语义要点（逐字保留原实现）：
 * - `content-type` 含 `application/json` ⇒ `JSON.parse` 后 `JSON.stringify(_, null, 2)` 美化
 * - 其余一律按文本读（含空 `content-type`）
 * - 超长按 `maxContentLength` 截断，并在尾部标注**原始长度**（截断后的长度没有意义）
 */
export interface ResponseContent {
  content: string;
  contentType: string;
}

/** 便于单测注入的最小响应面（`Response` 天然满足） */
export type TextualResponse = Pick<Response, 'headers' | 'json' | 'text'>;

/**
 * 读取响应正文（JSON 美化 / 文本原样），并按 `maxContentLength` 截断。
 */
export async function readResponseContent(
  response: TextualResponse,
  maxContentLength: number
): Promise<ResponseContent> {
  const contentType = response.headers.get('content-type') || '';
  let content: string;

  if (contentType.includes('application/json')) {
    const jsonData = await response.json();
    content = JSON.stringify(jsonData, null, 2);
  } else {
    content = await response.text();
  }

  if (content.length > maxContentLength) {
    content =
      content.substring(0, maxContentLength) +
      `\n\n[Content truncated. Original length: ${content.length} characters]`;
  }

  return { content, contentType };
}

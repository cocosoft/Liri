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
 * 渠道工具进度通知摘要（中文人话文案）
 *
 * 将技术化的工具名+参数转成一行用户可读描述，用于 QQ 等受限渠道的
 * 工具进度通知（替代裸工具名 "🔧 开始执行：bash…"）。
 *
 * 与 client/src/utils/toolHumanSummary.ts（UI 卡片渲染）及
 * services/toolUseSummary（英文历史压缩）用途不同：本文件面向
 * 渠道推送，要求短文案 + 中文动作 + 关键参数摘要。
 *
 * 用法：
 *   formatToolNotifySummary('glob', { pattern: 'xx模式xx' })
 *   // → "搜索文件：xx模式xx"
 */

/** 摘要最大长度（字符），超长截断 */
const MAX_DETAIL_LEN = 40;

/** 工具名 → 动作描述 + 参数提取键（按优先级） */
const TOOL_ACTIONS: Record<string, { action: string; argKeys: string[] }> = {
  // ---- 执行类 ----
  bash: { action: '执行命令', argKeys: ['command', 'cmd', 'script'] },
  powershell: { action: '执行命令', argKeys: ['command', 'cmd', 'script'] },
  shell: { action: '执行命令', argKeys: ['command', 'cmd', 'script'] },

  // ---- 搜索类 ----
  glob: { action: '搜索文件', argKeys: ['pattern'] },
  file_search: { action: '搜索文件', argKeys: ['pattern'] },
  grep: { action: '搜索内容', argKeys: ['pattern'] },
  web_search: { action: '网络搜索', argKeys: ['query', 'keywords'] },
  web_fetch: { action: '获取网页', argKeys: ['url', 'link'] },
  fetch: { action: '获取内容', argKeys: ['url', 'link'] },

  // ---- 文件操作类（双命名兼容：file_read/read_file）----
  file_read: { action: '读取文件', argKeys: ['file_path', 'path', 'filePath'] },
  read_file: { action: '读取文件', argKeys: ['file_path', 'path', 'filePath'] },
  file_write: {
    action: '写入文件',
    argKeys: ['file_path', 'path', 'filePath'],
  },
  write_file: {
    action: '写入文件',
    argKeys: ['file_path', 'path', 'filePath'],
  },
  file_edit: { action: '编辑文件', argKeys: ['file_path', 'path', 'filePath'] },
  edit_file: { action: '编辑文件', argKeys: ['file_path', 'path', 'filePath'] },

  // ---- 内容生成类 ----
  image_generate: { action: '生成图片', argKeys: ['prompt'] },
  video_generate: { action: '生成视频', argKeys: ['prompt'] },
  doc_generate: { action: '生成文档', argKeys: ['title', 'prompt'] },

  // ---- 任务类 ----
  todo_write: { action: '更新任务列表', argKeys: [] },
  create_task_list: { action: '创建任务列表', argKeys: [] },
};

/**
 * 生成工具进度通知摘要
 *
 * @returns 如 glob 工具返回 "搜索文件：xx模式xx"；未知工具回退 "使用工具 {name}：{首参}"
 */
export function formatToolNotifySummary(
  name: string,
  args: Record<string, unknown> | undefined
): string {
  const spec = TOOL_ACTIONS[name];
  if (!spec) {
    return fallbackSummary(name, args);
  }
  const detail = extractArg(args, spec.argKeys, spec.action === '执行命令');
  return detail ? `${spec.action}：${detail}` : spec.action;
}

/** 未知工具：显示工具名 + 第一个字符串参数（如有） */
function fallbackSummary(
  name: string,
  args: Record<string, unknown> | undefined
): string {
  const firstStr = Object.values(args ?? {}).find(
    (v) => typeof v === 'string' && v.length > 0
  ) as string | undefined;
  if (firstStr) {
    return `使用工具 ${name}：${truncate(firstStr)}`;
  }
  return `使用工具 ${name}`;
}

/** 按键优先级提取字符串参数；命令类只取首行 */
function extractArg(
  args: Record<string, unknown> | undefined,
  keys: string[],
  firstLineOnly: boolean
): string {
  for (const key of keys) {
    const val = args?.[key];
    if (typeof val === 'string' && val.trim().length > 0) {
      const v = firstLineOnly ? val.split('\n')[0]!.trim() : val.trim();
      return truncate(v);
    }
  }
  return '';
}

/** 超长截断（保留尾部：路径/文件名信息在尾部） */
function truncate(s: string): string {
  if (s.length <= MAX_DETAIL_LEN) {
    return s;
  }
  return `…${s.slice(-(MAX_DETAIL_LEN - 1))}`;
}

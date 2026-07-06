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
 * Agent Compaction 共享工具函数
 * 供 CompactionManager 和 SlidingWindow 共用
 */

/**
 * 从内容中提取关键路径信息（文件路径、URL、工具调用 ID 等结构化标识）
 * 用于截断时保留关键信息，避免 Agent 因路径损坏而行为错乱
 *
 * @param content 待提取的文本内容
 * @returns 去重后的关键路径列表（最多 5 条）
 */
export function extractKeyPaths(content: string): string[] {
  const paths: string[] = [];

  // 匹配 JSON 中的路径/URL 字段
  const jsonPathPattern =
    /"(filePath|localUrl|inputPath|outputPath|comparePath|path|url|imageUrl)":\s*"([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = jsonPathPattern.exec(content)) !== null) {
    paths.push(match[2]);
  }

  // 匹配 Windows 绝对路径（如 E:\PY\CODES\PY_APP\app\data\...\file.png）
  const winPathPattern = /([A-Za-z]:\\[^\s"',;}\]\)]+(?:\.\w{2,6}))/g;
  while ((match = winPathPattern.exec(content)) !== null) {
    paths.push(match[1]);
  }

  // 匹配 Unix 绝对路径（如 /home/user/project/file.png）
  const unixPathPattern = /(\/[^\s"',;}\]\)]+(?:\.\w{2,6}))/g;
  while ((match = unixPathPattern.exec(content)) !== null) {
    paths.push(match[1]);
  }

  // 匹配形如 /v1/images/static/media/xxx 的静态资源路径
  const staticPathPattern =
    /(\/v1\/[a-zA-Z]+\/static\/[^\s"',;}\]\)]+)/g;
  while ((match = staticPathPattern.exec(content)) !== null) {
    paths.push(match[1]);
  }

  // 去重，最多返回 5 条
  return [...new Set(paths)].slice(0, 5);
}

/**
 * 在截断后的内容中附加关键路径信息
 *
 * @param truncated 已截断的内容
 * @param originalContent 原始完整内容
 * @param maxSnippetLen 截断长度
 * @returns 附加了关键路径的截断内容
 */
export function appendKeyPathsToTruncated(
  truncated: string,
  originalContent: string,
  maxSnippetLen: number
): string {
  const keyPaths = extractKeyPaths(originalContent);

  if (keyPaths.length > 0) {
    return (
      truncated +
      `\n[关键路径]\n${keyPaths.join('\n')}` +
      `\n... [截断 ${Math.max(0, originalContent.length - maxSnippetLen)} 字符]`
    );
  }

  return (
    truncated +
    `\n... [截断 ${Math.max(0, originalContent.length - maxSnippetLen)} 字符]`
  );
}

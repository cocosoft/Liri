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
 * 工具名称常量（共享）
 *
 * PathGuard 和 FileIOLoopDetector 统一从本文件导入，单一事实来源。
 */

/** 读类工具名称集合 */
export const READ_TOOLS = new Set([
  'read_file',
  'read',
  'cat',
  'search_files',
  'search_content',
  'glob',
  'grep',
  'list_files',
  'ls',
]);

/** 写类工具名称集合 */
export const WRITE_TOOLS = new Set([
  'write_file',
  'write',
  'edit_file',
  'replace_in_file',
  'create_file',
  'delete_file',
  'delete_files',
]);

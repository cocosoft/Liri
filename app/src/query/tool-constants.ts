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
 * 文件 IO 工具名清单（**单一事实来源**，全部为真实注册名）。
 *
 * 消费方：`FileIOLoopDetector`（读写配对循环检测 → 并集 `READ_TOOLS`）与
 * `PathGuard`（按读/写分级套用拒绝列表 → `FILE_READ_TOOLS` / `SEARCH_TOOLS` / `WRITE_TOOLS`）。
 *
 * ⚠️ 2026-09-26 修正工具名漂移：清单原为 **Claude Code 风格名**
 * （`read_file` / `write_file` / `edit_file` / `search_files`…），而本仓**真实注册名**是
 * `file_read` / `file_write` / `file_edit` / `file_search`（事实来源 = `src/tools/**` 的
 * `name = '...'` 声明）⇒ 消费方对本仓主要文件工具**永不命中**，读写循环检测静默失效。
 * 防回退守卫：`tests/tools/toolNameLists.test.ts`。
 *
 * 读侧按**参数命名约定**分两支（`PathGuard` 提取路径时依赖该区分）：
 *  - `FILE_READ_TOOLS`：整文件读，入参键 `file_path`；
 *  - `SEARCH_TOOLS`：搜索类读，入参键 `path`（`glob`）/ `searchPath`（`grep`、`file_search`）。
 *
 * 成员判定依据（两处易误判）：
 *  - `glob` **在**读清单：本仓真实注册名（`tools/search/GlobTool.ts`）。
 *  - `bash` / `powershell` **不在**任一清单：命令类工具（入参 `command` + `cwd`），
 *    既无"按文件读写"语义，也不提供调用方要提取的路径键 ⇒ 纳入只是"永不命中"的假覆盖。
 *
 * ✅ 2026-09-26 已修（原文记作"未修"）：调用方 `TAORLoop.act()` 现按各工具 `params` 补齐入参键
 * （`file_path` / `notebook_path` / `searchPath`）—— 此前只认 `path` / `filePath` / `directory`
 * ⇒ 即便清单名正确，`checkBeforeAccess()` 也从未被调用。
 */

/** 整文件读工具（入参键 = `file_path`） */
export const FILE_READ_TOOLS = new Set(['file_read']);

/** 搜索类读工具（入参键 = `path` / `searchPath`） */
export const SEARCH_TOOLS = new Set(['glob', 'grep', 'file_search']);

/** 读类工具并集（供按"是否读文件"统一判定的消费方使用） */
export const READ_TOOLS = new Set([...FILE_READ_TOOLS, ...SEARCH_TOOLS]);

/** 写类工具名称集合（`notebook` 写 `.ipynb`，入参键 `notebook_path`） */
export const WRITE_TOOLS = new Set(['file_write', 'file_edit', 'notebook']);

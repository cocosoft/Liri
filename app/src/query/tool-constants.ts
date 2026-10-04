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
 * `file_read` / `file_write` / `file_edit`（事实来源 = `src/tools/**` 的
 * `name = '...'` 声明）⇒ 消费方对本仓主要文件工具**永不命中**，读写循环检测静默失效。
 * 防回退守卫：`tests/tools/toolNameLists.test.ts`。
 *
 * ⚠️ 2026-09-29（P2-3 / T2）：本清单的**真名**现由 `satisfies readonly ToolName[]` **编译期校验**
 * （`ToolName` 来自生成物 `constants/toolNames.generated.ts`）—— 拼错 / 改名后未同步 ⇒ **`typecheck` 报错**。
 * 同批**删除 `'file_search'`**：它**不在生效清单**（仅存在于 `ToolFactory.getAllBaseTools()` —— 台账
 * **N-27** 已认定该函数**从未被使用**；真实注册类 `FileSearchTool` 亦未被任何 loader 引用）
 * ⇒ 保留它属本文件自己禁止的**"永不命中的假覆盖"**。
 *
 * 读侧按**参数命名约定**分两支（`PathGuard` 提取路径时依赖该区分）：
 *  - `FILE_READ_TOOLS`：整文件读，入参键 `file_path`；
 *  - `SEARCH_TOOLS`：搜索类读，入参键 `path`（`glob`）/ `searchPath`（`grep`）。
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

import type { ToolName } from '@modules/constants/toolNames.generated';

/** 整文件读工具（入参键 = `file_path`） */
const FILE_READ_TOOL_NAMES = [
  'file_read',
] as const satisfies readonly ToolName[];
export const FILE_READ_TOOLS = new Set<string>(FILE_READ_TOOL_NAMES);

/** 搜索类读工具（入参键 = `path` / `searchPath`） */
const SEARCH_TOOL_NAMES = [
  'glob',
  'grep',
] as const satisfies readonly ToolName[];
export const SEARCH_TOOLS = new Set<string>(SEARCH_TOOL_NAMES);

/** 读类工具并集（供按"是否读文件"统一判定的消费方使用） */
export const READ_TOOLS = new Set([...FILE_READ_TOOLS, ...SEARCH_TOOLS]);

/** 写类工具名称集合（`notebook` 写 `.ipynb`，入参键 `notebook_path`） */
const WRITE_TOOL_NAMES = [
  'file_write',
  'file_edit',
  'notebook',
  // P0-9（2026-10-04）：`write_project_file` 带 `relativePath`，此前既未列写类、其路径键也不在
  // `PATH_ARG_KEYS` ⇒ 注册表分支求交为空 ⇒ 可写向 `**/auth/**` 等拒绝目录而不被拦（fail-OPEN）。
  'write_project_file',
] as const satisfies readonly ToolName[];
export const WRITE_TOOLS = new Set<string>(WRITE_TOOL_NAMES);

/**
 * 「路径语义」入参键集合（**单一事实源**）。
 *
 * 消费方：`PathGuard._extractPath()` —— 静态名单分支直接使用；**运行期注册表分支**用它对
 * "注册表声明的入参名"做**求交过滤**。
 *
 * 为什么必须有它（2026-09-29，spec `pathguard-registry-driven-args.md` §3.2）：
 * 注册表能给出某工具的**全部**入参名，但"某个入参是不是路径"无法从注册表得知；
 * 若把全部字符串入参都当路径，会误拦 URL / 提示词里形似 `.env` 通配模式的值 ⇒ **必须**收窄。
 */
export const PATH_ARG_KEYS: readonly string[] = [
  'file_path',
  'notebook_path',
  'path',
  'searchPath',
  'directory',
  'target_directory',
  'filePath',
  // P0-9（2026-10-04）：`write_project_file` 的路径入参键（相对项目文件夹）
  'relativePath',
];

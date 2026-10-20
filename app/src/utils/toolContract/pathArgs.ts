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
 * 「路径语义」入参键集合（**单一事实源**）。
 *
 * 2026-10-20（U-02 v2 / P3）由 `query/tool-constants.ts` **下沉**到 infra：
 * 消费方横跨 `query/PathGuard`（app）、`tasks/lro`（app）与
 * `chat/services/ToolExecutionService`（app），而后两者反向依赖 `query` 会与
 * 「`query → chat`」（`ChatManagerTAORAdapter`）成环 ⇒ 落到无出向依赖的 utils。
 * 原取用路径 `@modules/query` 仍可用（`query/tool-constants.ts` 再导出）。
 *
 * 消费方：`PathGuard._extractPath()`（静态名单分支直接使用；**运行期注册表分支**用它对
 * "注册表声明的入参名"做**求交过滤**）；`findWorkspaceEscape()`（隔离区越界判定）。
 *
 * 为什么必须收窄（2026-09-29，spec `pathguard-registry-driven-args.md` §3.2）：
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

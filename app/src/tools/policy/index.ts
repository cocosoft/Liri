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
 * 工具策略模块出口
 */

export type {
  ToolPolicy,
  PolicyContext,
  PolicyResult,
  PolicyUserRole,
  ToolProfile,
} from './ToolPolicy';
export { allowResult, denyResult } from './ToolPolicy';

// N-29（2026-09-20）：移除零消费者的 profile 机制出口 ——
// `ToolCatalog` / `ToolClassifier` / `PROFILE_DEFINITIONS` / `filterToolsByProfile`、
// `RoleBasedToolPolicy`、`ProfileBasedToolPolicy` 三类声明经全仓检索**无任何消费者**
// （含 `@modules/tools/policy` 别名形式），属"三套工具 profile 机制并存"中的第 ③ 套，
// 已随文件删除一并摘除。工具可见性的**唯一生效路径**是
// `tools/utils/ToolManagerUtils.ts#getBuiltinToolLoaders()`（显式 loader 清单）。
export { DefaultToolPolicy } from './DefaultToolPolicy';
export { ToolPolicyPipeline } from './ToolPolicyPipeline';

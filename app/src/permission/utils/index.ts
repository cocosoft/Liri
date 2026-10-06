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
 * 权限工具模块导出
 */

// 2026-10-06（N-82/N-83）：原此处再导出 `./PermissionUpdate`（`PermissionUpdateValidator` /
// `PermissionUpdateManager` / `permissionUpdateManager` 及 `PermissionUpdate*` 类型）——
// 该文件为**未接线的 CC 对标实现**、`0 消费者`，已删除（详见台账 N-82 / N-83）。
// 注意：`permission/index.ts` 的 `PermissionUpdate` **类型**来自 `./PermissionUpdateSchema`，与本块无关，未受影响。

export {
  ShadowedRuleDetector,
  shadowedRuleDetector,
} from './ShadowedRuleDetector.js';
export type {
  ShadowedRuleInfo,
  ShadowedRuleDetectionResult,
} from './ShadowedRuleDetector.js';

export {
  BypassPermissionsKillswitch,
  bypassPermissionsKillswitch,
} from './BypassPermissionsKillswitch.js';
export type {
  BypassKillswitchConfig,
  BypassEvent,
  BypassStats,
} from './BypassPermissionsKillswitch.js';

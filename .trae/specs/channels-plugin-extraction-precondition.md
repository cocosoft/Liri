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

# 评估：通道插件化前置（`packages/channels` 的跨包引用）

- **状态**：✅ **只读评估已收口（2026-11-15）** —— **不改代码**（插件化未排期，CS03）
- **来源**：`dev_docs/20261114/今日计划-2026-11-14.md` §3 P2「通道适配器外移成插件」
- **关联**：`scripts/modules-to-layers.json`（分层唯一事实源）· `layer-inversion-service-app-app-ui.md`（`runtime`/`infrastructure` 归 service 的既有裁定）

---

## 1. 结论

原记录「channels 真正向上的 app 依赖 **5 处**」**已过期**，实测只剩 **3 处，且全部是 `import type`**；
按**分层映射**它们都不构成越层（`lint:arch` / `lint:infra` 全绿）。真正残留的是**物理路径耦合**
（`packages/channels` 源码指向 `app/src/**`，抽包即断），故：

- **现在不动**（插件化未排期，CS03：不做未被要求的前置重构）；
- 一旦排期，**前置动作 = 把两个类型下沉到包**，清单见 §3。

---

## 2. 实测（2026-11-15）

### 2.1 剩余跨包引用（channels 内，排除 `@modules/channels/*` 自引用）

| 文件 | 引用 | 形态 |
|---|---|---|
| `packages/channels/src/channels/routing/streamConsumption.ts:20` | `ChatStreamChunk`（`@modules/runtime/api/CoreAPI`） | `import type` |
| `packages/channels/src/channels/runtimePorts.ts:16` | 同上 | `import type` |
| `packages/channels/src/channels/runtimePorts.ts:17` | `RequestPriority`（`@modules/types/requestPriority`） | `import type` |

原列的 `infrastructure/http/LocalHTTPServiceSSE` 与 `session/types/UnifiedMessage` 两处**已不在** channels 中（实测 grep 0 命中）。

### 2.2 层映射（`scripts/modules-to-layers.json`）

| 模块 | 层 | 对 channels（**service**）是否合法 |
|---|---|---|
| `types` | **core** | ✅ service → core |
| `runtime` | **service** | ✅ 同层 |
| `channels` | service | —— |

⇒ 这 3 处**不是分层违规**；`lint:arch`（R00-001 / R03-002）与 `lint:infra`（R10 物理包边界）当前均判合规。

### 2.3 为什么抽包时仍然会断

`runtime` / `types` 归 service/core 是**逻辑层**裁定；但它们的**物理位置**在 `app/src/**`。
外部 npm 包只能依赖已发布的 `packages/*`，因此抽包前必须把被引用的**声明**下沉到包内。

---

## 3. 抽包前置清单（排期后照此执行）

| 步 | 动作 | 规模 / 约束 |
|---|---|---|
| P1 | `RequestPriority` 下沉到 `packages/kernel`（core 层），`app/src/types/requestPriority.ts` 改为**薄转发**或全量改 import | 全仓 **8 个 importer**；`resourceGovernor`（app）与 `session`（service）已在用，需同批改 |
| P2 | `ChatStreamChunk` 下沉到 `packages/service`；**先与既有 `StreamChunk`（`packages/service/src/session/types/message.ts:107`）比对** | R02：若同构则合并为单一类型（禁止两套）；app 侧保留 re-export，使 **106 处** import 不变 |
| P3 | channels 两个文件改引包路径 | 仅 2 文件 / 3 行（type-only） |
| P4 | 校验 | `typecheck` · `lint:arch` · `lint:infra` · 全量 `bun test`；`lint:arch` 的「薄桶 R07-003」需检查 re-export 是否触发 |

---

## 4. 触发条件（何时动）

同时满足才立项：

1. 通道插件化**进入排期**（外部包形态确定：发布到 npm / 随包分发）；
2. 需要**非核心渠道由第三方维护**（当前无此诉求）；
3. `packages/channels` 已被要求**不依赖 `app/`** 的构建校验（当前门禁只校验层，不校验物理路径）。

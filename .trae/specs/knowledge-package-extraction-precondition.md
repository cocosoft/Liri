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

# 评估：`knowledge` 拆包前置（`app/src/knowledge` → `packages/knowledge`）

- **状态**：✅ **只读评估已收口（2026-11-15）** —— 结论：**前置不成立，暂缓**
- **来源**：`dev_docs/20261114/今日计划-2026-11-14.md` §3 P2「`app/src` 是否继续拆包」
- **关联**：`channels-plugin-extraction-precondition.md`（同法评估，先例）· `scripts/modules-to-layers.json`（分层唯一事实源）

---

## 1. 结论

**拆包前置条件不成立**：`knowledge` 并非"只依赖 kernel + infra"，它对 **app 层的 `ai` / `tools` 有实质回指**，
且这些依赖是**能力调用**（模型调用、工具契约），不是可以简单挪位的类型。

⇒ **暂缓**；若确要拆包，必须先做一轮**依赖下沉/端口化**（§3），属设计级改造，不进本迭代。

---

## 2. 实测（2026-11-15，`app/src/knowledge` **73 个 `.ts`**，不含测试）

### 2.1 引用目标分布

| 引用目标 | 层 | 文件数 / 命中数 | 判定 |
|---|---|---|---|
| `@openliri/infra/*` | infra | — / **117** | ✅ 允许（向下） |
| `@openliri/kernel/*` | core | — / **26** | ✅ 允许（向下） |
| `@openliri/service/*` | service | — / **5** | ✅ 允许（物理包） |
| `@modules/types/*` | core | 1 / 1 | ✅ 允许 |
| `@modules/infrastructure/*` | service | 2 / 2 | ✅ 允许 |
| **`@modules/ai`** | **app** | **15 / 33** | ❌ **跨模块回指，拆包阻塞** |
| **`../../tools/types/*`** | **app** | **7 / 21** | ❌ **工具契约，拆包阻塞** |
| `@modules/docs` | app（物理 `packages/docs`） | 10 / 13 | ⚠️ 物理已在包内 ⇒ 抽包可行，但层映射仍记 app |
| `@modules/query` | app | 1 / 1 | ❌ 单点回指（可先摘） |
| `@modules/knowledge`（自引用） | app | — / 27 | —— 内部引用，拆包后自然消失 |

（原 2026-11-14 扫描为 74 文件 / `ai` 15 文件 31 命中 / `tools/types` 7 文件 21 命中；本轮复测文件数 -1、`ai` 命中 +2，**结论不变**。）

### 2.2 为什么 `tools/types` 最扎眼

`knowledge/tools/` 下 **7 个文件**（`Knowledge{Delete,Export,Import,Restore,Search,Snapshots,Write}Tool.ts`）
**直接相对引用** `../../tools/types/Tool|ToolResult|ToolUseContext` —— 这既是**跨模块**依赖，
也是**相对路径穿透**（拆包后必然断）。它们同时是 `Tool` 接口的**实现方**（注册进工具注册表）。

---

## 3. 抽包前置清单（若将来排期）

| 步 | 动作 | 影响面 |
|---|---|---|
| P1 | 把 `tools/types/{Tool,ToolResult,ToolUseContext}` 的**契约**下沉到 kernel（或 shared 类型包），app 侧保留 re-export | 7 文件 21 处（knowledge）+ 全仓其它消费者需核对 |
| P2 | `@modules/ai` 的 33 处**收敛为注入端口**（如 `KnowledgeLlmPort`），由 app 组装根注入实现 | 15 文件；涉及 embedding / 生成 / 重新排序等调用 |
| P3 | `@modules/query` 单点回指摘除（或同样端口化） | 1 文件 1 处 |
| P4 | 确认 `@modules/docs` / `@modules/infrastructure` 的物理包路径在抽包后可达 | 12 文件 15 处（物理已在包内，主要是层映射口径） |
| P5 | 工具实现（`knowledge/tools/*`）留在 app 侧注册，或抽为插件式注册 | 与 P1 绑定 |

---

## 4. 触发条件（何时重开）

同时满足才立项：

1. `knowledge` 被要求**独立发布/独立版本节奏**（当前无此诉求）；
2. P1 的契约下沉**已在别处先落地**（否则单为拆包做一次全仓类型搬迁，收益不抵风险）；
3. P2 的端口化**有第二消费者**（否则只是为拆包而造的抽象，违 CS03）。

---

## 5. 合规检查

| 规则 | 判定 |
|---|---|
| CS01（归一化） | ✅ 先查已有依赖面，结论是"**不要为拆包而造抽象**" |
| CS03（回退最小化） | ✅ 无诉求不新增端口/配置；不预做可配置性 |
| CS06（证据驱动） | ✅ 全部数字为本轮实测（文件数 / 命中数 / 层映射取自 `modules-to-layers.json`） |
| R12-1（§2.14 规则 5） | ✅ 终局裁定 + 3 条触发条件 |

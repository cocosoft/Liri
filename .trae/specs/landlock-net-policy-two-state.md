# Landlock 网络策略：收敛为**两态**（`--net-deny` / 不 handle）

> 立项：2026-09-29 · 来源：台账 **D-36-①**（用户裁定「方案 A：根因修复」）
> 关联：`tool-chain` 无关；本 spec 属 **CLI 契约变更**（`landlock-run` 的 flag 集）

---

## 1. 权威依据（先立事实）

1. **内核 `include/uapi/linux/landlock.h`**：`landlock_ruleset_attr` 注释原文 —— handled access rights
   "**should be denied by default** when the ruleset is enacted. Vice versa, access rights that are
   **not specifically listed here are not going to be denied** by this ruleset"
   ⇒ **handle = 默认拒绝；未 handle = 不受限**。
2. **同一头文件 `struct landlock_net_port_attr`**：`port` 是**字面端口号**（`port 0` 表示
   "ephemeral 端口"，官方文档示例为 `.port = 53`）⇒ **没有"任意端口"通配**
   ⇒ "放行**任意端口**的 CONNECT"**在内核层面无法表达**。

## 2. 被修缺陷（实测 + 静态复核）

原 CLI 为 `--net-connect tcp|udp`，实现是 `attr.handled_access_net = <该请求的 CONNECT 位>` 且
**从不添加任何 `LANDLOCK_RULE_NET_PORT` 规则**（全文件 grep 0 命中）⇒ 由事实 1 得：

| 意图（头注释 / README 原文） | 实际效果 |
|---|---|
| `--net-connect tcp` **授予** CONNECT | **拒绝** TCP connect（handle 但无授权规则） |
| "bind is never granted（**deny-bind** 是默认姿态）" | bind **未被 handle ⇒ 放行** |

**两个方向都相反。** 三个后果：

1. **bash 被误伤**：`bashLandlockExec` 的意图是"网络显式放行（否则 curl/git/npm 全废）"，实际得到的是**拒绝 CONNECT** ⇒ 一旦用户开启 `bashEnabled`，网络类命令**全部失败**。
2. **code_run 有安全缺口**：`LinuxSandboxRunner` 的注释意图是"网络全禁"，但因**不传任何网络参数** ⇒ 未 handle ⇒ **网络完全不受限**（与其注释相反）。
3. **ABI < 10 上 helper 恒定失败**：`bashLandlockExec` **无条件**请求 `connect_udp`，而 UDP 位需 ABI ≥ 10 ⇒ `main.c` 的 `requested_net & ~net_mask_for_abi(use_abi)` 检查**硬失败 exit 125** ⇒ `failClosed=false` 时静默降级 plain（`failClosed=true` 时直接拒绝 bash）。
   （对照：`main.c` 注释明写"the caller must clamp by its own probe result"，而调用方并未按 ABI 裁剪。）
4. **`denyBind` 静默丢弃**：`LandlockPolicy.denyBind` 从未被 `buildLandlockArgv` 输出（CLI 无对应 flag）。

## 3. 设计：只承认**两态**

由事实 2 ⇒ 网络**无法**表达"按协议/端口放行" ⇒ 策略收敛为：

| 形态 | policy | argv | 内核效果 |
|---|---|---|---|
| **不受限**（等价普通 shell） | **不设 `net`** | 不传网络参数 | 未 handle ⇒ 不限制 |
| **全禁** | `net: { denyAll: true }` | `--net-deny` | handle 该 ABI 已知**全部** net 位 + 不加规则 ⇒ 全拒 |

**`--net-deny` 的实现要点**：`requested_net` **由运行 ABI 派生**（`net_mask_for_abi(use_abi)`）而非调用方给定 ⇒ 天然是子集 ⇒ 旧的"beyond kernel ABI"硬失败**不可能再发生**（顺带修掉缺陷 3）。

**调用方映射**：
- bash（`bashLandlockExec`）⇒ **不设 `net`**（达成"放行"意图，并消灭 ABI<10 硬失败）
- code_run（`LinuxSandboxRunner`）⇒ **`denyAll`**（达成"全禁"意图，**净安全增强**）
- `LandlockPolicyBuilder` ⇒ `permissions.network === false` ⇒ `denyAll`；`true` ⇒ 不设 `net`

## 4. 改动清单

| 层 | 落点 | 处置 |
|---|---|---|
| C | [`native/main.c`](../../app/src/sandbox/landlock/native/main.c) | 删 `--net-connect <tcp\|udp>`；加 `--net-deny`（无参）；`struct cli.net_connect:uint64_t` → `net_deny:bool`（新增 `#include <stdbool.h>`）；`requested_net = cli->net_deny ? net_mask_for_abi(use_abi) : 0`（删除 NET 的越 ABI 硬失败）；订正头注释（含"为何没有 `--net-allow`"） |
| TS 类型 | [`types.ts`](../../app/src/sandbox/landlock/types.ts) | `LandlockNetRule`：`{allow:string[]; denyBind?:boolean}` → **`{ denyAll: true }`**（附权威依据与沿革） |
| TS 桥 | [`runWithLandlock.ts`](../../app/src/sandbox/landlock/runWithLandlock.ts) | `buildLandlockArgv`：`net.denyAll ⇒ --net-deny`；订正 CLI 注释（3 处） |
| TS 构造 | [`LandlockPolicyBuilder.ts`](../../app/src/sandbox/landlock/LandlockPolicyBuilder.ts) | 按 `permissions.network` 映射两态；**删除 `NET_TCP_ABI`**（随旧设计失效、无消费者） |
| TS 导出 | [`landlock/index.ts`](../../app/src/sandbox/landlock/index.ts) | 去掉 `NET_TCP_ABI` 再导出 |
| 调用方 | [`bashLandlockExec.ts`](../../app/src/tools/bash/bashLandlockExec.ts) | 移除 `net` 字段（真放行）+ 头注释订正 |
| 调用方 | [`LinuxSandboxRunner.ts`](../../app/src/tools/CodeRunner/LinuxSandboxRunner.ts) | `net: { denyAll: true }`（真全禁）+ 注释订正 + **导出 `buildBunLandlockPolicy`**（仅供离线断言） |
| 文档 | [`native/README.md`](../../app/src/sandbox/landlock/native/README.md) | CLI 契约与 ABI 表订正 |
| 测试 | [`tests/sandbox/landlockNetPolicy.test.ts`](../../app/tests/sandbox/landlockNetPolicy.test.ts) | **新建 8 例**（argv 两态 / 防回退 / 三个生产者的意图 / 与 ABI 无关） |
| 测试 | [`tests/tools/bashLandlockExec.test.ts`](../../app/tests/tools/bashLandlockExec.test.ts) | 原"`net.allow === ['connect_tcp','connect_udp']`"断言 → **`net` 未定义** |

## 5. 验收（可证伪）

1. `app typecheck` **0**；`client typecheck` **0**。
2. `tests/sandbox` + `tests/tools/bashLandlockExec.test.ts` + `tests/tools/codeRunnerLandlockConfig.test.ts` **全绿**。
3. **全量 `bun test` 0 fail**，且用例数增量 = 新增断言数（**逐数吻合**）。
4. `lint:arch` **0 错**（`R03-002` = 0）。
5. **防回退**：全仓不再有 `--net-connect` / `net.allow` / `denyBind` 的**代码**用法（仅允许注释/台账中的沿革说明）。
6. **未验（如实）**：C 侧 `main.c` 的**真实 enforce 行为待 Linux 实测**（本机 Windows，README 亦声明无法本地编译）⇒ 建议 Linux 侧按 README §构建 执行：`cc -static -O2 -o landlock-run main.c` + `--probe`，并各自用 `--net-deny` / 不带该 flag 跑一次 `curl` 对照。

## 6. 不在范围

- ❌ **不支持**"按协议/端口放行"（内核不可表达；若将来需要，须引入"具体端口白名单"参数）。
- ❌ 不动 `main.c` 的 **FS 越 ABI 硬失败**（`requested_fs = fs_mask_for_abi(MAX_ABI)` 的检查）—— 经复核这是**有意的"ABI 下限"**（注释明写 "fail instead of silently narrowing"），属既有设计，不属本次语义缺陷。
- ❌ 不改 `sandbox.landlock.enabled/failClosed/bashEnabled` 三个开关的语义。
- ❌ 不重建/分发 helper 二进制（属部署动作）。

## 7. 关联

- 台账：**D-36-①**（缺陷登记）→ **D-38**（本 spec 实施）
- 上游设计文档：`dev_docs/20260824/沙箱隔离机制与Landlock集成方案-20260824.md`（CLI 契约来源；其 `--net-connect` 描述**随本 spec 失效**）

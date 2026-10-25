# Spec：第三方插件进程隔离（T25-08）

> 版本 1.4 ｜ 创建 2026-10-25 ｜ 状态：✅ **P0 + P1 已落地**；**P2 部分落地**（能力声明 + 安装/加载双闸 + env 授权表 + **`config` 能力已兑现**；`events` 只留名字、声明即拒绝；**清单签名已实现但默认关**）
> 实现落点：`app/src/plugins/utils/pluginTrust.ts`（P0 闸）· `app/src/plugins/host/{pluginHostProtocol,pluginHostEntry,PluginHostSupervisor}.ts`（P1 宿主）· `app/src/plugins/host/pluginConfigPort.ts`（P2 `config` 读写端口）· `app/src/plugins/utils/pluginCapabilities.ts`（P2 能力授权）· `app/src/plugins/utils/pluginSignature.ts`（P2 签名校验）
> 开关 / 授权：`PLUGIN_THIRD_PARTY_INPROCESS=false`（准入闸）· `PLUGIN_HOST_PROCESS=true`（子进程宿主）· `LIRI_PLUGIN_CAPABILITY_GRANTS=<id>:<cap>[,…]`（能力授权；未配置 = 不做能力门控）· `LIRI_PLUGIN_REQUIRE_SIGNATURE` + `LIRI_PLUGIN_TRUSTED_KEYS_DIR`（签名校验；默认关）
> 来源：`dev_docs/20261025/待完成工作任务清单-20261025.md` §10.6（第二批建议组 6）
> 关联：`google-ai-review-adjudication.md` §3.2（进程托管落点）· `tool-sidecar-isolation.md`（侧车先例）· `utils/sidecarIpc.ts`（可复用 IPC 帧）
>
> **本 spec 是设计单**：P0 策略经用户确认后才落码；P1/P2 各自另立施工单。

---

## 1. 现状取证（事实，非推断）

| 事实 | 证据 |
|---|---|
| 插件在主进程内**动态 `import`** 并执行生命周期 | `app/src/plugins/index.ts:549`（`loader.loadPlugin`）· `:873`（`sdkAdapter.runLifecycle('activate', …)`） |
| 「SDK 隔离边界」只是**模块引用纪律**（plugin-sdk 不引用核心模块），**不是进程边界** | `app/src/plugins/core/SdkPluginAdapter.ts:9-11` |
| 安装前只有**正则静态扫描**（识别 `child_process` / `eval` 等） | `app/src/plugins/utils/pluginSecurityScanner.ts:17-85` |
| 插件来源目录 = `~/.pyapp/plugins/installed`（含市场/本地/npm 安装物），与**第一方 bundled 插件**（`plugins/bundled/*`）同进程加载 | `plugins/core/PluginLoader.ts:40-49` · `plugins/bundled/*` |
| 已有可复用的**子进程 + IPC** 基建（工具侧车） | `app/src/utils/sidecarIpc.ts` · `app/src/tools/sidecar/*` |

**结论**：插件一旦激活即与主进程同权限 —— 可 `require('node:fs')` 读 `.env`、可 `spawn` 子进程、可改全局。静态扫描挡不住混淆/动态拼接。

---

## 2. 威胁模型（要挡什么）

| 威胁 | 现状 | 目标 |
|---|---|---|
| 恶意插件读 `process.env`（API Key）窃取 | 可 | 隔离后不可（独立进程 env 白名单） |
| 插件执行任意命令 / 起常驻进程 | 可 | 隔离后只能经宿主 RPC 申请 |
| 插件崩溃拖垮主进程 | 可（同进程） | 宿主捕获 + 有界重启 |
| 插件改写全局/污染宿主内存 | 可 | 独立进程 |
| 插件伪造工具结果 / 越权调用内核 | 取决于注入面 | RPC 能力白名单 + 宿主侧审计 |

---

## 3. 方案对比

| 方案 | 隔离强度 | 改动面 | 复用度 | 结论 |
|---|---|---|---|---|
| **A. Bun Worker（线程）** | 内存隔离，但**同进程 env**、崩溃仍影响进程 | 中 | 低 | ❌ 不足以挡 `.env` 读取 |
| **B. 子进程宿主 + RPC** | 进程级（env/内存/崩溃全隔离） | 大 | **高**（复用 `sidecarIpc` 帧 + 侧车监督器范式） | ✅ **推荐** |
| **C. 进程内 + 能力白名单（Context 裁剪）** | **无**（插件代码可直接 `require`） | 小 | — | ❌ 不是安全修复，只能防误用 |

**推荐 B**，分三阶段；P0 是**不需要宿主就能立即关闭风险**的准入闸。

---

## 4. 分阶段落地

### P0：第三方插件准入闸（fail-closed，可立即实施）

- **判据**：插件是否来自「第一方」——
  - ✅ 第一方：`plugins/bundled/*`（随包分发、由本仓构建）；
  - ❌ 第三方：`~/.pyapp/plugins/installed/**`、市场缓存、npm 安装物、`LIRI_PLUGIN_SEED_DIRS` 指向的目录。
- **策略（待用户拍板，见 §5）**：第三方插件**默认不加载**，需显式信任（id 白名单）才加载；拒绝时**落 app.log + UI 提示**，不静默。
- **落点**：`plugins/index.ts` 的加载入口（唯一 choke point），前置一个 `assertPluginTrusted(pluginId, sourceDir)`。
- **零行为变更边界**：第一方 bundled 插件不受影响；未安装任何第三方插件的用户完全无感。

### P1：子进程宿主（本 spec 的核）

- 每个第三方插件一个**常驻子进程**（`bun` 入口 `plugins/host/entry.ts`），宿主 ↔ 插件用 `utils/sidecarIpc.ts` 既有帧（`request` / `notify` / `response`）。
- **能力白名单 RPC**（不是把 context 塞过去）：
  - `tools.register`（声明式：名称/schema/风险档）—— 实际执行回主进程，插件只提供 `handler` 的 RPC 调用；
  - `config.get/set`（仅插件自己的命名空间）—— ✅ **已落地（2026-10-25）**，见下方口径；
  - `events.emit/subscribe`（仅白名单事件名）—— ⏸ **未实现**：主进程侧尚无跨进程事件面。
    **现状口径（2026-10-25）**：`events` 仍留在词汇表（名字合法），但登记在
    `PLUGIN_CAPABILITIES_UNIMPLEMENTED` ⇒ 清单**一旦声明就拒绝**（与授权表无关：授权造不
    出提供面，放行只会给插件一个永不触发的空实现）。拒绝文案明确「尚未实现」且**不**引导
    用户去配 `LIRI_PLUGIN_CAPABILITY_GRANTS`；可用能力文案只列 `tools / config`。
  - `log.*`。
  - **不提供**：`fs`、`child_process`、`env`、`net`（确有需要走宿主代理并按权限审批）。
- **`config` 的实现口径（如实）**：
  - **读**走 env 快照 `LIRI_PLUGIN_CONFIG`：`PluginContext.config.get` 是**同步签名**，插件在
    `initialize` 里就会读，等不了往返；
  - **写**走 RPC：子进程 `set()` 排队 → `save()` 一次性发 `config.set`（id 带 `child_` 前缀），
    宿主校验（既有 `PluginConfigManager` 的 schema）+ 落盘后才回 `success:true`；失败在 `save()` 抛出；
  - **未授权 `config`** ⇒ 不下发快照、宿主拒绝 `config.set` ⇒ 子进程保持 SDK 的 no-op 实现；
  - 存储**复用** `PluginConfigManager`（`~/.pyapp/plugins/config/config.json`）单例 —— 禁止第二实例
    （两个实例会用各自的 Map 覆盖同一文件 ⇒ 抹掉别的插件配置）。
- **生命周期**：`activate → ready` 握手；崩溃 ⇒ `Supervisor` 有界重启（复用 `ToolSidecarSupervisor` 的监督范式：进程树强杀 + 退避 + 上限）。
- **env**：子进程只注入 `LIRI_PLUGIN_ID` / `LIRI_PLUGIN_DIR` 等最小集，**不继承** `process.env`（否则隔离失效）。

### P2：市场 / 安装链路改造

- 安装时校验签名（可选）与 manifest 的 `capabilities` 声明；安装后默认「未信任」；
- 市场 UI 显示请求的能力（tools/config/events），由用户勾选授权 —— ✅ **已落地（2026-10-25）**：
  - `GET/PUT /v1/plugins/marketplace/plugins/{id}/capabilities`（`PUT` 覆盖语义，纳入 admin 写鉴权）；
  - 授权落 `<plugins 根>/capability-grants.json`，与 env `LIRI_PLUGIN_CAPABILITY_GRANTS` **取并集**；
  - UI 侧 `buildCapabilityOptions` 把**未实现**能力渲染为禁用项（勾了也没有提供面，后端也 400）。

#### P2 · 清单签名（2026-10-25 落地，**默认关**）

| 项 | 口径 |
|---|---|
| 开关 | `LIRI_PLUGIN_REQUIRE_SIGNATURE` ∈ {`1`,`true`,`yes`,`on`}；**未设置 ⇒ 零行为变更，且不读任何文件** |
| 信任锚 | `LIRI_PLUGIN_TRUSTED_KEYS_DIR` 指向目录，放 `*.pem` 的 **Ed25519 公钥**；**刻意无默认目录**（信任位置必须显式声明，否则易变成假保护） |
| 签名对象 | `plugin.json` 的**原始字节**；`plugin.sig` 存 base64（允许折行） |
| 为什么不对 JSON 再序列化 | "规范化后签名"要自带一套规范化规则，规则一偏就是「验签通过但内容不同」 |
| 闸位 | **安装**（`PluginInstallManager`）与**加载**（`PluginLoader`）同一入口 `checkPluginSignature` —— 覆盖"手工丢进 installed 目录"绕过安装器的路径 |
| 失败语义 | 未配信任锚 / 目录不存在 / 无有效公钥 / 缺 `.sig` / 非 base64 / 不匹配 ⇒ **一律拒绝**，文案给出可操作原因 |
| 非目标（如实） | 无密钥轮换/吊销列表、无时间戳防重放；等市场链路落地再议 |

**工具链（2026-10-25）**：`bun run plugin:sign <子命令>`（`app/scripts/plugin-sign.ts`）

```bash
# 1) 生成密钥对（私钥留在本地，公钥放进信任锚目录）
cd app && bun run plugin:sign keygen --out ./keys
# 2) 给插件清单签名（对 plugin.json 原始字节）
bun run plugin:sign sign --plugin ~/.pyapp/plugins/installed/<id> --key ./keys/plugin-signing.key
# 3) 本地先验一遍（与运行时门禁同一个 checkPluginSignature）
bun run plugin:sign verify --plugin ~/.pyapp/plugins/installed/<id> --keys ./keys
# 4) 启用：.env 里写下面两行后重启
#    LIRI_PLUGIN_REQUIRE_SIGNATURE=true
#    LIRI_PLUGIN_TRUSTED_KEYS_DIR=<放 *.pem 公钥的目录>
```

> 工具**不会**替你改运行时的信任配置（信任锚仍要显式指定）；私钥不托管、不进插件目录。

> 无钥时**拒装**（而非告警放行）：开启该开关的语义就是"只装能证明来源的东西"；若缺钥时放行，攻击者只需清空目录即可绕过。

---

## 5. 待拍板：P0 策略（三选一）

| 选项 | 行为 | 影响 |
|---|---|---|
| **① 默认拒绝 + 白名单**（推荐，安全优先） | 未在 `PLUGIN_TRUSTED_IDS` 中的第三方插件**不加载**，日志/UI 明示原因与放行方法 | 已装插件的用户升级后需显式放行一次 |
| ② 默认允许 + 强告警 | 照常加载，但启动时打印「第三方插件在主进程运行，可读取本机密钥」并落审计 | 零破坏，但风险仍在 |
| ③ 只做 P1（宿主），暂不加闸 | 本轮不落码，等宿主就绪后整体切换 | 风险窗口继续存在 |

---

## 6. 验收口径

| 阶段 | 验收 |
|---|---|
| P0 | 单测：第一方放行 / 第三方未信任拒绝 / 白名单命中放行 / 拒绝原因落日志；本地无插件用户零变更；`lint:arch` 绿 |
| P1 | 负向：插件读 `process.env` **拿不到**宿主密钥；插件崩溃**不杀主进程**且被有界重启；插件工具调用经 RPC 且宿主侧有审计 |
| P2 | 安装链路 E2E：未授权能力 ⇒ 拒绝安装/启用 |
| P2 · `config`（2026-10-25） | 单测：已授权 ⇒ env 有快照且 `config.set` 落库回 `success:true`；未授权 ⇒ 无快照且 `config.set` 回 `success:false`；校验失败 ⇒ 回因；子进程 `set/save` 失败可抛、成功后才更新本地视角 |
| P2 · 签名（2026-10-25） | 单测：开关缺省不读文件；启用但未配信任锚 / 目录不存在 / 无 `.pem` / 缺 `.sig` / 非 base64 / 字节被改 ⇒ 全部拒绝；有效签名 ⇒ 放行并回签名者文件名；加载器层未签名 ⇒ 拒绝且状态回 `UNLOADED` |

## 7. 回退

- P0：开关 `PLUGIN_THIRD_PARTY_INPROCESS=true` 回退到「照旧同进程加载」。
- P1：开关 `PLUGIN_HOST_PROCESS=false` 回退到进程内路径（与 P0 共存：关宿主 ⇒ 仍受 P0 准入闸约束）。

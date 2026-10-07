# Spec：沙箱 B 组改造（《Liri 优化方案》§3 B1–B3）

> **状态**：**B 组全部完成**（**B1 ✅ / B2 ✅ / B3 ✅ / B4 ✅ / 遗留收口：`custom` 网络模式 ✅**）
> **来源方案**：[`Liri优化方案-20260925.md`](../../dev_docs/Liri优化方案-20260925.md) §3「B 组：沙箱（DSec 对标）」
> **代码面**：`app/src/sandbox/`
> **最后更新**：2026-09-26

---

## 1. 目标与范围

把沙箱侧"**名义契约 ≠ 实际契约**"的结构性问题逐条收敛：输出上限（B1）、网络策略执行域（B2）、
镜像获取（B3）。**不在范围**：集群调度 / RL 训练 / 3FS 等量级不匹配的机制（方案 §5 已声明不做）。

---

## 2. 任务清单与状态

| 编号 | 任务 | 状态 | 交付物 |
|---|---|---|---|
| B1 | 输出上限：把"名义契约"变成"被消费的契约" | ✅ **完成** | `SandboxPolicy.ts` 唯一来源（软/硬）+ `resolveOutputLimit` + `appendWithinLimit`；PTY/SSH 只读来源并上报截断 |
| B2 | 网络策略移出沙箱（去掉 `NET_ADMIN`，执行层外移） | ✅ **完成** | `NetworkPolicyEngine` 改**纯声明**（`compileNetworkPolicy`）；`--cap-add=NET_ADMIN` 撤销；容器内下发路径整体移除；端口白名单 **fail-closed 收窄** |
| B3 | 镜像获取：去掉 eager 全量 + 去掉同步阻塞 | ✅ **完成（B3-a 修 / B3-b 经评估判定"已满足"）** | `DockerImageManager` 全面去 `execSync`，改**可注入异步 CLI 执行器**；B3-b 结论见 §4.6 |
| B4 | 用**真实退出码**替代异常推断 | ✅ **完成** | `dockerCli.ts`（携带 `code` 的异步执行器）+ `DockerSandbox.execute` 按退出码判定成败；顺带去掉本文件残留的 `execSync` 与 `sanitizeCommand` 二次转义 |

---

## 3. B1 变更清单

| 文件 | 变更 |
|---|---|
| `app/src/sandbox/SandboxPolicy.ts` | **唯一来源**：`MAX_OUTPUT_BYTES_SOFT`（软/保上下文）/ `MAX_OUTPUT_BYTES_HARD`（硬/防 OOM）；`resolveOutputLimit()`；`appendWithinLimit()`；`SandboxGlobalPolicy` 增 `maxOutputBytesHard` |
| `app/src/sandbox/SandboxTypes.ts` | `SandboxExecuteResult` 增 `truncated?` / `truncatedBytes?`（方案 ③） |
| `app/src/sandbox/PTYSandbox.ts` | 配置 `maxOutputBytes` 改**可选**（删就地默认）；经唯一来源取数；逐块切片；结果带出截断 |
| `app/src/sandbox/SSHSandbox.ts` | 同上；`executeCommand` 内部结果与对外 `execute` 均带出截断 |
| `app/src/tools/environments/ExecutionEnvironment.ts` | `ExecuteOptions.maxOutputBytes` 加**显式豁免**注释（方案允许的验收分支） |
| `app/tests/sandbox/outputLimits.test.ts` | **新建** 11 例（唯一来源 / 边界 / 多字节字节数 / **PTY 真实执行**截断） |
| `app/src/sandbox/docker/NetworkPolicyEngine.ts`（B2） | **重写为声明层**：`compileNetworkPolicy()`（纯函数、零 exec）+ `NetworkPolicyPlan`；删除 `applyPolicy`/`needsNetAdmin` 与两个容器内执行助手（`iptables` / `/etc/hosts`） |
| `app/src/sandbox/docker/DockerSandbox.ts`（B2） | 删除 `--cap-add=NET_ADMIN`；删除 `applyPolicy` 调用；改为追加**宿主侧** `networkPlan.dockerArgs` + 对"未执行项/收窄"打 WARN |
| `app/src/sandbox/docker/index.ts`（B2） | 桶导出同步（`compileNetworkPolicy` / `NetworkPolicyPlan`） |
| `app/tests/sandbox/networkPolicyDeclaration.test.ts` | **新建** 10 例（B2 结构性代理） |
| `app/src/sandbox/docker/DockerImageManager.ts`（B3-a） | **重写为异步**：`DockerCliRunner` 可注入（默认 `execFile` + Promise）；**全部方法去 `execSync`**；`listImages`/`getImageSize` 改 `async`；顺带把"镜像不存在"从 ERROR 降为 debug |
| `app/tests/sandbox/dockerImageManager.test.ts` | **新建** 9 例（计时判据 + 注入契约 + 成败分支） |
| `app/src/sandbox/docker/dockerCli.ts`（B4） | **新建**：`DockerCliResult`（含**真实 `code`**）/ `DockerCliRunner` / `defaultDockerCliRunner`（`execFile`，不经宿主 shell） |
| `app/src/sandbox/docker/DockerImageManager.ts`（B4） | 改为从 `./dockerCli` 取执行器（删本地定义） |
| `app/src/sandbox/docker/DockerSandbox.ts`（B4） | `execute` 按**真实退出码**判定成败；`initialize`/`close`/`checkDockerAvailable` 全部去 `execSync` 并改**参数数组**；删除 `sanitizeCommand`（不再二次转义） |
| `app/tests/sandbox/dockerSandboxExitCode.test.ts` | **新建** 6 例（退出码 / 参数直传 / create 失败） |
| `app/src/sandbox/docker/DockerSandbox.ts`（B 组遗留收口） | `DOCKER_CONFIG_KEYS` 增 `CUSTOM_NETWORK_NAME: 'dockerCustomNetworkName'`；构造 `networkConfig` 时带出该名字 |
| `app/src/sandbox/docker/DockerNetworkPolicy.ts`（B 组遗留收口） | `VALID_NETWORK_MODES` **补上 `'custom'`**（原缺失 ⇒ custom 恒失败、"必须给名字"分支成死代码） |
| `app/tests/sandbox/dockerCustomNetwork.test.ts` | **新建** 5 例（声明层 / 校验层 / 端到端假执行器） |

---

## 4. B1 关键设计与**一处比方案更严重的实证**

### 4.1 唯一来源与双层语义

- 唯一来源落在 `SandboxPolicy.ts`（方案①的建议落点），后端**只读不另设默认值**；
- **双层语义**（方案②，参照 `tools/bash/BashTool.ts` 的成熟分法）：
  `SOFT` 保上下文（超出即丢弃）、`HARD` 防 OOM（任何一层不得超出）。
  非法组合（软 > 硬）**回落**为硬上限并告警，不静默采用。

### 4.2 ③ 结果携带截断信息（含一处**必要的修正**）

`SandboxExecuteResult` 增 `truncated` / `truncatedBytes`。落地时发现：两个后端原来的写法是
**"累计未超限就整块追加"**（`if (acc.length < limit) acc += chunk`）⇒ ①单块输出可直接突破上限；
②**是否截断取决于 OS 分块时机，不可确定性判定** ⇒ 方案要求的"各后端有边界单测"**写不出来**。
故补 `appendWithinLimit()` 做**逐块按剩余量切片**，并把丢弃量按**真实字节**统计。

**单位口径（如实）**：上限仍按**字符数**比较（与既有实现一致；`maxOutputBytes` 名义为字节，
实际比较 `String.length`，属既有口径），**丢弃量按真实字节**。严格字节口径需改造累积结构，留待后续批次。

### 4.3 ⚠️ 比方案描述**更严重**的实证（本轮新发现）

方案 B1 只点了"`maxOutputBytes` 无消费方"。逐符号核查后，实情是**三层名义契约都没有消费方**：

| 持有者 | 改前实测 | 结论 |
|---|---|---|
| `SandboxPolicy`（整模块：`maxOutputBytes` / `maxExecutionTimeMs` / 白黑名单 / `mode`） | `createSandboxPolicy` / `PRODUCTION_SANDBOX_POLICY` / `restrictToolSet` / `validateToolAccess` / `SandboxGlobalPolicy` 全仓命中**仅自身 + `sandbox/index.ts` 桶导出** | **整模块零消费者**（不只是 `maxOutputBytes`） |
| `PTYSandbox` / `SSHSandbox`（类） | 全仓**无构造点**（`new PTYSandbox(`/`new SSHSandbox(` 0 命中）；仅其 *config 类型* 被 `WorkspaceManager`/`SSHWorkspace` 引用，且这两处**也不读** `maxOutputBytes` | **运行时不可达** ⇒ 其截断行为当前不生效 |
| `ExecuteOptions.maxOutputBytes`（`tools/environments`） | 声明后无任何实现读取（`LocalExecutionEnvironment.execute` 直接抛未实现；`DockerExecutionEnvironment` 未读） | 显式豁免（见 §4.4） |
| `DockerSandbox` 的 `exec` `maxBuffer`（10MB） | — | **不同层**（子进程缓冲），不由此派生（方案 §1.1 #14） |
| `tools/bash/BashTool.ts`（2MB 软 / 16MB 硬） | — | **工具层**双限，本双层语义的**参照**而非消费者 |

⇒ B1 的"建立映射"= 把**名义层**接入**唯一来源**；因两个后端当前不可达，本项**不改变实际运行行为**，
但使"名义契约"与"唯一来源"一致，且**将来一接线即遵守同一来源**。

### 4.4 豁免项（方案允许的验收分支）

`ExecuteOptions.maxOutputBytes` **显式豁免**并注明理由：该抽象层（`tools/environments`）与
`app/src/sandbox/` 的后端不是同一条执行路径；贸然接线会产生**第二套**输出上限来源，
与"唯一来源"的目标相悖（理由已就地写入该字段注释）。

### 4.5 B2：网络策略移出沙箱 —— 改成**声明层** + fail-closed 收窄

**改前的"假安全"（方案 §3 B2 复核成立）**：端口白名单经 `docker exec … sh -c "iptables …"` **在容器内**下发（依赖 `docker create --cap-add=NET_ADMIN`），域名黑名单则 `echo >> /etc/hosts` 写进容器 ⇒ **策略执行者与被约束者同处一个权限域**：容器内 root 一条 `iptables -F` 即可清空规则。

**改后（本仓只做"能做的宿主侧部分"）**：
- **零容器内执行**：`NetworkPolicyEngine` 变为**纯声明**（`compileNetworkPolicy()`：不 exec、不读写文件、不依赖 Docker 可用）；
- **撤销 NET_ADMIN**：`docker create` 参数里**永不**出现 `--cap-add=NET_ADMIN`（有结构性用例锁死）；
- **宿主侧落点两项**：`--network`（含默认 `none`）与 `--add-host <domain>:0.0.0.0`（域名黑洞改由**创建期**下发，替代原容器内写 `/etc/hosts`）。

**fail-closed（关键取舍，避免静默降级）**：配置了**端口白名单**而本仓无宿主侧执行器时，**不假装**"端口已受限"，而是把网络模式**收窄为 `none`**（宁可全禁）并打 WARN + 在计划里列 `unenforcedInThisRepo`。
- 与方案"① 短期：去掉 NET_ADMIN，白名单改由宿主侧承担"一致；
- **行为影响（如实）**：默认配置（`networkMode='none'`，未配白名单/黑名单）**零变化**；只有**显式配了** `allowedPorts` 的部署会从"弱限制"变为"全禁网络"，需宿主侧执行器才能真正按端口放行。

**验收映射（方案原文："威胁模型用例 —— 沙箱内尝试清空/篡改策略后，实际网络行为不变"）**：
真实容器 e2e **需 Docker、本仓无 CI ⇒ 未做**；本轮以**结构性代理**锁定：
① `dockerArgs` 永不含 `--cap-add`（不再把 NET_ADMIN 交给被约束方）；
② `dockerArgs` 永不含容器内执行形态（`exec` / `sh -c` / `iptables` / `/etc/hosts`）⇒ "进容器下发策略"的路径**已不存在**；
③ `enforcementOwner === 'host'`。

> **✅ 条件复评（2026-10-07）：Docker **现已可用** ⇒ 本项（及 B3-a/B4）的"真实容器 e2e"**已解阻、可排期执行**（**尚未执行**）。实测证据：`docker --version` = **29.7.2**；`docker info` **daemon 可达**（ServerVersion 29.7.2）；**容器可跑** —— `docker run --rm oven/bun:latest bun --version` ⇒ `1.3.14`；本地已有镜像 `liri-verify-builder:local`(1.76GB) / `oven/bun:1.3.14` / `tonistiigi/binfmt:latest`；`docker ps -a` 当前无容器。**仍未做（如实）**：上述三条 e2e（B2 容器内 `iptables -F` 观测 / B3-a 拉镜像期间 `/health` 可响应 / B4 真实退出码）**尚未**在真实容器上跑过 —— 本轮只**核验了条件已解除**（并与 `app/tests/sandbox/{dockerSandboxExitCode,dockerImageManager,dockerCustomNetwork}.test.ts` 的 **22 例结构性用例 0 fail** 一致）。

**分寸（不作过头声明）**：本项改的是"执行者与被约束者同域"这一**形态**，**没有**构造逃逸实验 ⇒ 表述为**结构性修复**，**不**声称"修复了某个可复现漏洞"。

### 4.6 B3：镜像获取（B3-a 修 / B3-b 评估为"已满足"）

**B3-a [P0]：`execSync` 阻塞事件循环 —— 已修（与论文无关，自身即缺陷）**
- 改前：`DockerImageManager` **全部**方法走 `execSync`，其中 `pullImage`（超时 120s）在 **daemon 进程内同步阻塞事件循环** ⇒ 拉镜像期间**全部 HTTP/SSE 停摆**。
- 改后：抽出 **可注入的异步 CLI 执行器** `DockerCliRunner`（默认 `execFile` + Promise），所有方法改 `await`；`listImages()` / `getImageSize()` 由同步改 `async`（**全仓无消费者**，见 §4.3 同类实证，故签名变更零影响）。
- **顺带修正**：`imageExists` 在"镜像不存在"时原先按 **ERROR** 记入 ErrorTracker —— 而"首次运行镜像不存在"是**正常路径**（每次首跑必现）⇒ 降为 `debug`。

**B3-b [P1]：层缓存 / 按需补差异层 —— 评估结论：现有机制已满足验收，不新建自定义层存储**
- 方案的验收是"**二次任务不重复拉取全量层**"。实测现有路径已满足：`DockerSandbox` 先 `imageExists()`，**镜像在本地即完全跳过 `pull`**；而 `docker pull` 本身**按层 digest 增量**（Docker 自带层缓存）。
- 论文的"写留本地 / 读按需 / 元数据本地"三条原则在**本仓单机沙箱**场景下若要"原样移植"，等价于自建镜像层存储 —— 属**新子系统**，且方案 §5 已声明**不引入** EROFS/3FS/OverlayBD ⇒ 本轮**不建**，如实记录理由（避免把"已有能力"重造一遍）。

**验收映射与一处**我自己的更正**（如实）**：
- B3-a 的验收是"拉镜像期间 `/health` 仍可响应（并发探测）"，需真实 Docker ⇒ **未做**；改以**离线计时判据**替代。
- ⚠️ **本轮 A/B 先暴露了我第一版断言太弱**：只比较"事件顺序"**抓不到 `await` 之前的同步阻塞**（正是 `execSync` 的形态 —— 阻塞结束后 `run` 会**同步**先入队，过期计时器排在它后面）。已把断言改为**计时**（期限 10ms、异步工作量 80ms、模拟阻塞 60ms ⇒ 阈值 40ms），**重做 A/B**：注入 60ms 忙等 ⇒ **恰 1 红**（`Expected: < 40 / Received: 64`），恢复后 9/9 绿。

### 4.7 B4：用**真实退出码**替代"异常推断"

**改前**：`DockerSandbox.execute` 在 **try 分支写死** `success: true, exitCode: 0`，真实退出码只在 catch 兜底 ⇒ "命令返回非 0 但宿主没抛异常"会被判成**成功**。

**改后**：执行器抽到共享模块 [`dockerCli.ts`](../app/src/sandbox/docker/dockerCli.ts)（**携带真实 `code`**），`success = code === 0` / `exitCode = code`；`code === null`（未取到码）保持"执行异常"语义。

**同批修掉三处**同源**问题（CS05 根因优先，不是"顺手改无关代码"）**：
1. 本文件**残留的 `execSync`**（`docker create` / `start` / `rm -f` / `info`）—— 与 B3-a **同一缺陷类**（daemon 内同步阻塞事件循环）⇒ 全部改异步执行器；
2. 改**参数数组直传**（原先 `args.join(' ')` 交给宿主 shell ⇒ 参数会被 shell 二次解释，含空格/元字符的 `-e KEY=VALUE` 会走样）；
3. **删除 `sanitizeCommand`** —— 那套转义是为"拼字符串交给 shell"服务的；改数组直传后保留会把反斜杠/引号**双重转义**进容器（A/B 实测：`echo "a\b"` 被转成 `echo \"a\\b\"`）。

**验收映射**：新增 **6 例**假执行器用例（无需 Docker）；A/B 同时变异"写死成功 + 恢复二次转义" ⇒ **恰 2 红**且按用例名可归属。

---

### 4.8 B 组遗留收口：`custom` 网络模式**恒不可用**（2026-09-26 修复；实情比原记录**更严重**）

**原记录（§7-7）**：`DockerSandbox` 从不填 `customNetworkName` ⇒ custom 会在校验处报错。

**逐符号复核后，实情更深 —— `'custom'` 根本不在运行时白名单里**：

| 位置 | 内容 | 问题 |
|---|---|---|
| 类型 `DockerNetworkMode` | `none \| bridge \| host \| custom` | 允许 custom |
| 运行时白名单 `VALID_NETWORK_MODES` | `none, bridge, host, container` | **没有 custom**（却多出 `container`） |
| 校验分支 `mode === 'custom' && !customNetworkName` | "自定义网络模式必须指定 customNetworkName" | 被白名单先拒 ⇒ **永不可达（死代码）** |
| 声明层 `compileNetworkPolicy` | `--network <customNetworkName>`（缺名 fail-closed 为 `none`） | 实现完整，但**从未被触发** |

⇒ 用户怎么配都只会得到"不支持的网络模式: custom"（**配置键此前也不存在**，见下）。

**修法（两处，最小改动）**：
1. 补配置键 `dockerCustomNetworkName`（`DOCKER_CONFIG_KEYS.CUSTOM_NETWORK_NAME`）并在 `DockerSandbox` 构造 `networkConfig` 时带出；
2. 白名单**补上 `'custom'`** ⇒ 那条"必须给名字"分支由此**可达**，成为"custom 必须显式指定网络名"的真实防线。

**同批一致性收口（2026-09-26，同日完成）**：白名单里的 `'container'` **不在类型 `DockerNetworkMode` 里**，声明层也没有"目标容器"参数 ⇒ 放行它只会产出 `--network container`（**docker 语法错误**），在 `initialize()` 处表现为一句令人困惑的创建失败。**已将其从白名单移除** ⇒ 该配置现在得到**清晰**的"不支持的网络模式"提示（且提示的"可选"列表不再列它）。
若将来真要支持 `container:<name|id>`，需**新增目标容器配置键**并在声明层拼出完整值 —— 属**新功能**，不属一致性修复（不臆造）。

**验收（离线 7 例，`tests/sandbox/dockerCustomNetwork.test.ts`）**：声明层（有名字 ⇒ `--network <名字>`；缺名 ⇒ fail-closed `none`）/ 校验层（有名字通过；缺名拒因**必须是**"必须指定 customNetworkName"而**不是**"不支持的网络模式" ⇒ 锁死"该分支可达"；**接受的模式集合恰等于类型联合**；`'container'` 被**清晰拒绝**且"可选"列表不再列它）/ 端到端（假执行器：`custom + 名字` ⇒ `initialize` 成功、`create` 参数含 `--network <名字>`、且仍无 `NET_ADMIN`；`custom` 缺名 ⇒ 返回 false 且**从未下达 create**）。

**A/B（各自单变量）**：① 去掉名字传递 ⇒ **恰 1 红**（端到端成功用例）；② 白名单去掉 `'custom'` ⇒ **恰 2 红**（校验层 + 端到端成功用例）；③ 把 `'container'` 放回白名单 ⇒ **恰 1 红**（一致性守卫用例）。

**未做/未验（如实）**：① 真实 Docker 下"加入自定义网络后出站行为"未验（需 Docker）；② **未提供 UI 入口** —— 需手写 `customConfig`（`dockerNetworkMode` / `dockerCustomNetworkName`）；③ 未做 `container:<name|id>` 的**真支持**（需新增目标容器键，属新功能）。

---

## 5. 验收与实测（2026-09-26）

| 验收项（方案原文） | 结果 |
|---|---|
| ① `policy.maxOutputBytes` **有确定消费路径** | ✅ 唯一来源常量 + `resolveOutputLimit()`；策略层默认取该来源；两个后端**只读**该来源（不再自设 1MB） |
| ① 的另一允许分支：**显式豁免 + 注明理由** | ✅ `ExecuteOptions.maxOutputBytes`（§4.4） |
| ② 统一"硬上限 + 软截断"双层语义 | ✅ `SOFT`/`HARD` 两常量 + 软>硬回落；`maxOutputBytesHard` 进入策略结构 |
| ③ `SandboxExecuteResult` 携带 `truncated` / `truncatedBytes` | ✅ PTY 与 SSH 均带出（SSH 从 `executeCommand` 贯穿到对外 `execute`） |
| **各后端有边界单测** | ✅ PTY：**真实执行**（`echo` × 200 字符 + 软上限 16）⇒ `truncated===true`、`truncatedBytes>0`、`stdout` 不越限；另证"未配软上限 ⇒ 走唯一来源、不截断"。SSH：**无可测服务器** ⇒ 不写假测试，见 §7 |
| **A/B 归属** | ✅ 同时变异"唯一来源"与"逐块切片" ⇒ **5 红**且按用例名可归属：唯一来源 2（`不传参数`、`显式 soft 覆盖`）+ 逐块切片 3（`超限`、`已达上限`、`PTY truncated=false`）。**旁证**：变异 `resolveOutputLimit` 不影响"策略层与唯一来源一致"用例 —— 因策略默认直接取**常量**而非经解析函数 |
| B2：**结构性断言**（验收的代理） | ✅ 10 例全绿：6 组配置下 **`--cap-add`/`NET_ADMIN` 0 命中**、**容器内执行形态 0 命中**、`enforcementOwner==='host'`；`bridge+allowedPorts` ⇒ 收窄为 `none`；`blockedDomains` ⇒ `--add-host …:0.0.0.0` |
| B2：**fail-closed 不静默降级** | ✅ `bridge + allowedPorts` ⇒ `narrowedByFailClosed===true` + `--network none`；`unenforcedInThisRepo` 显式列出 `egress-port-whitelist`；默认配置（`mode:'none'`）**零变化** |
| B2：**A/B 归属** | ✅ 同时变异"恢复 NET_ADMIN + 去掉收窄" ⇒ **恰 2 红**且按用例名可归属（`不含 --cap-add`、`bridge+allowedPorts 收窄`） |
| B3-a：**不再同步阻塞**（验收的离线代理） | ✅ 9 例：**计时判据**（计时器按期限触发，不被阻塞推迟）+ **注入契约**（`imageExists`/`pullImage` 的 CLI 参数确实经过注入执行器）+ 各方法成败分支（失败返回 `false`/`[]`/`null`，不抛） |
| B3-a：**A/B 归属**（含一次自查更正） | ✅ 注入 60ms 忙等 ⇒ **恰 1 红**（`Expected: < 40 / Received: 64`）。⚠️ **更正**：首版用"事件顺序"断言时该变异**抓不到**（`await` 前的阻塞不影响顺序），已改为计时判据后重测 |
| B3-b：**二次任务不重复拉全量层** | ✅ **判定为已满足**（`imageExists` 短路 + Docker 自带层缓存）；**不新建**自定义层存储（理由见 §4.6） |
| B4：**真实退出码判定成败** | ✅ 6 例（假执行器，无需 Docker）：退出码 7 ⇒ `success=false`/`exitCode=7`/`error` 带出 stderr；0 ⇒ 成功且无 error；`code=null` ⇒ `exitCode=-1`；`timedOut` 透传；**参数不含 `docker` 前缀且命令原样传递**；`docker create` 非 0 ⇒ `initialize()` 失败 |
| B4：**A/B 归属** | ✅ 同时变异"退出码改回写死成功 + 恢复二次转义" ⇒ **恰 2 红**（`退出码 7`、`命令原样传递`） |
| B 组遗留：`custom` 网络模式**不再恒失败** | ✅ 端到端（假执行器）：`dockerNetworkMode='custom'` + `dockerCustomNetworkName='liri-net'` ⇒ `initialize()` **成功**，`create` 参数含 `--network liri-net`（且仍无 `NET_ADMIN`） |
| B 组遗留：**"必须给名字"分支变为可达**（原为死代码） | ✅ 白名单补 `'custom'` 后：缺名拒因是"必须指定 customNetworkName"，**不是**"不支持的网络模式"（用例显式断言后者**不出现**） |
| B 组遗留：**不静默放过** | ✅ `custom` 缺名 ⇒ `initialize()` 返回 `false`，且假执行器 `seen` 中**没有任何 `create`** |
| B 组遗留：**A/B 归属** | ✅ ① 去掉名字传递 ⇒ **恰 1 红**（端到端成功用例）；② 白名单去掉 `'custom'` ⇒ **恰 2 红**（校验层 + 端到端成功用例） |
| B 组遗留：**白名单与类型一致**（`'container'` 移除） | ✅ 接受的模式集合**恰等于** `DockerNetworkMode` 联合；`'container'` 被**清晰拒绝**（"不支持的网络模式"，且"可选"列表不含它）⇒ 不再出现"走到 docker 才炸"的困惑失败。**A/B**：把 `'container'` 放回 ⇒ **恰 1 红** |

**门禁（B4 后最终）**：`typecheck` **0** · `lint` **0** · `lint:arch` **0** · `tests/sandbox` **50 pass** · 全量 **3864 pass / 19 skip / 0 fail / 3883 tests / 396 files**（套件自报 81.21s）。

**门禁（custom 网络修复后）**：`typecheck` **0** · `eslint`（本轮改动 3 文件）**0** · `lint:arch` **0 错 0 警** · `tests/sandbox` **55 pass**（6 文件）· 全量 **3941 pass / 19 skip / 0 fail / 3960 tests / 403 files**（套件自报 75.80s）· 新增用例 5 例（`tests/sandbox/dockerCustomNetwork.test.ts`）。

**门禁（`'container'` 一致性收口后）**：`typecheck` **0** · `eslint`（改动 2 文件）**0** · `lint:arch` **0 错 0 警** · `tests/sandbox` **57 pass** · 全量 **3950 pass / 19 skip / 0 fail / 3969 tests / 404 files**（套件自报 75.01s）· 该文件累计 7 例。

> 🔎 **一次计数口径自查（如实）**：我先用 `bun test tests/sandbox/`（**带尾斜杠**）跑到 **41 pass**，与上面 B4 记录的 50 不符，遂核查 —— **不带尾斜杠**的 `bun test tests/sandbox` 才是全量 **55 pass / 6 文件**；且 **55 = 50（B4 时点）+ 5（本轮新增）**，账目吻合 ⇒ 差异**不是**测试丢失，而是**我的命令带了尾斜杠**（匹配范围变小）。该坑已记台账（TE 类：命令口径影响结论）。

> ⚠️ **过程记录（如实，两条）**：
> ① 本轮我**两次**把全量套件的"慢"误判为"**挂死**"（依据"6 分钟无输出"/"6 秒 CPU 零增长"），**两次都不成立** —— 套件正常完成且 `0 fail`。成因是 PowerShell 管道缓冲 + 机器负载；**短窗 CPU 采样不足以判定挂死**（I/O 阻塞型用例 CPU 本就平坦）。
> ② **一次真实的"长时间停顿"**：某次全量运行停在 `tests/tools/repl.integration.test.ts`（日志 4339 行 ≥2 分钟不增长）；但 **单跑该文件 5 pass / 0 fail / 12.71s**（Python **3.13.14** 可用、用例真在跑），**紧接着重跑全量 ⇒ 0 fail**。该文件与本轮改动**无交集** ⇒ 属**全量并发下偶发停顿**，**未定性**（已记台账，供后续观察）。

---

## 6. 合规检查表

| 规则 | 落实 |
|---|---|
| CS01（新增前先查已有） | 复用既有 `SandboxPolicy` 作为落点（方案建议），未新建并行策略模块；`PTY`/`SSH` 仅改取数来源 |
| CS03（回退最小化） | 唯一新增的分支是"软 > 硬 ⇒ 回落"这一**真实可误配**场景（并有单测）；无"以防万一"兜底 |
| CS05（根因优先） | 未停在"给字段加个消费者"，而是先查清**三层名义契约**与实际执行路径的脱节（§4.3），再决定映射与豁免 |
| CS02（禁字符串匹配判状态） | 截断判定基于**计数**（`droppedBytes > 0`），非文案匹配；`truncated` 程序化带出，不再只写进 stdout 文案 |
| R04-001（文件行数） | `SandboxPolicy.ts` 仍远小于 1000 行 |
| 不同层不混（方案 §1.1 #14） | Docker `maxBuffer` 与 BashTool 工具层双限**均不**接入本来源，并在注释中写明原因 |

---

## 7. 未做 / 未验（如实）

1. **SSH 后端无边界单测**：需要可连的 SSH 服务器，仓内无 fixture ⇒ 不写"假测试"；其截断逻辑与
   PTY 共用同一助手（`appendWithinLimit`），由 PTY 的真实执行用例覆盖该助手的语义。
2. **单位口径未改成严格字节**（上限按字符数比较，丢弃量按字节）—— 属既有口径，改造需变更累积结构。
3. **两个后端当前不可达**（§4.3）：本项**未改变实际运行行为**；"接线后遵守同一来源"由 `resolveOutputLimit` 保证。
4. **B3-a 的真实验收未做**：方案要求"拉镜像期间 `/health` 仍可响应（并发探测）"，需真实 Docker ⇒ 本轮以**离线计时判据**替代（§4.6）。
5. **B2 的真实威胁模型 e2e 未做**：方案原文的验收是"沙箱内尝试清空/篡改策略后，**实际网络行为不变**"，需真实 Docker（起容器 → 容器内 `iptables -F` → 观测出站行为）—— 本仓无 Docker CI，本轮以**结构性代理**替代（§4.5）。
6. **宿主侧执行器未实现**（B2 的"执行层外移"即**不在本仓**执行按端口/按域名的强制）：`unenforcedInThisRepo` 会显式列出这些项并打 WARN，真正落地需平台侧（Windows 宿主防火墙 / Linux nftables 作用于 veth / eBPF）。
7. ~~**`custom` 网络模式仍不可用**（预存，未修）~~ ✅ **已修（2026-09-26，B 组遗留收口）** —— 见 §4.8；**同批一并收口**了白名单里 `'container'` 与类型不一致的问题（移除 `'container'`，使其**清晰失败**）。
8. 真实容器/远端沙箱的端到端验证未做（需 Docker/SSH 环境）。
9. **B3-b 未建自定义层存储** —— 注意这是**判定为"已满足"**而非"未做"：`imageExists` 短路 + Docker 自带层缓存已满足方案的验收口径；若将来出现"镜像极大且层变化频繁"的真实场景再评估（属新子系统）。
10. **B4 的真实 Docker e2e 未做**：容器内命令返回非 0 ⇒ 结果承接（`exitCode`/`error`）未在真机验证（需 Docker 环境）；本轮以假执行器离线锁定映射逻辑。

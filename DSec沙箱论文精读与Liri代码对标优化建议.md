# DSec 论文精读 × Liri 代码对标优化建议

> 论文：*DeepSeek Elastic Compute (DSec): A Sandbox Infrastructure for Effective Agentic Training at Scale*（DeepSeek-AI, arXiv:2609.22978v1, 2026-09-19）
> 代码基线：`E:\PY\Documents\CODES\PY_APP\app\src\sandbox\` 及 `app\src\tools\`
> 说明：arXiv 网页抓取被本机 SSRF 策略拦截（DNS 解析到 198.19.0.4），本报告全部论文内容来自本地附件 PDF 转换文本，非网页推断。

---

## 一、论文核心结论提炼

### 1.1 规模基线（生产数据）

| 指标 | 数值 |
|---|---|
| 单生产单元节点数 | ~160 节点 |
| 沙箱日吞吐 | ~300 万 / 天 |
| 并发沙箱峰值 | >380,000 |
| 沙箱创建速率 | >5,000 / 秒 |
| 单节点密度 | 800 microVM 或 3,200 container |
| 单作业突发规模 | 最高 32K 沙箱实例 |

### 1.2 五条工作负载特征（决定了平台架构，而不是"选一个沙箱运行时"）

1. **突发式创建**：单个 RL 作业一次申请最多 32K 沙箱 → 调度与镜像分发不能有中心瓶颈。
2. **必须高密度overcommit**：Agent 大部分时间在等 LLM 出下一个动作，CPU 稀疏 → 可超卖。
3. **有状态且长生命周期**：改文件、装依赖、起服务；空闲后仍钉住内存/页缓存/可写层 → 必须做内存共享与回收。
4. **高度异构**：OJ 脚本执行、SWE 全仓任务、安全任务、computer-use、Android 全套系统 → **单一沙箱抽象无法高效覆盖**，需 FnCall / container / microVM / full-VM 四层后端。
5. **环境多样性高、复用率低**：每个任务可能自带仓库/依赖/服务/评测脚本 → 必须按需加载镜像，不能全量拉取。

### 1.3 四组关键机制

**A. 统一 SDK + 分层后端 + 无状态控制面**
- `libdsec` 统一暴露四类后端；`apiserver` **不保存任何 per-sandbox 状态**，沙箱 ID 内编码所属 `edge`，任意 apiserver 都能直接转发 → 接入层可线性横向扩展。
- Placement Engine 两阶段：过滤（健康 + 后端/硬件能力）→ 排序（随机采样少量候选，选最不忙）。Placement 和 Watcher **都不需要持久状态**，重启即可重建视图。
- `edge` 在接单前做**节点本地准入检查**，与集群级 placement 形成互补（集群视图是周期刷新的，必然滞后）。

**B. 按需镜像加载（论文里收益最大的一招）**
- 镜像放 3FS（已有分布式文件系统），不另建 registry + P2P 分发层。
- 三条设计原则：**写留本地**（小随机写是 3FS 弱项）、**读按需且成批**（大 IO 是 3FS 强项）、**元数据尽量本地**（EROFS multi-device 把元数据与数据分离，元数据下到本地盘）。
- 实测（8,192 容器突发、10 节点）：
  - 端到端 35 min（按需 EROFS）vs >60 min（eager `docker pull` cold），**1.71× 加速**；
  - 单节点累计写盘 ~700 GB vs >1,600 GB，**写量降低约 57%**，接近全本地缓存的 ~600 GB。
- EROFS 层挂载 vs tar.gz 解包（同一评测工作区）：45 min vs 79 min，**1.76× 加速**，tar 路线磁盘写流量是 EROFS 的 ~5.5×、峰值写吞吐 3.4×。
- 层合并优化：小于阈值（如 3 GB）的连续层离线合并为一对 EROFS 镜像，减少 mount 数量同时保留 overlayfs whiteout 语义，保持跨镜像 page cache 复用。

**C. 高密度资源管理**
- `virtio-pmem + DAX` 消除页缓存重复（同一份宿主页被多个 microVM 共享），但注意 `struct page` 元数据开销 = 容量的 1/64（128 GB pmem 需要 2 GB guest RAM），且冷访问需同步缺页 → 因此**只对只读 EROFS 基础镜像/工具链层启用**，大容量可写盘走 `DAMON + virtio-balloon free-page reporting`（实测内存降低 **21.2%**，CPU 开销不显著）。
- QoS-aware CPU 调度：沙箱分 **LS（延迟敏感）/ BE（尽力而为）** 两类；BE 进 `SCHED_IDLE`；再叠加 Linux **core scheduling**，防止 BE 与 LS 抢同一物理核的兄弟超线程 → SMT 引起的延迟膨胀从 **45.2% 降到 17.3%**。

**D. 与 RL 框架协同 + 安全**
- **`pack_diff`**：任意时刻对沙箱打增量磁盘快照做 checkpoint，之后可恢复为新沙箱 → **让 Agent 用同一套基础设施构建、验证、消费环境**，无需独立镜像构建流水线。
- rollout 与可抢占的 GPU 训练**解耦**；沙箱生命周期与训练协同，训练抢占时 pause/resume 保留 rollout 状态同时回收空闲资源。
- IAM：多级嵌套 project（而非云厂商常见的扁平/两级），Agent 与人类**共用同一套管理 API 与授权模型**；委派受父级约束——**不能授予自己不持有的权限，子项目策略与配额不得超越父级**。
- 容器/FnCall **跑在 QEMU/libvirt VM 内**，不直接在裸机上，VM 提供独立内核与网络栈作为额外安全边界；网络策略用 **eBPF 在 edge 侧下发**。
- `edge → aether` 通道（Linux 用 Unix domain socket，VM 用 vsock）做健康探测，**通道关闭即标记沙箱失败**；`chronus` 提供 shell session 抽象，按 operation 的 terminal-session id 复用/新建实例，一个沙箱内可并发多 session。

---

## 二、Liri 现状（基于实际代码，非推测）

### 2.1 已有能力（对齐得不错的部分）

| 能力 | Liri 实现 | 对应论文机制 |
|---|---|---|
| 多后端原型 | `DockerSandbox` / `SSHSandbox` / `PTYSandbox` / `LocalWorkspace` / `DockerWorkspace` / `SSHWorkspace` | 论文的多后端思路（但无统一 SDK 抽象） |
| 可插拔后端注册 | `registerSandboxBackend()`（docker / ssh / openshell） | 类似 libdsec 后端注册 |
| 生命周期回收 | `SandboxPruner.prune()`，per-instance `idleTimeoutMs` + `pruneDisconnected` + lifetime 判定 | 对齐 TTL 回收 |
| 资源限额 | `ResourceLimitManager`（按 `pluginId` 维护 `usageSnapshots`） | 对齐 quota，但无层级委派 |
| 强制访问控制 | `app/src/sandbox/landlock/`（`LandlockDetector`、`LandlockPolicyBuilder`、`runWithLandlock`、native `main.c` ABI 3+），已被 `tools/BashTool`、`tools/CodeRunner/LinuxSandboxRunner` 真实调用 | 本质是论文"多层隔离"思想的自研版 |
| 输出内存治理 | `BashTool` 16 MB 硬 `maxBuffer` + 2 MB 软截断（`BashTool.ts:40-46, 676-687`） | 对齐论文"防内存暴涨"的工程直觉 |

### 2.2 关键差距

**差距 1｜镜像走 eager pull，正是论文实测最慢的那条路**
`DockerSandbox.ts:96-100`：
```ts
const imageExists = await this.imageManager.imageExists(image);
if (!imageExists) {
  logger.info(`拉取 Docker 镜像: ${image}`);
  await this.imageManager.pullImage(image);
}
```
`DockerImageManager.pullImage()` 是 `execSync(['docker','pull', name])`，超时 120 s。这**等价于论文 Fig.10 里的 "Docker Pull (cold)" 基线**——必须先把每一层下载并解包完，容器才能启动。Liri 没有层缓存复用、没有按需加载、没有元数据/数据分离。

**差距 2｜网络策略在容器内用 iptables 实现，而执行策略的进程又持有 NET_ADMIN**
- `DockerSandbox.ts:135-137`：需要时给容器加 `--cap-add=NET_ADMIN`。
- `NetworkPolicyEngine.ts:121-129`：在容器内执行 `iptables -P OUTPUT DROP` 等规则。
- 静态读代码可确认：**策略执行者与被约束者处于同一权限域**。容器内的 Agent 代码具备 CAP_NET_ADMIN 即可 `iptables -F` 清空规则。
- 论文的做法是在 `edge` 创建沙箱时用 **eBPF 在宿主侧下发**，策略在沙箱外，沙箱内进程无从修改。
- 域名黑名单靠改 `/etc/hosts`（`NetworkPolicyEngine.ts:4` 注释），同样在沙箱内可写。

**差距 3｜没有 checkpoint / restore，回收即销毁**
`SandboxPruner.prune()`（`SandboxPruner.ts:150-164`）判定后是**移除**。Liri 没有论文的 `pack_diff` 等价物：不能"把当前交互会话增量快照成可复用环境"。这直接意味着：**没有 pause/resume，也没有跨会话的环境复用**，每次任务都要重建工作区。

**差距 4｜输出/资源约束在各后端之间不一致，缺统一契约**
- `DockerSandbox.ts:243`：`maxBuffer: 10 * 1024 * 1024`
- `PTYSandbox.ts:27`：`maxOutputBytes: 1024 * 1024`
- `SSHSandbox.ts:39`：`maxOutputBytes: 1024 * 1024`
- `SandboxPolicy.ts:74` 默认 1 MB，而 `SandboxPolicy.ts:148` 的 `PRODUCTION_SANDBOX_POLICY` 给 8 MB
- `BashTool.ts` 另一套 16 MB / 2 MB

同一语义（"命令输出上限"）在不同后端、不同策略下有 5 个不同数值，且没有单一来源。论文的 `libdsec` 恰恰把 container / VM / FnCall 收敛到**一个接口**上。

**差距 5｜执行结果语义偏弱**
`DockerSandbox.ts:246-254` 在 try 分支直接返回 `success: true, exitCode: 0`，真实退出码要等抛异常后从 `execErr.code` 里补（`:266-275`）。等效于**用"是否抛异常"推断执行结果**，而非读取子进程真实状态；`docker exec` 起 `sh -c` 还隐含 POSIX shell 依赖。

**差距 6｜准入控制与放置策略缺失**
`EnhancedSandboxManager` 有 `registerSandbox/unregisterSandbox`（`:661, :670`）与统计（`SandboxPruner.getStats()`），但**没有节点级容量准入检查**——即论文 `edge` 的 "capacity 不足就拒绝" 那一环。对单机场景这不算致命，但意味着并发创建时没有第一道防线。

**差距 7｜隔离层级不足**
Docker 容器直接跑在宿主内核上；论文特意说明 "FnCall 和 container 跑在 QEMU/libvirt VM 内而不是直接在宿主上"，把 VM 当作不可信容器的第二道边界。Liri 在 Windows 上更依赖 Docker Desktop 的 WSL2 隔离，属隐式继承而非显式设计。

---

## 三、优化建议（按性价比排序）

### P0-1 引入镜像层缓存 + 增量/按需加载（直接对标 1.71× 与 57% 写量收益）
- 最小可行版：在 `DockerImageManager` 增加**本地层索引 + 预拉取白名单**，把 `pullImage` 拆成 `ensureBaseLayers()`（宿主机一次性）与 `ensureTaskLayer()`（按任务）；
- 目标：把 `DockerSandbox.initialize()` 的 "imageExists → pull 全量" 改成 "命中本地缓存 → 只补差异层"；
- 不建议直接上 EROFS/OverlayBD（Liri 是跨平台单机 Agent，不是集群平台），但**"写留本地、读按需、元数据本地" 三条原则可以原样搬**：任务仓库用只读挂载 + 本地产可写层，比"复制整个仓库进沙箱"更省。
- 收益锚点：论文数据表明这类改动在突发场景是 1.7× 量级，在单机场景至少能省掉重复解包。

### P0-2 把网络策略移出沙箱（安全必修）
- 保留 `NetworkPolicyEngine` 作为**声明层**，但执行层改为宿主侧（Windows 下走 Docker `--network` + 宿主防火墙规则；Linux 下可参考论文用 eBPF，或退一步用宿主 nftables 作用于 veth）；
- 若短期无法移动执行层，则**必须去掉 `--cap-add=NET_ADMIN`**，改用不带 NET_ADMIN 的方案（Docker 网络别名 + 宿主侧 DNS/路由控制），否则"策略"实质是可被约束对象自行撤销的建议。

### P0-3 统一输出与资源契约
- 定义唯一来源：`SandboxPolicy` 里的 `maxOutputBytes` 作为契约字段，各后端**只读不另设默认值**，消灭 `DockerSandbox` 的 10 MB 与 `PTYSandbox`/`SSHSandbox` 的 1 MB 分歧；
- 同时统一"硬截断 vs 软截断"语义（参考 `BashTool` 已有的 16 MB/2 MB 双层设计），并让 `SandboxExecuteResult` 显式携带 `truncated` 与 `truncatedBytes`。

### P1-1 用"真实退出码"替代"异常推断"
- `execute()` 改为显式捕获子进程 `status`（`spawn` 或 `execAsync` 的 `code`），去掉 try 分支里写死的 `success: true, exitCode: 0`；
- 这条对"证据驱动"的工具链很关键：`exitCode` 是判断命令成败的**原生信号**，论文的 reward 计算正是建立在 exit code / stdout / test pass rate 这些信号上。

### P1-2 给 SandboxPruner 加"冻结/快照"态（pack_diff 的轻量版）
- `PruneResult` 目前只有"移除"，建议新增第三态 `frozen`：超时后不立即销毁，而是把工作区打包成增量快照（对 Docker 可用 `docker commit` 或导出可写层 diff），登记到可复用环境索引；
- 复用命中时从快照恢复而非重建 —— 这就是论文 "环境由 Agent 构建、为 Agent 所用" 的单机投影；
- 注意论文的边界条件：快照是**增量**的（基于共享 base），否则存储会爆。

### P1-3 补一层节点级准入
- 在 `EnhancedSandboxManager.registerSandbox()` 前插入容量检查（当前沙箱数、内存余量 vs 上限），不足则拒绝并给出明确错误，而不是让底层 Docker 报一个模糊失败；
- 静态可确认的是 Liri 目前**只有统计没有拒绝**。

### P2-1 层级化配额与委派（对齐论文 IAM）
- `ResourceLimitManager` 现在按 `pluginId` 扁平记账；建议引入父子层级，并落实论文那两条硬约束：**不能授予自己不持有的权限**、**子级配额不得超过父级**；
- 这条在多 Agent 协作场景（Liri 已有 swarm 相关代码）会直接变成安全边界。

### P2-2 QoS 分层调度的最小落地
- 单机虽无 LS/BE 集群调度，但可以借用其**分类思想**：把"用户交互命令"与"后台批处理/索引/日志"分开，后者降优先级执行，避免交互路径被后台任务拖慢（论文对应收益是 SMT 延迟膨胀 45.2% → 17.3%）。

---

## 四、一句话总结

论文最重要的启示不是"要做 800 microVM/节点的分布式平台"——那与 Liri 的单机定位不符；而是**三个可移植的原则**：
1. **不要 eager 全量**（镜像、输出、上下文都同理，按需 + 增量）；
2. **策略执行者不能在权限域内部**（网络策略移到宿主侧，与 Landlock 已有的"外部约束"思路保持一致）；
3. **会话状态值得被 checkpoint**（回收 ≠ 销毁，能复用才叫基础设施）。

Liri 已有的 Landlock 集成说明"外部强制约束"这条路线是对的；缺口集中在**镜像生命周期**、**网络策略位置**和**状态快照复用**三处。

---

## 附录：本报告涉及的代码证据位置

| 结论 | 文件:行 |
|---|---|
| eager 拉镜像 | `app/src/sandbox/docker/DockerSandbox.ts:96-100` |
| `docker pull` 同步 120s | `app/src/sandbox/docker/DockerImageManager.ts:37-53` |
| 容器内 iptables 策略 | `app/src/sandbox/docker/NetworkPolicyEngine.ts:121-129` |
| 需要 NET_ADMIN | `app/src/sandbox/docker/DockerSandbox.ts:135-137` |
| 域名黑名单走 /etc/hosts | `app/src/sandbox/docker/NetworkPolicyEngine.ts:4` |
| 10 MB maxBuffer | `app/src/sandbox/docker/DockerSandbox.ts:243` |
| 1 MB 输出上限 | `app/src/sandbox/PTYSandbox.ts:27`；`app/src/sandbox/SSHSandbox.ts:39` |
| 策略默认 1 MB / 生产 8 MB | `app/src/sandbox/SandboxPolicy.ts:74, 148` |
| BashTool 16 MB 硬 + 2 MB 软 | `app/src/tools/BashTool/BashTool.ts:40-46, 676-687` |
| 写死 success/exitCode | `app/src/sandbox/docker/DockerSandbox.ts:246-254` |
| prune 仅移除 | `app/src/sandbox/SandboxPruner.ts:150-164` |
| 注册/注销无准入 | `app/src/sandbox/EnhancedSandboxManager.ts:661, 670, 873` |
| 扁平配额记账 | `app/src/sandbox/ResourceLimitManager.ts:261-262` |
| Landlock 已接入工具层 | `app/src/sandbox/landlock/*`，被 `app/src/tools/BashTool/BashTool.ts`、`app/src/tools/CodeRunner/LinuxSandboxRunner.ts` 调用 |
| 后端注册 | `registerSandboxBackend()`（docker / ssh / openshell） |

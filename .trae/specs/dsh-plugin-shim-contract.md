# Spec：DSH 插件兼容层契约（DSH-Plugin-Shim）

> 版本 1.0 ｜ 创建 2026-10-06 ｜ 状态：🟡 **契约草案 —— 用户裁定「先立契约 spec，**不实施**」**
> 来源：`dev_docs/任务计划-20261004.md` §12 **T-3**（外部 `20261005/google ai 建议.md` 三·DSH 启示①）
> 关联规则：GR15（Spec-Driven）/ GR01（基础设施复用）/ CS01（归一化）/ CS03（回退最小化）/ CS04（零 Mock）/ R06-008（分层）
> 口径（CS06）：下列 file:line / 命中数为 **2026-10-06 实测**。

---

## 1. 背景与取证

### 1.1 现状：**不存在** `dsh-plugin` 消费面

- `grep` `dsh-plugin|PluginShim`（`app/src` 全域）⇒ **0 命中**。
- 命中的 `DSH`/`deepseek-harness` 字样**全部为注释内的"对标出处"引用**（如 `context/compaction/*`、`ai/clients/PromptCacheConfig.ts`），**非**插件消费代码。

### 1.2 本仓插件体系**已完备**（本 spec 的复用底座，GR01）

| 能力 | 载体 |
|---|---|
| **发现 / 加载** | `plugins/core/PluginLoader.ts`（`initialize` / `loadAllPlugins` / `loadPlugin` / `unloadPlugin` / `activatePlugin` / `deactivatePlugin` / `getLoadedPlugins` / `destroy`） |
| **生命周期** | `plugins/core/PluginLifecycleManager.ts` + `plugins/lifecycle/ActivationContext.ts` |
| **依赖解析** | `plugins/management/PluginDependencyManager.ts`（`DependencyResolution` / `VersionConflict` / `DependencyNode` / `resolveDependencies`）+ `plugins/utils/dependencyResolver.ts` + `semver.ts` |
| **权限 / 安全** | `plugins/utils/pluginSecurityScanner.ts`（`DangerPattern` / `RiskLevel` / `SecurityIssue` / `scanPluginDir`）+ `plugins/api/PluginAPI.ts`（`IPluginAPI` / `PluginTool`）+ `plugins/api/KernelServiceRegistry.ts` |
| **热加载** | `plugins/hotload/PluginHotloadManager.ts`（`HotloadStatus` / `HotloadRecord` / `hasHotDisposeHook` / `isHotReloadEligible` / `reloadPlugin`） |
| **分发 / 安装** | `plugins/distribution/NpmDistributor.ts` · `plugins/install/{PluginInstallManager,PythonPluginInstaller}.ts` · `plugins/marketplace/PluginMarketplace.ts` |
| **SDK 侧** | `plugin-sdk/`（`core.ts` / `types.ts` / `ManifestLoader.ts` / `categories.ts` / `channel-contract.ts`）/ 对外契约文档 `plugin-sdk/AGENTS.md` |

### 1.3 **已有同类适配先例**（本 spec 的形态参照）

`plugins/core/SdkPluginAdapter.ts` —— "**SDK Plugin → plugins 体系**"适配层，已确立两件事可复用：
① **生命周期映射**（SDK `initialize/activate/deactivate/destroy` ↔ 本仓插件生命周期）；
② **服务注入**（`KernelServiceRegistry` 注入，`resolveInject` / `grantInjectedAccess`），并以"**SDK 隔离边界**"约束引用方向（SDK 侧只经 `createPluginContext` 收 services，不引用核心模块）。

⇒ 若日后要做 DSH shim，**形态应是"第二个 Adapter"，而非第二套插件系统**（防双轨，CS01）。

---

## 2. 目标 / 非目标

**本次（v1.0）唯一交付** = **契约草案**（四面边界 + 实施前置条件 + 验收口径）。**不写任何代码。**

**非目标（本次明确不做）**
- N1：不新建 `dsh-plugin` 适配层代码、不引入任何依赖（含 `dsh-plugin` 包本身）。
- N2：不改动既有插件体系（`PluginLoader` / `PluginManager` / 生命周期 / 权限）任何行为。
- N3：不承诺 DSH ABI 版本兼容（外部 ABI 未稳定，见 §4-D1）。
- N4：不新建第二套插件发现/DI/权限机制（必须走既有底座，否则即双轨）。

---

## 3. 契约草案（四面）

> 约定：`DshPluginManifest` / `DshPluginModule` 为**待定的外部 ABI 形状**（本仓只能被动适配，不能定义）。

### 3.1 插件发现（discovery）

| 项 | 约定 |
|---|---|
| 输入 | DSH 插件目录/包（`dsh-plugin` 形态），含其 manifest |
| 映射 | DSH manifest → 本仓 `PluginMetadata`（`plugins/types/PluginMetadata.ts`），**必填字段缺失即拒绝加载**（不兜底、不编造） |
| 复用 | **必须**经 `PluginLoader.loadPlugin()` 入册；**禁止**绕过 Registry 自建发现（§1.2 唯一入口） |
| 命名冲突 | 与既有插件同 id ⇒ **明确失败并报冲突**（不覆盖、不静默改名） |

### 3.2 依赖注入（DI）

| 项 | 约定 |
|---|---|
| 服务面 | 仅经 `KernelServiceRegistry` 注入；DSH 侧**不得**直接 import 本仓核心模块（照 `SdkPluginAdapter` 的隔离边界） |
| 依赖解析 | 复用 `PluginDependencyManager.resolveDependencies()`（含 `VersionConflict` 报告） |
| 失败语义 | 依赖不可满足 ⇒ **fail-closed 不激活**（不用"降级到无依赖"掩盖） |

### 3.3 权限边界（permission）

| 项 | 约定 |
|---|---|
| 静态扫描 | 激活**前**经 `pluginSecurityScanner.scanPluginDir()`；`RiskLevel=high` ⇒ 需显式确认（沿用既有判定，不新造等级） |
| 运行时 | 工具/命令注册走 `PluginAPI`（`IPluginAPI`）；高危能力的**授权语义复用既有 Permission 体系**（不新造第二套） |
| 红线 | ❌ DSH 插件不得绕过 `PathGuard` / 沙箱；❌ 不得读 `~/.pyapp/config.json` 等凭据（与 `QQChannel` 文件安全同口径） |

### 3.4 热加载（hot reload）

| 项 | 约定 |
|---|---|
| 资格 | 复用 `isHotReloadEligible()` / `hasHotDisposeHook()` —— **无 dispose 钩子的插件不热重载**（既有判据，不放宽） |
| 机制 | 复用 `PluginHotloadManager.reloadPlugin()`（含 `HotloadRecord` 状态机） |
| 边界 | 热重载失败 ⇒ 回退到**未加载**态并如实报错（不保留半初始化实例） |

---

## 4. 决策点（**若日后实施**，需先答）

| ID | 决策项 | 选项 | 说明 |
|:--:|---|---|---|
| **D1** | DSH ABI 版本策略 | (a) 钉死单一 ABI 版本（不兼容即拒）／(b) 多版本矩阵／(c) 只支持 manifest 的最小子集 | 外部 ABI 稳定性未证 ⇒ 建议 **(a) 钉死 + 明确报错** |
| **D2** | 权限模型 | (a) 复用既有 Permission 体系（映射 DSH 声明）／(b) 为 DSH 另立权限模型 | 建议 **(a)**（防双轨，CS01） |
| **D3** | 隔离级别 | (a) 同进程（照 `SdkPluginAdapter`）／(b) 子进程/沙箱 | 与 `sandbox-b-group`（P1-20）交叉；同进程实现成本低但隔离弱 |
| **D4** | 分发渠道 | (a) 复用 `NpmDistributor` / `PluginInstallManager`／(b) DSH 自有渠道 | 建议 **(a)** |

---

## 5. 若实施：影响文件（预计，**本次不动**）

| # | 文件 | 改动 |
|---|---|---|
| 1 | `app/src/plugins/core/DshPluginAdapter.ts` | **新建**：DSH ABI → 本仓插件体系（仿 `SdkPluginAdapter`） |
| 2 | `app/src/plugins/types/DshPluginManifest.ts` | **新建**：外部 manifest 的**最小结构契约**（仅描述本仓消费的字段） |
| 3 | `app/src/plugins/core/PluginLoader.ts` | 可能**不动**（若适配器经既有 `loadPlugin` 入册则零改动） |
| 4 | `app/tests/plugins/DshPluginAdapter.test.ts` | **新建**：契约用例（发现/DI/权限/热加载四面各 ≥1 例 + 反例） |

---

## 6. 若实施：验收（可证伪）

| 项 | 通过标准 |
|---|---|
| 发现 | DSH manifest 合法 ⇒ 入册且出现在 `getAllPlugins()`；manifest 缺必填 ⇒ **明确失败**（不兜底） |
| 同名 | 与本仓插件同 id ⇒ 报冲突且**不覆盖** |
| DI | 依赖不可满足 ⇒ **不激活**（fail-closed）；服务仅经 `KernelServiceRegistry` |
| 权限 | `RiskLevel=high` 未确认 ⇒ 不激活；绕过 `PathGuard` 的尝试被拒 |
| 热加载 | 无 dispose 钩子 ⇒ `isHotReloadEligible=false`；失败 ⇒ 回 **未加载**态 |
| 双轨守卫 | 全仓**无**第二套插件发现/DI/权限机制（`grep` 可证） |
| 回归 | 不启用 shim 时**零行为变更**（全量 `bun test` 0 fail） |

---

## 7. 触发条件（**何时才值得做** —— 本次不做的判据）

须**同时**满足（任一不满足即维持不实施）：
1. **有真实 DSH 插件消费需求**（当前 0）；
2. DSH 插件 ABI **达到可钉版本**（当前未证）；
3. 收益（生态复用）**大于**维护第二适配面的成本 —— 需先有量化依据。

> 与 **T-1（AI-VFS）/ T-4（内核 IPC 信号总线）** 同判据："**架构级、无触发场景 ⇒ 未立项**"。

---

## 8. 合规检查清单

| 规则 | 结论 |
|---|---|
| GR15 Spec-Driven | ✅ 先立契约 spec；**本次不实施**（用户裁定） |
| GR01 基础设施复用 | ✅ 四面**全部复用**既有底座（`PluginLoader` / `PluginDependencyManager` / `pluginSecurityScanner` / `PluginHotloadManager` / `KernelServiceRegistry`），形态照 `SdkPluginAdapter` |
| CS01 归一化 | ✅ 已检索：`dsh-plugin`/`PluginShim` 全仓 0 命中 ⇒ 无既有实现可复用亦无双轨；**明确禁止**新造第二套发现/DI/权限 |
| CS03 回退最小化 | ✅ 失败一律 **fail-closed / 明确报错**，不设"降级到无依赖/无权限"通道 |
| CS04 零 Mock | ✅ 本次交付仅文档；若实施，用例用真实 manifest 字面量 |
| CS05 根因优先 | ✅ 根因＝"外来 ABI 无接入面"，而非"插件系统缺能力"（§1.2 已完备） |
| R06-008 分层 | ✅ 适配器留 `plugins`（app 层）；隔离边界照 `SdkPluginAdapter`（外部侧不引核心模块） |
| PY_APP §2 简洁优先 | ✅ 契约面 ≤4 且**零新依赖/零新机制** |

---

## 9. 实施记录

| 日期 | 事件 | 详情 |
|---|---|---|
| 2026-10-06 | **立契约 spec（用户裁定「先立契约 spec，不实施」）** | 本文件创建；取证见 §1（`dsh-plugin`/`PluginShim` 0 命中 · 既有插件体系完备 · `SdkPluginAdapter` 先例）。**交付 = 契约草案**（四面 + 决策点 + 前置条件 + 验收口径）；**未写任何代码、未引任何依赖** |

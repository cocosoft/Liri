# 代码删除安全流程 / Code Deletion Safety

> 规则格式：`[CD-ID] [强制级别] 描述`。强制级别：**MUST**（违反即拒绝）/ **SHOULD**（需说明理由）。
>
> 本规则是 [PY_APP.md](./PY_APP.md) §3「外科手术式修改」与 [architecture.md](./architecture.md)「实现唯一性 / 双轨制」在**删除**场景下的强化：前两者约束"**从窄处删**"，本规则补齐"**删之前如何证明可删**"。
>
> **来源**：第九轮外部审查 §6.2〔`dev_docs/20261009/openai 建议.md`〕—— 以本仓**沙箱误删事故**为实证。

---

## §0 背景：为什么需要一条"删除"规则

**实证事故（本仓）**：v0.4.69 的"死面清理"以**静态引用为零**为依据，删除了沙箱隔离子系统的多个"未接线"组件：

- `c693698db refactor(sandbox): drop the unwired isolation dead surfaces (P1 follow-up)`
- `da37b9df4 refactor(sandbox): remove the hollow SPI faces and their dead backends (S1/S6/S7)`
- `9305397a2 refactor(sandbox): delete the unused SandboxConfigBuilder policy library`

删除后经确认：这些组件**在当前执行路径之外，但由其他入口（配置 / 启动接线 / 运行时发现）真实使用** ⇒ 于 v0.4.71 整体回滚：

- `4356706bf revert(sandbox): restore the sandbox subsystem removed by the v0.4.69 dead-surface cleanup`

**根因**：**"静态引用为零" ≠ "运行时可删"**。运行时可达性由**动态导入、配置注册、插件/依赖注入、构建变体、环境开关**等**静态正则看不见**的入口决定（与本仓 `lint:arch` 的 R00-003 动态盲区同源）。删除是不可逆的破坏性操作，必须走**可证伪**的流程。

---

## §1 删除前六步核查（MUST）

**CD01 [MUST] 搜静态引用、动态导入与配置注册**

- 搜索：`import` / `require` / `export` 引用；**动态导入** `import('…')` / `require('…')`（含拼接路径 / 变量）；**字符串形式的注册**（配置项、表驱动的 key、`allowedPaths` 等）。
- 工具：`SearchCodebase` + `Grep`（**多关键词**，非单一名）；对**动态**入口单独搜 `import(`、`require(`、以及目标模块名/路径片段的**字符串出现**。

**CD02 [MUST] 搜构建入口、插件入口与运行时发现机制**

- 构建入口：`build:*/` 变体脚本（`scripts/build-variant.ts`）、编译入口（`pyapp.ts` / `main.ts`）、打包脚本。
- 插件入口：`ModuleDefinitions` / 模块注册表 / `channelRegistry` / `skillRegistry` / 工具注册表 / MCP bridge / `dependencyRegistry`。
- 运行时发现：目录扫描、约定式加载、`resolve*` 动态解析（如按名加载通道/技能/插件）。

**CD03 [MUST] 查依赖注入容器、反射与外部协议入口**

- DI：`dependencyRegistry`、`EffectScope`、`resolve<T>()`、工厂注册表。
- 反射 / 元数据：装饰器、`auto-bind`、约定式方法名（`render*` / `handle*`）。
- 外部协议入口：HTTP 路由注册表、IPC 命令清单、ACP/A2A、webhook 路径 —— 这些**未必**在该组件的静态调用链里。

**CD04 [MUST] 确认功能在测试、构建变体与运行模式中是否启用**

- 测试：`tests/**` + `src/**` 内联测试是否引用。
- 构建变体：`core/personal/coding/enterprise` 是否包含该能力。
- 运行模式：`CLI | REPL | MCP | DAEMON | TEST` 各模式下是否可达（**至少逐一回答**，不得只验开发模式）。
- 环境开关：`featureFlags.ts` 的对应开关（默认值与"生效语义"见 [project_rules.md](./project_rules.md) §1.4）。

**CD05 [MUST] 先摘入口，再确认无运行时消费者，最后删实现**

- **顺序不可颠倒**：① 先在**独立变更**中移除注册/调用入口 → ② 观察一段（或经真实运行）确认**无运行时消费者 / 无告警/无降级日志** → ③ 最后才删除实现体。
- 禁止"入口与实现同一提交一起删"——一旦判断有误，回滚粒度太粗。

**CD06 [MUST] 独立提交 + 保留回滚路径**

- 删除应落在**独立提交**（不与功能/重构混提），提交信息写明**删除依据**（六步核查结论）与**回滚方式**。
- 保留可回滚点：删除前记录被删文件清单/提交哈希；涉及多文件时优先"先 revert-only 提交可复原"的形态。

---

## §2 关键模块：**禁止**以"无静态引用"作为删除依据（MUST）

**CD07 [MUST] 关键模块白名单（一票否决）**

对下列**关键模块**，**不得**仅凭"静态引用为零"删除：

| 关键域 | 举例（本仓） | 为什么禁 |
|---|---|---|
| **沙箱 / 隔离** | `sandbox/**`、Landlock 接线、`code_run` 沙箱、`PathShield` | 安全兜底常为**运行时按平台/能力**启用，静态失联 ≠ 无消费者（**本次事故本体**） |
| **安全 / 权限** | `security/**`、`permission/**`、`EnhancedPermissionEngine`、bash 拦截 | fail-closed 兜底必须保留；删除即**静默削弱安全姿态** |
| **会话恢复** | `session/**` 的恢复/修复/`recovery`、`EventLogStorage` 修复链、`ExecutionManager` 恢复 | 崩溃/重启路径**测试难以覆盖**，静态失联常见 |
| **通道 / 工具注册** | `channels/**` 注册表与目录、`ToolRegistry`、MCP bridge | 由**配置 / DB / 运行时发现**驱动，静态引用天然稀疏（如 `ChannelCatalog` 的 `exportKey` 约定） |

对上述模块：删除前**必须**满足 CD01–CD06 **且**给出"运行时可证无消费者"的证据（真实运行观察 / 负向对照 / 明确的废弃标记 + 迁出计划）；否则**保留并记录**（如需清理，先标记 `@deprecated` + `process.emitWarning`，观察期后再删）。

---

## §3 正例（照此执行）与反例（勿重犯）

**✅ 正例 —— 本次沙箱事故的复盘引用**
若在 v0.4.69 之前套用本规则：CD02 会发现这些"未接线"组件**确由配置/启动接线入口引用**；CD04 会因"沙箱按平台能力运行时启用"而**拒绝**"无静态引用即删"；因此**不会**发生 `c693698db`/`da37b9df4`/`9305397a2`，也就无需 `4356706bf` 的整体回滚。

**❌ 反例 —— 已发生的做法**
以 `lint:arch` 静态零引用为唯一依据，**同批**删除"未接线"组件 ⇒ 运行期能力缺失 ⇒ 只能整块 revert。

---

## §4 规则索引

| 规则 ID | 描述 | 强制级别 |
|---------|------|:--------:|
| CD01 | 删除前搜静态引用 / 动态导入 / 配置注册 | MUST |
| CD02 | 删除前搜构建入口 / 插件入口 / 运行时发现 | MUST |
| CD03 | 删除前查 DI 容器 / 反射 / 外部协议入口 | MUST |
| CD04 | 删除前确认测试 / 构建变体 / 运行模式启用情况 | MUST |
| CD05 | 先摘入口 → 确认无消费者 → 再删实现 | MUST |
| CD06 | 独立提交 + 保留回滚路径 | MUST |
| CD07 | 关键模块禁止以"无静态引用"为删除依据 | MUST |

**AI 自查问句**：我准备删掉的这段代码，**有没有可能**通过"动态导入 / 配置 / 插件 / DI / 外部协议"被别的入口用到？如果没有穷尽这几类入口的搜索，**我就还不能删**。

---

## §5 与现有规则的关系

| 现有规则 | 本规则强化点 |
|---|---|
| [PY_APP.md](./PY_APP.md) §3 外科手术式修改 | 明确"删除"是高风险操作，需六步核查，而非"顺手删" |
| [architecture.md](./architecture.md) 实现唯一性 / 双轨制 | 双轨清理时，先证明"另一套确无运行时消费者"再删 |
| [architecture-compliance.md](./architecture-compliance.md) R00-003（动态导入盲区） | 把"静态看不见动态"从**上报**升级为**删除前必查项**（CD01/CD02） |
| [coding-standards.md](./coding-standards.md) CS03 回退最小化 / CS05 根因优先 | 删除不是"回退策略裁撤"的借口；先根因，再决定是否删 |

# 模块 `onReady` 生命周期驱动缺失 —— 设计方案

> 状态：**✅ 已实施（方案 C）** ｜ 建立 2026-09-14 ｜ 实施并验收 2026-09-14 ｜ 关联台账：V-17（残余）、V-30（遗留）
> 结论摘要：`mail` / `calendar` / `doc` 三模块的 `onReady()` **无统一驱动方** → 其工具永不注册 → 相关能力（含 V-17 名单中 5 项）在运行期不可用。**已按方案 C（统一生命周期驱动）修复**，`GET /v1/tools` **78 → 84 项**。

## 实施记录（2026-09-14）

| 项 | 实施内容 |
|---|---|
| 落点（优化） | 统一驱动放在 **`ModuleRegistry.initialize()`**（紧随既有 `module.initialize()`）→ **覆盖 eager / 延迟 / 按需全部路径**（原方案写的是 `ModuleInitializer`，实施时改到更居中的位置） |
| 声明式挂载 | `MODULE_DEFINITIONS` 的 `doc` / `mail` / `calendar` 三项新增 `onReady`（动态 import + `getInstance().onReady()`）；**新增模块只需声明即自动获得驱动** |
| 失败隔离 | `onReady` 抛错 → `handleError()` 记录、**不阻断**初始化（与 `initialize` 的"抛错即失败"区分） |
| 幂等 | `MailModule` / `CalendarModule` / `DocModule` 各加"已就绪即返回"（DocModule 枚举无 `READY`，用 `!== UNINITIALIZED`） |
| **未做（取舍）** | 方案 §5.2 的"移除 `main.ts` 的 media 特例"**保留不动** —— 该特例用 `new MediaModule()`（非单例），声明式驱动会引入双实例/双注册风险（media 本不在缺陷范围内） |
| Q2 | `ModuleDefinitions` 中 `mail`/`calendar` 注释由"已在 eager 阶段加载"校正为"DEFERRED：启动后由 `scheduleDeferredModules` 后台批次加载" |
| Q3 | `config/types.ts` 的 `autoDegradeOnTimeout` 补**危险默认警示注释**，**保持不接线**（fail-safe） |

**验收结果**：启动日志出现三模块"就绪"；`/v1/tools` **84 项**（含 `mail:send` / `calendar:add\|list\|update\|delete` / `office:workflow`）；幂等验证通过（触发 office 端点后工具数仍 84）；`tsc` 0 + 全量 3823 pass / 0 fail + `lint:arch` 通过。

---

## §1 背景与现象

| 现象 | 证据 |
|---|---|
| `GET /v1/tools` 返回 **78 项**，**不含** `mail:send` / `calendar:add|update|delete` / `office:workflow` | 2026-09-14 实测（`GET /v1/tools` 实取） |
| 模型侧同样看不到这些工具：`tool_search select:calendar` → `matches: []`，模型原文「工具清单里不存在 `calendar:add`（或任何日历相关工具）」 | 2026-09-14 浏览器实测 |
| **V-17 门控名单中新增的 5 项**（`mail:send` / `calendar:add|update|delete` / `office:workflow`）在运行期**永不命中** | 同上（名单本身正确，属"备而不用"） |
| 三模块**确实已初始化**（不是"模块没加载"） | `app.log`：`模块初始化完成: mail (0ms)` / `calendar (1ms)` / `doc (0ms)` |
| feature flag **不是**原因 | `core/featureFlags.ts#L153-L161` 三者默认 **`true`**；且日志中**无** "MAIL_MODULE feature flag 已关闭" / "跳过 mail 模块" 等记录 |

⇒ 既有"模块已加载"也有"开关已开启"，但**工具从未注册**。

---

## §2 根因（已定位到调用方缺失）

### §2.1 三模块的注册动作都在 `onReady()` 内

| 模块 | 注册动作 | 文件 |
|---|---|---|
| mail | `globalToolManager.registerTool(createMailSendTool())` | `modules/mail/MailModule.ts#L37-L60`（`onReady()`） |
| calendar | 连续注册 4 个日历工具 + 启 `ScheduleHook` | `modules/calendar/CalendarModule.ts#L43-L73`（`onReady()`） |
| doc | 注册办公工作流工具（`office:workflow`） | `modules/doc/DocModule.ts#L95` 起（`onReady()`；`DOC_MODULE` 开关亦默认 `true`） |

三者的 `onReady()` 结构一致：**先查 feature flag**（默认 `true`，故不早退）→ 动态 import 工具体 → `registerTool()` → 打 "就绪" 日志。

### §2.2 但全仓 `onReady()` 的**驱动方只有 3 处**（grep 实证）

| 驱动方 | 覆盖范围 | 备注 |
|---|---|---|
| `main.ts#L1052` `await mediaModule.onReady()` | **仅 media** | 显式硬编码单模块调用 |
| `modules/doc/api/officeHandlers.ts#L207` `await doc.onReady()` | **仅 doc** | **HTTP 请求触发**（懒调用）——即"访问办公/邮件/日历 HTTP 端点后"才注册工具 |
| `core/di/ContainerScope.ts#L180` `await desc.onReady(instance)` | 经 DI 容器注册者 | 三模块**均未走此路径**（否则会有"就绪"日志） |

⇒ **`MailModule.onReady()` 与 `CalendarModule.onReady()` 无任何调用方**；`DocModule.onReady()` 仅在办公 HTTP 端点被访问时触发。

**旁证**：`app.log` 中**既无** `MailModule 就绪 — 邮件工具已注册`，**也无** `CalendarModule 就绪 — 4 个日历工具已注册`，即两者的 `onReady()` 从未执行 → 与"注册未发生"完全吻合。

### §2.3 附带发现（非本议题根因，供交叉参考）

`ModuleDefinitions.ts#L982-L984` 的注释称 `mail`/`calendar` **"已在 eager 阶段加载"**，而 `LazyModuleStrategy.ts#L325-L332` 却把它们声明为 **`ModuleLoadPriority.DEFERRED`**（trigger「邮件/日历功能首次触发时加载」）。**两者口径不一致**（前者是"备注性描述"，后者是实际被 `getDeferredModuleIds()` 消费的策略）——但本次取证表明**模块层面确实都完成了初始化**，故该矛盾**不是**本症状的直接原因；建议在修复时一并校正注释口径，避免误导。

---

## §3 影响面

1. **能力缺失（主影响）**：邮件发送、日历增删改查、跨模块办公工作流在**会话内不可被模型调用**（工具不在 registry）。
2. **门控覆盖失效（关联 V-17）**：V-17 名单中这 5 项虽正确登记，但运行期永不命中 ⇒ V-17 对"办公类外部动作"的确认保护**实际未生效**。
3. **前端「办公」页**：`getCapabilities()`（`MailModule#L81-L87`）在模块未 `onReady()` 时 `status` 恒为 `UNINITIALIZED` → 界面可能显示"未就绪/降级"，与"开关已开、模块已加载"的事实不符。
4. **doc 的不一致行为**：其工具"访问过 HTTP 端点后才出现" ⇒ 同一会话中工具可用性**随时间变化**，属难复现的偶发问题。

---

## §4 候选方案

| 方案 | 做法 | 优点 | 缺点 / 风险 |
|---|---|---|---|
| **A. 显式补调用** | 在 `main.ts` 启动链追加 `await mailModule.onReady(); await calendarModule.onReady();`（对齐既有 `mediaModule.onReady()`） | 改动最小（约 2 行）、立即可验证 | **仍是"逐个硬编码"**：新增模块仍会漏（本次缺陷正是这么产生的）；且 `main.ts` 启动时长增加 |
| **B. 走 DI 容器** | 把三模块注册进 DI 容器，交由 `ContainerScope#L180` 生命周期钩子驱动 | 复用既有容器机制、不增启动硬编码 | 需评估容器注册面与解析时机（容器注册可能触发其它副作用）；未覆盖"不经容器"的模块；仍需保证三模块都在容器内 |
| **C. 统一生命周期驱动（推荐）** | 由 `ModuleInitializer` 在模块初始化完成后**统一调用**该模块的 `onReady()`（若实现）——即把"是否/何时调 `onReady`"从**调用方**收回到**模块框架** | **根治**：新增模块自动获得驱动，不再依赖"记得加一行"；与 §1.16「注册 → disposer 生命周期约定」精神一致 | 改动面最大（框架层）；需处理幂等（media 已被显式调用）与失败隔离（单模块 `onReady` 抛错不得影响启动） |

---

## §5 推荐方案（C）与实施步骤

**推荐 C**，理由：本缺陷的本质是"**生命周期驱动靠调用方自觉**"，A 只是把漏掉的那次补上，**下一次新增模块仍会重演**；C 把驱动收敛到框架，符合项目"实现唯一性 / 收敛单一入口"的一贯取向。

1. `ModuleInitializer`：在模块 `initialize()` 成功后，若实例具备 `onReady`（鸭子类型判断，避免引入新的接口约束面），则在**受控时机**（建议：T2 分发完成后、与 `scheduleDeferredModules` 同域）调用一次；**逐个 try/catch 隔离**，失败记 `handleError()`（§1.9）并标记该模块 `DEGRADED`，不阻断启动。
2. **幂等**：为模块增加"已 ready"标记（可复用各模块既有 `private status`），`onReady` 重复调用直接返回；据此**移除** `main.ts#L1052` 的 media 特例（避免双驱动）。
3. **doc 的 HTTP 懒调用保留**（`officeHandlers.ts#L207`）作为兜底，但在框架驱动生效后通常已是空转；如需清理，另附小项。
4. `ModuleDefinitions.ts#L982-L984` 的口径矛盾**同时校正**（注释改为与 `LazyModuleStrategy` 一致，或反向调整策略——见 §9 Q2）。
5. 验证见 §6。

---

## §6 验证计划（实施后）

| # | 验证 | 通过标准 |
|---|---|---|
| 1 | 启动日志 | 出现 `MailModule 就绪 — 邮件工具已注册` 与 `CalendarModule 就绪 — 4 个日历工具已注册` |
| 2 | `GET /v1/tools` | 包含 `mail:send` + `calendar:add/list/update/delete` + `office:workflow`（78 → 约 84 项） |
| 3 | 模型可见性 | `tool_search select:calendar:add` → `matches` 含该项（当前为空） |
| 4 | **门控联动（V-17 闭环）** | 切「执行」模式后要求模型调用 `calendar:add` → 应弹「决策确认」卡；点「取消」后**不写入**（零副作用） |
| 5 | 失败隔离 | 人为让某模块 `onReady` 抛错 → 启动不中断、仅该模块 `DEGRADED` |
| 6 | 幂等 | 重复触发 `onReady` 不产生重复注册（`registry` 工具数不增长、无"重复注册"告警） |
| 7 | 回归 | app 全量测试 0 fail + `lint:arch` 通过 |

---

## §7 风险与回滚

- **风险**：框架层改动可能影响**所有模块**的启动时序（尤其重型模块如 `doc`/`media` 的 `onReady` 会做 IO/启动 hook）。**缓解**：驱动**异步不阻塞**（与 `scheduleDeferredModules` 同域）、单模块失败隔离、必要时给重型模块加"延迟到空闲"选项。
- **回滚**：C 的实施点集中（`ModuleInitializer` 一处 + `main.ts` 一处去特例），回滚即恢复"显式调用"（或退化为方案 A）。

---

## §8 关联待决策项（V-17 残余，**建议在本议题一并评审**）

V-17 的**代码收尾已完成并通过运行期验证**（名单 13 项 / 门控接线 / 弹卡 + 取消零副作用，见台账 V-17 行）。仅余两处**配置未被消费**，且两者都属"产品语义决策"，**不宜由实施方擅自接线**：

| 配置 | 位置 | 现状 | 说明 |
|---|---|---|---|
| `negotiation.responseTimeoutMs`（默认 **5 分钟**） | `config/types.ts#L240`/`#L575` | **无消费方**；循环用自持常量 `ReActToolLoop.INTERACTION_MAX_WAIT_MS` | 若接线，**等待上限将由当前常量值变为 5 分钟**（**用户可感的行为变化**：应答慢的用户可能"还没答就超时"）⇒ 需先确认期望取值 |
| `negotiation.autoDegradeOnTimeout`（默认 **true**） | `config/types.ts#L242`/`#L576` | **无消费方**；`defaultAnswerForTimeout()`（`DecisionGate.ts#L326`）**生产零调用**（仅单测） | ⚠ **安全隐患（重要）**：若按默认值接线，超时将改用"默认答案"——而 `defaultAnswerForTimeout()` 对 **confirm 类问题返回 `['确认']`**（见 `tests/chat/DecisionGate.test.ts#L297-L308`）⇒ **等待超时即自动确认外部操作**，与 V-17「外部操作必须用户确认」的语义**直接冲突**。当前"超时 = `return undefined`（不执行，fail-safe，`ReActToolLoop.ts#L2344-L2351`）"**反而是安全的**。⇒ 若未来要接线，**必须对 `external_action` 类问题强制 fail-safe（忽略该开关）** |

---

## §9 待用户决策项

| # | 问题 | 选项 |
|---|---|---|
| **Q1** | 采用哪个方案修复生命周期驱动？ | **C（统一驱动，推荐）** / A（最小补调用）/ B（走 DI 容器） |
| **Q2** | `ModuleDefinitions`（称 eager）与 `LazyModuleStrategy`（标 DEFERRED）的口径矛盾如何处理？ | 校正注释以匹配策略 / 调整策略使其真正 eager / 暂不处理（仅记录） |
| **Q3** | V-17 残余两项：`responseTimeoutMs` 期望取值？`autoDegradeOnTimeout` 是否接线？ | ① 保持 10 分钟常量（不接线）/ 接线为 5 分钟 / 其它取值；② 保持不接线（fail-safe，推荐）/ 接线但对外部动作强制 fail-safe |

---

## §10 附：本次取证命令与证据位置（可复核）

- 工具清单：`GET http://127.0.0.1:18990/v1/tools` → 78 项（无 `mail:*`/`calendar:*`/`office:workflow`）
- 模块初始化：`~/.pyapp/data/logs/app.log` → `模块初始化完成: mail (0ms)`、`calendar (1ms)`、`doc (0ms)`；**无** "跳过 mail 模块"、**无** "MailModule 就绪"
- 驱动方 grep：`\.onReady\(` → `main.ts#L1052`（media）/ `officeHandlers.ts#L207`（doc）/ `ContainerScope.ts#L180`（DI）
- 开关默认值：`core/featureFlags.ts#L153-L161`（`DOC_MODULE` / `MAIL_MODULE` / `CALENDAR_MODULE` = `true`）

# 真机长程任务实测问题整改方案 v2（2026-11-21）

> 状态：**P1-1 / P1-2 / P1-3 / P2-1 / P2-2 已实施并真机复验**（§8）；P2-3 为只读对齐（已登记上游依赖）。
> 待办仅剩「产品决策类」两项（见 §8.2 末尾），无工程阻塞。
> 来源：2026-11-21 Liri 真机实测（会话 `session_mwpit6sk32d12fe50b`，前端 1420 / 后端 18990）
> 关联规则：CS01（先查已有）· CS02（状态禁字符串匹配）· CS05（根因优先）· CD06（独立提交可回滚）
> 边界：只修复实测暴露的问题；**不新增审批系统、不自动批准、不伪造任务完成状态**。
>
> **v2 修订（重要）**：v1 判断「审批项无 TTL」是**错误**的。回仓取证发现
> `InboxManager` 已有按类型分层的 TTL（工具 30 分钟 / 工作区 24 小时，2 分钟扫描一次）。
> 真正的缺陷是：**过期只改了 inbox 状态并广播，普通聊天会话的状态/消息元数据没有收敛**，
> 所以侧栏仍显示「待审批 / 已暂停」。v2 据此重写 P1-2，并补全 P1-1 的复用与落点。

---

## 0. 结论先行

1. 长程任务链路本身是通的：6 步任务在 **2 次人工审批**后自动跑完，产物落盘且读回校验通过。
2. 阻碍「无人值守自动化」的是两件事：
   - **审批规则粒度失真**：一次「以后这个命令免审批」写入 `^powershell -NoProfile.*`（放行所有 PowerShell）；
   - **审批过期后状态不收敛**：TTL 已存在，但过期只更新 inbox 并广播，会话仍停在
     `requires_action`（侧栏「待审批」/「已暂停」），用户看到的与真实状态（卡已不可回复）不一致。
3. 另有三处一致性：全局信任级别设置页不可见、todo 未收尾、i18n 细节。
4. 建议顺序：**P1-1 → P2-2 → P1-3 → P2-1 → P1-2**。
5. 与工具治理 v3 的交叉点：若后续开放 `desktop` / `browser` 等 EXTERNAL 工具，审批频次会上升，
   **必须先完成 P1-2 的状态收敛**，否则积压会更严重。

---

## 1. 实测证据（均可复核）

| # | 观察 | 证据 |
|---|---|---|
| E1 | 任务完成：6 步全做，写盘 + 读回 | `output/real-machine-longtask.md`，3297 B，mtime 2026-11-21 05:59:34 |
| E2 | 会话事件链完整 | `C:\Users\csdnc\.pyapp\data\sessions\57971aa3\session_mwpit6sk32d12fe50b\events.jsonl`：121 条事件 / 3 轮 / 32 次工具调用（bash 22、file_read 5、file_write 3、todo_write 2） |
| E3 | 两轮因审批收尾 | `turn/end`：turn1 `tool_use` + `terminationReason=awaiting_approval`；turn2 `stop` + `awaiting_approval`；turn3 `completed` |
| E4 | 安全门真的拦截 | 2 条 `tool/result.isError=true`：`$\([^)]*\)` 危险模式；PowerShell `if` 控制流被拒（只判单条命令） |
| E5 | 规则落盘粒度失真 | `C:\Users\csdnc\.pyapp\data\permissions\tool_rules.json`：`toolName=bash`、`contentPattern=^powershell -NoProfile.*`、`origin=approval`；设置页显示「命中 9 次」 |
| E6 | 进度 4/6 与答复不一致 | `assistant/todo` 仅 2 次：第一次 6 项 pending；第二次 4 项 completed + 第 5 项 `in_progress`，此后无收尾事件 |
| E7 | 审批堆积 | 会话列表当前可见 4 个「待审批」、5 个「已暂停」、1 个「出错」（未展开全部 54 个） |
| E8 | 未收录命令仍是审批主因 | 设置页：近 7 天 25 个未收录命令被转审批，共 3574 次；powershell 282、mkdir 207、for 204 |
| E9 | 设置页多数功能有效 | 主题浅→深→浅、语言 zh→en→zh、工具放行撤销（列表 1→0，磁盘变 `[]`）均生效 |
| E10 | 工具可见性收敛 | 70 项中 13 项对模型可见，1 项「未接线（覆写无效）」 |
| E11 | Windows 沙箱不参与判定 | 信任与隔离页原文：「当前平台没有可用的隔离后端…已停用」 |
| E12 | 全局信任级别只在提示条出现 | 会话顶部横幅 `chat`；信任与隔离页默认权限模式显示 `default`，无全局级别字段 |
| E13 | **审批 TTL 已存在** | `APPROVAL_TTL_MS = 30min`、`WORKSPACE_SCOPE_TTL_MS = 24h`、扫描周期 2min（`InboxManager.ts:130-145,256-270`）；历史实测 991 张卡中 934 张过期（94%，注释 `:131-135`） |
| E14 | **过期不收敛普通会话状态** | 过期只 `UPDATE inbox_items ... status='expired'` + 广播 `inbox:update`（`InboxManager.ts:1319-1378`）；入口层唯一过期监听器是 `abortPdcaAfterExpiry`（`main.ts:1754-1763`），未见普通聊天会话的状态收口 |
| E15 | `/v1/inbox` 已废弃 | `inbox-handlers.ts:1-10` 头注：已迁移至通知中心 `/v1/notifications/*`，仅为兼容保留 |
| E16 | 停止钩子不能阻断/续跑 | `StopHook` 签名为 `void \| Promise<void>`（`StopHooks.ts:46-50`），不能注入消息或否决收尾 |
| E17 | 解释器常量已存在 | `HIGH_CAPABILITY_INTERPRETERS` / `isHighCapabilityInterpreter` / `hasInlineCodeFlag`（`app/src/tools/bash/bashCommandPolicy.ts:194-237`） |

---

## 2. 问题清单

| ID | 级别 | 问题 | 直接后果 |
|---|---|---|---|
| P1-1 | 高 | 「以后这个命令免审批」落盘为**命令前 2 token 前缀**，解释器命令退化为「放行整个解释器」 | 一次点击把治理面放大到所有 PowerShell 命令 |
| P1-2 | 高 | **审批过期后会话状态不收敛**：inbox 已 `expired`，会话仍 `requires_action`；且 TTL 不可配置 | 卡已不可回复，侧栏仍显示「待审批/已暂停」；用户重复尝试 |
| P1-3 | 中高 | 生效的全局信任级别（`--trust-level`）在设置页不可见 | 用户看到的 `default` 与实际 `chat` 不一致 |
| P2-1 | 中 | 模型完成后未收尾 todo，进度停在 4/6 | 界面与最终答复矛盾 |
| P2-2 | 低 | 语言切换后 `document.documentElement.lang` 仍为 `zh-CN`；「简单模式」硬编码 | i18n 细节不一致 |
| P2-3 | 说明项 | Windows 无沙箱后端，隔离档位不参与判定 | 页面已如实披露；对齐既有 `windows-sandbox.md` |

---

## 3. 逐项方案

### P1-1 命令级免审批：解释器命令改为精确匹配

**根因**：`buildCommandContentPattern` 固定取前 2 个 token 再加 `.*`
（`packages/service/src/runtime/inboxApproval.ts:1260-1269`）。
对 `powershell -NoProfile -Command "..."` 生成 `^powershell -NoProfile.*` ⇒ 与按钮文案「这个命令」不符。

**改法（复用已有，CS01）**：

1. **共享解释器清单**：现有 `HIGH_CAPABILITY_INTERPRETERS` 在 app 层
   （`app/src/tools/bash/bashCommandPolicy.ts:194-214`），而 `inboxApproval` 在 service 层，
   **不能反向 import app**（R00-001）。把该集合与 `isHighCapabilityInterpreter` / `hasInlineCodeFlag`
   下沉到 `packages/infra/src/permission/commandPatterns.ts`，app 层改为 re-export（行为逐字不变）。
2. **精确匹配集合**：在共享清单上补 `cmd` / `sh` / `bash` / `zsh`（解释器形态，不只是"高能力"），
   并对首 token 归一：`basename`、去 `.exe`、小写（处理 `C:\...\powershell.exe`）。
3. 命中解释器 ⇒ `^${escapeRegExp(command.trim())}$`，复用 `persistWorkspaceCommandRule`
   （`inboxApproval.ts:1215-1252`）的写法；非解释器保留 2-token 前缀。
4. **透明化**：审批卡显示将落盘的正则（挂到 Inbox `options` 的预览字段，前端
   `InlineApprovalActions.tsx:34-60` 展示）。
5. 单测：`app/tests/permission/commandLevelAllowlist.test.ts`
   - 正向：`dir /b` 仍按前缀命中；
   - 负向：批准 `powershell -NoProfile -Command "A"` 后，`powershell -NoProfile -Command "B"` 必须再次审批；
   - 归一：`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe -NoProfile ...` 也走精确匹配。

**验收**：复现 E5 后，`tool_rules.json` 的 `contentPattern` 为精确命令；换参数重新弹审批。
**风险/出口**：精确匹配会增加打扰；出口是已有的「本工作区永久信任」与「工具级放行」。
**回滚**：共享常量文件 + `inboxApproval` 两处，独立提交可 revert。

---

### P1-2 审批过期：让会话状态与 inbox 状态收敛（重写）

**现状（不是"没有 TTL"）**：

- TTL 已存在：工具审批 30 分钟、工作区申请 24 小时；每 2 分钟扫描一次（E13）。
- 过期动作：更新 `inbox_items.status='expired'`、广播 `inbox:update`、通知渠道、触发 PDCA abort（E14）。
- **缺口**：普通聊天会话的状态来自 `SessionInfo.status`（`requires_action`）与消息
  `metadata.terminationReason=awaiting_approval`；过期没有改写这两者 ⇒ 侧栏继续显示「待审批/已暂停」，
  而卡片已不可回复。

**改法（分三步，均不自动执行）**：

| 步骤 | 内容 | 落点 |
|---|---|---|
| 1. 状态收敛 | 过期回调里，对**普通聊天会话**追加一条会话事件（如 `approval/expired`）并把会话状态从 `requires_action` 收口到 `idle`；幂等（重复过期不报错） | `main.ts` 的 `onInboxItemsExpired` 旁路（`:1754-1763`）+ `InboxManager` 广播载荷带 `sessionId` |
| 2. 前端呈现 | 会话列表区分「待审批（可回复）」与「审批已过期（未执行）」；`requires_action` 徽标按最新审批状态降级；过期项折叠 | `client/src/utils/sessionStatus.ts`、通知中心/收件箱组件 |
| 3. 可清理 | 过期项支持「批量清理已过期」；不做批量批准 | 通知中心；沿用 `session_inbox_map` 的过期清理（`InboxManager.ts:1415`） |

**TTL 可配置**：新增配置键（例如 `permission.approvalTtlMs`），默认保持 30 分钟（零行为变更）；
是否上调由数据决定，**不自动批准**。历史 94% 过期率说明"5 分钟全局 TTL"过短，
但 30 分钟是否合适需以新数据复评，不在本次拍脑袋调整。

**接口口径**：不要继续扩展已废弃的 `/v1/inbox`（E15）；新逻辑走通知中心 `/v1/notifications/*`
与 `InboxManager` 服务层。

**验收**：

1. 构造一张审批卡 → 等 TTL（测试可注入短 TTL）→ 卡片 `expired` 后，
   会话侧栏**不再显示「待审批」**，改为「审批已过期（未执行）」；
2. 过期卡不可回复（后端已拒绝），前端不提供批准按钮；
3. 批量清理后计数归零；
4. PDCA 场景仍走既有 `abortPdcaAfterExpiry`，不重复收口。

**风险**：会话状态收口必须幂等，避免与用户正在处理的新审批互相覆盖；
以 `sessionId + inboxId` 为判据，只降级"最后一次待审批已过期"的会话。

---

### P1-3 全局信任级别：在信任与隔离页只读展示

**根因**：`defaultTrustLevel` 只被提示条读取（`GlobalTrustNoticeBar.tsx:45-65`）；
`TrustedWorkspacesPanel` 已加载并保留该字段（`:36-59`），但未渲染。

**改法**：新增只读行：
- 有值：`全局信任级别（启动参数 --trust-level）：chat`
- 无值：`未启用（仅工作区级信任生效）`
- 注明「修改需重启并带 `--confirm-global-trust`；本页不可改，避免第二事实源」。

**验收**：真机 `chat` 显示一致；未设置不渲染噪音。**不做**可编辑项。

---

### P2-1 todo 未收尾：契约 + 诚实提示（不自动补状态）

**根因**：`TodoWriteTool.description` 仅一句（`TodoWriteTool.ts:427-428`），无收尾硬约束；
实测只写 2 次 todo，最后一次停在第 5 项 `in_progress`。

**改法**：

1. **工具契约**：描述里加「给出最终答复前，必须把已完成项置 `completed`、未做项说明原因；禁止留下 `in_progress`」。
2. **前端提示**：最后一条消息已完成但仍有未完成项 ⇒ 显示「进度未收尾」+ 一键「标记完成 / 清理」（用户确认）。
3. **可选强制（默认不做）**：`StopHook` 是 `void` 签名（E16），**无法阻断收尾**；
   若必须强制，只能在 `TAORLoop` 收尾点加**一次性** finalize guard（注入一条系统提醒并允许再跑一轮，
   带计数器防循环）。该改动跨包，单独立项，不与本项混提。

**验收**：复跑 6 步任务，最终进度 6/6；若仍漏收尾，界面显式提示，不再静默停在 4/6。
**明确不做**：后端自动把 `in_progress → completed`（伪造状态，违反 CS02/CS04）。

---

### P2-2 i18n 细节

1. `AppearancePanel.tsx:62-71`：`changeLanguage` 后同步 `document.documentElement.lang`；
   并在应用启动时设置一次（可放 `App.tsx` 的主题 effect 旁，`:126-131`）。
2. `SettingsPage.tsx:651`：「简单模式 / 高级设置」改 i18n key，中英文各补一条。
3. 新增一个客户端测试：切换 `en` 后断言 `documentElement.lang === "en-US"`，切回 `zh-CN` 恢复。

**验收**：切英文后 `html lang` 正确、设置页无该处中文残留。**回滚**：两处小改，独立提交。

---

### P2-3 Windows 沙箱（对齐既有 spec）

不在本次修复范围。**不新立方案**：已有 `.trae/specs/windows-sandbox.md`；
本项只做两件事：
1. 在信任与隔离页保留现有「已停用且原因可见」的披露；
2. 把本方案登记为 `windows-sandbox.md` 的上游依赖（状态收敛不依赖沙箱，可先做）。

---

## 4. 已定决策（v2 采纳）

| ID | 决策 | 结论 |
|---|---|---|
| D1 | 解释器免审批语义 | **精确匹配**（换参数再问）；共享常量下沉 infra |
| D2 | 审批 TTL | **已有 TTL 保留**，新增可配置键、默认不变；**优先修状态收敛**，不靠调 TTL 掩盖问题 |
| D3 | Windows 无沙箱是否启动告警 | **不告警**（页面已披露）；对齐 `windows-sandbox.md` |
| D4 | todo 收尾 | **契约 + 前端提示 + 一次性收尾提醒**（2026-11-21 按用户指令落地）；**仍不自动补状态** |
| D5 | 审批接口 | 新逻辑走通知中心 `/v1/notifications/*`，不扩废弃的 `/v1/inbox` |
| D6 | 过期卡处理 | **只降级状态 + 可清理**，不自动批准、不自动重放 |

---

## 5. 实施顺序与验证

| 步骤 | 内容 | 依赖 | 验证 |
|---|---|---|---|
| C1 | P1-1 共享解释器常量下沉 + 精确匹配 + 单测 | 无 | `bun test app/tests/permission/`；真机复现 E5 |
| C2 | P2-2 html lang + i18n key + 客户端测试 | 无 | `client` typecheck；浏览器切语言 |
| C3 | P1-3 只读展示全局信任级别 | 无 | 真机 `chat` 显示一致 |
| C4 | P2-1 契约 + 前端提示 | 无 | 复跑长任务检查进度事件 |
| C5 | P1-2 过期状态收敛 + 可配置 TTL + 批量清理 | C1 不影响；建议在 C4 后 | 注入短 TTL 的真机走查 |

每步独立提交，提交信息写明"放宽/删除依据"与回滚点；合并前跑：
`bun run lint:arch`、`bun run lint:infra`、`app`/`client` 的 `typecheck`、相关单测。

**C5 额外守卫**：

- 新增 `app/tests/runtime/approvalExpiryConvergence.test.ts`：过期 → 会话状态收口、幂等、PDCA 不重复收口；
- 前端 `sessionStatus` 单测：`expired` 不显示「待审批」徽标；
- 真机：`APPROVAL_TTL_MS` 注入 10s（测试环境）→ 侧栏状态从「待审批」变「已过期」。

---

## 6. 明确不做

1. 不新增第二套审批机制（复用 `PermissionChecker` / Inbox / 通知中心）。
2. 不改变 `trustLevel` 的生效逻辑与危险命令硬拦截。
3. 不自动批准任何审批；过期一律「未执行」，不自动重放。
4. 不自动把 todo 标成 completed。
5. 不用调大/调小 TTL 代替状态收敛。
6. 不把强制 todo 收尾塞进 StopHook（签名不支持阻断）。

---

## 7. 交叉影响（与另外两份方案）

| 方案 | 交叉点 | 约束 |
|---|---|---|
| `tool-governance-merge-plan.md`（v3） | 工具包/profile 会改变默认工具面；审批频次随包启用变化 | P1-2 的状态收敛应先于 `desktop`/`browser` 等 EXTERNAL 包开放 |
| `browser-use-and-computer-use-completion.md` | 两工具均为 EXTERNAL，每次调用需审批 | 同左；并复用 P1-2 的过期降级，不另造队列 |
| `windows-sandbox.md` | 平台隔离能力 | P2-3 只读对齐，不重复立项 |

---

## 8. 实施记录（2026-11-21）

### 8.0 优先修复：只读 PowerShell 包裹仍弹审批

**根因**：`BashSecurityAnalyzer` 的「单条 PowerShell 包裹已由 PowerShell 安全链判定」快路径只在
`isShellOperator` 分支内；`powershell -Command "(Get-Item 'x').Length"` 不含 shell 操作符 ⇒
落「未知命令 ⇒ ask」（真机 `session_mwpj4amge75a67ec4f` seq 3241）。

**修复**：`packages/infra/src/security/BashSecurityAnalyzer.ts:632-640` 把
`options.delegatedSinglePowerShell` 判定提到失败原因之前；未委托时行为不变（仍 ask）。
回归测试：`app/tests/security/psWrapperDelegation.test.ts`（新增 2 例，12/12 pass）。

### 8.1 已完成

| 项 | 内容 | 文件 |
|---|---|---|
| P1-1 | 解释器/壳 ⇒ 精确匹配；常量下沉 infra（service 不得反向 import app）；补 `cmd/sh/bash/zsh/fish`；首 token 归一（路径/`.exe`/大小写） | `packages/infra/src/permission/commandPatterns.ts`（新）、`inboxApproval.ts`、`bashCommandPolicy.ts`（re-export） |
| P1-1 测试 | 前缀 vs 精确、完整路径 `powershell.exe`、`cmd/sh/bash/python/node`、规则命中/不命中 | `app/tests/permission/commandPatterns.test.ts`（新） |
| P2-2 | `html[lang]` 跟随语言；「简单模式/高级设置」i18n | `client/src/i18n/index.ts`、`AppearancePanel.tsx`、`SettingsPage.tsx`、zh/en `settings.ts` |
| P1-3 | 信任与隔离页只读展示全局信任级别（启动参数） | `TrustedWorkspacesPanel.tsx`、zh/en `settings.ts` |
| P2-1（契约） | `todo_write` 描述 + 两语言提示词加收尾硬约束 | `TodoWriteTool.ts`、`app/prompts/*/tool-descriptions.json` |
| P1-2（后端） | 过期回调收口普通聊天会话：仍有 pending 则不收口；记 denied；发 `session:approval_expired` 生命周期事件（→ idle）+ SSE 广播；前端刷新会话列表 | `inboxApproval.ts`（`convergeSessionAfterApprovalExpiry`）、`SessionLifecycleEvent.ts`、`SessionStateBridge.ts`、`main.ts`、`useInitApp.ts` |
| P1-2（持久化） | 列表读的是持久化 `UnifiedSession.status`（生命周期事件只改内存态）⇒ 过期时同步把 `requires_action` 收回 `active` | `inboxApproval.ts`、`api/coreApiProvider.ts`（端口加 `status`/`listSessions`） |
| P1-2（批量对账） | 启动期一次对账：状态 `requires_action` 且**无 pending 卡** ⇒ 收回 `active`（覆盖收敛上线前就过期的历史遗留） | `inboxApproval.ts#reconcileStuckApprovalSessions`、`main.ts` |
| 续接闸门（D6） | goal 重启续接：仍有 pending 卡 ⇒ 跳过；上次卡**已过期且未决策**（过期时刻晚于目标推进）⇒ 跳过，不自动重放 | `goalStartupResume.ts`、`InboxManager.ts`（`INBOX_STATUS_EXPIRED`） |
| 恢复闸门 | 检查点仍有待审批 ⇒ Durable Resume 跳过（`phase='skipped'`） | `app/src/chat/manager/bootstrap.ts`、`ResumeManager.ts` |
| P1-2（TTL） | 工具审批 TTL 可配 `permission.approvalTtlMs`（默认 30min 不变；按 tick 读取，改配置无需重启） | `InboxManager.ts`（`APPROVAL_TTL_CONFIG_KEY` / `normalizeApprovalTtlMs` / `startExpireScheduler`） |
| P1-2（批量清理） | 通知中心「清理已过期」：服务端探测 `status=expired` → `PATCH /v1/notifications/batch` 批量归档；只归档过期项，不批量批准 | `notificationService.ts`、`endpoints.ts`、`notificationStore.ts`、`NotificationPanel.tsx`、zh/en `workspace.ts` |
| P1-2（列表语义） | 默认列表排除 `dismissed`（显式 `status=dismissed` 才返回）—— 修复归档项重开面板「回流」 | `NotificationPersistence.ts#list` |
| P2-1（前端） | 回合结束仍有未完成 todo ⇒ 浮动栏显式「进度未收尾：还有 N 项未完成」+ 一键「让助手收尾」（发一条收尾指令，不自动改状态） | `StatusFloatBar.tsx`、`usePdcaStartEntry.ts`（判据导出）、zh/en `base.ts` |
| P2-1（强制 guard） | 终稿后仍留未完成 todo ⇒ 注入**一次**收尾提醒（`todoFinalize` 上限 1、随 run 重置；只提醒不伪造 `completed`） | `agentIncompleteTurn.ts`、`ReActToolLoop.ts`、`app/tests/chat/agentIncompleteTurn.test.ts`（+3 例） |
| C5 测试 | 过期收敛（状态收回 / 幂等 / PDCA 与工作区申请不收口 / 启动对账 / TTL 解析） | `app/tests/runtime/approvalExpiryConvergence.test.ts`（新，8 例） |

**验证**：`app` 与 `client` 的 `typecheck` 均 0 错；相关 6 个测试文件 65/65 pass；
本轮新增修复后 `app` 与 `client` typecheck 复跑 0 错，审批/过期/通知相关测试 27/27 pass，
chat 收尾 guard 与终止相关 29/29 pass；
`lint:state-ratchet`（Register-or-Fail）与 `lint:infra`（R1–R28）均通过。

### 8.2 未完成（下一步）

1. ~~`paused` / `error` 残留（已定性，非缺陷）~~ **已于 2026-11-21 后续会话收口**（见 §8.4）：
   根因不是"真实状态"，而是 `CrashRecoveryManager` 把「持久化 `active` + 有活动」当成"崩溃时仍在跑"
   （`active` 在本仓语义是"可继续对话"，正常收尾不改写）⇒ 每次**硬杀重启**都把用过的会话批量转
   `paused` / `error`。修法**不伪造状态**：以事件日志为准，只有「最后一个 turn 仍未闭合」才参与崩溃恢复；
   带崩溃标记但轮次已闭合的历史记录，按同一收尾原因口径收回（`completed ⇒ active`、
   `awaiting_approval ⇒ requires_action`）。印证：61 会话从 **52 paused + 4 error** →
   **59 active / 2 paused / 0 error**，残留 2 个的最后一个 turn 均为 `synthetic=true`（真中断）。
2. ~~存量 52 paused 的清理~~：由上一条的对账自动完成，无需逐条「恢复」或批量入口（剩 2 个为真中断，保留）。
3. guard 真机已触发验证（含防重复）：日志 `todo_finalize_retry {"unfinished":2}`；第二轮仅 23 字
   「收尾状态：清单 A已标记 completed；」，**不再重复首轮正文**（指令已明确禁止）。
4. 长任务复跑：已完成（6/6，见 §8.3）。

**仍待产品决策（非工程阻塞）**
- 会话列表是否要一个显式的「审批已过期（未执行）」徽标（当前收敛为 `active` ⇒ 不出徽标，不误导但也无提示）；
- 是否为「已过期」项提供会话级批量入口（通知中心已支持批量归档）。

### 8.3 真机复验记录（2026-11-21 06:48–07:46）

| 步骤 | 结果 |
|---|---|
| 06:48 重启（含 analyzer + Durable Resume 守卫） | 无新增审批卡；`goal 启动续接跳过：会话仍有待审批` ×2 |
| 06:55 重启（含持久化收敛） | 06:57:46 过期 4 张卡；两会话 `requires_action → active`（日志 + API 双证） |
| 07:00 重启（含启动对账） | `启动对账：…已收回 active {"converged":7}`；`requires_action=0` |
| 07:01 目标续接执行 ×2（旧目标） | 模型重放同一批命令 ⇒ 新增 2 张卡（暴露 D6 违背） |
| 07:04 重启（含「过期未决策不重放」闸门） | 对账 `converged=2`；两目标均 `上次审批已过期且未决策（不自动重放）` |
| 07:05 终态 | `pending=0`、`requires_action=0`；前端 56 会话扫描无「待审批」徽标 |
| 07:18 重启（含 TTL 配置键） | `pending=0`、`requires_action=0`；无「审批过期清理失败」 |
| 07:19 前端复验（长任务会话） | 浮动栏：`已完成 4/6 | 进度未收尾：还有 2 项未完成 | ✓ 让助手收尾` |
| 07:21 首次「清理已过期」 | **FAIL**：按钮需翻页后才出现（计数只看当前页）；归档项重开面板「回流」 |
| 07:24 修复 | 服务端探测 + 列表默认排除 `dismissed`；typecheck / 单测绿 |
| 07:26 复验 | **PASS**：首屏即见「清理已过期」；点击后 3 条归档；关闭重开不回流、按钮不再出现 |
| 07:31 优雅关闭复验 | `POST /v1/system/shutdown` → 202、端口正常关闭；重启后 `paused` 仍 52（**未新增**；存量已由 §8.4 的轮次对账收口） |
| 07:34 6 步任务复跑 | 38s 完成；任务卡 6/6 全 `completed`；无「进度未收尾」（模型自收尾，guard 未触发） |
| 07:37 强制触发 guard | `todo_finalize_retry {"unfinished":2}`（23:37:24Z）；同一助手消息内追加第二轮（"进度：清单 3 项已建立…"）；任务卡仍 1/3，前端如实显示「进度未收尾」 |
| 07:45 复验（指令强化） | `todo_finalize_retry {"unfinished":2}`（23:45:48Z）；第二轮仅 23 字「收尾状态：清单 A已标记 completed；」，**无重复正文** |

---

### 8.4 后续会话收口（2026-11-21 08:00–09:00）

| 项 | 内容 | 文件 |
|---|---|---|
| 陈旧崩溃徽标 | 崩溃恢复新增「在飞轮次」探针（只有最后一个 turn 未闭合才参与）；历史 `recovered_paused` / `failed_stale` 且轮次已闭合 ⇒ 按收尾原因收回 | `packages/service/src/session/recovery/CrashRecoveryManager.ts`、`packages/service/src/session/SessionGateway.ts`、`app/src/chat/manager/sessionStatusReconcile.ts`（新）、`app/src/chat/ChatManager.ts`、`app/src/chat/manager/recovery.ts` |
| 测试 | 探针 6 例 + 对账 14 例（含合成 closer / 无 turn 事件 / 仍在飞 / 可续原因保持） | `app/tests/session/crashRecoveryTurnProbe.test.ts`、`app/tests/chat/sessionStatusReconcile.test.ts` |
| 副作用修复 | 一次性收尾提醒会让同一工具轮次重入 ⇒ 周期检查点被写两次；改为 `lastPeriodicCheckpointTurn` 去重（`todoExpansionPersistence` 转绿） | `app/src/chat/agentPreReasoning.ts` |
| 复查（本方案守卫） | `commandPatterns` + `approvalExpiryConvergence` + `psWrapperDelegation` + `agentIncompleteTurn` = **47/47 pass**；前端会话徽标 `session-list-display` = **9/9 pass** | — |

**交叉约束核对（§7）**：EXTERNAL 工具（`desktop` / `browser`）的开放发生在 P1-2 状态收敛落地**之后**，
且两工具默认关闭、每次调用仍走 `EXTERNAL` 审批 ⇒ 符合"先完成状态收敛再开放"的约束。
详见 [`browser-use-and-computer-use-completion.md`](./browser-use-and-computer-use-completion.md) §11。

---

## 9. 证据文件索引

| 用途 | 路径 |
|---|---|
| 会话事件全量 | `C:\Users\csdnc\.pyapp\data\sessions\57971aa3\session_mwpit6sk32d12fe50b\events.jsonl` |
| 审批复验会话（只读 PS 被二次否决） | `C:\Users\csdnc\.pyapp\data\sessions\57971aa3\session_mwpj4amge75a67ec4f\events.jsonl`（seq 3241/3243） |
| 审批规则落盘 | `C:\Users\csdnc\.pyapp\data\permissions\tool_rules.json`（测试后已还原为 `[]`） |
| 长任务产物 | `output/real-machine-longtask.md` |
| TTL 与过期实现 | `packages/service/src/runtime/InboxManager.ts:120-145,249-279,1319-1378` |
| 过期旁路监听 | `app/src/main.ts:1757-1771`、`packages/service/src/runtime/inboxApproval.ts:886-1004` |
| 会话状态映射 | `client/src/utils/sessionStatus.ts:26-55`、`client/src/types/session.ts:51` |
| 停止钩子签名 | `packages/query/src/query/StopHooks.ts:31-50` |
| 解释器常量 | `app/src/tools/bash/bashCommandPolicy.ts:194-237` |
| 废弃 inbox 端点 | `app/src/infrastructure/http/handlers/inbox-handlers.ts:1-10` |
| 未收录命令流水线（已有，勿重复建设） | `.trae/docs/permission-whitelist-review.md` |
| Windows 沙箱既有 spec | `.trae/specs/windows-sandbox.md` |

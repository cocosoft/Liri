# 团队工具名 snake_case 收敛（D-04）— Spec

- **来源**：`dev_docs/20261001/pending-tasks-consolidated-20261001.md` **D-04**（原始出处 `liri-upgrade-plan` §5 尾 L202 / 台账 D-36-②）
- **状态**：🟡 **改名已实施（2026-10-03）· codegen 纳入待裁定（见 §4）**
- **一句话**：把 D-37 遗漏的 2 个 PascalCase 工具名收敛为 snake_case（与 D-37 同口径）。

---

## 1. 取证（2026-10-03）

| 事实 | 坐标 |
|---|---|
| 原 D-36-② 列 **4 个**「不在生成物内」的 PascalCase 类 | 台账 D-36-② |
| 其中 `EnterPlanModeTool` / `ExitPlanModeTool` **已不存在**（全 `app/src` 0 命中）⇒ 已被后续清理消化 | Grep |
| 仅剩 2 个：`TeamCreateTool`（`name = 'TeamCreate'`）· `TeamDeleteTool`（`name = 'TeamDelete'`） | `tools/TeamCreateTool/TeamCreateTool.ts:83`、`tools/TeamDeleteTool/TeamDeleteTool.ts:57`（改前） |
| 二者**已注册**（非"孤立类"）：经 `createToolLoader(ToolFactory.prototype.createTeamCreateTool/createTeamDeleteTool)` | `tools/utils/ToolManagerUtils.ts:161-162` |
| 且有 UI：`require('./toolUIs/TeamCreateTool/UI')` / `TeamDeleteTool/UI` | `components/ui/ToolUIRegistry.ts:240/247` |
| **为何不在生成物**：二者**flag 门控**（`isToolEnabled('ENABLE_TEAM_CREATE')` / `'ENABLE_TEAM_DELETE'`，`core/featureFlags.ts:382-383`）⇒ 门控关闭时工厂**返回 `null`**，而 codegen 口径 = 「**全量 ∧ 可实例化**」（`gen-tool-names.ts` 明文记载，见台账 D-40/D-41）⇒ **不进 `TOOL_NAMES`** | `tools/ToolFactory.ts:605-616`、`:622-631`、`scripts/gen-tool-names.ts:36-50` |
| 名字引用面：全仓**仅**这 2 处 `name =`（`'TeamCreate'`/`'TeamDelete'` 字面量 0 处其他引用）⇒ 改名无连锁消费方 | Grep |

---

## 2. 改名（✅ 已实施）

| 文件 | 改前 | 改后 |
|---|---|---|
| `tools/TeamCreateTool/TeamCreateTool.ts` | `name = 'TeamCreate'` | `name = 'team_create'` |
| `tools/TeamDeleteTool/TeamDeleteTool.ts` | `name = 'TeamDelete'` | `name = 'team_delete'` |

**验证**：app `typecheck` **0** · `bun test tests/tools` **582 pass / 0 fail** · `bun run lint` **0 error（56 预存 warning）**。

---

## 3. 不在范围

- ❌ 不改 `ToolUIRegistry`（其按键是**文件路径**，非工具名）。
- ❌ 不改类名 / 目录名（`TeamCreateTool` 类名与目录维持，只改**模型可见工具名**）。
- ❌ 不改 flag 语义或默认值（见 §4）。

---

## 4. ⏳ 待裁定：codegen 纳入（本 spec 未做）

**阻塞（硬事实）**：codegen 事实源 `getAllBuiltinToolLoaders()` **已含**这两个 loader，但生成口径 = 「全量 ∧ **可实例化**」⇒ 两个 flag 门控关闭时工厂返回 `null` ⇒ **名字拿不到**（该边界由 `gen-tool-names.ts:36-50` 显式告警，台账 D-40/D-41 记录在案）。

**两条可选路径（需用户裁定）**：

| 路径 | 内容 | 代价 |
|---|---|---|
| **甲：默认开启 flag** | 令 `TEAM_CREATE` / `TEAM_DELETE` 默认启用 ⇒ 二者可实例化 ⇒ 进入 `TOOL_NAMES` | **行为变更**：团队工具默认**对模型可见**（当前默认不可见） |
| **乙：改生成口径为静态名字注册表** | 名字不再依赖"实例化成功"（加载器携带名字元数据或独立静态清单） | 属 **D-40/D-41** 议题（口径变更），改动面较大，但**不引入行为变更** |

> 未裁定前：**改名已生效**（若工具被 flag 启用，其名字即 snake_case）；`TOOL_NAMES` 仍不含这两个名字（与其"默认不可用"现状一致）。

---

## 5. 合规对照

| 规则 | 检查点 | 状态 |
|---|---|---|
| D-37 同口径 | 只改**已注册**工具的名字、去 PascalCase；不改类名/目录 | ✅ |
| CS01 | 未新建名单；沿用既有 flag / codegen / UI 注册面 | ✅ |
| CS02 | 名字为标识符字面量，非字符串匹配判状态 | ✅ |
| `project_rules §1.3` | 无 Mock、无 `any` 新增 | ✅ |

# 团队工具名 snake_case 收敛（D-04）— Spec

- **来源**：`dev_docs/20261001/pending-tasks-consolidated-20261001.md` **D-04**（原始出处 `liri-upgrade-plan` §5 尾 L202 / 台账 D-36-②）
- **状态**：✅ **已完成（2026-10-03 结案）** —— 改名已实施；`codegen 纳入` **经裁定为「不需要」**（理由见 §4）
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

## 4. ✅ 裁定：codegen 纳入【不需要】（2026-10-03）

**裁定理由（两条决定性证据）**：

1. **`TOOL_NAMES` 的语义本就排除"默认不可用"的名字** —— `gen-tool-names.ts:36-50` 明文定义口径 = 「全量 ∧ **可实例化**」，并明确该边界是有意设计：*"此类名字**不能**用于 `as const satisfies readonly ToolName[]`（会被判'不存在'）"*。即 `TOOL_NAMES` 是**"运行期可用名"的类型守卫**，不是"源码里存在的名字清单" ⇒ 默认关闭的工具**不该**进入。
2. **真正缺陷（PascalCase）已修完** —— 改名后只要 flag 启用，名字即 snake_case；且这两个名字**全仓无消费方**（唯一引用就是那 2 处 `name =`）⇒ "进枚举"无实际收益。

**两条原候选路径的处置（均不采纳，附理由）**：

| 路径 | 判定 | 理由 |
|---|---|---|
| 甲：默认开启 flag | ❌ 不采纳（**非本议题**） | 属**产品决策**（默认给模型多 2 个"团队"工具；其余 flag-gated 工具均默认关）⇒ 若将来决定默认启用，二者**自动**进入枚举，无需为此改 codegen |
| 乙：改生成口径为静态名字注册表 | ❌ 不采纳（**属 D-40/D-41**） | 会改写 `TOOL_NAMES` 既有契约，且波及**全部** flag-gated 工具 ⇒ 独立大改，不挂在 D-04 名下 |

**结论**：D-04 以「改名」为闭环点；`codegen 纳入` 明确不需要。

> 阻塞事实（flag 门控 ⇒ 生成口径 = 「全量 ∧ 可实例化」 ⇒ 名字拿不到）见 **§1 取证表**最后两行；该口径的既有契约与边界登记在 `gen-tool-names.ts:36-50` / 台账 D-40·D-41。

---

## 5. 合规对照

| 规则 | 检查点 | 状态 |
|---|---|---|
| D-37 同口径 | 只改**已注册**工具的名字、去 PascalCase；不改类名/目录 | ✅ |
| CS01 | 未新建名单；沿用既有 flag / codegen / UI 注册面 | ✅ |
| CS02 | 名字为标识符字面量，非字符串匹配判状态 | ✅ |
| `project_rules §1.3` | 无 Mock、无 `any` 新增 | ✅ |

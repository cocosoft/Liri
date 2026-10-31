# Spec：SQLite 驱动抽象评估（SQLite Driver Abstraction）

> 版本 1.0 ｜ 创建 2026-10-31 ｜ 状态：🟡 **评估结论：暂不引入驱动中性抽象；先收口直连面**
> 来源：`dev_docs/20261031/deepseek建议.md` §4「评估 `bun:sqlite` 的抽象」（长期架构考量）
> 关联：`scripts/modules-to-layers.json`（`external` = infra）· `.trae/specs/infra-layer-boundary-contract.md` §3 判据 · project_rules §1.5 数据库统一约定
> 口径（CS06）：以下数字均 **2026-10-31 实测**（Grep `bun:sqlite` / `@modules/external`）。

---

## 1. 现状取证

| 事实 | 数值 | 取证方式 |
|---|---|---|
| 走 infra 包装（`@modules/external`）的文件 | **56** | `Grep "from '@modules/external'" app/src` |
| 直连 `bun:sqlite` 的文件 / 处 | **8 / 18** | `Grep "bun:sqlite" app/src` |
| 其中包装本体（合法直连） | **2 文件 / 8 处** | `external/sqlite3.ts`（6）· `external/index.ts`（2） |
| 其余直连（**漂移**） | **6 文件 / 10 处** | `bootstrap/preflight.ts`（3）· `evals/sandbox.ts`（2）· `tools/VideoGenerateTool/VideoTaskPersistence.ts`（2）· `tasks/PdcaWorkItemBridge.ts`（1）· `pyapp.ts`（1）· `tools/VideoGenerateTool/MediaTemplates.ts`（1） |

**包装形态**（`app/src/external/sqlite3.ts` 头注）：用 Bun 内建 `bun:sqlite` 暴露 **sqlite3 回调式 API**，
目的是避免原生 C++ 插件（`.node`）在 `bun build --compile` 单文件 exe 中加载失败；
导出面为 `BunDatabase`（type）与 `openBunDatabase()`。

**结论一**：本仓**已经有** infra 层抽象（`external` 模块 + 唯一出口 `@modules/external`），
缺的不是"抽象"，而是"不该直连的地方直连了"。

## 2. 为什么暂不引入驱动中性抽象（D1）

| # | 理由 | 说明 |
|---|---|---|
| R1 | **无真实需求** | 发布形态是 `bun build --compile` 单文件；没有第二运行时（Node/Deno）的发布要求，也没有第二 SQLite 实现的需求 |
| R2 | **同步语义不可无损抽象** | `bun:sqlite` 同步；`better-sqlite3` 同步但 API 不同；`node:sqlite` 尚不稳定；Deno 侧多为异步 ⇒ 一层接口要同时表达同步/异步，热点路径的调用形态与错误语义都会变形 |
| R3 | **性能与调试成本** | DB 调用是热点；多一层转发会模糊栈、影响慢查询归因（`sqlite3.ts` 现有 `measure()` 已在做这件事，再叠一层反而更难定位） |
| R4 | **抽象面不可控** | 56 个消费方已在用包装；真正需要"可替换"的最小面只有 5 个动作：`exec` / `prepare` / `transaction` / `batch` / `close`。在这 5 个之外做泛化属投机（CS03） |
| R5 | **与既有判据一致** | Q5 判据「DB 驱动永不进 core」已满足：驱动适配在 `infra/external`，core 无 I/O |

## 3. 触发条件（何时**才**做驱动抽象）

| 触发 | 判据 |
|---|---|
| **T1** | 出现**非 Bun 运行时**的真实发布需求（如 Node/Deno 单文件分发），且无法用 Bun 编译满足 |
| **T2** | 需要**第二种真实数据库**（PG/Redis 等）。注意：那是**新增适配器**，不是替换 SQLite 驱动 |
| **T3** | 压测证明包装层开销 ≤ 2%，且上述 5 个动作已收敛为统一调用面 |

未命中任一条件 ⇒ 本 spec 保持 🟡，**不实施**。

## 4. 近期动作（本 spec 不实施，按序独立变更）

| # | 动作 | 为什么 |
|---|---|---|
| A1 | 把 6 个文件的 `bun:sqlite` 直连改走 `@modules/external` | 直连绕过慢查询插桩与路径/目录创建约束（`preflight.ts` 甚至出现在 `pyapp.ts` 启动链上） |
| A2 | 加门禁：新增 `bun:sqlite` 直连即红，白名单 = 2 个包装文件（A1 完成后清零） | 与 `lint:infra` 同形的"可缩小白名单"，防止直连面回涨 |
| A3 | 若未来做抽象，**只**抽象 §2-R4 的 5 个动作 | 避免把 SQL 方言、事务语义、迁移器一并抽象成"框架" |

## 5. 明确不做（Negative list）

- ❌ 不引入 ORM / Query Builder（现有 SQL 直写 + 仓储类已足够，迁移成本远大于收益）。
- ❌ 不把 SQLite 驱动下沉 core（违反 core 零 I/O 判据，见 `packages/kernel/src/core/README.md`）。
- ❌ 不做"运行时自动探测驱动"（Bun 是硬依赖，探测只增加不确定性）。

## 6. 验收（本 spec 自身）

1. §1 的每个数字都能用文中的 Grep 复现。
2. 结论与 `infra-layer-boundary-contract.md §3` 判据不冲突（驱动适配留 infra、core 零 I/O）。
3. 本批**零代码改动**：只新增本文档。

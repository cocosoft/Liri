# 消息排序键改「首事件 seq」（H1 遗留专项设计）

> 状态：**已实施（B1 + B2 同批）**，待真机复验验收项 #5（2026-11-18）
> 来源：真机会话 `c2c_9FF0D4BE58D7363BD09464E699C1154A`（QQ 通道会话 Web 页问答顺序翻转）
> 关联：已落地的止血修复 `31ed0c866`（`execution/*` 不参与聚合排序）

---

## 1. 已发生的问题与当前止血

通道会话里，`execution/*`（`prepared` / `ownership_decision` / `status_changed`）**带的是入站用户消息 id**，
却落盘在**回合结束之后** ⇒ 派生器把它们计入该消息的 `maxChunkSeq`，用户消息的排序键被抬到其助手回复之后
（实测 14 > 9、32 > 26 …，8 轮全翻转）。

止血（已提交 `31ed0c866`）：聚合前 `if (ev.type.startsWith('execution/')) continue;`。

**为什么不是终态**：这只挡住了**已知的一类**事件。任何"回合结束后才落盘、且带 `messageId`"的事件
（审批回填、外部渠道回执、后续新增的审计事件）都会**再次**造成同一现象，且没有任何机制能发现。

---

## 2. 目标与不变式

- **排序语义**：消息按「**首事件 seq**」升序 —— 与 `getSessionMessages` 注释（"消息按首事件 seq 升序"）一致。
- **游标语义**：分页游标与排序键**同源**（同一字段、同一量纲），否则 `lastEventSeq <= before` 的过滤会与排序不一致（历史上 N-57 已因此丢过条）。
- **不变**：事件落盘顺序、`messages.jsonl` 结构、事件类型清单、删除墓碑（`deletedMessageRanges` 按 seq 区间）、
  投影版本覆盖判据（`proj.lastEventSeq >= agg.maxChunkSeq`）**均不改**。

---

## 3. 现状耦合（三处必须一起看）

| # | 位置 | 现在用的键 | 用途 |
|---|---|---|---|
| K1 | `EventMessageDeriver` 聚合 | `agg.maxChunkSeq` | 排序 + 返回 `lastEventSeq` |
| K2 | `EventMessageDeriver` 排序 | `lastEventSeq`（= K1） | ④ 排序（`result.sort`） |
| K3 | `sessionMessagesRead._paginateMessages` | `lastEventSeq ?? timestamp` | `before` 过滤 + 切片 |
| K4 | 前端 `sessionSlice` / `loadOlderMessages` | `messages[0].lastEventSeq` | 下一页游标 |
| K5 | 删除墓碑 / 投影覆盖 | `lastEventSeq` | 区间过滤 / 版本比较（**不能改**） |

⇒ K1–K4 需一起切到「首事件 seq」，K5 保持 `lastEventSeq`。**两套键必须显式区分**，否则会重演"混比两种量纲"。

---

## 4. 方案对比

| 方案 | 做法 | 评价 |
|---|---|---|
| **A（现状）** | 跳过 `execution/*` + 将来按需再加黑名单 | 零改动，但**脆弱**：每新增一类"回合后事件"就复发一次，且无检测 |
| **B（选）** | 派生消息新增 `firstEventSeq`，排序与游标改用它；`lastEventSeq` 只承担版本/墓碑 | 从语义上根治；改动面：1 个派生器 + 1 个分页函数 + 前端 1 处游标 |
| C | 保持排序不变，把 `lastEventSeq` 改成 `min(first,last)` | 破坏投影覆盖比较与墓碑区间 ⇒ **否决** |

---

## 5. 方案 B 的实施

### B1 服务端（可独立提交、可回滚）

1. `DerivedMessage` 增 `firstEventSeq?: number`（事件聚合消息 = `agg.firstSeq`；纯投影兜底消息 = 缺省）。
2. 排序（`EventMessageDeriver` ④）：
   ```ts
   const key = (m) => m.firstEventSeq ?? m.lastEventSeq ?? m.timestamp ?? 0;
   ```
   同键时保持现有 `timestamp → id` 稳定兜底。
3. `_paginateMessages`：`withPaginationSeq` 与 `before` 过滤统一按 `firstEventSeq ?? lastEventSeq ?? timestamp`；
   返回给前端的对象**同时**带 `firstEventSeq`（新游标）与 `lastEventSeq`（兼容/观测）。
4. `execution/*` 的跳过**保留**（双保险：即便将来忘了加新键，也不会因生命周期事件乱序）。

### B2 前端

1. `sessionSlice` 的分页游标：`messages[0].firstEventSeq ?? messages[0].lastEventSeq`。
2. 去重/排序不改（前端只按服务端顺序渲染）。

无正式用户（`project_rules.md §1.3`）⇒ **不做兼容期双读**，直接切。

### B3 实施结果（2026-11-18）

| 层 | 落地 |
|---|---|
| 派生器 | `DerivedMessage.firstEventSeq = agg.firstSeq`（两处 push）；④ 排序 key = `firstEventSeq ?? lastEventSeq ?? timestamp` |
| 分页 | `withPaginationSeq` 泛型加 `firstEventSeq?`，基准 `firstEventSeq ?? lastEventSeq`，回填**双键同写**；`_paginateMessages` 的 `key` 同源 |
| 前端 | `Message.firstEventSeq`；`sessionSlice` 三处游标、`loadOlderMessages`、`chat-message-set-messages` 排序主键均改为 `firstEventSeq ?? lastEventSeq` |
| 读路径补漏（`dd23d1ace`） | `_deriveSessionMessagesFromEvents` 的响应映射原先只复制 `lastEventSeq` ⇒ 前端拿不到首键、游标退回末键。已补 `firstEventSeq` 并在 `DerivedSessionMessages` / `getSessionMessages` 返回类型中如实声明两键 |

验证：派生器/分页新增 3 例（`execution/*` 不参与排序、首末键相反以首键为准、回填双键同写）；
`bun test tests/session tests/runtime tests/http` 1218 pass / 0 fail；`tsc`（app 三 project）+ client `tsc` 0 错；
`vitest run src/stores/chat` 24 files passed；`lint:fn-size` / `lint:arch` / `lint:consts` 未增长。

补漏后复验（2026-11-19）：全量 `bun test` **13189 pass / 42 skip / 0 fail**（1576 文件）；
`tests/runtime + tests/session + tests/http` **1220 pass / 0 fail**（含新增 `sessionMessagesSeqPassthrough` 2 例：
返回体首/末两键如实、`before=12` 仍含首键 9 的消息）；client `vitest run src/stores/chat` **24 files / 218 pass**。

---

## 6. 验收（可证伪）

| # | 断言 | 手段 |
|---|---|---|
| 1 | 用户消息恒在其回复之前（含 `execution/*`、`assistant/status` 等回合后事件） | 单测：构造 seq 交错的 4 类事件，断言 `[u,a]` 顺序 |
| 2 | 长会话分页不丢条、不重复 | 复用 `loadOlderMessages` / `withPaginationSeq` 既有用例，扩到"首/末键不同"的消息 |
| 3 | 纯投影兜底消息（无事件）仍按 `timestamp` 参与排序 | 单测：无 `firstEventSeq` 时回退 |
| 4 | 墓碑过滤与投影覆盖**行为不变** | 现有 `deletedRanges` / `pickMoreCompleteContent` 用例全绿 |
| 5 | 真机 H1 会话顺序正确、翻页正常 | 手测：`c2c_9FF0…` 打开 + 连续加载更早 |

**真机结果（2026-11-21，PASS）**：在 `localhost:1420` 打开 `c2c_9FF0D4BE58D7363BD09464E699C1154A`
（标题「确认在线并询问需求」，8 轮）——初次渲染 10 条（第 4–8 轮），点击「↑ 加载更早消息」后
完整遍历去重 **16 条 = 8 轮 × 2**，角色序列 `UAUAUAUAUAUAUAUA`，首条 `在?`(22:31) → 末条 `好。…`(22:36)，
顺序正确；同一 `data-msg-id` 未重复出现、点击前可见消息无丢失、控制台 0 错误。
**数据前提限制（如实）**：该会话只有 8 轮，`limit=30&maxVisible=10` 单页已取全量 ⇒ 「连续加载 5 次」
只可能点到 1 次（点后控件消失属"无更多历史"，非故障）；要验证多页翻页需一条 ≥40 条消息的会话。

**回归面**：`tests/session`（派生器/分页/墓碑）+ `client` 分页用例；`tsc` 三 project；`lint:fn-size` 不增长
（`EventMessageDeriver` 已接近长文件上限，改动用"只替换 key 表达式"的方式，不新增函数）。

---

## 7. 风险与回滚

| 风险 | 处置 |
|---|---|
| 游标口径切换导致"翻页重复/丢条" | 服务端游标与排序**同源**（同一表达式）；前端只读 `firstEventSeq ?? lastEventSeq`；用例 #2 覆盖 |
| 忘记改 K5（墓碑/覆盖）而误用 firstEventSeq | 类型上分开命名；代码注释标注「lastEventSeq = 版本/墓碑专用，禁止用于排序」 |
| 长文件超限 | 只改 key 表达式与字段，不新增函数；若需新增，先拆 `EventMessageDeriver` 的排序段 |

回滚：B1 单提交 revert（前端仍读 `lastEventSeq`，行为回到今天的状态）；B2 单独 revert。

---

## 8. 不做的事

- 不改事件写入顺序、不做数据迁移（派生是读时计算）。
- 不为"排序键"新增第二套派生器（CS01）。
- 不把 `execution/*` 从事件日志中删除（它仍是执行审计的唯一来源）。

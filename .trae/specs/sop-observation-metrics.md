# Spec：SOP 观察期度量（`/sop observe`）

- **状态**：✅ 已实施（2026-11-15；2026-11-18 补 `command-registry` 的 `argumentHint` 遗漏项 `observe`）
- **来源**：`.trae/specs/learning-feedback-loop.md` §3-S4「`sop`：以批准后 SKILL.md 是否被真实调用 ≥N 次且未伴随低分作为观察期判据」
- **前置**：`sop-distill-draft.md`（批准链已落地：`/sop approve` 写入 `~/.pyapp/skills/sop-<id>/SKILL.md`）

---

## 1. 数据源取证（决定了本 spec 的做法）

| 候选来源 | 实测结论 | 是否可用 |
|---|---|---|
| `skillUsageTracker`（`~/.pyapp/data/skills-usage.json`） | 只有**聚合**字段 `viewCount` / `useCount` / `firstUsedAt` / `lastUsedAt`，**无逐次时间、无会话/轮次关联** | ❌ 无法按观察窗切片 |
| DB `skill_usage` 表 | `track()` 只由注册表 `registered` / `unregistered` 触发，**不是调用记录** | ❌ 语义不符 |
| 会话事件 `assistant/tool_call` | 含 `name` 与解析后的 `args`；技能族工具名为 `skill`（`op=run/view/list`，`args.name` 为技能名） | ✅ 可逐次重建 |
| 会话事件 `turn/quality` | 含 `turnNumber` / `score`，**不含工具/技能名** | ✅ 与上一行按轮次 join |

⇒ 本 spec **不新增埋点、不改事件契约**：只用既有事件的**只读聚合**。

## 2. 目标 / 非目标

**目标**
- **G1** 一条命令回答：`sop-<id>` 在观察窗内被**真实执行**几次、其中几轮**伴随低分**。
- **G2** 判定三态：`supported`（够量且无低分）/ `insufficient`（次数不足）/ `flagged`（伴随低分）。
- **G3** 只用结构化字段（`op` / `args.name` / `turnNumber` / `score`），不做文案匹配（CS02）。
- **G4 只读**：不写台账、不改技能、不跑模型。

**非目标**
- **N1** 不把结果写进 `SopDraftStore`（避免为派生指标扩台账）；"可查"= 命令可见。
- **N2** 不改 `skills-usage.json` 与 DB `skill_usage` 语义。
- **N3** 不新增定时器/后台任务（观察期由人工执行命令触发）。
- **N4** 不引入 skill 专用事件类型（会动事件三处登记）。

## 3. 口径

| 项 | 定义 |
|---|---|
| 观察窗 | 默认 **7 天**（`SOP_OBSERVATION_WINDOW_DAYS`），`/sop observe <id> [天数]` 可覆盖；按事件 `time` 过滤 |
| 一次「使用」 | `assistant/tool_call` 中 `name === 'skill'`、`op` 缺省或 `'run'`、`args.name === sop-<id>`；`op=view/list` **不算** |
| 伴随低分 | 该轮存在 `turn/quality` 且 `score < 低分阈值`（单源：`@modules/evals` 的 `SUSPICIOUS_SCORE_THRESHOLD`） |
| 缺分数 | 有调用但该轮无 `turn/quality` ⇒ 计入 `unscoredTurns`，**不猜通过/低分** |
| 判定顺序 | 有低分轮 ⇒ `flagged`（即使次数不足）；否则次数 `< N` ⇒ `insufficient`；否则 `supported` |
| N | 默认 **5 次**（`SOP_OBSERVATION_MIN_USES`） |

## 4. 设计

```
会话事件（最近 N 个会话，只读）
  └─ collectSopSkillObservations(sessionId, events, {skillName, since})   // 纯函数：逐轮 uses/score
        └─ summarizeSopObservations(skillName, turns, scoreCutoff)        // 纯函数：合并 uses / 低分轮 / 缺分数轮
              └─ judgeSopObservation(observation, minUses)               // 纯函数：三态 + 原因
                    └─ /sop observe <id> [天数]                           // 命令：注入 deps，格式化输出
```

- 落点：`app/src/tasks/evolution/sopObservation.ts`（与 `sopDistill` 同域，app 层）。
- 命令：`app/src/commands/builtin/sop/Sop.ts` 新增 `observe`；deps 增 `listSessionIds` / `readEvents` / `readScoreCutoff`（与 `/learn scan` 同款注入，便于测试）。
- 草图解析复用 `resolveDraft`（改为 `{ draft | null, error? }` 判别，顺手去掉该文件里两处裸 `'error'` 字面量）。

## 5. 验收

| 项 | 判据 |
|---|---|
| 只算 run | `op=view` / `op=list` 不计入 uses；`op` 缺省按 run |
| 窗口过滤 | 早于 `since` 的事件不计 |
| 低分 join | 同轮 `score < 阈值` ⇒ `flagged`；`score >= 阈值` ⇒ 不算低分 |
| 缺分数 | 有调用无质量事件 ⇒ 进 `unscoredTurns`，不伪造通过 |
| 三态 | 次数不足 ⇒ `insufficient`；低分优先 ⇒ `flagged`；充足且无低分 ⇒ `supported` |
| 只读 | 命令不写任何文件；未批准草案 ⇒ 明确拒绝观测 |

## 6. 风险

| 风险 | 缓解 |
|---|---|
| 会话已被裁剪 ⇒ uses 偏低 | 输出里打印「扫描会话数 / 观察窗」，让"不足"可解释 |
| 同名手工技能与 SOP 技能混淆 | 只匹配 `sop-<id>`（批准产物名由 `sopSkillName` 决定） |
| 低分阈值口径漂移 | 复用 `SUSPICIOUS_SCORE_THRESHOLD`（单源），不复制数值 |

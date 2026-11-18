# 未收录命令 → 白名单评审流水线

> R5（2026-11-17）。上游数据：`unknown-commands.jsonl`（R4 结构化采样）；
> 周报 CLI：`scripts/report-unknown-commands.ts`；设置页数据：
> `GET /v1/permissions/rules` 的 `unknownCommandSuggestions`。
>
> **边界**：本流水线只做「观测 → 人工评审 → 改代码/规则 → 发版」，
> **不做运行时自动学习**（不会因为某条命令被批准多次就自动放行）。

## 1. 数据从哪来

`auto` 档对**未收录命令** fail-closed（转 `ask`）时，会往本地追加一行采样：

```
<pyapp-home>/data/permission/unknown-commands.jsonl
```

字段（R4）：`head / at / surface / surfaceLength / headSeq / shell / os /
permissionMode / autonomy / decision / segmentIndex / blockedBy`。

- `surface` **落盘前已去敏**（秘密形态、`--password=`、URL 内嵌凭据、长 hex/base64 截断）；
- 同一 `head` **每次出现都落一行**（`headSeq` 递增），全进程上限 50 行；
- 轮转：单文件 ≥ 5 MB 或跨月 ⇒ `unknown-commands.<YYYY-MM>[-<epoch>].jsonl`。

## 2. 周报（每日 / 每周）

```bash
# 最近 7 天，前 20 名；不同命令名 > 20 ⇒ 退出码 2（任务变红）
bun run scripts/report-unknown-commands.ts --since 7 --top 20 --fail-over 20

# 机器可读（供看板 / 归档）
bun run scripts/report-unknown-commands.ts --since 7 --top 50 --json
```

退出码：`0` 正常（含无样本）、`1` 参数错误、`2` 超过 `--fail-over` 阈值。
阈值口径 = 窗口内**不同命令名数量**（要补的是"命令种类"，不是出现次数）。

**调度方式**（三选一，按部署形态）：

| 形态 | 做法 | 说明 |
|---|---|---|
| 本机（桌面 / 开发） | Windows 计划任务 / `cron` 每天 09:00 跑上面的命令 | 采样是本机数据，必须有本机文件 |
| DAEMON 常驻 | 复用启动提示（见 §5）+ 人工按周跑周报 | 不额外起调度器 |
| CI | **仅在能提供采样文件时**跑（如上传产物） | 干净 CI 无采样数据 ⇒ 脚本会如实报「无样本」，**不得**当作通过 |

## 3. 评审流水线（四步，缺一不可）

1. **取 top-N**：周报按 `count` 降序；优先看 `count` 高、`blockedBy=classifier` 的命令。
2. **安全评审**（人工，逐条回答）：
   - 是否**结构只读**（不写、不起子进程、不触网）？→ 可进只读白名单；
   - 参数是否有副作用（`--force` / `-o` / 输出重定向 / 配置写入）？→ 需参数级收敛；
   - 是否可执行任意代码（解释器 / `-e` / `--exec` / 包管理器安装）？→ **维持 ask/deny**。
3. **同批评测**：为每个新增白名单命令补**正/负向**用例（允许形态 + 该拒的形态），
   落在 `app/tests/permission/` 相关语料/门禁用例中，随 CI 跑。
4. **发版**：只改代码内唯一事实源（`AUTO_MODE_READONLY_COMMANDS` / `commandSpecs.ts`），
   单独提交并写明依据（周报窗口、样本量、评审结论）。

## 4. 用户自助出口（不改代码的那条路）

设置 → 权限管理 → 工具权限规则，可建三类 allow（`POST /v1/permissions/rules`）：

- **命令前缀级**：`contentPattern`（如 `^git status`）—— 最常用；
- **工具级**：不放行具体命令，只按工具名（谨慎，等于信任整个工具）；
- **审批卡生成**：「始终允许」（参数指纹）/「本工作区永久信任」（精确命令 + 工作区根）
  —— 只读、只能撤销；出事时可用 `POST /v1/permissions/approvals/pause` 一键暂停。

护栏：危险命令头（`rm -rf` / `git push` / `npm install` …）**禁止建 allow**；
allow 规则有预算（`permission.userRuleAllowBudget`，默认 50）；
保存前会跑**影响预演**（基准命令写前/写后对比），若把基准从 `ask`/`allow` 变 `deny`
⇒ 写接口 409 `code=impact`，需显式 `confirmImpact=true` 再写（防把自己/agent 锁死）。

### 4.1 结构形态（`for` / `if` / `$env:`）能不能「记住」？（B2，2026-11-17）

**先看代码事实**（决定答案的不是文案，而是匹配语义）：

| 维度 | 事实 | 落点 |
|---|---|---|
| 为什么保持 ask | 循环体 / 分支体 / 变量展开无法静态确认，分类器不放开结构判定 | `BashSecurityAnalyzer` / auto 分类器 |
| `contentPattern` 语义 | **正则**，对 bash 的**命令原文**（`input.command`）做 `test`，另以 `JSON.stringify(input)` 兜底 | `types/PermissionRule.ts#isRuleMatch` |
| 「始终允许」指纹 | bash **未声明** `approvalFingerprint` ⇒ 全参数稳定 JSON，**不参数化**（换参数即换指纹，不命中） | `approvalFingerprint.ts` |

**结论（对用户的可交付口径）**

1. **可以**用正则规则整体放行该形态（如 `^for\b`），但一条规则覆盖**任意循环体/分支体**
   ⇒ 等于放弃这层保护；因此不提供「结构形态一键记住」入口，界面上只给如实说明。
2. 「始终允许」（指纹档）对它**无效**：bash 的指纹是全参数 JSON，换一行参数就重新询问。
3. 可交付的收敛路径（按推荐度）：
   - **拆成单条命令**：读/找/搜用 `file_read` / `glob` / `grep`（提示层已收敛）；判断存在性用单条 `Test-Path`；
   - **固化精确命令**：审批卡「本工作区永久信任」= 精确命令 + 工作区根（归一化比较），出事可逐条撤销；
   - **确需循环**再自建 `contentPattern` 正则 allow，并接受「整类放行」的代价。
4. 复核手段：规则行展示 `hitCount / lastHitAt`，可据此判断这类整体放行是否被过度使用。

## 5. 启动提示与设置页

- REPL 启动：`ui.showWarning('本周 N 个未收录命令导致 M 次审批（最多：xxx）；可在「设置 → 权限管理」添加 allow 规则')`
 （非阻塞，失败/无样本静默）；
- DAEMON：同一文案记 `warn` 日志（无 UI）；
- 桌面设置页：`GET /v1/permissions/rules` → `unknownCommandSuggestions`
  `{sinceDays, headCount, sampleCount, topHeads[]}`，无样本 ⇒ `null`（不显示 0 值噪音）。

## 6. 规则命中计数与「90 天未命中」

`/v1/permissions/rules` 每条规则带 `hitCount / lastHitAt`（决策链真实判定计数，
`simulate` 不计数）；`GET /v1/permissions/rules/health` 的 `ruleHits` 给出
`{staleDays: 90, countingSince, observationDays, observationComplete, staleRules[]}`。

- 判定：`now - (lastHitAt ?? createdAt) ≥ 90 天` ⇒ 建议清理；
- **观察期闸**：开始计数不足 90 天 ⇒ `observationComplete: false` 且 `staleRules: []`
  —— 不把"还没开始计数"误报成"规则没用"；
- 数据：`<pyapp-home>/data/permission/rule_hits.json`（节流写盘，崩溃最多丢 5s）。

## 7. 尚未覆盖（如实记录）

- `approvedBy`（批准者）仍为 `null`：审批记录没有身份字段（本地审批无 actor）。
- 规则的**命中计数**为观测数据：崩溃最多丢最后 5s，且不跨机器聚合。

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
allow 规则有预算（`permission.userRuleAllowBudget`，默认 50）。

## 5. 启动提示与设置页

- REPL 启动：`ui.showWarning('本周 N 个未收录命令导致 M 次审批（最多：xxx）；可在「设置 → 权限管理」添加 allow 规则')`
 （非阻塞，失败/无样本静默）；
- DAEMON：同一文案记 `warn` 日志（无 UI）；
- 桌面设置页：`GET /v1/permissions/rules` → `unknownCommandSuggestions`
  `{sinceDays, headCount, sampleCount, topHeads[]}`，无样本 ⇒ `null`（不显示 0 值噪音）。

## 6. 尚未覆盖（如实记录）

- **按规则 id 的命中计数**（`hitCount`）与「90 天未命中提示」尚未实现：
  需要独立的规则命中计数器（当前 `PermissionMetricsStore` 只按工具/原因聚合），
  不能用本流水线的采样计数冒充。

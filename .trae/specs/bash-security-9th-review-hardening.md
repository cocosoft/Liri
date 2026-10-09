# Spec：第九轮审查「专项 A」安全加固（Bash/审批/AST）

> 版本 1.0 ｜ 创建 2026-10-09 ｜ 状态：🟢 **已实施 + 已验证**
> 来源：`dev_docs/20261009/openai 建议.md` §十（5 条确定缺陷）· §八（专项 A 整改任务单）
> 关联规则：GR15 / CS01 / CS02 / CS03 / CS05 / CS06 / R06-008
> 口径：下列 `file:line` 为本轮实测；**未做**项显式标注。

---

## 1. 逐项取证与修复

### 缺陷 #1 —— `lazyInitNative` 哨兵判断失效（原生解析器**从未加载**）

- **取证**：`security/bash/BashAST.ts` 原为 `let nativeParseBash: … | null = null;` 却判
  `if (nativeParseBash === undefined)` ⇒ 条件**恒假** ⇒ 永远走 TS 降级（原生 Rust bash 解析器成死码）。
- **修复**：哨兵改 `undefined` 初始（三态：`undefined`=未尝试 / `null`=不可用 / 函数=可用）；
  新增 `getBashAstStats()`（`nativeLoaded` / `nativeLoadFailed` / `nativeCallCount` / `tsFallbackCount`）
  与 `resetBashAstForTest()`（审查要求"调用次数与加载失败测试"）。
- **关联修正（重要）**：原生 bash 解析器是**受限子集**（`&&`/`|`/`;`/控制结构一律 `too_complex`）⇒
  原 `if (result.error) return {kind:'too-complex'}` 会**短路**，使命令失去 TS 侧的分链检测。
  现改为**不短路**：原生 inconclusive ⇒ 继续 TS 降级（断言：`&&` 链中危险命令仍被识别）。

### 缺陷 #2 —— TS 降级解析器 `||` 分割缺口（**真实绕过**）

- **取证**：`splitCommands` 原条件 `(ch === '|' && input[i+1] !== '|') || ch === ';' || ch === '&'`
  ⇒ `||` **不作为分隔符** ⇒ `echo safe || rm -rf /` 被当成**单条命令**（`argv[0]='safe'`）
  ⇒ `isDangerousCommand(argv)` 只读 `argv[0]` ⇒ **`rm -rf /` 被放过**。
- **修复**：`|`/`||`/`&`/`&&`/`;` 一律分隔，双字符运算符消费第二字符；并补**转义**判定（`\<op>` 不分隔）。

### 缺陷 #3 —— 审批命令规范化把**语义不同**命令映射到同一授权标识

- **取证**：`permission/ApprovedCommandRegistry.ts#normalizeCommand` 原 `.replace(/\s+/g,' ')`
  + `.toLowerCase()` ⇒ ① 引号内空白被折叠（`echo "a  b"` ≡ `echo "a b"`，参数语义不同却同 hash）；
  ② 转小写（POSIX 下 `RM` ≠ `rm`）⇒ **批准其一即放行另一**。
- **修复**：改为**引号感知**状态机 —— 仅压缩**引号外**空白、运算符贴边、**保留大小写**。
  两端一致（提交审批 / 执行查询同用 `hashCommandForExecution`）。

### 缺陷 #4 —— AST 不确定时**不失败关闭**

- **取证**：`tools/bash/BashTool.ts` 原仅在 `astResult.kind === 'simple'` 时判危险；
  `too-complex` / `parse-unavailable` **既不阻断也不要求审批** ⇒ 解析盲区即放行。
- **修复**：`simple` ⇒ 继续后续检查（危险命令照旧拦截）；**`too-complex`/`parse-unavailable`
  ⇒ 转人工审批**（`requireApproval` + `metadata.reason='ast_inconclusive'`）——不静默放行，也不直接 deny（保留可用性）。

### 缺陷 #5 —— 子进程 env 合并顺序：调用方 env 可**覆盖**已剥离项

- **取证**：`BashTool.ts` 原 `{ ...stripSensitiveEnv(process.env), ...(env || {}) }`
  ⇒ 调用方（模型可控）env 在剥离**之后**合并，可覆盖 `PATH`/`NODE_OPTIONS` 等，甚至重注入 `*_API_KEY`。
- **修复**：单一事实源 `security/sensitiveEnv.ts` 新增 `sanitizeCallerEnv()`（对调用方 env 施加
  **同一套敏感键策略** + 额外剥离**执行控制键**：`PATH`/`NODE_OPTIONS`/`NODE_PATH`/`PYTHONPATH`/
  `PYTHONHOME`/`PYTHONSTARTUP`/`BASH_ENV`/`ENV`/`PROMPT_COMMAND`/`LD_PRELOAD`/`LD_LIBRARY_PATH`/
  `DYLD_INSERT_LIBRARIES`/`DYLD_LIBRARY_PATH`）；被剥离键 `logger.warn` **留痕**（CS03-002 不静默）。

---

## 2. 落点（实测）

| # | 文件 | 改动 |
|:-:|---|---|
| 1/2 | `app/src/security/bash/BashAST.ts` | 哨兵修正 + 统计 + 去短路 + `||` 分割 + 转义判定 |
| 3 | `app/src/permission/ApprovedCommandRegistry.ts` | `normalizeCommand` 重写（引号感知 / 保大小写） |
| 4 | `app/src/tools/bash/BashTool.ts` | AST inconclusive ⇒ `requireApproval` |
| 5 | `app/src/tools/bash/BashTool.ts` + `app/src/security/sensitiveEnv.ts` + `security/index.ts` | 调用方 env 清理（单一事实源）+ 接线 + 留痕 |
| 测试 | `app/tests/security/bashAstHardening.test.ts`（**新，9 例**）· `app/tests/permission/ApprovedCommandRegistry.test.ts`（**2 处断言按新语义修正**） | — |

## 3. 验收（实测）

| 项 | 结果 |
|---|---|
| `bun test tests/security tests/permission tests/tools/BashToolApproval.test.ts` | ✅ **135 pass / 1 skip / 0 fail** |
| `bun run typecheck`（3 tsconfig） | ✅ **0** |
| `bun run lint:arch` | ✅ 错误 **0** / 警告 4（基线） |
| `bun run lint:doc-code` | ✅ 一致 |
| **绕过样本**（#2） | ✅ `echo safe \|\| rm -rf /` ⇒ 2 条命令，`isDangerousCommand` 命中 |
| **碰撞样本**（#3） | ✅ `hashCommand('RM -RF /TMP/ABC') ≠ hashCommand('rm -rf /tmp/abc')`；`echo "a  b" ≠ echo "a b"` |
| **env 覆盖样本**（#5） | ✅ `sanitizeCallerEnv({PATH,NODE_OPTIONS,MY_SECRET,FOO})` ⇒ 保留 `{FOO}`，stripped 3 键 |

## 4. 非目标 / 未做（如实）

| 项 | 说明 |
|---|---|
| §七「3 个 Bash 开关默认关」 | ✅ **A2 已翻转为安全基线**（2026-10-09 用户裁定，见 `default-off-switches-review-gates.md §2.2`）；**A4/A5 维持默认关**（灰度 + 启用/回退条件/迁移期限 + `warnGraySecuritySwitchesOnce()` 一次性告警）。§七 的"自动断言"由 `lint:doc-code` 的 `SAFETY_SWITCHES` 承接（A2 仍保 `def:true` 断言，防静默翻回）。**单测**：`app/tests/tools/bashSecuritySwitchDefaults.test.ts`（**8 例**）—— 告警经「**构造 BashTool + 日志断言**」验证（**不扩大导出面**：只导出 `resetGraySwitchWarningForTest`，`warnGraySecuritySwitchesOnce` 保持模块私有） |
| 缺陷 #3 的**跨平台大小写** | 修复后 Windows 下 `DIR`/`dir` 不再复用同一授权（**保守收紧**：多弹一次审批）；如需 Windows 大小写折叠，应**仅对可执行名**折叠（另立项） |
| 影响面 | 本次改的是 `analyzable` 判据与审批键；**未**改 `DANGEROUS_COMMANDS` 等规则表 |
| 端到端 | 未跑真实"沙箱内攻击"验证（与审查原文口径一致） |
| #4 交互提示 | `requireApproval` 仅作用于**非已批准**命令的安全拦截层（已批准默认路径不受影响） |

## 5. 合规检查清单

| 规则 | 结论 |
|---|---|
| GR15 | ✅ 本 spec 为实施记录（含行为变更：#3/#4/#5） |
| CS01 | ✅ 复用 `sensitiveEnv.ts` 单一事实源（不新建第二份剥离表）；`normalizeCommand` 收敛于既有函数 |
| CS02 | ✅ 三态哨兵 / `kind` 判别用结构化状态，非字符串猜测 |
| CS03 | ✅ 丢失项**留痕不静默**；#4 选"审批"而非"直接 deny"（保留可用性）；不为不可达场景加分支 |
| CS06 | ✅ §1 逐条 `file:line`；#1 的原生"受限子集"事实由 `native/src/bash_ast.rs` 支撑 |
| R06-008 | ✅ 改动均在既有层内，无新增跨层边 |

## 6. 回滚

- 逐个缺陷独立可回退（改动集中 4 个源文件 + 2 个测试文件）；无数据/DB 变更。
- #3 会使**在途**（≤5min TTL、内存态）的已批准项失效 ⇒ 重新弹一次审批即可，无持久影响。

# 技能系统

## 概述

技能（Skill）是预定义的**提示词指令模板**，通过注入 LLM 上下文来指导 Agent 完成特定任务。技能**不是可执行代码**——技能内容仅作为提示词注入，不执行系统命令。

## 技能三来源（物理目录隔离）

| 来源 | 定义位置 | 加载方式 |
|------|---------|---------|
| **内置** | `BundledSkillLoader` 内联数组（10 个，程序化定义，非 SKILL.md 文件） | 启动时 `initBuiltinSkills` 注册到 SkillRegistry |
| **用户** | `~/.pyapp/skills/<name>/SKILL.md`（Markdown + YAML front matter） | 启动扫描 + 写盘后 `reloadUserSkills` 热注册 |
| **第三方** | `~/.pyapp/skills/vendor/<safeId>/`（ClawHub 等市场安装） | 启动 `adapter.loadSkills()` + 安装时实时注册 |

三个来源物理隔离，互不混淆：用户目录排除 `vendor/` 子目录扫描。

## 内置技能（10 个）

| 技能 | 说明 |
|------|------|
| debug | 开启会话调试日志并帮助诊断问题 |
| loop | 按固定间隔重复执行提示词或斜杠命令（如 `/loop 5m /foo`） |
| simplify | 简化并解释复杂代码 |
| remember | 记住信息供后续引用 |
| verify | 验证代码变更并给出改进建议（LLM 指导；机械编译/测试验证由 `query/verifyProject.ts` 工具函数执行，非技能） |
| batch | 批量处理多个文件或任务 |
| stuck | 卡住时提供解决思路 |
| update-config | 用自然语言管理配置——权限、环境变量、hooks 等 |
| skillify | 把当前会话中的可复用流程沉淀为技能（别名：capture / makeskill / 创建技能） |
| skill-creator | 按技能设计方法论创建/编辑/审查 SKILL.md（剥离 Python 依赖，仅提示词注入） |

> 新增内置技能：修改 `src/skills/loaders/sources/BundledSkillLoader.ts` 数组即可，启动自动注册。

## 用户技能

在 `~/.pyapp/skills/<name>/SKILL.md` 创建 Markdown 文件（含 YAML front matter）：

```markdown
---
name: my-skill
description: 描述
platform: all
user-invocable: true
---

# 技能指令...
```

写盘后应用自动注册（无需重启）；删除文件自动移除。YAML front matter 支持条件字段（`platform` / `os` / `require_env`），由 `SkillConditionMatcher.ts` 匹配。

## 第三方技能

从 ClawHub 市场安装的技能自动存储到 `~/.pyapp/skills/vendor/<safeId>/`，与用户技能物理隔离。安装/更新/卸载通过应用内技能市场界面或 HTTP API 完成。

## 使用技能

```bash
# 查看技能列表
/skill list

# 查看技能详情
/skill info <skill_name>

# 启用/禁用技能
/skill enable <skill_name>
/skill disable <skill_name>

# 重新加载技能
/skill reload
```

## 安全模型（2026-08-06 Skill 系统加强）

技能本质是"可执行代码/指令"，以下安全边界为强制约束：

### 1. 文件操作入口统一校验（validateSkillId）

所有涉及路径操作的 HTTP handler 在拼接路径前必须通过 `validateSkillId`：
- 拦截 `..` 路径穿越、`/` `\` 分隔符、绝对路径（盘符/根）
- 拦截 Windows 保留设备名（CON/NUL/COM1…）与非法字符
- 入口覆盖：删除、克隆、文件列表、关联文件内容、启用/禁用落盘、导入

**路径归一化**：导入（zip / JSON files 分支）与远程下载的技能内相对路径逐段校验，拦截 `..` / 绝对路径 / Windows 保留名，确保文件无法逃逸技能目录（zip-slip 防护）。

### 2. 签名校验：已移除（无假防护）

`SkillGuard` 伪实现（仅内容自身 sha256 截断、无密钥、无调用点）已删除（S1-1）。
签名能力保留接口待签名源生态成熟后以真实密钥方案（Ed25519 + 公钥白名单）重新接入。

### 3. 执行链受限

- **Shell 执行永久禁用**（S1-2）：`SkillPreprocessor` 内联 `!`command`` 不再执行，
  `SkillTool` 的 shell 分支与 mock 执行器已移除。技能内容仅作为提示词注入，不执行系统命令。
- **权限确认**（S1-3）：技能含任一危险能力（`shell` / `paths` / `allowed-tools` / `hooks`）
  时必须用户确认后才可执行；无危险能力的技能免确认。
- **路径白名单边界**：目录判断基于 `relative()` 归一化 + 前缀边界，杜绝 `/home/user2`
  误匹配 `/home/user` 白名单。
- **敏感权限审批**：SKILL.md 声明 `file-write` / `command` / `host-access` 的技能导入后
  默认"未启用"，需用户显式审批（`.enabled` 标记落盘）。

### 4. 网络请求安全

- 远程技能下载 `sourceUrl` 与重定向目标必须通过 **SSRF 校验**（`checkSsrf`）：
  拦截内网/环回/链路本地/云元数据地址（含 IPv6 与 IP 变体混淆）。
- ClawHub API 重定向最多 3 跳、仅 http/https、每跳重定向目标重新 SSRF 校验。
- CORS 白名单：仅放行 `localhost` / `127.0.0.1` 任意端口（Tauri 原生请求不受影响）。

### 5. 其他加固

- **frontmatter 注入防护**（S0-4）：创建/更新技能时 `name`/`description`/`category`
  字段去除换行（防 `---` 逃逸注入）并限制长度。
- **快照缓存完整性**（S2-4）：注入快照签名含内容哈希（版本号不变但内容变化时失效），
  落盘带弱完整性 checksum，加载校验。

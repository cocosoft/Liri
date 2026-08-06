# Liri 技能系统帮助文档

本文档介绍 Liri 中技能系统的来源、内置技能清单和使用方法。

---

## 技能系统概述

技能（Skill）是预定义的提示词指令模板，指导 Agent 完成特定任务。技能内容仅作为提示词注入 LLM 上下文，**不执行系统命令**。

技能有三个来源，物理目录隔离：

| 来源 | 位置 | 说明 |
|------|------|------|
| **内置** | 程序化定义（BundledSkillLoader） | 系统预定义 10 个核心技能，不可删除 |
| **用户** | `~/.pyapp/skills/<name>/SKILL.md` | 用户手工创建的自定义技能 |
| **第三方** | `~/.pyapp/skills/vendor/<name>/` | 从 ClawHub 市场安装的技能 |

### 技能管理命令

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

---

## 内置技能详解（10 个）

### 1. debug - 调试诊断

**描述**: 开启会话调试日志并帮助诊断问题。

**使用场景**: 当需要分析调试日志或错误信息时使用。

**示例**:
```bash
/skill debug "TypeError: Cannot read property 'name' of undefined"
```

---

### 2. loop - 定时循环

**描述**: 按固定间隔重复执行提示词或斜杠命令（如 `/loop 5m /foo`）。

**使用场景**: 当需要轮询状态、定时重复执行任务时使用。

**示例**:
```bash
/skill loop "每隔5分钟检查一次服务状态"
```

---

### 3. simplify - 代码简化

**描述**: 简化并解释复杂代码。

**使用场景**: 当需要理解或简化复杂代码时使用。

**示例**:
```bash
/skill simplify "const result = items.filter(i => i.active).map(i => i.value).reduce((a, b) => a + b, 0);"
```

---

### 4. remember - 信息记忆

**描述**: 记住信息供后续引用。

**使用场景**: 当需要存储关键信息用于后续任务时使用。

**示例**:
```bash
/skill remember "用户认证模块使用 JWT，密钥存储在环境变量中"
```

---

### 5. verify - 代码验证（LLM 指导）

**描述**: 验证代码变更并给出改进建议。

**说明**: 作为内置技能时，它是指导 LLM 审查代码的提示词模板；项目级的机械验证（编译检查、测试运行）由内置工具函数执行，不属于技能范畴。

**示例**:
```bash
/skill verify "审查这段代码的正确性和改进空间"
```

---

### 6. batch - 批量处理

**描述**: 批量处理多个文件或任务。

**使用场景**: 当需要对多个相似目标执行相同操作时使用。

**示例**:
```bash
/skill batch "将 project 目录下所有 .ts 文件的 console.log 替换为 logger.info"
```

---

### 7. stuck - 卡住求助

**描述**: 卡住时提供解决思路和下一步行动建议。

**使用场景**: 当遇到问题卡住、不确定如何继续时使用。

**示例**:
```bash
/skill stuck "我的代码报错 'Cannot find module'，不知道怎么解决"
```

---

### 8. update-config - 配置管理

**描述**: 用自然语言管理配置——权限、环境变量、hooks 等。

**使用场景**: 当需要修改应用配置时使用。

**示例**:
```bash
/skill update-config "将日志级别调整为 DEBUG"
```

---

### 9. skillify - 技能沉淀

**描述**: 把当前会话中的可复用流程沉淀为可复用技能。别名：capture / makeskill / 创建技能。

**使用场景**: 当完成了一个可重复的流程、想保存为技能时使用。

**示例**:
```bash
/skill skillify "把'新建 TypeScript 项目并初始化配置'的流程保存为技能"
```

---

### 10. skill-creator - 技能设计方法论

**描述**: 创建、编辑、改进、审查或重构 SKILL.md 文件，遵循经过验证的技能设计方法论。

**使用场景**: 当需要创建新技能、或希望按专业方法论设计/重构技能结构时使用。

**说明**: 提供技能设计核心原则（简洁优先 / 自由度匹配 / 渐进披露）、技能结构（SKILL.md + references + assets）、命名规范与完整创建流程。技能在 Liri 中仅作提示词注入，不执行 shell/Python 脚本；创建的用户技能写入 `~/.pyapp/skills/<name>/SKILL.md` 自动注册。

**示例**:
```bash
/skill skill-creator "帮我设计一个每周生成项目周报的技能"
```

---

## 创建自定义技能

### 用户技能

在 `~/.pyapp/skills/<name>/SKILL.md` 创建 Markdown 文件（含 YAML front matter）：

```markdown
---
name: my-skill
description: 我的自定义技能
platform: all
user-invocable: true
---

# 技能指令...

1. 第一步...
2. 第二步...
```

写盘后应用**自动注册**（无需重启），删除文件自动移除。

### 第三方技能

从 ClawHub 市场安装的技能自动存储到 `~/.pyapp/skills/vendor/`，与用户技能物理隔离。安装/更新/卸载通过技能市场界面完成。

---

## 技能安全说明

- **技能不执行系统命令**：技能内容仅作为提示词注入，Shell 执行已永久禁用
- **敏感技能需审批**：声明 `file-write` / `command` / `host-access` 等敏感能力的技能导入后默认"未启用"，需你显式审批
- **危险能力需确认**：技能含 shell / paths / allowed-tools / hooks 任一能力时，执行前必须经你确认
- **下载安全**：远程技能下载经过 SSRF 校验，拦截内网/元数据地址访问

---

**文档版本**: v2.0  
**最后更新**: 2026-08-06  
**适用版本**: Liri v7.10+

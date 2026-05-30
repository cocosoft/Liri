# Liri 技能系统帮助文档

本文档详细介绍 Liri 中所有可用的技能及其使用方法。

---

## 技能系统概述

Liri 的技能系统允许用户通过 `/skill` 命令调用各种专业能力。技能分为两大类：

| 类别 | 说明 |
|------|------|
| **内置技能** | 系统预定义的核心技能，共16个 |
| **用户技能** | 用户自定义或通过插件添加的技能 |

### 技能管理命令

```bash
# 查看技能列表
/skill list

# 启用技能
/skill enable <skill_name>

# 禁用技能
/skill disable <skill_name>
```

---

## 内置技能详解

### 1. debug - 调试日志分析

**描述**: 分析调试日志或错误信息，提供问题诊断和解决方案。

**使用场景**: 当需要分析调试日志或错误信息时使用。

**参数**:
- `输入`: 调试日志或错误信息

**示例**:
```bash
# 使用技能
/skill debug "TypeError: Cannot read property 'name' of undefined"

# 详细日志分析
/skill debug "
Error: Connection refused
    at Object.connect (/app/server.js:15:12)
    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)
"
```

**功能特性**:
- 识别主要问题
- 提供解决方案
- 建议预防措施

---

### 2. remember - 记忆审查和整理

**描述**: 审查和整理项目记忆，提取关键信息并结构化存储。

**使用场景**: 当需要审查和整理项目记忆时使用。

**参数**:
- `输入`: 需要记忆的关键信息

**示例**:
```bash
# 记忆代码片段
/skill remember "用户认证模块使用 JWT，密钥存储在环境变量中"

# 记忆会议要点
/skill remember "
会议记录：
1. 数据库迁移计划在下周执行
2. API 接口需要增加版本控制
3. 性能优化优先级最高
"
```

**功能特性**:
- 提取关键信息点
- 分类整理
- 生成易于检索的格式

---

### 3. verify - 代码和配置验证

**描述**: 验证代码正确性或配置有效性。

**使用场景**: 当需要验证代码正确性或配置有效性时使用。

**参数**:
- `输入`: 需要验证的代码或配置

**示例**:
```bash
# 验证代码
/skill verify "
function calculateTotal(prices) {
  return prices.reduce((sum, p) => sum + p, 0);
}
"

# 验证配置
/skill verify "{
  'database': 'sqlite',
  'port': 3000,
  'debug': true
}"
```

**功能特性**:
- 检查语法正确性
- 验证逻辑合理性
- 提供改进建议

---

### 4. simplify - 代码和文档简化

**描述**: 简化复杂代码或文档，使其更易于理解和维护。

**使用场景**: 当需要简化复杂代码或文档时使用。

**参数**:
- `输入`: 需要简化的内容

**示例**:
```bash
# 简化代码
/skill simplify "
const result = items.filter(item => item.active).map(item => item.value).reduce((a, b) => a + b, 0);
"

# 简化文档
/skill simplify "在当前的实现方案中，我们需要对现有的系统架构进行全面的评估和分析，以确定最优的改进策略。"
```

**功能特性**:
- 保持核心功能
- 提高可读性
- 减少复杂度

---

### 5. skillify - 将对话转化为技能

**描述**: 将有用的对话转化为可复用的技能。

**使用场景**: 当需要将有用的对话转化为可复用技能时使用。

**参数**:
- `输入`: 对话内容或技能描述

**示例**:
```bash
# 从对话创建技能
/skill skillify "
用户问：如何创建一个 React 组件？
回答：使用 npx create-react-app，然后在 src/components 目录下创建 .tsx 文件
"

# 从描述创建技能
/skill skillify "
技能描述：帮助用户快速创建 TypeScript 项目
步骤：
1. 创建目录
2. 初始化 package.json
3. 安装依赖
4. 配置 tsconfig.json
"
```

**功能特性**:
- 提取核心逻辑
- 生成技能模板
- 提供使用说明

---

### 6. batch - 批量处理任务

**描述**: 设计批量处理方案，自动化执行多个相似任务。

**使用场景**: 当需要批量处理多个相似任务时使用。

**参数**:
- `输入`: 批量处理的任务描述

**示例**:
```bash
# 批量重命名文件
/skill batch "将所有 .txt 文件重命名为 .md 文件"

# 批量处理数据
/skill batch "处理目录下所有 CSV 文件，提取第一列数据并汇总"
```

**功能特性**:
- 设计批量处理流程
- 提供自动化方案
- 考虑错误处理

---

### 7. stuck - 卡住时提供建议

**描述**: 当遇到问题卡住时，提供解决建议和下一步行动方案。

**使用场景**: 当遇到问题卡住需要建议时使用。

**参数**:
- `输入`: 遇到的问题描述

**示例**:
```bash
# 解决代码问题
/skill stuck "我的代码报错 'Cannot find module'，不知道怎么解决"

# 解决设计问题
/skill stuck "我在设计 API 接口时不确定用 REST 还是 GraphQL"
```

**功能特性**:
- 分析问题原因
- 提供多种解决方案
- 建议下一步行动

---

### 8. loop - 循环执行任务

**描述**: 设计循环执行方案，设置终止条件和监控机制。

**使用场景**: 当需要循环执行某个任务时使用。

**参数**:
- `输入`: 循环执行的任务描述

**示例**:
```bash
# 定时任务
/skill loop "每隔5分钟检查一次服务状态"

# 数据处理循环
/skill loop "处理队列中的所有消息，直到队列为空"
```

**功能特性**:
- 设计循环逻辑
- 设置终止条件
- 提供监控方案

---

### 9. updateConfig - 更新配置设置

**描述**: 分析当前配置，提供更新方案并验证配置有效性。

**使用场景**: 当需要更新系统配置时使用。

**参数**:
- `输入`: 配置更新需求

**示例**:
```bash
# 更新数据库配置
/skill updateConfig "将数据库连接从 SQLite 改为 PostgreSQL"

# 更新日志配置
/skill updateConfig "增加日志级别，记录更多调试信息"
```

**功能特性**:
- 分析当前配置
- 提供更新方案
- 验证配置有效性

---

### 10. keybindings - 按键绑定帮助

**描述**: 了解或配置按键绑定，展示常用快捷键。

**使用场景**: 当需要了解或配置按键绑定时使用。

**参数**:
- `输入`: 按键绑定需求（可选）

**示例**:
```bash
# 获取所有按键绑定
/skill keybindings

# 查询特定快捷键
/skill keybindings "如何退出应用？"

# 获取常用快捷键
/skill keybindings "显示常用快捷键"
```

**功能特性**:
- 解释按键绑定功能
- 提供配置建议
- 展示常用快捷键

---

### 11. loremIpsum - 示例文本生成

**描述**: 生成占位文本，用于测试或原型开发。

**使用场景**: 当需要生成占位文本时使用。

**参数**:
- `输入`: 文本长度或类型（可选）

**示例**:
```bash
# 生成默认文本
/skill loremIpsum

# 指定长度
/skill loremIpsum "生成100个单词"

# 指定类型
/skill loremIpsum "生成技术文档风格的文本"
```

**功能特性**:
- 符合要求的长度
- 保持语义连贯
- 适合占位使用

---

### 12. claudeApi - Claude API 参考

**描述**: 提供 Claude API 的使用参考和帮助。

**使用场景**: 当需要了解 Claude API 使用时使用。

**参数**:
- `输入`: API 相关问题（可选）

**示例**:
```bash
# 获取API帮助
/skill claudeApi

# 查询特定API
/skill claudeApi "如何使用 messages API？"

# 获取示例代码
/skill claudeApi "提供一个完整的API调用示例"
```

**功能特性**:
- 解释 API 功能
- 提供使用示例
- 解答具体问题

---

### 13. claudeInChrome - Chrome 集成帮助

**描述**: 提供 Claude Chrome 扩展的使用帮助。

**使用场景**: 当需要使用 Claude Chrome 扩展时使用。

**参数**:
- `输入`: 具体需求（可选）

**示例**:
```bash
# 获取帮助
/skill claudeInChrome

# 特定问题
/skill claudeInChrome "如何在 Chrome 中使用 Claude？"
```

---

### 14. scheduleRemoteAgents - 远程代理调度

**描述**: 调度和管理远程代理任务。

**使用场景**: 当需要调度远程代理执行任务时使用。

**参数**:
- `输入`: 调度需求（可选）

**示例**:
```bash
# 获取帮助
/skill scheduleRemoteAgents

# 调度任务
/skill scheduleRemoteAgents "在远程服务器上执行备份任务"
```

---

### 15. hunter - 审查工件

**描述**: 审查和分析代码工件。

**使用场景**: 当需要审查代码质量或安全性时使用。

**参数**:
- `输入`: 需要审查的内容（可选）

**示例**:
```bash
# 获取帮助
/skill hunter

# 审查代码
/skill hunter "审查这段代码的安全性问题"
```

---

### 16. dream - Kairos 梦境

**描述**: 利用 Kairos 系统进行时间感知任务。

**使用场景**: 当需要处理时间相关的任务时使用。

**参数**:
- `输入`: 具体需求（可选）

**示例**:
```bash
# 获取帮助
/skill dream

# 时间相关任务
/skill dream "分析时间序列数据"
```

---

### 17. runSkillGenerator - 技能生成器

**描述**: 自动生成新技能。

**使用场景**: 当需要创建新技能时使用。

**参数**:
- `输入`: 技能描述（可选）

**示例**:
```bash
# 获取帮助
/skill runSkillGenerator

# 生成技能
/skill runSkillGenerator "创建一个数据分析技能"
```

---

## 技能使用技巧

### 1. 组合使用技能

```bash
# 先用 debug 分析问题，再用 skillify 创建解决方案
/skill debug "遇到的错误..."
/skill skillify "解决方案..."
```

### 2. 参数传递

技能接受文本参数，您可以输入任意内容作为参数：

```bash
/skill verify "您的代码或配置内容"
/skill remember "需要记忆的文本"
```

### 3. 技能状态

技能有启用/禁用状态，可以通过 `/skill enable` 和 `/skill disable` 管理：

```bash
# 禁用不常用的技能
/skill disable loremIpsum

# 重新启用
/skill enable loremIpsum
```

---

## 技能配置

### 用户可调用技能

所有内置技能默认都是用户可调用的。您可以在技能列表中看到标记为 `user-invocable` 的技能。

### 技能上下文

技能可以在两种上下文中执行：
- **inline**: 在当前会话中执行（默认）
- **fork**: 在独立的子代理中执行

---

**文档版本**: v1.0  
**最后更新**: 2026-05-04  
**适用版本**: Liri v1.0+
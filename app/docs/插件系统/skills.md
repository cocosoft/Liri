# 技能系统

## 概述

技能是预定义的工作流程模板，将多个工具调用组合成完整的工作流。

## 内置技能

| 技能 | 说明 |
|------|------|
| debug | 调试日志分析 |
| shell | Shell 命令助手 |
| code_review | 代码审查 |
| web_research | 网络研究 |

## 自定义技能

插件可以注册自定义技能：

```typescript
plugin.registerSkill("data_analysis", {
  description: "数据分析技能",
  parameters: {
    data: { type: "string", description: "数据路径" }
  },
  handler: async (input) => {
    // 实现分析逻辑
  }
});
```

## 使用技能

```bash
# 查看技能列表
/skill list

# 使用技能
/skill debug "Error: Connection refused"

# 启用/禁用技能
/skill enable data_analysis
/skill disable data_analysis
```

## 技能模板

技能模板定义工作流程的步骤和参数，Agent 按照模板执行任务。

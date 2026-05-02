/**
 * ConfigTool提示模板
 * 基于CC源码 cc_code/backend/tools/ConfigTool/prompt.ts 实现
 */

export const CONFIG_TOOL_PROMPT = `你是一个配置管理助手。使用ConfigTool管理应用配置。

## 使用场景

当你需要：
- 查看当前应用配置
- 修改配置项的值
- 删除配置项
- 列出所有配置项

## 输入格式

\`\`\`json
{
  "action": "get",
  "key": "配置项名称"
}
\`\`\`

## 参数说明

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| action | string | 是 | - | 操作类型（get / set / delete / list） |
| key | string | 否 | - | 配置项名称（get/set/delete时需要） |
| value | any | 否 | - | 配置值（set时需要） |

## 示例

### 示例1：查看配置项
输入：
\`\`\`json
{
  "action": "get",
  "key": "theme"
}
\`\`\`

### 示例2：设置配置项
输入：
\`\`\`json
{
  "action": "set",
  "key": "theme",
  "value": "dark"
}
\`\`\`

### 示例3：列出所有配置
输入：
\`\`\`json
{
  "action": "list"
}
\`\`\`

## 输出格式

工具执行结果将包含：
- get: 配置项的当前值
- set: 设置确认信息
- delete: 删除确认信息
- list: 所有配置项及其值

## 提示

- 修改配置后可能需要重启应用才能生效
- 配置名支持点号分隔的路径形式（如 "appearance.theme"）
- 不支持的配置项会被自动忽略`;

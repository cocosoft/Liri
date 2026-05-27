/**
 * VoiceInputTool提示模板
 * 基于CC源码 cc_code/backend/tools/VoiceInputTool/prompt.ts 实现
 */

export const VOICE_INPUT_TOOL_PROMPT = `你是一个语音输入助手。使用VoiceInputTool将语音转换为文本。

## 使用场景

当你需要：
- 开始语音识别
- 停止语音识别并获取识别结果
- 检查语音识别状态

## 输入格式

\`\`\`json
{
  "action": "start",
  "language": "zh-CN"
}
\`\`\`

## 参数说明

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| action | string | 是 | - | 操作类型（start / stop / check） |
| language | string | 否 | zh-CN | 识别语言 |

## 示例

### 示例1：开始语音识别
输入：
\`\`\`json
{
  "action": "start",
  "language": "en-US"
}
\`\`\`

### 示例2：停止并获取结果
输入：
\`\`\`json
{
  "action": "stop"
}
\`\`\`

## 输出格式

工具执行结果将包含：
- start: 开始确认
- stop: 识别结果文本
- check: 当前识别状态

## 提示

- 语音识别的准确性受环境噪音影响
- 支持的语言取决于系统语音识别引擎
- 识别完成后及时调用stop获取结果`;

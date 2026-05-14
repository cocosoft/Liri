# TTS - 文本转语音工具

## 描述

将文本转换为语音音频文件。

## 输入参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `text` | string | 是 | 要转换的文本 |
| `voice` | string | 否 | 语音风格 |
| `speed` | number | 否 | 语速 (0.5-2.0) |
| `format` | string | 否 | 音频格式 |

## 使用示例

```javascript
// 基本语音合成
TTS({
  text: "欢迎使用 PY_APP",
  voice: "zh-CN-XiaoxiaoNeural"
})

// 调整语速
TTS({
  text: "Hello, World!",
  voice: "en-US-JennyNeural",
  speed: 1.2
})
```

## 支持的语音

| 语言 | 语音 |
|------|------|
| 中文 | zh-CN-Xiaoxiao, zh-CN-Yunxi |
| 英文 | en-US-Jenny, en-US-Guy |
| 日文 | ja-JP-Nanami |

## 返回值

返回生成的音频文件路径或音频数据。

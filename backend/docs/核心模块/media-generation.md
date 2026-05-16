# Media 生成 - 媒体生成模块

## 概述

媒体生成模块提供图片、视频、音乐的 AI 生成能力，通过统一工具接口访问多个 AI 提供商。

## 图片生成

```typescript
import { ImageGenerateTool } from "./tools/ImageGenerateTool/ImageGenerateTool.js";

const tool = new ImageGenerateTool();

const result = await tool.execute({
  prompt: "赛博朋克风格的城市夜景",
  size: "1024x1024",
  quality: "hd",
  style: "vivid"
});
```

### 参数说明

| 参数 | 类型 | 说明 |
|------|------|------|
| prompt | string | 图片描述（必填） |
| size | string | 尺寸: 256x256, 512x512, 1024x1024, 1024x1792, 1792x1024 |
| quality | string | standard / hd |
| style | string | vivid / natural |
| n | number | 生成数量（1-4） |
| provider | string | openai / anthropic / replicate / stability |

## 视频生成

```typescript
import { VideoGenerateTool } from "./tools/VideoGenerateTool/VideoGenerateTool.js";

const videoTool = new VideoGenerateTool();

const result = await videoTool.execute({
  prompt: "一只猫在草地上奔跑",
  duration: 10,
  resolution: "1080p",
  fps: 30
});
```

### 参数说明

| 参数 | 类型 | 说明 |
|------|------|------|
| prompt | string | 视频描述（必填） |
| duration | number | 时长（5-60 秒） |
| resolution | string | 720p / 1080p / 4k |
| fps | number | 24 / 30 / 60 |
| provider | string | openai / runway / pika / stability |

## 音乐生成

```typescript
import { MusicGenerateTool } from "./tools/MusicGenerateTool/MusicGenerateTool.js";

const musicTool = new MusicGenerateTool();

const result = await musicTool.execute({
  prompt: "轻快的钢琴曲",
  duration: 30,
  genre: "classical",
  tempo: "medium"
});
```

### 参数说明

| 参数 | 类型 | 说明 |
|------|------|------|
| prompt | string | 音乐描述（必填） |
| genre | string | classical / jazz / electronic / rock / pop / ambient |
| duration | number | 时长（15-300 秒） |
| tempo | string | slow / medium / fast |
| provider | string | openai / suno / udio |

## 语音合成 (TTS)

```typescript
import { TTSTool } from "./tools/TTSTool/TTSTool.js";

const tts = new TTSTool();

const result = await tts.execute({
  text: "欢迎使用 PY_APP",
  voice: "zh-CN-Xiaoxiao",
  speed: 1.0
});
```

## 支持的提供商

| 类型 | 提供商 |
|------|--------|
| 图片 | OpenAI DALL-E 3, Anthropic, Replicate, Stability AI |
| 视频 | OpenAI Sora, Runway, Pika, Stability AI |
| 音乐 | OpenAI, Suno AI, Udio |
| 语音 | Azure TTS, OpenAI TTS |

## 返回值

所有媒体生成工具返回生成的媒体文件 URL 及相关元数据。

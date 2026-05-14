# Media 生成 - 媒体生成模块

## 概述

媒体生成模块提供图片、视频、音乐和语音的 AI 生成能力。

## 图片生成

```typescript
import { ImageGenerationTool } from "./tools/media/ImageGenerationTool.js";

const tool = new ImageGenerationTool();

const result = await tool.execute({
  prompt: "赛博朋克风格的城市夜景",
  size: "1024x1024",
  quality: "standard"
});
```

## 视频生成

```typescript
import { VideoGenerationTool } from "./tools/media/VideoGenerationTool.js";

const videoTool = new VideoGenerationTool();

const result = await videoTool.execute({
  prompt: "一只猫在草地上奔跑",
  duration: 10,
  resolution: "1080p"
});
```

## 音乐生成

```typescript
import { MusicGenerationTool } from "./tools/media/MusicGenerationTool.js";

const musicTool = new MusicGenerationTool();

const result = await musicTool.execute({
  prompt: "轻快的钢琴曲",
  duration: 30,
  genre: "classical"
});
```

## 语音合成 (TTS)

```typescript
import { TTS } from "./tools/media/TTS.js";

const tts = new TTS();

const result = await tts.execute({
  text: "欢迎使用 PY_APP",
  voice: "zh-CN-Xiaoxiao",
  speed: 1.0
});
```

## 支持的提供商

| 类型 | 提供商 |
|------|--------|
| 图片 | OpenAI DALL-E 3, Stable Diffusion |
| 视频 | Runway, Pika Labs |
| 音乐 | Suno AI, MusicGen |
| 语音 | Azure TTS, OpenAI TTS |

## 返回值

所有媒体生成工具返回生成的媒体文件路径或 URL。

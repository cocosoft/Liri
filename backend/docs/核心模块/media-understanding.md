# Media 理解 - 媒体理解模块

## 概述

媒体理解模块提供对视音频内容的分析能力，包括图片识别、视频分析和音频转写。

## 图片理解

```typescript
import { ImageUnderstandingTool } from "./tools/media/ImageUnderstandingTool.js";

const tool = new ImageUnderstandingTool();

const result = await tool.execute({
  image: "path/to/image.jpg",
  question: "图片中有什么动物？"
});
```

## 视频理解

```typescript
import { VideoUnderstandingTool } from "./tools/media/VideoUnderstandingTool.js";

const videoTool = new VideoUnderstandingTool();

const result = await videoTool.execute({
  video: "path/to/video.mp4",
  query: "描述视频内容"
});
```

## 图片信息提取

```typescript
const result = await tool.execute({
  image: "screenshot.png",
  instruction: "提取图片中的所有文字"
});

// 返回提取的文本内容
console.log(result.text);
```

## 支持的模型

| 类型 | 模型 |
|------|------|
| 图片理解 | GPT-4 Vision, Claude 3 Vision |
| 视频理解 | GPT-4 Video, Gemini Pro Vision |
| OCR | Tesseract, Azure OCR |

## 输入格式

- 图片: PNG, JPG, JPEG, GIF, WebP, BMP
- 视频: MP4, AVI, MOV, WebM

## 使用场景

- 图片内容描述
- 图片中文字提取 (OCR)
- 视频内容摘要
- 物体识别和定位

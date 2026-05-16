# Media 理解 - 媒体理解模块

## 概述

媒体理解模块提供对图片和视频内容的分析处理能力，包括图片信息提取、格式转换、视频元数据获取等操作，通过 ImageTool 和 VideoTool 实现。

## 图片处理

```typescript
import { ImageTool } from "./tools/ImageTool/ImageTool.js";

const tool = new ImageTool();

// 获取图片信息
const info = await tool.execute({
  action: "info",
  inputPath: "path/to/image.jpg"
});

// 图片格式转换
const converted = await tool.execute({
  action: "convert",
  inputPath: "path/to/image.png",
  outputPath: "path/to/image.jpg",
  format: "jpeg",
  quality: 85
});

// 调整图片大小
const resized = await tool.execute({
  action: "resize",
  inputPath: "path/to/image.jpg",
  outputPath: "path/to/resized.jpg",
  width: 800,
  height: 600
});
```

## AI 视觉分析

PY_APP 的 AI 模型层（如 DeepSeek）原生支持图片理解能力，可在对话中直接分析图片内容：

```typescript
// AI 模型调用时自动支持图片输入
const response = await ai.complete({
  messages: [
    { role: "user", content: "这张图片里有什么？" }
  ],
  images: ["path/to/image.jpg"]  // 附带的图片
});
```

## 支持的模型

AI 视觉理解能力由 AI 提供商模型原生提供，不依赖独立的理解工具。

## 输入格式

- 图片: PNG, JPG, JPEG, GIF, WebP, BMP
- 视频元数据: MP4, AVI, MOV, WebM

## 使用场景

- 图片格式转换和尺寸调整
- 图片元数据提取
- AI 对话中的图片内容理解
- 文件类型转换（通过 converter 工具链）

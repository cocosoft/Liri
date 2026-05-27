# Video Generation - 视频生成工具

## 描述

根据文本描述生成视频内容。

## 输入参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `prompt` | string | 是 | 视频描述文本 |
| `duration` | number | 否 | 视频时长(秒) |
| `resolution` | string | 否 | 分辨率 |

## 使用示例

```javascript
// 生成视频
video_generation({
  prompt: "一只猫在草地上奔跑",
  duration: 10,
  resolution: "1080p"
})
```

## 支持的模型

- Runway Gen-2/Gen-3
- Pika Labs
- Stable Video Diffusion

## 返回值

返回生成的视频文件路径或视频数据。

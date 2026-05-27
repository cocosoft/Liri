# Image Generation - 图片生成工具

## 描述

根据文本描述生成图片，支持多种 AI 图片生成模型。

## 输入参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `prompt` | string | 是 | 图片描述文本 |
| `size` | string | 否 | 图片尺寸 (默认 1024x1024) |
| `quality` | string | 否 | 图片质量 (standard/hd) |

## 使用示例

```javascript
// 生成图片
image_generation({
  prompt: "一只可爱的橘猫坐在窗台上"
})

// 指定尺寸和风格
image_generation({
  prompt: "赛博朋克风格的城市夜景",
  size: "1792x1024",
  quality: "hd"
})
```

## 支持的模型

- DALL-E 3 (OpenAI)
- Stable Diffusion (本地部署)
- Midjourney (通过 API)

## 返回值

返回生成的图片 URL 或 Base64 编码的图片数据。

## 注意事项

- 生成时间取决于模型和图片复杂度
- 遵守内容政策，不支持生成违规内容
- 建议使用英文描述以获得更佳效果

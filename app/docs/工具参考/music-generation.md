# Music Generation - 音乐生成工具

## 描述

根据文本描述生成音乐和音频内容。

## 输入参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `prompt` | string | 是 | 音乐描述文本 |
| `duration` | number | 否 | 音频时长(秒) |
| `genre` | string | 否 | 音乐风格 |

## 使用示例

```javascript
// 生成音乐
music_generation({
  prompt: "轻快的钢琴曲",
  duration: 30,
  genre: "classical"
})

// 生成不同风格
music_generation({
  prompt: "充满活力的电子音乐",
  duration: 60,
  genre: "electronic"
})
```

## 支持的风格

- classical (古典)
- electronic (电子)
- jazz (爵士)
- pop (流行)
- ambient (氛围)

## 返回值

返回生成的音频文件路径或音频数据。

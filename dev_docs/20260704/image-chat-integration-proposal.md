# 图像模块与聊天模块集成方案

> 日期: 2026-07-04 | 状态: 提案 | 审阅: Liri 2nd review (见 logs/app.md)

---

## §1 现状分析

### 1.1 已有能力 —— 不需要重新造轮子

**后端工具已注册，AI 可通过 tool_call 调用：**

| 工具名 | 后端实现 | 能力 |
|--------|---------|------|
| `image_generate` | `ImageGenerateTool.ts` | AI 生图（DALL-E/Stability/Replicate/ComfyUI） |
| `image_analysis` | `ImageAnalysisTool.ts` | 图片分析（vision/ocr/objects/similarity/depth） |
| `image` | `ImageTool.ts` | 图片编辑（resize/crop/rotate/flip/watermark/adjust） |
| `image_svg_generate` | `ImageSvgTool.ts` | SVG 生成 |

**聊天已支持工具结果渲染：**

- `ToolCallGroup.tsx` — 检测 `IMAGE_TOOL_NAMES`，用 `ImageToolResult` 组件渲染
- `ImageToolResult` — 四态分发（waiting/failed/empty/success），按工具名路由到对应视图
- 例：用户在聊天中发送"生成一张猫的图片"，AI 自动调用 `image_generate`，结果直接显示在聊天中

**前端图像模块独立 UI 已完善：**

- `ImagePage.tsx` — 图库浏览 + 工具面板
- `ImageToolPanel.tsx` — 工具选择和参数表单
- `canvas-editor/` — 完整的 Canvas 编辑器（15种工具 + 滤镜 + Undo/Redo）
- `ImageGallery.tsx` — 图片列表

### 1.2 真正的缺口 —— 是什么导致"不够好用"

> 优先级定义：P1 = 用户无法使用 / P2 = 用户能用但体验差 / P3 = 锦上添花

经过架构分析，当前的主要问题不是"功能缺失"，而是**体验断层**：

| 问题 | 现状 | 影响 |
|------|------|------|
| **P1: 图片输入路径繁琐** | 图片分析/编辑需要的 `inputPath` 是后端文件路径，用户不会填 | 用户无法在聊天中直说"分析这张图" |
| **P1: Canvas 无后端工具** | `canvas` 工具在后端未实现，AI 无法调用画布操作 | 用户无法在聊天中说"在这张图上画个箭头" |
| **P2: 生图结果不回流图库** | AI 生成的图片没有自动进入 `ImageGallery`，用户需要手动找文件 | 用户生完图后不知道去哪儿找 |
| **P2: Chat 输入区不支持图片拖入** | 聊天输入框没有图片上传/拖入/粘贴能力 | 用户无法直接在聊天中上传图片给 AI 分析 |
| **P3: 缺乏链式操作** | 无法在聊天中说"先生成一只猫，然后把它变成黑白" | 需要多轮交互 |
| **P3: 工具对普通用户不可见** | 用户不知道 AI 能做哪些图像操作，完全依赖 AI 自主判断 | 发现性差 |

---

## §2 集成方案 —— 三阶段渐进式

### 阶段一：打通数据流（P1，体验质变）

目标：用户能在聊天中上传图片、引用图片，AI 能正确理解和操作。

#### 2.1 聊天输入区增加图片上传

**现状**：聊天输入 `ChatInput` 仅支持文本输入。图片上传在独立的 `ImagePage` 中。

**方案**：在 `ChatInput` 消息发送前增加图片附件能力（含发送前预览）：

```
用户操作:
  - 拖入图片到聊天输入区
  - 粘贴剪贴板中的图片（Ctrl+V）
  - 点击附件按钮选择图片文件

发送前预览（关键体验）:
  - 图片加入后，在输入区上方显示缩略图预览条
  - 每个缩略图右上角有「删除」按钮（x）
  - 多图时缩略图底部显示数量标签（如 +3）
  - 超过 5 张时缩略图区滚动或折叠为 "+N"
  - 用户可删除某张图后继续添加

多图上传控制:
  - 并发上传限制 maxConcurrent = 3（避免浏览器连接池耗尽）
  - 单条消息最多 20 张图片（maxImagesPerMessage = 20）
  - 单 session 每分钟最多 20 次上传（防滥用）

前端处理流程:
  1. 前端接收图片 File 对象 → 立即显示缩略图预览（本地 blob URL）
  2. 调用 imageService.upload(file) → POST /v1/images/upload → 返回 { path, url }
  3. 上传完成后缩略图从 loading 态切为就绪态
  4. 在消息 payload 中附加: { attachedImages: [{ path, url, filename }] }
  5. 发送消息时，图片信息随消息传递到后端

后端处理:
  6. ChatManager.streamMessage() 构建 apiMessages 时，将图片转为 vision 格式的 content block:
     {
       type: "image_url",
       image_url: { url: "http://localhost:xxx/v1/images/static/..." }
     }
  7. AI 收到带图片的消息后，可自主决定使用 image_analysis 或直接 vision 理解
```

**改动清单**：

| 文件 | 改动 |
|------|------|
| `client/src/components/ChatArea/ChatInput.tsx` | 新增拖入/粘贴/附件按钮，维护 `attachedImages` 状态 |
| `client/src/services/chatService.ts` | `streamMessage()` 新增 `images?: AttachedImage[]` 参数 |
| `client/src/stores/chatStore.ts` | `streamMessage()` / `sendMessage()` 传递图片信息 |
| `app/src/chat/ChatManager.ts` | `streamMessage()` 构建 `apiMessages` 时将 `attachedImages` 转为 `image_url` content block |
| `client/src/types/message.ts` | 新增 `AttachedImage` 类型 |

#### 2.2 图片引用解析 —— 让 AI 知道"这张图"是什么

**现状**：用户说"分析这张图"，AI 不知道"这张图"是哪个文件。所有 `image_analysis` 的 `inputPath` 需要填绝对路径。

**方案**：**不用自建引用标识符格式**。上传的图片已有绝对路径，直接让 AI 在上下文中即可引用：

```
上传图片 → 保存到 ~/.pyapp/uploads/{sessionId}/{timestamp}_{filename}
          → attachedImages 中携带 path（绝对路径）
          → AI 收到的消息中 attachedImages 就是现成的路径
          → AI 调用 image_analysis(inputPath: attachedImages[0].path) 即可

场景A: 用户上传图片后说"分析这张图"
  → AI 从上一条消息的 attachedImages 中直接取 path
  → image_analysis(inputPath: "/home/user/.pyapp/uploads/sess_001/cat.png", action: "full")

场景B: 用户说"分析上一轮生成的那张图"
  → AI 从历史消息的 tool_call result 中提取 generatedImages[0].filePath
  → image_analysis(inputPath: generatedImages[0].filePath, action: "full")
```

**为什么不用 `{sessionId}_{messageIndex}_attached_0` 这种自建格式**：
- `image_generate` 输出的图片已经是文件路径，格式统一
- 减少一个需要维护的标识符格式
- 基于结构化数据 `attachedImages[].path`，不依赖字符串匹配（符合 CS02）

**AI 路径参数校验层**（防御模型编造路径）：
- ChatManager 在 tool loop 中增加轻量校验：AI 调用图像工具时，检查 `inputPath` 是否在已知路径集合中
- 已知路径集合 = `attachedImages[].path` + `imageContext` 中的历史路径
- 不匹配时自动修正为最接近的已知路径（而非透传给模型），记录 warning 日志
- 避免了过度信任模型的隐式推理能力

**改动清单**：

| 文件 | 改动 |
|------|------|
| `app/src/chat/ChatManager.ts` | 构建 apiMessages 时，若消息含 `attachedImages`，在 user message 中附加文件路径信息 |
| `app/src/tools/ImageGenerateTool/ImageGenerateTool.ts` | `execute()` 返回的 result 中确保 `filePath` 字段为绝对路径 |
| 无新增文件 | 无需自建引用解析层 |

#### 2.3 Canvas 后端工具实现

**现状**：`canvas` 工具在前端 `toolRegistry.ts` 中注册了表单，但后端没有对应的 `CanvasTool` 实现。`ToolFactory.createCanvasTool()` 存在但返回 `Tool | null`。

**方案**：实现 `CanvasTool`，暴露最小化的画布操作：

```
工具名: canvas
描述: 在图片上进行画布操作（画笔、形状、文字、裁剪等）

参数:
  action: 'draw_line' | 'draw_rect' | 'draw_ellipse' | 'draw_arrow'
         | 'add_text' | 'crop' | 'resize' | 'flip' | 'grayscale'
         | 'filter' | 'undo' | 'redo' | 'clear'
  imagePath: string  (输入图片路径)
  outputPath?: string  (输出路径，默认覆盖原图)

draw_* 参数:
  x1, y1, x2, y2: number  (坐标，百分比。如 x1=50 表示图片宽度的 50% 位置)
  color?: string  (默认 "#FF0000")
  lineWidth?: number  (默认 3)

add_text 参数:
  text: string
  x, y: number  (文字起始位置，百分比坐标)
  fontSize?: number
  color?: string
  rotation?: number  (文字旋转角度，0-360，默认 0)

crop 参数:
  x, y, width, height: number  (百分比坐标)

filter 参数:
  type: 'brightness' | 'contrast' | 'grayscale' | 'blur' | 'rotate'
  value?: number  (rotate 时为角度 0-360)
```

**实现方式**：基于 Sharp（已有依赖），避免引入新依赖。

**与前端 Canvas 编辑器的协作**（AI 粗操作 → 用户精修）：
- AI 后端 `CanvasTool` 处理后，结果图片可通过「在编辑器中打开」按钮跳转到前端编辑器
- 具体按钮实现统一在 §2.8 预览增强中定义，此处只描述协作模式
- 本质上是 **AI 做批量/模板化操作 → 用户做精细调整** 的分工

**改动清单**：

| 文件 | 改动 |
|------|------|
| `app/src/tools/CanvasTool/CanvasTool.ts` | 新建，实现 `CanvasTool extends BaseTool` |
| `app/src/tools/ToolFactory.ts` | 修改 `createCanvasTool()` 返回真实实例 |
| `client/src/components/views/image/toolRegistry.ts` | 更新 `canvas` 工具的 schema 参数 |

---

### 阶段二：体验闭环（P2，用户留存）

#### 2.4 生图结果自动入图库

**现状**：AI 生成图片后保存到 `~/.pyapp/output/images/`，但前端 `ImageGallery` 通过 `GET /v1/images/list` 查询时需要手动刷新。

**方案**：生图完成后通过事件通知前端刷新图库。

```
流程:
  1. ImageGenerateTool 执行完成 → ToolManager 发布事件 "tool:completed"
  2. 事件包含: { toolName: "image_generate", result.images }
  3. 前端 EventBus 监听 → imageGalleryStore.refresh()
```

**改动清单**：

| 文件 | 改动 |
|------|------|
| `app/src/tools/ToolManager.ts` | `executeTool()` 完成后 emit `tool:completed` 事件 |
| `client/src/stores/chatStore.ts` | 监听 `tool:completed`，若为生图工具则通知图库刷新 |
| 无需新增 API | -- |

#### 2.5 Chat 中图片操作结果的上下文保持

**现状**：用户说"把刚才那张图调亮一点"，AI 不知道"刚才那张图"是哪张。

**方案**：工具结果中携带 `filePath`，在会话级别持久化 `imageContext`（跨请求存活，不受断连影响）。

```
ChatManager 维护 session 级 imageContext (key = sessionId):
  {
    lastGeneratedImage: { filePath, url, prompt },
    lastEditedImage: { filePath, url, actionPerformed },
    lastAnalyzedImage: { filePath, url, analysisSummary }
  }

存储: ChatManager 内存中 Map<sessionId, ImageContext>
      （非 DB，但跨请求存活，刷新/重连不丢失）

当 AI 第二次调用图像工具时，从 imageContext 自动补全 inputPath:

用户: "生成一只猫"
AI: [调用 image_generate(prompt="一只猫")] → result.images[0].filePath = "/.../cat_001.png"
imageContext.lastGeneratedImage = result.images[0]

--- 用户刷新浏览器 / WebSocket 重连 ---
imageContext 仍在 ChatManager 内存中，不受影响

用户: "把眼睛颜色改成蓝色"
AI: [调用 image(inputPath=".../cat_001.png", action="draw_circle", ...)]
     ↑ inputPath 从 imageContext 自动提取
```

**改动清单**：

| 文件 | 改动 |
|------|------|
| `app/src/chat/ChatManager.ts` | 在 tool loop 中维护 `imageContext`，在构建 apiMessages 时注入上下文提示 |
| `app/src/tools/ImageGenerateTool/ImageGenerateTool.ts` | `execute()` 返回的 `GeneratedImage` 中添加 `fileId` 字段（已有） |
| `app/src/tools/ImageTool/ImageTool.ts` | `inputPath` 为空时从 `imageContext` 回退 |

#### 2.6 工具描述优化（优先） + 系统提示词兜底

**现状**：AI 靠自己的理解决定是否调用图像工具，有时会忽略或错误调用。

**方案**：**优先优化各工具自身的 `description` 字段**，系统提示词仅作为兜底。

```
优先方案: 优化 BaseTool.description
  现代模型（GPT-4o、Claude Sonnet 4+）对 tool description 的理解力极强。
  把触发条件、参数说明、使用场景都写到 tool description 里：
  
  ImageGenerateTool.description:
    "Generate AI images from text descriptions (prompts). Use this when the user
     asks to create, draw, or generate an image. Supports multiple aspect ratios,
     quality levels, and output formats. Returns file paths of generated images."
     
  ImageAnalysisTool.description:
    "Analyze image content including metadata, colors, OCR text recognition,
     object detection, visual description (vision), and image similarity.
     Use when the user asks what's in an image, requests analysis, or needs
     to compare images. inputPath can be obtained from attachedImages or
     previous tool results."
     
  ImageTool.description:
    "Edit images with operations: resize, crop, rotate, flip, add watermark,
     adjust brightness/contrast/saturation, convert format, or grayscale.
     Use when the user asks to modify or transform an existing image."

兜底方案: 系统提示词补充
  如果 tool description 优化后 AI 仍不准确，再追加系统提示词。
```

**改动清单**：

| 文件 | 改动 |
|------|------|
| `app/src/tools/ImageGenerateTool/ImageGenerateTool.ts` | 优化 `description` 属性 |
| `app/src/tools/ImageAnalysisTool/ImageAnalysisTool.ts` | 优化 `description` 属性 |
| `app/src/tools/ImageTool/ImageTool.ts` | 优化 `description` 属性 |
| `app/src/tools/ImageSvgTool/ImageSvgTool.ts` | 优化 `description` 属性 |
| `app/src/chat/ChatManager.ts` | 仅兜底：系统提示词追加图像工具指南 |

---

### 阶段三：进阶能力（P3，差异化竞争力）

#### 2.7 链式图像操作

**现状**：用户需要多次对话才能完成"生成→编辑→分析"的链路。

**方案 A（短期）**：优化工具描述和系统提示词，让 AI 能在单轮对话中多次调用工具组成链式操作。

**方案 B（长期）**：实现 `image_pipeline` 工具，允许用户用自然语言描述多步操作：

```
用户: "生成一张猫的图片，然后把它变成黑白，再分析一下这张图"

image_pipeline 内部:
  Step 1: image_generate(prompt="一只猫") → cat.png
  Step 2: image(inputPath="cat.png", action="grayscale") → cat_bw.png
  Step 3: image_analysis(inputPath="cat_bw.png", action="full") → analysis
  → 返回: { steps: [...], finalResult: analysis }
```

#### 2.8 图像预览交互增强

**现状**：生图结果以静态缩略图展示在聊天中。

**方案**（按需）：
- 点击生图结果可放大预览（已有 ImageViewer）
- 图片结果旁增加"编辑"按钮 → 跳转 Canvas 编辑器
- 图片结果旁增加"下载"按钮
- 图片结果旁增加"分析"按钮 → 自动触发 `image_analysis`

---

## §3 实施优先级

> 优先级定义：P1 = 用户无法使用 / P2 = 用户能用但体验差 / P3 = 锦上添花

| 优先级 | 编号 | 任务 | 工作量 | 前置依赖 | 验收标准 |
|:------:|------|------|:------:|------|------|
| P1 | 2.1 | 聊天输入区增加图片上传（含发送前预览） | 中 | -- | 上传 ≤2s（5MB 以下）；预览条显示/删除/多图折叠正常 |
| P1 | 2.2 | 图片引用解析（直接路径 + 校验层） | 小 | 2.1 | 连续 10 次"分析这张图"正确调用 image_analysis，inputPath 校验生效 |
| P2 | 2.3 | Canvas 后端工具实现 + 编辑器协作链路 | 中 | 2.2 | draw/rotate/text 操作结果可被前端编辑器打开 |
| P2 | 2.4 | 生图结果自动入图库 | 小 | 2.1 | 生图完成后图库列表自动刷新 |
| P2 | 2.5 | 图像上下文保持 | 小 | 2.2 | 刷新/重连后"把刚才那张图调亮"仍正确引用 |
| P2 | 2.6 | 工具描述优化（优先） + 系统提示词兜底 | 极小 | -- | 10 个典型场景连续测试，图像工具调用正确率 ≥ 80% |
| P3 | 2.7 | 链式图像操作 | 大 | 2.3, 2.5 | "生成→编辑→分析"链路在单轮对话中完成 |
| P3 | 2.8 | 图像预览交互增强 | 中 | 2.2 | 生图结果旁出现编辑/下载/分析按钮 |

**建议执行顺序**：P1（2.1 + 2.2）先完成 → P2 全部 → P3 按需。

---

## §4 风险与注意事项

### 4.1 图片上传异常处理与安全校验（P1 必须覆盖）

**异常处理**：

| 场景 | 处理方式 |
|------|---------|
| 上传了超过 10MB 的大图 | 前端 File 对象阶段拦截，toast "图片不能超过 10MB" |
| 上传了不支持的格式（如 `.webp`） | 前端自动转 PNG/JPEG 后上传；或接受 webp（后端已支持） |
| 上传过程中网络断开 | 缩略图保持 error 态，显示"上传失败，点击重试" |
| 粘贴截图时浏览器权限不足（非 HTTPS） | 捕获 `NotAllowedError`，**自动弹出文件选择对话框**（`<input type="file">`），不显示错误提示 |
| 发送消息时仍有图片未上传完成 | 发送按钮 disabled，缩略图 loading 态，全部完成后才允许发送 |

**安全校验**（补充 §4.1 未覆盖的缺口）：

| 风险 | 处理方式 |
|------|---------|
| SVG 注入（`<script>` 标签） | 后端上传时对 SVG 做 strip-script 处理（移除 `<script>`、`onerror=` 等） |
| MIME 类型伪造（`.exe` 改 `.png`） | 后端用 magic bytes 校验真实文件类型，不只看扩展名 |
| 上传限速 | 单 session 每分钟最多 20 次上传；超限返回 429 |
| 多图上传并发 | 限制 `maxConcurrent = 3`，超过 5 张缩略图折叠为 "+N"，`maxImagesPerMessage = 20`

### 4.2 其他风险

1. **大图处理**：Canvas 后端工具操作大图时可能内存压力大，Sharp 管道模式已处理流式，但需设置最大尺寸限制（如 4096x4096）。
2. **服务端 Canvas vs 前端 Canvas**：后端 `CanvasTool` 是 Sharp 批处理模式，不可与前端交互式 Canvas 编辑器混淆。后端工具用于"AI 代用户操作"，前端编辑器用于"用户手动操作"。两者的协作方式见 §2.3。
3. **不破坏现有架构**：所有改动都在现有框架内扩展，不自建新的注册机制、不自建新的事件总线。
4. **CS02 原则**：图片引用解析基于 `attachedImages` 数组（结构化数据），而非匹配文件名字符串。

---

## §5 关键文件参考

| 文件 | 改动类型 |
|------|:---:|
| `client/src/components/ChatArea/ChatInput.tsx` | 修改 |
| `client/src/services/chatService.ts` | 修改 |
| `client/src/stores/chatStore.ts` | 修改 |
| `app/src/chat/ChatManager.ts` | 修改 |
| `app/src/tools/CanvasTool/` | **新建** |
| `app/src/tools/ToolFactory.ts` | 修改 |
| `app/src/tools/ImageAnalysisTool/ImageAnalysisTool.ts` | 修改 |
| `app/src/tools/ImageTool/ImageTool.ts` | 修改 |
| `client/src/components/views/image/toolRegistry.ts` | 修改 |
| `client/src/types/message.ts` | 修改 |

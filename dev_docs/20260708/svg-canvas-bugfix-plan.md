# SVG/Canvas 工具链 BUG 修复方案

> 来源: `logs/chat-export-1782184808721.md` | 日期: 2026-07-08

## 诊断范围

- `app/src/tools/ImageSvgTool/ImageSvgTool.ts`
- `app/src/tools/CanvasTool/CanvasTool.ts`
- `app/src/tools/CanvasTool/CanvasInstance.ts`
- `app/src/chat/ChatManager.ts`（路径校验段）

---

## BUG #1（严重）：ChatManager 向 image_svg_generate / canvas 注入非法 inputPath ✅ 已完成

**文件**: `app/src/chat/ChatManager.ts` 第 3405-3454 行

**现象**: `image_svg_generate` 和 `canvas` 被列入 `IMAGE_TOOL_NAMES`，触发 inputPath 自动补全逻辑，向参数中注入工具不认识也不需要 `inputPath` 字段。

**根因**: `IMAGE_TOOL_NAMES` 集合粗粒度地把所有"带有图像概念"的工具收进去了：

```typescript
const IMAGE_TOOL_NAMES = new Set([
  'image_analysis',      // ✅ 需要路径校验
  'image',               // ✅ 需要路径校验
  'image_svg_generate',  // ❌ 不需要——从 prompt 生成，无输入路径
  'canvas',              // ❌ 不需要——大多数操作不涉及文件路径
]);
```

**修复方案**:

```typescript
// 方案 A：拆分为两个集合（推荐）

// 需要 inputPath 校验的图像工具
const IMAGE_INPUT_TOOLS = new Set(['image_analysis', 'image']);

// 生成类图像工具（不需要 inputPath）
const IMAGE_GENERATE_TOOLS = new Set(['image_svg_generate', 'canvas']);

// 合并用于 tool call 匹配
const IMAGE_TOOL_NAMES = new Set([...IMAGE_INPUT_TOOLS, ...IMAGE_GENERATE_TOOLS]);

// 只在 INPUT_TOOLS 上执行路径校验
if (IMAGE_INPUT_TOOLS.has(normalizedToolCall.name) && toolCall.sessionId) {
  // ... 原有路径提取 + 校验逻辑
}
```

**影响面**: 仅改 ChatManager.ts ~15 行，不改任何 tool 内部逻辑。

---

## BUG #2（中等）：ImageSvgTool 忽略 model 参数 ✅ 已完成

**文件**: `app/src/tools/ImageSvgTool/ImageSvgTool.ts` 第 189 行

**现象**: `ImageSvgInput` schema 有 `model: z.string().optional()`，但 execute 方法调用 `aiService.generate(messages)` 时没有传递 model 参数，永远使用默认模型。

**修复方案**:

```typescript
// 第 189 行
const response = await aiService.generate(messages, {
  model: input.model,  // ← 新增
});
```

**影响面**: 1 行改动。

---

## BUG #3（中等）：CanvasTool.handleText 静默丢弃非 text 元素

**文件**: `app/src/tools/CanvasTool/CanvasTool.ts` 第 267-276 行

**现象**: 当 `textElements.length > 0` 时，只添加 text 元素，忽略同批次中的非 text 元素（如图形、图片）。

```typescript
// 当前逻辑
const textElements = (input.elements ?? []).filter((e) => e.type === 'text');
if (textElements.length === 0 && input.elements) {
  instance.addElements(input.elements);   // 无 text → 全添加
} else {
  instance.addElements(textElements);     // 有 text → 只添加 text，丢弃其他
}
```

**修复方案**:

```typescript
const elements = input.elements ?? [];
const textElements = elements.filter((e) => e.type === 'text');

if (textElements.length > 0) {
  instance.addElements(textElements);
}

// 非 text 元素也添加（原先被丢弃）
const nonTextElements = elements.filter((e) => e.type !== 'text');
if (nonTextElements.length > 0) {
  instance.addElements(nonTextElements);
}

// 如果没有任何 elements，不做任何事（原先的 else 分支）
```

**影响面**: 单一方法 ~10 行。

---

## BUG #4（低）：validateSvg 的正则误匹配 DOCTYPE ✅ 已完成

**文件**: `app/src/tools/ImageSvgTool/ImageSvgTool.ts` 第 328-370 行

**现象**: 

```typescript
const tagRegex = /<(\w+)[\s>]/g;  // 会匹配到 <!DOCTYPE html> 中的 DOCTYPE
```

**修复方案**:

```typescript
// 排除以 ! 开头的 SGML 标记
const tagRegex = /<(?!!)(\w+)[\s>]/g;
```

**影响面**: 1 行正则改动。

---

## BUG #5（低）：ImageSvgTool size 参数无 NaN 校验 ✅ 已完成

**文件**: `app/src/tools/ImageSvgTool/ImageSvgTool.ts` 第 167-168 行

**现象**: `input.size` 默认 `'64x64'`，但如果传入 `'abc'`，`parseInt` 产生 `NaN`。

**修复方案**:

```typescript
const [width, height] = (input.size ?? '64x64').split('x').map(Number);
if (isNaN(width) || isNaN(height) || width <= 0 || height <= 0) {
  return { success: false, error: `Invalid size: ${input.size}. Expected format: WxH` };
}
```

**影响面**: 3 行。

---

## BUG #6（低）：Canvas 测试假阳性 ✅ 已完成

**文件**: `app/src/tools/CanvasTool/__tests__/CanvasTool.test.ts`

**现象**: 

- `draw` 测试不传 `canvasId`，期望 `success: true` → 实际 `handleDraw` 调用 `getOrError(undefined)` 返回 null → 返回 `{ success: false }`
- `export` 测试同理
- `import` 操作传 `'import' as any`，不传 `elements`，期望成功

**修复方案**:

1. 每个测试正确传入 `canvasId`（先执行 create 获取 id，再传给后续操作）
2. `import` 测试改为期望 `success: false` 或补全 `elements`

---

## 优先级与执行顺序（全部完成 ✅）

| 优先级 | BUG# | 说明 | 状态 |
|:--:|:--:|------|:--:|
| P0 | #1 | ChatManager 注入非法 inputPath → 可能导致 SVG 生成调用失败 | ✅ |
| P1 | #2 | model 参数被忽略 → 用户无法指定模型 | ✅ |
| P1 | #3 | handleText 丢数据 → 组合元素调用中丢失非文本图形 | ✅ |
| P2 | #5 | size NaN → 可能导致无效 SVG viewBox | ✅ |
| P2 | #4 | DOCTYPE 误匹配 → 仅影响 validate 警告，不妨碍执行 | ✅ |
| P3 | #6 | 测试假阳性 → 不阻塞功能，但降低测试可信度 | ✅ |

---

## 验证方式（全部通过 ✅）

| 检查项 | 结果 |
|------|:--:|
| `bun test src/tools/CanvasTool/__tests__/` | 11 pass, 0 fail |
| `bun test src/tests/PathGuard.test.ts` | 16 pass, 5 skip, 0 fail |
| ImageSvgTool 回归 | 无独立测试文件，逻辑改动已验证 |
| `bun run typecheck` | 通过 |
| `bun run lint:fix` | 0 错误 0 警告 |

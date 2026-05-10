# MakeItDown 转 Markdown 功能开发规则

**对标源码**: Microsoft MarkItDown v0.1.6b2 (`reference/markitdown-main`)  
**集成目标**: PY_APP 项目的 `tools/converter/` + `FileReadTool` + `FileConvertTool` + `/convert` 命令  
**最后更新**: 2026-05-10  
**版本**: v1.0

---

## §1 MarkItDown → PY_APP 模式映射

| MarkItDown (Python) | PY_APP (TypeScript) | 说明 |
|---------------------|---------------------|------|
| `MarkItDown` 引擎类 | `ConverterEngine` (单例) | 管理注册表 + 执行匹配/转换循环 |
| `DocumentConverter` 抽象基类 | `BaseConverter` 抽象类 | 定义 `accepts()` + `convert()` |
| `StreamInfo` dataclass | `FileInfo` 接口 | 文件元信息（path, ext, mime, size） |
| `ConverterRegistration` | — | PY_APP 直接用注册顺序 + priority 字段 |
| `DocumentConverterResult` | `ConversionResult` 接口 | `{ markdown, title?, metadata? }` |
| `_get_stream_info_guesses()` | `FileTypeDetector.detect()` | 三重检测 → 返回单一 FileInfo |
| `_convert()` 双循环 | `ConverterRegistry.findAndConvert()` | 扩展名 → MIME 匹配 + 优先级排序 |
| `_markdownify.py` | `HtmlMarkdownify` | 自定义 HTML → Markdown 规则 |
| `_exceptions.py` 层次 | `AppError` + `ErrorCodes` | 标准 PY_APP 错误体系 |
| entry_points 插件 | — | PY_APP 不支持第三方插件，全内置 |
| optional dependencies | Feature Flag + npm 可选依赖 | 延迟错误，缺失时友好提示 |

### 1.1 MarkItDown 核心处理流程

```
source (path/URL/stream/response)
  │
  ▼
convert_local/convert_stream/convert_url/convert_response
  │
  ▼
_get_stream_info_guesses()    ← 扩展名 → MIME → Magika 三重检测
  │
  ▼
_convert()
  │  ├── 外循环: stream_info_guesses (多个类型假设)
  │  └── 内循环: 按 priority 排序的 converters
  │       ├── accepts() → True 则调用 convert()
  │       └── 失败则记录并尝试下一个
  │
  ▼
DocumentConverterResult { markdown, title }
```

### 1.2 优先级设计

参考 MarkItDown 的优先级常量，PY_APP 采用：

```
PRIORITY_SPECIFIC_FILE_FORMAT = 0    // 专用格式 (docx, pdf, xlsx ...)
PRIORITY_GENERIC_FILE_FORMAT = 10    // 通用格式 (html, zip, plaintext)
PRIORITY_FALLBACK = 20               // 兜底 (plaintext)
```

优先级值越低越优先。同一优先级的转换器按注册顺序尝试，保证确定性。

---

## §2 实现约定

### 2.1 引擎层约定

1. **`ConverterEngine` 为单例**：通过 `getConverterEngine()` 获取，应用级共享
2. **转换器注册**：在 `ConverterRegistry` 中通过 `register()` 方法注册
3. **匹配策略**：首轮精确匹配（扩展名 + MIME），次轮 Magic Bytes 内容检测
4. **返回值**：始终返回 `ConversionResult`，失败时抛出 `AppError`

### 2.2 转换器实现约定

每个转换器必须遵守：

```typescript
export class XxxConverter extends BaseConverter {
  readonly name = 'xxx';
  readonly priority = PRIORITY_SPECIFIC_FILE_FORMAT;
  readonly supportedExtensions = ['.xxx'];
  readonly supportedMimeTypes = ['application/xxx'];

  async convert(context: ConversionContext): Promise<ConversionResult> {
    // 1. 检查可选依赖（如有）
    this.ensureDependencies();
    // 2. 执行转换逻辑
    // 3. 返回 ConversionResult
  }
}
```

### 2.3 可选依赖处理

参考 MarkItDown 的模块级 try/except 延迟错误模式：

```typescript
// 转换器文件级（模块初始化时尝试加载，失败则保存异常）
let _depError: Error | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('mammoth');
} catch (e) {
  _depError = e as Error;
}

// convert() 方法中抛出友好错误
if (_depError) {
  throw new AppError(ErrorCodes.MISSING_DEPENDENCY, {
    module: `Converter:${this.name}`,
    context: { dependency: 'mammoth' },
    message: `转换 .docx 文件需要安装 mammoth。
运行：npm install mammoth`,
  });
}
```

### 2.4 文件检测流程（四重检测）

参考 MarkItDown 的扩展名 → MIME → Magika 三层，PY_APP 增加 Magic Bytes：

```
第一层: 扩展名检测 (path.extname)
  ↓ 匹配 → 直接返回 FileInfo
  ↓ 不匹配或缺失 → 进入第二层
第二层: MIME 类型检测 (mimeMap[ext])
  ↓ 匹配 → 更新 FileInfo
  ↓ 不匹配或缺失 → 进入第三层
第三层: Magic Bytes 检测 (文件头 8-16 字节)
  ↓ 匹配 → 纠正 extension + mimeType
  ↓ 不匹配 → 进入第四层
第四层: 内容嗅探 (ZIP/OOXML 内部标记)
  ↓ 匹配 → 精确区分 docx/xlsx/pptx
  ↓ 不匹配 → 兜底为 plaintext
```

### 2.5 错误处理约定

| MarkItDown 异常 | PY_APP 映射 | 场景 |
|-----------------|-------------|------|
| `MissingDependencyException` | `AppError(ErrorCodes.MISSING_DEPENDENCY, ...)` | 可选依赖未安装 |
| `UnsupportedFormatException` | `AppError(ErrorCodes.UNSUPPORTED_FORMAT, ...)` | 无匹配转换器 |
| `FileConversionException` | `AppError(ErrorCodes.CONVERSION_FAILED, ...)` | 转换执行失败 |
| `MarkItDownException` (base) | `AppError` | 通用转换错误 |

### 2.6 测试约定

参考 MarkItDown 的 vector-driven 测试模式：

```typescript
interface TestVector {
  name: string;
  input: { format: string; content: string | Buffer };
  mustInclude?: string[];
  mustNotInclude?: string[];
}
```

- 每个转换器必须有单元测试覆盖
- 每个测试用例使用 `mustInclude`/`mustNotInclude` 断言
- 测试目录：`backend/testing/converter/`
- 测试文件样本：`backend/testing/converter/fixtures/`

---

## §3 目录与文件命名规范

### 3.1 引擎层

```
tools/converter/
├── engine/
│   ├── BaseConverter.ts       // 抽象基类
│   ├── ConverterRegistry.ts   // 注册表
│   ├── ConverterEngine.ts     // 引擎单例
│   └── types.ts               // 类型定义
```

### 3.2 转换器列表（按注册顺序）

对应 MarkItDown `enable_builtins()` 注册顺序，最通用在最前，最具体在最后：

```typescript
// 通用转换器 (priority = 10)
PlainTextConverter  // 兜底 text/*
ZipConverter        // 递归解压
HtmlConverter       // HTML → MD

// 特定 URL/格式转换器 (priority = 0)
RssConverter
WikipediaConverter
YouTubeConverter
BingSerpConverter
DocxConverter       // DOCX → HTML → MD
XlsxConverter       // XLSX → 表格 → MD
XlsConverter        // XLS → 表格 → MD
PptxConverter       // PPTX → 文本 → MD
AudioConverter      // 音频元数据 + 语音识别
ImageConverter      // 图片元数据 + LLM 描述
IpynbConverter      // Jupyter Notebook
PdfConverter        // PDF → 文本 + 表格
OutlookMsgConverter // Outlook MSG
EpubConverter       // EPUB → 章节 → MD
CsvConverter        // CSV/TSV → 表格
```

### 3.3 文件命名

| 类型 | 约定 | 示例 |
|------|------|------|
| 转换器文件 | `XxxConverter.ts` | `DocxConverter.ts` |
| 工具函数 | `XxxUtil.ts` | `HtmlMarkdownify.ts` |
| 类型定义 | `types.ts` | `types.ts` |
| 引擎核心 | `XxxEngine.ts` | `ConverterEngine.ts` |
| 抽象基类 | `BaseXxx.ts` | `BaseConverter.ts` |

### 3.4 命令命名

| 元素 | 名称 | 说明 |
|------|------|------|
| 命令名 | `convert` | CLI 命令 `/convert` |
| 命令文件 | `Convert.ts` | 命令实现 |
| 命令目录 | `convert/` | 命令模块目录 |

### 3.5 工具命名

| 元素 | 名称 | 说明 |
|------|------|------|
| 主动转换工具 | `FileConvertTool` | AI Agent 主动调用 |
| 增强工具 | `FileReadTool` | 原工具增强（新增非文本检测路径） |

---

## §4 依赖管理

### 4.1 可选依赖清单

| 格式 | npm 包 | Feature Flag | 安装命令 |
|------|--------|-------------|----------|
| HTML | cheerio | FILE_CONVERTER | `npm install cheerio` |
| DOCX | mammoth | FILE_CONVERTER_DOCX | `npm install mammoth` |
| XLSX | xlsx | FILE_CONVERTER_XLSX | `npm install xlsx` |
| PPTX | pptx.js | FILE_CONVERTER_PPTX | `npm install pptx.js` |
| PDF | pdfjs-dist | FILE_CONVERTER_PDF | `npm install pdfjs-dist` |
| EPUB | epubjs | FILE_CONVERTER_EPUB | `npm install epubjs` |
| ZIP | adm-zip | FILE_CONVERTER_ZIP | `npm install adm-zip` |
| 图片 | sharp | FILE_CONVERTER_IMAGE | `npm install sharp` |
| 音频 | fluent-ffmpeg | FILE_CONVERTER_AUDIO | `npm install fluent-ffmpeg` |
| XML | fast-xml-parser | FILE_CONVERTER | `npm install fast-xml-parser` |
| MSG | msg.js | FILE_CONVERTER | `npm install msg.js` |

### 4.2 Feature Flag 命名规范

```
FILE_CONVERTER: true            // 总开关（必须开启）
FILE_CONVERTER_DOCX: true       // DOCX 转换
FILE_CONVERTER_PDF: true        // PDF 转换
FILE_CONVERTER_PPTX: true       // PPTX 转换
FILE_CONVERTER_XLSX: true       // XLSX 转换
FILE_CONVERTER_IMAGE: true      // 图片转换
FILE_CONVERTER_AUDIO: true      // 音频转换
FILE_CONVERTER_EPUB: true       // EPUB 转换
FILE_CONVERTER_ZIP: true        // ZIP 递归转换
```

### 4.3 缺失依赖处理

参考 MarkItDown 的 `MISSING_DEPENDENCY_MESSAGE` 模式：

1. 转换器模块加载时尝试 `try/require` 导入
2. 失败则保存异常，`convert()` 被调用时抛出 `AppError(ErrorCodes.MISSING_DEPENDENCY)`
3. 错误消息明确指示安装命令
4. `FileReadTool` 对缺失依赖返回友好提示而非崩溃

---

## §5 OOXML ZIP 格式区分规则

MarkItDown 在 OOXML (Office Open XML) 文件处理中面临 DOCX/XLSX/PPTX 都使用 ZIP 格式的问题。参考其做法：

1. **Magic Bytes 初筛**：PK\x03\x04 检测到 ZIP
2. **内部标记检测**：读取 ZIP 内 `[Content_Types].xml` 的内容类型标记
3. **区分规则**：

| Content_Types 标记 | 格式 |
|-------------------|------|
| `word/main.xml` | DOCX |
| `xl/workbook.xml` | XLSX |
| `ppt/presentation.xml` | PPTX |
| 无匹配 | 泛 ZIP |

实现位置：`FileTypeDetector.detect()`

---

## §6 质量门禁

### 6.1 每阶段检查清单

- [ ] TypeScript 编译通过（strict 模式）
- [ ] ESLint 无错误（禁止 `any` 类型）
- [ ] 单元测试通过（覆盖率 ≥ 80%）
- [ ] 模块依赖验证通过（`modules:validate`）
- [ ] 功能与 MarkItDown 对齐

### 6.2 禁止行为

- 禁止使用 `console.log`/`console.error`（使用 `Logger`）
- 禁止使用 `any` 类型（使用具体类型或 `unknown`）
- 禁止重复造轮子（先检查 `src/utils/common.ts`）
- 禁止双轨制（统一收敛到 `tools/converter/`）
- 禁止在工具层直接实现转换逻辑（必须经引擎层）
- 禁止在未实现所有对应格式的情况下删除 MarkItDown 转换器

### 6.3 转换器实现顺序

严格按以下顺序实现，不得跳过或提前删除：

1. PlainText → CSV/JSON/XML → HTML（文本类，无外部依赖）
2. DOCX → XLSX/XLS → PPTX → PDF（Office 类，需要可选依赖）
3. 图片 → 音频（媒体类，需要 LLM 或外部工具）
4. EPUB → ZIP（归档类，需要解压库）
5. IPYNB → RSS/Atom（数据格式类）
6. URL 类（Wikipedia/YouTube/Bing — 需要网络请求）
7. Outlook MSG（邮件格式）

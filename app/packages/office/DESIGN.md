# Liri 办公模块设计方案 — `@pyapp/office`

> 版本：v1.0 | 日期：2026-07-04 | 状态：草案

---

## 1. 背景

### 1.1 已有资产

| 资产 | 位置 | 说明 |
|------|------|------|
| **FileConvertTool** | `app/src/tools/converter/` | DOCX/XLSX/PPTX/PDF → Markdown 读取引擎 |
| **KanbanTool** | `app/src/tools/KanbanTool/` | 看板 CRUD 管理（内存存储） |
| **PDFTool** | `app/src/tools/PDFTool/` | 简单 PDF 生成/提取（手写 PDF 语法） |
| **mammoth** | 已有依赖 | DOCX 读取库 |
| **xlsx** | 已有依赖 | XLSX 读取库 |
| **outlook-email-parser** | 已有依赖 | Outlook MSG 解析 |
| **msg.js** | 已有依赖 | 邮件消息解析 |

### 1.2 缺失能力

- ❌ 文档**创建/编辑**（converter 只有单向读取）
- ❌ 邮件收发（仅能解析 MSG 文件，无网络收发）
- ❌ 日历/日程管理
- ❌ 演示文稿创建
- ❌ 电子表格创建/编辑

---

## 2. 架构决策

### 2.1 定位

新建独立包 `@pyapp/office`，放在 `app/packages/office/`。

**理由**：
- 办公功能逻辑复杂、外部依赖多，独立包便于版本管理
- 遵循现有 `@pyapp/core` → `@pyapp/personal` → `@pyapp/coding` 的包分层
- 办公工具之间共享私有模块（如邮件配置、文档模板）

### 2.2 构建变体归属

归属于 **enterprise** 构建变体。

**依赖链**：
```
@pyapp/office → @pyapp/core
@pyapp/coding → @pyapp/personal → @pyapp/core
@pyapp/personal → @pyapp/core
```

`@pyapp/office` 是 `@pyapp/core` 的直接扩展包，与 `@pyapp/personal` 无必然依赖关系（办公和编码互不依赖）。`enterprise` 变体 = `coding` + `office` + `personal` 的组合。

**工具间调用规范**（如 CalendarTool 调用 DocumentTool.create）：

| 方式 | 适用场景 | 规范 |
|------|---------|------|
| 直接 import | 同包内工具互相调用 | ✅ 允许；注意避免循环依赖 |
| 通过 ToolRegistry | 跨包调用（如 core 调用 office） | ✅ 通过 `toolRegistry.execute('document', ...)` |
| 事件总线 | 异步通知（如"邮件已发送"通知日历"会议邀约已发出"） | ⚠️ 复杂场景用，优先用前两种 |

禁止通过全局单例互相引用；工具实例化的依赖通过构造函数注入。

### 2.3 分发策略

不新增构建变体。`enterprise` 变体在 `app/scripts/build-variant.ts` 中已有定义，只需：
1. 在 enterprise 的 `features` 配置中增加办公模块 flag
2. 在 `buildVariantFlags.ts` 中生成对应的 Feature Flag

即：`LIRI_BUILD_VARIANT=enterprise` 时自动启用模块。

### 2.4 包构建流程

`@pyapp/office` 作为 monorepo workspace 包（非独立 npm 发布），构建时：

- **位置**：`app/packages/office/`（与 `app/src/` 同级，通过 workspace 引用）
- **依赖安装**：`bun install` 在 workspace 根目录执行时自动安装 office 包的生产依赖
- **构建变体区分**：
  - `enterprise` 构建：安装 office 包全部依赖（nodemailer、imapflow、docx 等），启用所有办公 Feature Flag
  - `personal`/`coding` 构建：**不安装** office 包依赖（tree-shaking），通过条件编译排除 `@pyapp/office` 的 import
- **入口**：`app/packages/office/index.ts` export 工具类列表，由 `ModuleRegistry` 在运行时按需 `import()`

### 2.5 前置条件（实施前必须完成）

办公模块依赖以下基础设施，需在编码前就位：

| 前置项 | 文件 | 改动量 | 说明 |
|--------|------|:--:|------|
| Feature Flag 定义 | `app/src/core/featureFlags.ts` | 新增 `OFFICE_MODULE`、`OFFICE_DOCUMENT`、`OFFICE_EMAIL`、`OFFICE_CALENDAR` 等 6 个 flag | `feature()` API 已可用，仅需追加常量 |
| enterprise 构建配置 | `app/scripts/build-variant.ts` | 在 `enterprise.features` 数组中追加 `OFFICE_MODULE` 等 flag | 构建脚本已完整，仅需配置 |
| 运行时构建标识 | `app/src/core/featureFlags.ts` | 利用现有 `isAtLeastVariant('enterprise')` + `LIRI_BUILD_VARIANT` 环境变量 | 链路已通，无需改动 |
| 延迟加载 | `app/src/core/lazy/LazyService.ts` | `LazyModuleStrategy` 已预留 `enterprise` 模块配置 | 骨架已齐，仅需扩展 |

> `ToolRegistry.registerLazy()` 方法当前不存在 → 复用已有的 `LazyService.registerLazy()` 或 `ModuleManager.registerLazyModule()` 进行工具延迟注册。

---

## 3. 功能模块设计

### 3.1 模块全景

```
@pyapp/office
├── document/             # 文档模块
│   ├── DocumentTool.ts   # 文档创建/编辑工具
│   ├── TemplateEngine.ts # 模板引擎（Handlebars 语法：{{变量}}、{{#each}}、条件判断等）
│   └── __tests__/
├── spreadsheet/          # 电子表格模块
│   ├── SpreadsheetTool.ts   # 表格创建/分析工具│   ├── ChartGenerator.ts    # 图表生成（柱状/折线/饼图）
│   └── __tests__/
├── presentation/         # 演示文稿模块
│   ├── PresentationTool.ts  # PPT 生成工具
│   └── __tests__/
├── email/                # 邮件模块
│   ├── EmailTool.ts         # 邮件收发
│   ├── EmailConfigService.ts # 邮箱配置管理（加密存储）
│   ├── EmailSender.ts       # SMTP 发送
│   ├── EmailReader.ts       # IMAP 读取/搜索
│   └── __tests__/
├── calendar/             # 日历模块
│   ├── CalendarTool.ts      # 日程管理工具（含会议纪要/议程扩展）
│   ├── ICalParser.ts        # iCal 解析/生成
│   └── __tests__/
├── contact/              # 通讯录模块
│   ├── ContactTool.ts       # 联系人管理
│   └── __tests__/
├── index.ts              # 包入口
├── package.json
└── DESIGN.md
```

### 3.2 第一波（MVP）功能

#### 3.2.1 文档工具 — DocumentTool

**工具名**：`document`

**能力**：

| Action | 描述 |
|--------|------|
| `create` | 从 Markdown/文本创建 DOCX 文档 |
| `regenerate` | 从已有 DOCX 提取内容（mammoth → Markdown），修改后重新生成（**样式不保留**） |
| `merge` | 合并多个文档 |
| `export` | 导出为 PDF/DOCX/Markdown |

**合并策略**（`merge`）：逐文档提取 Markdown 内容（mammoth → 纯文本）→ 按顺序拼接 → 用 `docx` 重新生成单个 DOCX。不保留原始样式，排版由最终生成阶段统一控制。

**技术选型**：`docx` npm 包（纯 JS，Bun 兼容，轻量）
- **创建**：用 `docx` 基于模板对象生成 DOCX
- **回写**：`docx` 不支持编辑已有 DOCX 并保留格式；`regenerate` 策略为 mammoth 读取 → 转 Markdown → 用户修改 → `docx` 重新生成
- 读取复用现有 converter 引擎的 `DocxConverter`

**⚠️ regenerate 能力边界**：
- ✅ 保留：文本内容、标题层级（Heading 1/2/3 → Markdown `#`/`##`/`###`）、加粗、斜体、列表
- ❌ 丢失：页眉/页脚/页码、图片绝对位置、表格合并单元格、自定义字体/字号/颜色
- 如需完全保留格式的编辑，需依赖 LibreOffice CLI 或 `officegen`（暂不纳入第一波）

**PDF 导出方案**：

| 方案 | 说明 | 第一波 |
|------|------|:--:|
| DOCX → LibreOffice CLI | `soffice --headless --convert-to pdf`，格式还原度最高 | ✅ 首选 |
| DOCX → HTML（mammoth）→ PDF（puppeteer/playwright） | 格式近似度高，但依赖 Chromium，体积大 | ⚠️ Plan B |
| `pdf-lib` | 底层 PDF 操作库，非渲染引擎；仅用于 PDF 元数据操作/水印，不用于全文渲染 | ❌ 不适合 |
| 现有 PDFTool | 手写 PDF 语法，仅支持简单文本布局 | ❌ 不适合 |

> **务实说明**：`pdf-lib` 不是渲染引擎，从头用 Markdown AST + `pdf-lib` 渲染 PDF 工作量巨大（字体度量、分页、换行需全自行实现）。第一波优先走 LibreOffice CLI（初始化时检测安装路径，未安装则给出安装提示并回退到仅 DOCX/Markdown 导出）。

**参数示例**：
```typescript
const params = [
  { name: 'action', type: 'string', enum: ['create', 'regenerate', 'merge', 'export'], required: true },
  { name: 'content', type: 'string', description: 'Markdown 内容（create 时必填）' },
  { name: 'sources', type: 'string[]', description: '待合并的文档路径列表（merge 时必填）' },
  { name: 'template', type: 'string', description: '模板路径（可选）' },
  { name: 'output', type: 'string', description: '输出文件路径' },
  { name: 'format', type: 'string', enum: ['docx', 'pdf', 'md'], description: '导出格式' },
]
```

#### 3.2.2 邮件工具 — EmailTool

**工具名**：`email`

**能力**：

| Action | 描述 |
|--------|------|
| `send` | 发送邮件（SMTP） |
| `inbox` | 读取收件箱（IMAP） |
| `search` | 搜索邮件 |
| `config` | 配置邮箱账户 |
| `summary` | 邮件摘要/自动分类 |

> **注**：SMTP 发送为第一波核心能力，默认启用；IMAP 读取（`inbox`/`search`）代码在同一波实现，但通过 Feature Flag 默认关闭——用户首次使用时弹出引导提示启用。

**技术选型**：
- 发送：`nodemailer`（成熟稳定）
- 接收：`imapflow`（比 node-imap 更现代，支持 OAuth2）
- 配置存储：本地加密 JSON 文件（`~/.liri/email-config.json`，AES-GCM 加密）

**安全设计**：
- 邮箱密码/Token 使用 `crypto` 内置 AES-GCM 加密存储
- 解密密钥从环境变量 `LIRI_EMAIL_KEY` 或 `LIRI_SECRET_KEY` 获取
- 存储时额外保存密钥指纹（SHA-256 前 8 位），每次加载配置时对比指纹；指纹不匹配时提示"检测到加密密钥已变更，需重新配置邮箱"
- 支持 OAuth2（Gmail/Outlook）和授权码（QQ/163）
- **传输加密**：所有 SMTP/IMAP 连接强制 TLS；非 TLS 连接拒绝并报错，除非用户显式覆盖
- **频率限制**：单次调用最多发送 50 封，每分钟不超过 10 封
- **日志脱敏**：邮件正文/密码/Token 不得写入日志文件，输出时用 `[REDACTED]` 标记

**配置结构**：
```json
{
  "accounts": [
    {
      "id": "gmail-main",
      "host": "smtp.gmail.com",
      "port": 587,
      "user": "...",
      "pass": "(AES encrypted)",
      "imapHost": "imap.gmail.com",
      "imapPort": 993
    }
  ]
}
```

#### 3.2.3 日历工具 — CalendarTool

**工具名**：`calendar`

**能力**：

| Action | 描述 |
|--------|------|
| `list` | 查看日程列表 |
| `add` | 添加日程事件 |
| `update` | 修改日程事件 |
| `delete` | 删除日程事件 |
| `export` | 导出 .ics 文件 |

**技术选型**：
- 解析/生成：`ical.js`（iCalendar RFC 5545 标准）
- 存储：本地 `.ics` 文件（~/.liri/calendars/`），简单可靠
- 后续可扩展：CalDAV 同步、SQLite 存储

**事件结构**：
```typescript
interface CalendarEvent {
  id: string;
 title: string;
  description?: string;
  location?: string;
  startTime: Date;
  endTime: Date;
  allDay?: boolean;
  recurrence?: string; // RRULE
  attendees?: string[];
  reminders?: number[]; // 分钟
  /** 会议扩展（替代独立的 MeetingTool，作为 CalendarEvent 的内嵌能力） */
  meeting?: {
    agenda?: string;         // 议程（Markdown）
    minutes?: string;        // 纪要（Markdown）
    actionItems?: string[];  // 行动项
  };
}
```

**与 DocumentTool 的协作**：
- 当执行 `meeting.agenda` / `meeting.minutes` 操作时，CalendarTool 调用 TemplateEngine 加载"会议纪要.hbs"模板
- TemplateEngine 渲染后生成 Markdown
- 可选择性地调用 DocumentTool.create 生成 `.docx` 文件
- `CalendarEvent.minutes` 字段仅存 Markdown（数据），不存 DOCX（文件）— 数据与导出分离

### 3.3 第二波功能

| 模块 | 工具名 | 能力 |
|------|--------|------|
| 电子表格 | `spreadsheet` | 创建 XLSX、数据分析、公式计算、图表生成 |
| 演示文稿 | `present` | 从大纲/Markdown 生成 PPTX、套用模板 |
| 通讯录 | `contact` | vCard 管理、联系人搜索 |
| 文档模板库 | — | 预置模板（周报/会议纪要/技术设计文档/PRD），格式为 `.hbs`，存放于 `app/packages/office/templates/` |

> 模板打包方式：随 `@pyapp/office` 包一起发布；运行时 TemplateEngine 从 `app/packages/office/templates/` 加载内置模板，用户可通过 `~/.liri/templates/office/` 覆盖（详见第12节模板引擎规范）。

#### 第二波技术选型补充

- **SpreadsheetTool**：读取复用已有 `xlsx` 依赖；创建/编辑使用 `exceljs`（支持公式、样式、图表）；两者操作同一个 workbook 时通过 `exceljs` 的 `xlsx.read()` 统一
- **PresentationTool**：`pptxgenjs` 从脚本创建 PPTX，**不支持 `.potx` 模板**。如需套用企业 PPT 模板，预留 `python-pptx`（通过 Bun Shell 调用 Python 脚本）作为 Plan B
- **ContactTool**：`vcard4` 解析/生成 vCard（RFC 6350），存储为本地 JSON 文件（`~/.liri/contacts.json`）

#### 三波依赖关系

三波之间是**累加关系**，后续波次复用前一波的基础设施：

```
第一波（基础设施）
├── DocumentTool + TemplateEngine + 缓存层 + 错误处理
│
第二波（累加到第一波之上）
├── SpreadsheetTool 复用 TemplateEngine
├── PresentationTool 复用 DocumentTool 的 docx→pptx 转换能力
├── ContactTool 独立模块
│
第三波（累加到第二波之上）
├── 智能特性复用缓存层和模板引擎
└── 审批流依赖 DocumentTool + EmailTool
```

### 3.4 第三波（高阶智能）

| 功能 | 描述 |
|------|------|
| 邮件自动分类 | 根据内容自动打标签、自动回复 |
| 文档智能写作 | 基于上下文自动生成/补全文档 |
| 数据源连接 | 连接 Git/Jira/数据库自动生成报表 |
| 审批流 | 多级审批 + 数字签名 |

> ⚠️ 审批流依赖 Liri Server（网络版/团队成员间协作）。本地模式下仅支持审批单草稿生成（通过 DocumentTool 创建 DOCX 审批单 + 签名框占位，使用 `docx` 的图片插入能力在签名位置插入占位框），不支持真实多级流转和数字签名验证。数字签名能力留到 Liri Server 阶段统一规划。

---

## 4. 工具注册

`@pyapp/office` 是独立包，工具代码位于包内，不直接依赖 `app/src/tools/ToolRegistry.ts`（跨包引用会导致循环依赖）。

注册路径：

```
1. 创建 BaseTool 子类
   ├── app/packages/office/<domain>/<ToolName>.ts
   ├── 实现 name / description / params / execute()
   └── export tool class

2. 包入口 export 工具注册信息
   ├── app/packages/office/index.ts
   └── export { DocumentTool, EmailTool, CalendarTool, ... } + 注册元数据

3. core 侧 ModuleRegistry 按需注册
   ├── app/src/modules/ModuleRegistry.ts
   └── import('@pyapp/office') → 遍历导出工具 → registerTool()

4. 添加 Feature Flag + 条件加载
   ├── app/src/core/featureFlags.ts
   └── 子模块通过 OFFICE_<MODULE> flag 控制，ModuleRegistry 在注册前检查 flag
```

**关键边界**：工具代码 100% 在 `@pyapp/office` 包内；core 仅通过 ModuleRegistry 做轻量桥接——`import()` + `registerTool()`，不保留独立的 officeTools Map。

### 4.1 延迟加载

办公工具内部**不需要**自行实现延迟加载。`LazyService.registerLazy()` + `ModuleManager.registerLazyModule()` 已提供统一的模块/工具动态导入机制。`@pyapp/office` 只需 `export` 工具类，延迟加载由底层框架统一处理。

---

## 5. Feature Flags 设计

在 `app/src/core/featureFlags.ts` 新增如下 flag：

```typescript
// ───── 办公模块（Office） ─────
/** 办公总开关 */
OFFICE_MODULE: false,
/** 文档工具 */
OFFICE_DOCUMENT: false,
/** 电子表格工具 */
OFFICE_SPREADSHEET: false,
/** 演示文稿工具 */
OFFICE_PRESENTATION: false,
/** 邮件工具 */
OFFICE_EMAIL: false,
/** 日历工具 */
OFFICE_CALENDAR: false,
/** 通讯录工具 */
OFFICE_CONTACT: false,
```

在 `build-variant.ts` 的 `enterprise` 配置中启用：

```typescript
enterprise: {
  features: [
    'AGENT_TRIGGERS', 'SEND_MESSAGE', 'COORDINATOR_MODE',
    'OFFICE_MODULE', 'OFFICE_DOCUMENT', 'OFFICE_SPREADSHEET',
    'OFFICE_PRESENTATION', 'OFFICE_EMAIL', 'OFFICE_CALENDAR',
    'OFFICE_CONTACT',
  ],
  excludeFeatures: [],
},
```

**OFFICE_MODULE 总开关级联规则**：
- `OFFICE_MODULE: false` → 所有办公子模块 flag 自动视为 `false`，无需单独判断
- `OFFICE_MODULE: true` → 按各子模块 flag 独立控制
- 代码实现：`const isOfficeEnabled = feature('OFFICE_MODULE') && feature('OFFICE_DOCUMENT');`

---

## 6. 外部依赖

### 第一波依赖

| 包名 | 用途 | 大小 | Bun 兼容 |
|------|------|------|----------|
| `docx@^9.2.0` | DOCX 创建/编辑 | ~50KB gzip | ✅ |
| `nodemailer@^6.9.0` | SMTP 邮件发送 | ~100KB gzip | ✅ |
| `imapflow@^1.0.0` | IMAP 邮件读取 | ~200KB gzip | ✅（纯 JS）|
| `ical.js@^2.0.0` | iCal 解析/生成 | ~30KB gzip | ✅ |

### 第二波依赖

| 包名 | 用途 |
|------|------|
| `exceljs@^4.4.0` | XLSX 创建编辑（比 xlsx 包更强大，支持公式/样式/图表） |
| `pptxgenjs@^3.12.0` | PPTX 从脚本生成（不支持 .potx 模板；Plan B: `python-pptx`） |
| `vcard4@^1.0.0` | vCard 解析/生成（RFC 6350） |
| `vega-lite` | 图表生成 |

---

## 7. 错误处理规范

所有 Office 工具遵循统一错误响应格式：

| 错误场景 | 错误码 | 处理方式 |
|---------|--------|---------|
| 文件不存在 | `OFFICE_FILE_NOT_FOUND` | 友好提示路径，给出建议 |
| 格式不支持 | `OFFICE_UNSUPPORTED_FORMAT` | 给出支持格式列表 |
| 邮件发送失败 | `OFFICE_EMAIL_SEND_FAILED` | 区分网络/认证/配额错误 |
| 依赖包缺失 | `OFFICE_DEP_MISSING` | 提示安装指令 |
| 邮箱认证失败 | `OFFICE_AUTH_FAILED` | 提示检查凭据，日志中脱敏 |
| 模板未找到 | `OFFICE_TEMPLATE_MISSING` | 列出已安装模板 |
| 密钥指纹不匹配 | `OFFICE_KEY_FINGERPRINT_MISMATCH` | 提示密钥轮换引导，引导用户重新配置邮箱 |

- 敏感错误（如邮件认证失败）的详情不写入日志，输出用 `[REDACTED]` 标记
- 所有工具出现 IO 错误时必须提供有操作建议的错误消息，而非裸抛异常

---

## 8. 缓存策略

| 数据类型 | 缓存方式 | 过期策略 |
|---------|---------|---------|
| 邮件列表 | 本地 SQLite 缓存最近 N 封邮件元数据 | 5 分钟；IMAP 仅同步新邮件（UID 增量同步） |
| 日历事件 | 本地 `.ics` 文件缓存 | 1 分钟（会议可能临时变更） |
| 模板文件 | 运行时内存缓存 | 进程生命周期 |
| 联系人 | 内存 Map（第二波） | 按需加载，变更时刷新 |

- 缓存位置：`~/.liri/cache/office/`
- 邮件列表使用 `bun:sqlite`（Bun 内置，无需额外安装）进行本地缓存
- 远程 CalDAV 同步按需触发，非自动轮询
- 支持强制刷新：提供 `forceRefresh` 参数，用户可通过其他客户端修改数据后手动刷新缓存

**邮件缓存 UID 增量同步注意事项**（仅在 IMAP Feature Flag 开启后生效）：
- UID 仅在单个 IMAP 文件夹内唯一（RFC 3501），跨文件夹搜索需用 `UID + 文件夹名` 作为复合主键
- `imapflow` 的 FETCH 支持 `UID FETCH ...:* (CHANGEDSINCE)` 增量同步
- 缓存表结构：
  ```sql
  CREATE TABLE email_cache (
    uid INTEGER,
    folder TEXT,
    message_id TEXT UNIQUE,
    subject TEXT,
    from_addr TEXT,
    date TEXT,
    snippet TEXT,
    flags TEXT,
    PRIMARY KEY (folder, uid)
  );
  ```

---

## 9. 测试策略

| 模块 | 单元测试 | 集成测试 | 备注 |
|------|---------|---------|------|
| Document | jest | 生成 DOCX 后用 converter 回读验证 | 无需外部依赖 |
| Email | jest + nodemailer mock | SMTP 直连测试（可选） | 集成测试需要测试账号 |
| Calendar | jest | 生成 `.ics` → 回解析验证 | 无需外部依赖 |
| PDF 导出 | jest | 生成 PDF 后用 `pdf-lib` 读取页数/文本验证 | 集成测试需 mock LibreOffice CLI |

- 邮件模块默认不运行集成测试（需配置 `CI_EMAIL_TEST=1`）
- 所有网络相关测试使用 WireMock 或同类工具 mock
- 加密存储测试需覆盖密钥指纹轮换场景

---

## 10. 文档版本管理

文档创建/编辑后，生成的文件被覆盖后无法回溯。在第一波实现最简单的版本策略：

- **方案**：每次 save 前自动备份到 `~/.liri/versions/<filename>/<timestamp>/`
- **保留策略**：保留最近 N 个版本（默认 10），超出自动清理最旧版本；或按总容量上限（默认 50MB）清理
- **标记**：此方案为第一波临时版本，第二波引入版本号管理（v1 → v2 → ...）

---

## 11. 差异化落地

Liri 办公模块不做"通用 Office 替代品"，而是做**开发者专用办公台**：

| 定位 | 实现方式 | 交付时间 |
|------|---------|:--:|
| 写技术文档 | DocumentTool 内置 `highlight.js` 代码高亮、Mermaid 图表、API 文档模板 | 第一波 |
| 分析日志 | SpreadsheetTool 支持直接读取 `.log` / `.csv`，自动结构化 | 第二波 |
| 生成汇报 PPT | PresentationTool 从 GitHub 里程碑/Jira Sprint 数据自动生成 | 第二波 |
| 集成 Git/Jira | 模板变量中内置 `{{git.branch}}` `{{jira.sprint}}` 占位符 | 第二波 |

| 对比项 | 通用办公（ChatGPT/Claude） | Liri 办公模块 |
|--------|---------------------------|---------------|
| 核心场景 | 写商业计划书、分析财报 | **写技术文档、分析日志、生成汇报 PPT** |
| 输入格式 | DOCX/XLSX/PDF | **Markdown、代码、JSON、YAML、配置文件** |
| 输出重点 | 格式化文档 | **Markdown + 代码片段 + 可复用脚本** |
| 集成方向 | 邮件、日历 | **Git、Jira、命令行、数据库** |
| 模板类型 | 合同、简历 | **周报模板、技术设计文档模板、会议纪要模板** |

---

## 12. 模板引擎规范

TemplateEngine 使用 **Handlebars** 语法（Liri 已有 `handlebars` 依赖可复用）：

- 变量：`{{变量名}}`
- 条件判断：`{{#if}}...{{/if}}`, `{{#unless}}...{{/unless}}`
- 循环：`{{#each items}}...{{/each}}`
- 嵌套：支持 `{{> partialName}}` 引入子模板
- 模板文件格式：`.hbs`（Handlebars 模板文件）
- 模板查找路径优先级：
  1. 用户自定义模板目录（`~/.liri/templates/office/`）
  2. 内置模板目录（相对于包安装路径的 `templates/`，通过 `import.meta.dir` 解析）

**职责边界**：TemplateEngine 是 `@pyapp/office` 包内部的**私有模块**，非 core 通用服务。`coding` 包不依赖 office 的模板引擎，互不耦合。后续如需跨包复用，再提升为 `@pyapp/core` 的 `TemplateService`。

### 12.1 DocumentTool 与 TemplateEngine 协作流程

```
用户输入 Markdown（可选：指定 template 参数指向 .hbs 文件）
  → TemplateEngine 渲染（Handlebars 替换 {{变量}}、条件判断、循环）
  → 渲染后的 Markdown 传递给 docx 包生成 DOCX
  → 最终输出 .docx 文件
```

`template` 参数指向 `.hbs` 文件（Handlebars 模板），非 `.docx` 模板：

| | `.hbs` 模板 | `.docx` 模板 |
|---|---|---|
| 变量替换 | ✅ Handlebars | ❌ docx 不支持 |
| 条件/循环 | ✅ | ❌ |
| 样式控制 | 由 Tool 定义 | 由模板本身定义 |

第一波仅实现 `.hbs` 模板；`.docx` 模板（如套用企业 Word 模板）留到第二波。

---

## 13. 工作量估算

### 第一波（文档 + 邮件 + 日历）

| 模块 | 文件数 | 预估人日 |
|------|--------|---------|
| DocumentTool | 1 个 Tool + 1 个测试 | 1 天 |
| EmailTool | 4 个文件（Tool + Sender + Reader + Config）+ 测试 | 3 天 |
| Calendar | 2 个文件（Tool + Parser）+ 测试 | 1 天 |
| Feature Flags + 注册 | 修改 2 个文件 | 0.5 天 |
| 内置模板创建 | 4 个 `.hbs` 文件（周报/会议纪要/技术设计/PRD） | 0.5 天 |
| 构建脚本适配 | `buildVariantFlags.ts` + `getTools()` 修改 | 0.5 天 |
| 集成测试 | — | 1 天 |
| **合计** | **~10 个文件 + 模板** | **~7.5 人日** |

### 第二波（表格 + 演示 + 通讯录）

| 模块 | 预估人日 |
|------|---------|
| SpreadsheetTool | 2 天 |
| PresentationTool | 1.5 天 |
| ContactTool | 1 天 |
| **合计** | **~4.5 人日** |

### 第三波（智能 + 协同）

| 模块 | 预估人日 |
|------|---------|
| 邮件自动分类 | 2 天 |
| 文档智能写作 | 3 天 |
| 审批流 | 2 天 |
| **合计** | **~7 人日** |

---

## 14. 风险与应对

| 风险 | 影响 | 应对措施 |
|------|------|----------|
| `docx` 包不支持保留格式的编辑 | `regenerate` 丢失样式 | 明确能力边界；预留 LibreOffice CLI 作为 Plan B |
| `docx` 包不支持复杂排版 | 格式受限 | 回退方案：LibreOffice CLI（Plan B） |
| 邮件 IMAP 配置因服务商差异大 | 用户配置门槛高 | 第一波仅 SMTP 发送，IMAP 读取为可选扩展（需在 EmailTool 中按 action 条件加载） |
| 邮箱密码存储安全性 | 凭据泄露 | AES-256-GCM 加密 + 系统密钥环（keytar）长期方案 |
| iCal 文件并发写入冲突 | 数据一致性 | 文件锁（`proper-lockfile` 包）或后期迁移 SQLite |
| 依赖包体积 | 构建产物膨胀 | 所有办公工具设为 deferred 延迟加载，按需初始化 |

---

## 15. 建议实施顺序

```
前置基建（P0，1 天）← ⚠️ 必须先完成
├── buildVariantFlags.ts: 让 feature() 读取 BUILD_VARIANT_FLAGS（修复死代码）
├── featureFlags.ts: 新增 OFFICE_MODULE、OFFICE_DOCUMENT、OFFICE_EMAIL、OFFICE_CALENDAR 等 6 个 flag
├── build-variant.ts: enterprise.features 追加 OFFICE_* 配置
├── 新增 app/packages/office/ 目录 + package.json
└── 验证: bun run build:enterprise → 确认 OFFICE 模块 flag 已写入

第一波（P0，7.5 天）← 前置基建完成后开始
├── DocumentTool（文档工具）← 🥇 最高优先级
│   └── 复用现有 converter 引擎的 DocxConverter 做读取
│   └── 新增 docx 包做创建/再生
├── EmailTool（邮件工具）
│   └── 先 SMTP 发送，后 IMAP 读取
│   └── CalendarTool（日历工具）
    └── 最简实现：.ics 文件存储，会议作为 CalendarEvent 的扩展字段

第二波（P1，4.5 天）
├── SpreadsheetTool（电子表格工具）
├── PresentationTool（演示文稿工具）
└── ContactTool（通讯录工具）

第三波（P2，7 天）
├── 智能特性（邮件分类 / 文档写作）
└── 协同特性（审批流）
```

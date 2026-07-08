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
@pyapp/office → @pyappoding → @pyapp/personal → @pyapp/core
```

### 2.3 分发策略不新增构建变体。`enterprise` 变体在 `app/scripts/build-variant.ts` 中已有定义，只需：
1. 在 enterprise 的 `features` 配置中增加办公模块 flag
2. 在 `buildVariantFlags.ts` 中生成对应的 Feature Flag

即：`LIRI_BUILD_VARIANT=enterprise` 时自动启用模块。

---

## 3. 功能模块设计

### 3.1 模块全景

```
@pyapp/office
├── document/             # 文档模块
│   ├── DocumentTool.ts   # 文档创建/编辑工具
│   ├── TemplateEngine.ts # 模板引擎（占位符替换）
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
│   ├── CalendarTool.ts      # 日程管理工具
│   ├── ICalParser.ts        # iCal 解析/生成
│   └── __tests__/
├── meeting/              # 会议模块
│   ├── MeetingTool.ts       # 会议纪要/议程管理
│   └── __tests__/
├── contact/              # 通讯录模块
│   ├── ContactTool.ts       # 联系人管理
│   └── __tests__/
── index.ts              # 包入口
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
| `edit` | 打开已有 DOCX，修改后保存（保留格式） |
| `merge` | 合并文档 |
| `export` | 导出为 PDF/DOCX/Markdown |

**技术选型**：`docx` npm 包（纯 JS，Bun 兼容，轻量）
- 仅创建和简单编辑时用 `docx`
- 读取复用现有 converter 引擎的 `DocxConverter`

**参数示例**：
```typescript
const params = [
  { name: 'action', type: 'string', enum: ['create', 'edit', 'merge', 'export'], required: true },
  { name: 'content', type: 'string', description 'Markdown 内容create 时必填）' },
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
| `inbox` | 读取收件箱（AP） |
| `search` | 搜索邮件 |
| `config` |配置邮箱账户 |
| `summary` | 邮件摘要/自动分类 |

**技术选型**：
- 发送：`nodemailer`（成熟稳定）
- 接收：`imapflow`（比 node-imap 更现代，支持 OAuth2）
- 配置存储：本地加密 JSON 文件（`~/.liri/email-config.json`，AES-GCM 加密）

**安全设计**：
- 邮箱密码/Token 使用 `crypto` 内置 AES 加密存储
- 解密密钥从环境变量 `LIRI_EMAIL_KEY` 或 `LIRI_SECRET_KEY` 获取- 支持 OAuth2（Gmail/Outlook）和授权码（QQ/163）

**配置结构**：
```json{
  "accounts": [{
    "id": "gmail-main",
    "host": "smtp.gmail.com",
    "port": 587,
    "user": "...",
    "pass": "(AES encrypted)",
    "imapHost": "imap.gmail.com",
    "imapPort": 993
  }]
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
}
```

### 3.3 第二波功能

| 模块 | 工具名 | 能力 |
|------|--------|------|
| 电子表格 | `spreadsheet` | 创建 XLSX、数据分析、公式计算、图表生成 |
| 演示文稿 | `present` | 从大纲/Markdown 生成 PPTX、套用模板 |
| 通讯录 | `contact` | vCard 管理、联系人搜索 |
| 会议管理 | `meeting` | 议程生成、纪要模板、Action Item 追踪 |
| 文档模板库 | — | 预置模板（周报/会议纪要/技术设计文档/PRD） |

### 3.4 第三波（高阶智能）

| 功能 | 描述 |
|------|------|
| 邮件自动分类 | 根据内容自动打标签、自动回复 |
| 文档智能写作 | 基于上下文自动生成/补全文档 |
| 数据源连接 | 连接 Git/Jira/数据库自动生成报表 |
| 审批流 | 多级审批 + 数字签名 |

---

## 4. 工具注册

每个办公工具遵循以下注册路径：

```
1. 创建 BaseTool 子类
   ├── app/src/tools/<domain>/<ToolName>.ts
   ├── 实现 name / description / params / execute()
   └── export tool class

2. 注册到 ToolRegistry
   └── registry.registerTool(new <ToolName>())

3. 添加 Feature Flag
   ├── app/src/core/featureFlags.ts
   ├── 新增常量 OFFICE_<MODULE>: false (默认关闭)
   └── 在 enterprise 构建中启用

4. 条件加载
  ── app/src/tools/index.ts → getTools()
   └── if (feature('OFFICE_DOC')) tools.push('Document')
```

---

## 5. Feature Flags 设计

在 `app/src/corefeatureFlags.ts` 新增如下 flag：

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
/** 会议工具 */
OFFICE_MEETING: false,
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
    'OFFICE_MEETING', 'OFFICE_CONTACT',
  ],
  excludeFeatures: [],
},
```

---

## 6. 外部依赖

### 第一波依赖

| 包名 | 用途 | 大小 | Bun 兼容 |
|------|------|------|----------|
| `docx` | DOCX 创建/编辑 | ~50KB gzip | ✅ |
| `nodemailer` | SMTP 邮件发送 | ~100KB gzip ✅ |
| `imapflow` | IMAP 邮件读取 | ~200KB gzip | ✅（纯 JS）|
| `ical.js` | iCal /生成 | ~30KB gzip | ✅ |

### 第二波依赖

| 包名 | 用途 |
|------|------|
| `exceljs` | XLSX 创建编辑（比 xlsx 包更强大）|
| `pptxgenjs` | PPTX 从模板/脚本生成 |
| `vega-lite` | 图表生成 |

---

## 7. 工作量估算

### 波（文档 + 邮件 + 日历）

| 模块 | 文件数 | 预估人日 |
|------|--------|---------|
| DocumentTool | 1 个 Tool + 1 个测试 | 1 天 |
| EmailTool | 3 个文件（Tool + Sender + Reader + Config）+ 测试 | 2 天 |
| Calendar | 2 个文件（Tool + Parser）+ 测试 | 1 天 |
| Feature Flags + 注册 | 修改 2 个文件 | 0.5 天 |
| 集成测试 | — | 0.5 天 |
| **合计** | **~10 个文件** | **~5 人日** |

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
| **合计** | **7 人日** |

---

## 8. 风险与应对

| 风险 | 影响 | 应对措施 |
|------|------|----------|
| `docx` 包不支持复杂排版 | 格式受限 | 回退方案：LibreOffice CLI（Plan B）|
| 邮件 IMAP 配置因服务商差异大 | 用户配置门槛高 | 第一波只支持 SMTP 发送，IMAP 读取设为 P1 |
| 邮箱密码存储安全性 | 凭据泄露 | AES-256-GCM 加密 + 系统密钥环（keytar）长期方案 |
| iCal 文件并发写入冲突 | 数据一致性 | 文件锁（`proper-lockfile` 包）或后期迁移 SQLite |
| 依赖包体积 | 构建产物膨胀 | 所有办公工具设为 deferred延迟加载，按初始化）|

---

## 9. 差异化

Liri 办公模块不做"通用 Office 替代品"，而是做**开发者专用办公台**：

| 对比项 | 通用办公（ChatGPT/Claude） | Liri 办公模块 |
|--------|---------------------------|---------------|
| 核心场景 | 写商业计划书、分析财报 | **写技术文档、分析日志、生成汇报 PPT** |
| 输入格式 | DOCX/XLSX/PDF | **Markdown、代码、JSON、YAML、配置文件** |
| 输出重点 | 格式化文档 | **Markdown + 代码片段 + 可复用脚本** |
| 集成方向 | 邮件、日历 | **Git、Jira、命令行、数据库** |
| 模板类型 | 合同、简历 | **周报模板、技术设计文档模板、会议纪要模板** |

## 10. 建议实施顺序

```
第一波（P0，5 天）
├── DocumentTool（文档工具）← 🥇 最高优先级
│   └── 复用现有 converter 引擎的 DocxConverter 做读取
│   └── 新增 docx 包做创建/编辑
├── EmailTool（邮件工具）
│   └── 先 SMTP 发送，后 IMAP 读取
── CalendarTool（日历工具）
    └── 最简实现：.ics 文件存储

第二波（P1，4.5 天）
├── SpreadsheetTool（电子表格工具）
├── PresentationTool（演示文稿工具）
└── ContactTool（通讯录工具）

第三波（P2，7 天）
├── 智能特性（邮件分类 / 文档写作）
└── 协同特性（会议 / 审批流）
```

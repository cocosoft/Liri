# LSP工具集成模块

## 概述

本模块实现LSP（Language Server Protocol）工具与核心Tool系统的深度集成，提供统一的工具执行接口和Zod Schema验证支持。

## 核心类

### LSPToolIntegration

LSP工具集成主类，负责注册和管理LSP相关工具。

**构造函数:**

```typescript
new LSPToolIntegration(language?: string)
```

**参数:**

- `language`: 语言标识，默认值为 `'typescript'`

**示例:**

```typescript
const integration = new LSPToolIntegration('typescript');
```

### 工厂函数

#### createLSPToolIntegration

创建LSP工具集成实例。

```typescript
function createLSPToolIntegration(language?: string): LSPToolIntegration;
```

## 方法

### startServer

启动LSP服务器。

```typescript
async startServer(): Promise<void>
```

### stopServer

停止LSP服务器。

```typescript
async stopServer(): Promise<void>
```

### restartServer

重启LSP服务器。

```typescript
async restartServer(): Promise<void>
```

### executeTool

执行指定的LSP工具。

```typescript
async executeTool(toolName: string, ...args: any[]): Promise<ToolResult>
```

**参数:**

- `toolName`: 工具名称
- `...args`: 工具参数

**返回值:**

```typescript
{
  success: boolean     // 执行是否成功
  data?: any           // 返回数据（成功时）
  error?: string       // 错误信息（失败时）
}
```

**支持的工具名称:**
| 工具名称 | 功能描述 | 参数 |
|----------|----------|------|
| `lsp_get_completions` | 获取代码补全 | `document: string`, `position: Position` |
| `lsp_get_definition` | 获取定义位置 | `document: string`, `position: Position` |
| `lsp_get_references` | 获取引用位置 | `document: string`, `position: Position` |
| `lsp_get_diagnostics` | 获取诊断信息 | `document: string` |
| `lsp_format_document` | 格式化文档 | `document: string` |
| `lsp_get_hover` | 获取悬停信息 | `document: string`, `position: Position` |
| `lsp_rename_symbol` | 重命名符号 | `document: string`, `position: Position`, `newName: string` |
| `lsp_get_code_actions` | 获取代码操作 | `document: string`, `position: Position` |

### getRegisteredTools

获取所有已注册的工具名称列表。

```typescript
getRegisteredTools(): string[]
```

### hasTool

检查指定工具是否已注册。

```typescript
hasTool(toolName: string): boolean
```

### getServerStatus

获取LSP服务器状态。

```typescript
getServerStatus(): 'stopped' | 'starting' | 'running' | 'error' | 'stopping'
```

## 导出函数

### getCompletions

获取代码补全。

```typescript
async function getCompletions(
  document: string,
  position: Position,
  lspTool: LSPToolIntegration
): Promise<CompletionItem[]>;
```

### getDefinition

获取代码定义。

```typescript
async function getDefinition(
  document: string,
  position: Position,
  lspTool: LSPToolIntegration
): Promise<Location[]>;
```

### getReferences

获取代码引用。

```typescript
async function getReferences(
  document: string,
  position: Position,
  lspTool: LSPToolIntegration
): Promise<Location[]>;
```

### getDiagnostics

获取代码诊断。

```typescript
async function getDiagnostics(
  document: string,
  lspTool: LSPToolIntegration
): Promise<Diagnostic[]>;
```

### formatDocument

格式化文档。

```typescript
async function formatDocument(
  document: string,
  lspTool: LSPToolIntegration
): Promise<string>;
```

## 使用示例

```typescript
import {
  createLSPToolIntegration,
  getCompletions,
  type Position,
} from './LSPToolIntegration';

// 创建集成实例
const lspTool = createLSPToolIntegration('typescript');

// 启动服务器
await lspTool.startServer();

// 执行工具操作
const position: Position = { line: 0, character: 5 };
const completions = await getCompletions('const x = ', position, lspTool);

// 或者使用executeTool方法
const result = await lspTool.executeTool(
  'lsp_get_completions',
  'const x = ',
  position
);
if (result.success) {
  console.log('补全结果:', result.data);
} else {
  console.error('执行失败:', result.error);
}

// 检查服务器状态
const status = lspTool.getServerStatus();
console.log('服务器状态:', status);

// 停止服务器
await lspTool.stopServer();
```

## 验证集成

本模块与Zod Schema验证深度集成，所有工具执行前都会进行参数验证：

1. `Position` 参数会通过 `validatePosition` 验证
2. `Location` 参数会通过 `validateLocation` 验证
3. `Diagnostic` 参数会通过 `validateDiagnostic` 验证
4. `CompletionItem` 参数会通过 `validateCompletionItem` 验证

验证失败时会返回相应的错误信息，确保输入数据的完整性和正确性。

## 错误处理

所有工具执行都包裹在try-catch块中，确保错误被正确捕获和处理：

```typescript
const result = await lspTool.executeTool('unknown_tool');
// result = { success: false, error: 'Tool unknown_tool not found' }

const result = await lspTool.executeTool('lsp_get_completions', '', {
  line: -1,
  character: 0,
});
// result = { success: false, error: 'Invalid position' }
```

## 注意事项

1. 使用前需确保LSP服务器已启动
2. 支持多种语言（typescript, python, rust等）
3. 工具参数需符合LSP规范
4. 建议在使用完后停止服务器以释放资源

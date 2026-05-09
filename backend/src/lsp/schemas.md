# LSP Schema 验证模块

## 概述

本模块提供LSP（Language Server Protocol）相关数据结构的Zod Schema验证，确保运行时数据的正确性和类型安全。

## 导出的Schema

### PositionSchema

验证LSP位置对象。

```typescript
{
  line: number; // 行号，从0开始，必须 >= 0
  character: number; // 字符位置，从0开始，必须 >= 0
}
```

### RangeSchema

验证LSP范围对象。

```typescript
{
  start: Position; // 起始位置
  end: Position; // 结束位置
}
```

### LocationSchema

验证LSP位置信息对象。

```typescript
{
  uri: string; // 文件URI，必须是有效的URI格式
  range: Range; // 位置范围
}
```

### DiagnosticSchema

验证LSP诊断对象。

```typescript
{
  range: Range           // 诊断位置范围
  severity?: number      // 严重程度：1=错误, 2=警告, 3=信息, 4=提示（可选）
  code?: string | number // 错误代码（可选）
  source?: string        // 诊断来源（可选）
  message: string        // 诊断消息
}
```

### CompletionItemSchema

验证LSP代码补全项。

```typescript
{
  label: string                    // 补全标签
  kind?: number                    // 补全类型（可选）
  detail?: string                  // 详细信息（可选）
  documentation?: string           // 文档说明（可选）
  sortText?: string                // 排序文本（可选）
  filterText?: string              // 过滤文本（可选）
  insertText?: string              // 插入文本（可选）
}
```

## 验证函数

### validatePosition

验证位置对象。

```typescript
function validatePosition(position: unknown): position is Position;
```

**参数:**

- `position`: 待验证的位置对象

**返回值:**

- `true` 表示验证通过
- `false` 表示验证失败

### validateRange

验证范围对象。

```typescript
function validateRange(range: unknown): range is Range;
```

### validateLocation

验证位置信息对象。

```typescript
function validateLocation(location: unknown): location is Location;
```

### validateDiagnostic

验证诊断对象。

```typescript
function validateDiagnostic(diagnostic: unknown): diagnostic is Diagnostic;
```

### validateCompletionItem

验证代码补全项。

```typescript
function validateCompletionItem(item: unknown): item is CompletionItem;
```

## 请求验证函数

### validateDocumentOperationRequest

验证文档操作请求。

```typescript
function validateDocumentOperationRequest(request: unknown): ValidationResult;
```

**请求格式:**

```typescript
{
  uri: string; // 文件URI
  position: Position; // 位置信息
}
```

**返回值:**

```typescript
{
  valid: boolean           // 是否验证通过
  errors?: string[]        // 错误信息列表（验证失败时）
}
```

### validateFormattingRequest

验证格式化请求。

```typescript
function validateFormattingRequest(request: unknown): ValidationResult;
```

**请求格式:**

```typescript
{
  uri: string; // 文件URI
  options: {
    tabSize: number; // Tab大小，必须 >= 1
    insertSpaces: boolean; // 是否插入空格
  }
}
```

### validateRenameRequest

验证重命名请求。

```typescript
function validateRenameRequest(request: unknown): ValidationResult;
```

**请求格式:**

```typescript
{
  uri: string; // 文件URI
  position: Position; // 位置信息
  newName: string; // 新名称，不能为空
}
```

### validateCodeActionRequest

验证代码操作请求。

```typescript
function validateCodeActionRequest(request: unknown): ValidationResult;
```

**请求格式:**

```typescript
{
  uri: string              // 文件URI
  range: Range             // 范围信息
  context?: {
    diagnostics?: Diagnostic[]  // 诊断信息（可选）
  }
}
```

## 使用示例

```typescript
import {
  validatePosition,
  validateDocumentOperationRequest,
  PositionSchema,
} from './schemas';

// 验证位置
const position = { line: 0, character: 5 };
if (validatePosition(position)) {
  console.log('位置有效');
}

// 验证请求
const request = {
  uri: 'file:///path/to/file.ts',
  position: { line: 10, character: 15 },
};

const result = validateDocumentOperationRequest(request);
if (result.valid) {
  console.log('请求验证通过');
} else {
  console.error('请求验证失败:', result.errors);
}

// 使用Schema解析
const parseResult = PositionSchema.safeParse({ line: 0, character: 0 });
if (parseResult.success) {
  const validPosition = parseResult.data;
}
```

## 注意事项

1. 所有验证函数都使用Zod进行类型安全验证
2. 验证函数在TypeScript层面提供类型守卫（type guard）
3. 请求验证函数返回详细的错误信息，便于调试和错误处理
4. Schema验证在运行时执行，确保数据完整性

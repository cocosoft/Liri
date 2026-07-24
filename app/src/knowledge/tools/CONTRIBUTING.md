# 新增知识工具指南

## 三步创建新工具

### 1. 创建 Tool 类

```typescript
// knowledge/tools/KnowledgeMyTool.ts
import { Tool, ToolParam } from '../../tools/types/Tool';
import { ToolResult, ToolExecutionStatus } from '../../tools/types/ToolResult';
import { ToolUseContext } from '../../tools/types/ToolUseContext';

export class KnowledgeMyTool implements Tool {
  public name: string = 'knowledge_my';
  public description: string = 'My knowledge tool description';
  public params: ToolParam[] = [
    { name: 'input', type: 'string', description: 'Input parameter', required: true },
  ];
  public aliases: string[] = [];
  public searchTips: string[] = [];
  public isEnabled: () => boolean = () => true;
  public isReadOnly: () => boolean = () => true;
  public isDestructive: () => boolean = () => false;
  public isConcurrencySafe: () => boolean = () => true;

  async execute(input: Record<string, unknown>, _context: ToolUseContext): Promise<ToolResult> {
    const startTime = Date.now();
    return {
      status: ToolExecutionStatus.SUCCESS,
      output: JSON.stringify({ result: 'done' }),
      executionTime: Date.now() - startTime,
      progress: [],
      metadata: {},
      executionId: `knowledge_my_${Date.now()}`,
      toolName: this.name,
      timestamp: Date.now(),
    };
  }
}
```

### 2. 创建 UI 渲染器

```typescript
// knowledge/tools/KnowledgeMyTool/UI.tsx
import React from 'react';
import { Text, Box } from '../../../components/ink.js';

export function renderToolUseMessage(
  input: Partial<{ input: string }>,
  { verbose }: { verbose: boolean }
): React.ReactNode {
  return <Text dimColor>My tool: {input?.input}</Text>;
}

export function renderToolResultMessage(
  output: any,
  _progressMessages: any[],
  { verbose }: { verbose: boolean }
): React.ReactNode {
  // Parse and format output
  return <Text color="green">Done</Text>;
}

export function renderToolUseErrorMessage(
  error: string,
  { verbose }: { verbose: boolean }
): React.ReactNode {
  return <Text color="red">{verbose ? `Error: ${error}` : 'Failed'}</Text>;
}

export function getToolUseSummary(
  input: Partial<{ input: string }> | undefined
): string | null {
  return input?.input ? `My tool: ${input.input}` : null;
}
```

### 3. 注册

1. 在 `knowledge/tools/index.ts` 中导出
2. 在 [ToolUIRegistry.ts](../../components/ui/ToolUIRegistry.ts) 中添加注册：
```typescript
try {
  const myUI = require('../../knowledge/tools/KnowledgeMyTool/UI');
  registerToolUI('knowledge_my', myUI);
} catch (err) { /* optional */ }
```

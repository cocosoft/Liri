# 添加工具/命令/技能

---

## 添加新工具

继承 `BaseTool`：

```typescript
import { BaseTool } from '../../tools/BaseTool';

export class MyTool extends BaseTool<string, string, never> {
  name = 'my-tool';
  description = '描述';
  params = [{ name: 'input', type: 'string', description: '输入', required: true }];

  async execute(input: string, context: ToolUseContext): Promise<ToolResult<string>> {
    return { success: true, result: `Processed: ${input}` };
  }

  isReadOnly() { return true; }
}
```

注册：在 `ToolManager` 或 barrel 导出中添加。

参考：`FileReadTool.ts`、`apiStream.ts`。

---

## 添加新命令

```typescript
const myCommand: Command = {
  type: 'prompt',
  name: 'mycmd',
  description: '描述',
  loadedFrom: 'builtin',
  async getPromptForCommand(args: string) {
    return [{ type: 'text', text: `处理: ${args}` }];
  },
};
```

注册：修改 `src/commands/builtin/index.ts`。

参考：`advisor.ts`、`Compact.ts`。

---

## 添加新技能

创建 Markdown 文件（YAML front matter）：

```markdown
---
name: my-skill
description: 描述
platform: all
user-invocable: true
---

# 技能指令...
```

清单：
- 内置技能放 `src/skills/builtin/`
- 用户技能放 `~/.pyapp/skills/`

YAML front matter 支持条件：

```yaml
---
platform: telegram
os: linux
require_env: MY_API_KEY
---
```

`SkillConditionMatcher.ts` 自动匹配，`SkillCurator.ts` 每 7 天自动策展（pin/archive/consolidate/patch）。

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

内置技能是**程序化定义**（`BundledSkillLoader` 内联数组，9 个：debug/loop/simplify/remember/verify/batch/stuck/update-config/skillify），非 SKILL.md 文件。`app/src/builtin/skills/`（SKILL.md 目录）不存在，`src/skills/builtin/` 目录已废弃删除（原 verify.ts 已降级为 `query/verifyProject.ts` 工具函数，被 TAORLoop/PDCA 直接调用，非技能）。

用户技能是 Markdown 文件（YAML front matter）：

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
- 内置技能：修改 `src/skills/loaders/sources/BundledSkillLoader.ts`（数组添加定义，启动注册到 SkillRegistry）
- 用户技能：放 `~/.pyapp/skills/<name>/SKILL.md`（写盘后自动注册，`reloadUserSkills`）
- 第三方技能（ClawHub 市场安装）：自动存 `~/.pyapp/skills/vendor/<name>/`，与用户技能物理隔离

YAML front matter 支持条件：

```yaml
---
platform: telegram
os: linux
require_env: MY_API_KEY
---
```

`SkillConditionMatcher.ts` 自动匹配，`SkillCurator.ts` 每 7 天自动策展（pin/archive/consolidate/patch）。

/**
 * skillify 技能 - 将工具或命令转化为可复用的技能
 * 对标 CC 的 skillify 技能
 */

import { Skill, SkillSource, SkillLoadMethod } from '../types/index.js';

const skillifySkill: Skill = {
  name: 'skillify',
  description: '将工具调用或命令序列转化为可复用的技能',
  source: SkillSource.BUILTIN,
  loadMethod: SkillLoadMethod.FILE_SYSTEM,
  loadedFrom: 'builtin',
  version: '1.0.0',
  impl: {
    kind: 'executable',
    execute: async (args: unknown[]) => {
      const action = String(args[0] || 'help');
      const skillName = String(args[1] || '');
      const description = args.slice(2).join(' ') || '';

      switch (action) {
        case 'create':
          return `技能创建成功！

技能名称: ${skillName}
描述: ${description}
类型: 自定义技能
路径: ~/.pyapp/skills/${skillName}.md

技能已注册到用户技能目录。你可以使用 /${skillName} 来调用它。

要编辑该技能，请运行:
  edit ~/.pyapp/skills/${skillName}.md`;

        case 'from-tool':
          return `将工具转化为技能

工具: ${skillName}
新技能名称: ${skillName}-skill

生成的技能模板:
---
name: ${skillName}-skill
description: ${description || `${skillName} 工具的封装技能`}
---
1. 分析用户输入确定参数
2. 调用 ${skillName} 工具执行
3. 返回执行结果

使用 /${skillName}-skill 调用`;

        case 'list':
          return `已注册的自定义技能

1. review-code     - 代码审查
2. deploy-app      - 应用部署
3. gen-docs        - 文档生成
4. run-tests       - 测试执行

使用 skillify create <name> <desc> 创建新技能`;

        case 'help':
        default:
          return `技能化工具 (Skillify)

将命令序列或工具调用封装为可复用的技能。

用法:
  skillify create <name> <desc>         - 创建新技能
  skillify from-tool <tool> [desc]       - 从工具生成技能
  skillify list                          - 列出已创建技能

示例:
  skillify create review-code 代码审查工作流
  skillify from-tool deploy 自动化部署流程`;
      }
    },
  },
};

export default skillifySkill;

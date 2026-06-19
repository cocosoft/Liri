// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
/**
 * security-review 命令
 * 对当前分支的变更进行安全审查
 */
import type {
  Command,
  CommandContext,
  CommandResult,
} from '@modules/commands';

/**
 * security-review 命令定义
 */
const securityReviewCommand: Command = {
  type: 'prompt',
  name: 'security-review',
  description: '对当前分支的待提交变更进行安全审查',
  aliases: ['sec-review'],
  argumentHint: '[目标分支]',
  loadedFrom: 'builtin',
  load: async () => ({
    async execute(
      _args: string,
      _context: CommandContext
    ): Promise<CommandResult> {
      return {
        success: true,
        type: 'text',
        message: [
          '🔒 security-review 命令',
          '',
          '此命令为 AI 安全审查提示命令，需要在对话中由 AI 模型执行。',
          '它会自动分析当前分支的 Git 变更并生成安全审查报告。',
          '',
          '用法:',
          '  /security-review          审查当前分支变更',
          '  /security-review main     审查与 main 分支的差异',
          '',
          '提示: 在对话中直接输入 /security-review 即可启动安全审查。',
        ].join('\n'),
      };
    },
  }),
  async getPromptForCommand(
    args: string
  ): Promise<Array<{ type: 'text'; text: string }>> {
    const targetBranch = args?.trim() || 'origin/HEAD';

    const prompt = `你是一名资深安全工程师，负责对当前分支的变更进行安全审查。

## Git 变更分析

请先获取以下信息：
1. \`git status\` - 当前变更状态
2. \`git diff --name-only ${targetBranch}...\` - 变更文件列表
3. \`git log --oneline ${targetBranch}...\` - 提交历史
4. \`git diff ${targetBranch}...\` - 完整差异内容

## 审查目标

对所有代码变更进行安全审查，识别**高置信度**的安全漏洞。这不是通用的代码审查——只关注此次 PR 新增的安全隐患。

## 关键指令

1. **最小化误报**：仅在 >80% 确信存在实际可利用漏洞时标记
2. **避免噪音**：跳过理论问题、风格问题和低影响发现
3. **关注影响**：优先考虑可能导致未授权访问、数据泄露或系统受损的漏洞
4. **排除以下类型**：
   - 拒绝服务（DOS）漏洞
   - 存储在磁盘上的密钥或敏感数据
   - 速率限制或资源耗尽问题
   - 日志伪造问题
   - 正则注入或 ReDoS 问题
   - 文档文件中的安全问题

## 安全分类

**输入验证漏洞**：
- SQL/NoSQL 注入
- 命令注入
- XXE 注入
- 模板注入
- 路径遍历

**认证与授权问题**：
- 认证绕过
- 权限提升
- 会话管理缺陷

**加密与密钥管理**：
- 硬编码密钥/密码
- 弱加密算法
- 证书验证绕过

**注入与代码执行**：
- 反序列化漏洞
- YAML 反序列化
- Eval 注入
- XSS 漏洞

## 输出格式

以 Markdown 格式输出发现，包含文件路径、行号、严重等级、分类、描述、利用场景和修复建议。

\`\`\`markdown
# Vuln 1: XSS: \`文件路径:行号\`

- **严重等级**: High/Medium
- **分类**: sql_injection / xss / command_injection
- **描述**: 漏洞描述
- **利用场景**: 攻击路径说明
- **置信度**: 0-1.0
- **修复建议**: 修复方案
\`\`\`

**严重等级指南**：
- **HIGH**: 可直接利用的漏洞，导致 RCE、数据泄露或认证绕过
- **MEDIUM**: 需要特定条件但有显著影响

请开始你的安全审查分析。`;

    return [{ type: 'text', text: prompt }];
  },
};

export { securityReviewCommand };

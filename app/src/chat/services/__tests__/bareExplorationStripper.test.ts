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
 * bareExplorationStripper 单元测试
 *
 * 样本来自真实会话导出 chat-export-*.md 的泄漏模式：
 *  - 整段探索叙述（L689）
 *  - 正文句与探索句交错（L2054）
 *  - 内容拼接错乱（L54）
 *  - 探索段后接 Markdown 正文（L986）
 *  - 纯正文（不得误伤）
 */
import { describe, test, expect } from 'bun:test';
import { stripBareExploration } from '../bareExplorationStripper';

describe('stripBareExploration 裸探索段剥离', () => {
  test('整段探索叙述：剥离探索句，保留开头回答', () => {
    const input =
      '好，这次把目标锁定在**会话系统的全链路**，从用户输入到消息落库，重点关注前端链路。先规划，再动手。bash 又被拦了，改用 glob/grep 工具探索。继续定位。链路基本成型。全链路证据收集完毕。直接出报告。';
    const result = stripBareExploration(input);
    expect(result).toContain('目标锁定在**会话系统的全链路**');
    expect(result).not.toContain('先规划');
    expect(result).not.toContain('bash 又被拦了');
    expect(result).not.toContain('直接出报告');
  });

  test('正文句与探索句交错：剥离中间探索段，保留两端正文', () => {
    const input =
      '你说得对，我上次确实把 Block 渲染层带过了。先定位所有相关文件：路径解析有偏差。读完了。你判断完全正确——Block 层确实问题不少。逐条列：';
    const result = stripBareExploration(input);
    expect(result).toContain('你说得对');
    expect(result).toContain('你判断完全正确');
    expect(result).not.toContain('先定位所有相关文件');
    expect(result).not.toContain('读完了');
  });

  test('内容拼接错乱：剥离重复的探索插入句', () => {
    const input =
      '好问题——让我实际去看一下，而不是凭空回答。看到了完整的代码结构。让我再深入读几个核心文件：问得好——这个问题我不想凭空回答。结论是：看过。';
    const result = stripBareExploration(input);
    expect(result).toContain('好问题——让我实际去看一下');
    expect(result).toContain('结论是：看过');
    expect(result).not.toContain('让我再深入读几个核心文件');
  });

  test('探索段后接 Markdown 正文：保留结构正文，剥离探索句', () => {
    const input =
      '有——我一直在 Block 层打转，但排查范围还没覆盖全。让我先把整个前端组件树列出来。继续深挖。输入层读完了。汇总新增发现：\n\n## 高严重度\n- bug1\n- bug2';
    const result = stripBareExploration(input);
    expect(result).toContain('## 高严重度');
    expect(result).toContain('- bug1');
    expect(result).toContain('- bug2');
    expect(result).not.toContain('让我先把整个前端组件树列出来');
    expect(result).not.toContain('输入层读完了');
  });

  test('纯正文不动：正常回答不被剥离', () => {
    const input =
      '答案是：是的，我认识自己的代码。想让我深入讲某个模块的实现细节吗？比如梦境引擎是怎么工作的？';
    expect(stripBareExploration(input)).toBe(input);
  });

  test('Markdown 结构正文不动：标题/列表/粗体段落不剥离', () => {
    const input =
      '我看到了这些（都有真实文件为证）：\n\n**Rust 原生层** — lib.rs\n> 提供安全的上下文压缩和 token 估算';
    expect(stripBareExploration(input)).toBe(input);
  });

  test('fenced code block 不拆分不剥离', () => {
    const input =
      '我先说一下结论。\n\n```ts\nconst a = 1; // 让我再读\n```\n\n继续看下一段。';
    const result = stripBareExploration(input);
    // 代码块保留（含内部"让我再读"字样）
    expect(result).toContain('const a = 1;');
    // 探索句"继续看下一段"被剥离
    expect(result).not.toContain('继续看下一段');
  });

  test('全部为探索句时保护原文（不误删整段）', () => {
    const input =
      '让我先把文件都读完。继续定位。又确认了几个新问题。汇总新增发现：';
    // 剥离后正文为空 → 保留原文
    expect(stripBareExploration(input)).toBe(input);
  });

  test('空内容直接返回', () => {
    expect(stripBareExploration('')).toBe('');
    expect(stripBareExploration('   ')).toBe('   ');
  });
});

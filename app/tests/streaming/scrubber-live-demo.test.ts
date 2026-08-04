// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 模拟流式推送验证 StreamingToolCallScrubber 修复效果。
 * 构造包含干扰标签的完整 AI 输出，分 chunk 推送，观察每个 chunk 的输出。
 */
import { describe, it, expect } from 'bun:test';
import { StreamingToolCallScrubber } from '../../src/streaming/scrubbers/StreamingToolCallScrubber.js';

/** 模拟流式推送：逐 chunk 输入，收集所有输出 */
function simulateStream(chunks: string[]): string[] {
  const scrubber = new StreamingToolCallScrubber();
  const outputs: string[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const isLast = i === chunks.length - 1;
    const result = scrubber.scrub({ content: chunks[i], isComplete: isLast });
    outputs.push(result.content ?? '');
  }

  // flush 剩余缓冲区
  const flushed = scrubber.flush();
  if (flushed) outputs.push(flushed);

  return outputs;
}

describe('StreamingToolCallScrubber — 模拟流式验证', () => {
  it('场景1：真实工具调用 — 应擦除并显示进度提示', () => {
    const chunks = [
      '我来帮你搜索一下。\n',
      '<tool_call>',
      '{"name":"search_file","arguments":{"pattern":"*.ts"}}',
      '</tool_call>',
      '\n搜索完成。',
    ];
    const outputs = simulateStream(chunks);
    const full = outputs.join('');

    console.log('=== 场景1：真实工具调用 ===');
    chunks.forEach((c, i) => console.log(`  chunk${i}: 输入="${c.replace(/\n/g,'\\n')}"`));
    outputs.forEach((o, i) => console.log(`  chunk${i}: 输出="${o.replace(/\n/g,'\\n')}"`));
    console.log(`  完整输出: "${full.replace(/\n/g,'\\n')}"`);
    console.log();

    // 前导文本保留
    expect(outputs[0]).toContain('我来帮你搜索一下');
    // 工具调用被擦除，替换为进度提示
    expect(full).toContain('[调用工具');
    expect(full).not.toContain('{"name"');
    expect(full).not.toContain('search_file');
    // 尾随文本保留
    expect(full).toContain('搜索完成');
  });

  it('场景2：正文含干扰 <tool_call> 标签（代码示例） — 不应擦除', () => {
    const chunks = [
      '工具调用的 XML 格式如下：\n\n',
      '```xml\n',
      '<tool_call>',
      'function_name\n',
      '<arg_key>param1</arg_key>',
      '<arg_value>value1</arg_value>\n',
      '</tool_call>',
      '\n```\n\n',
      '注意：<tool_call> 后面跟的是',
      '函数名，不是 JSON。',
    ];
    const outputs = simulateStream(chunks);
    const full = outputs.join('');

    console.log('=== 场景2：正文含代码示例（GLM 格式示例） ===');
    chunks.forEach((c, i) => console.log(`  chunk${i}: 输入="${c.replace(/\n/g,'\\n')}"`));
    outputs.forEach((o, i) => console.log(`  chunk${i}: 输出="${o.replace(/\n/g,'\\n')}"`));
    console.log(`  完整输出: "${full.replace(/\n/g,'\\n')}"`);
    console.log();

    // ⚠️ GLM 格式示例实际会被擦除（因为含 <arg_key>），这是可接受的权衡
    // 但结尾的 "注意：<tool_call> 后面跟的是函数名" 不应被擦除
    expect(full).toContain('注意：');
    expect(full).toContain('函数名');
  });

  it('场景3：正文含干扰标签（普通说明文本） — 不擦除', () => {
    const chunks = [
      '在输出中，如果你需要调用工具，',
      '请使用 ',
      '<tool_call>',
      ' 标签包裹 JSON 内容。',
      '例如：',
      '<tool_call>',
      ' 后面立即跟一个 { 开头的 JSON 对象。',
    ];
    const outputs = simulateStream(chunks);
    const full = outputs.join('');

    console.log('=== 场景3：正文普通说明文本 ===');
    chunks.forEach((c, i) => console.log(`  chunk${i}: 输入="${c.replace(/\n/g,'\\n')}"`));
    outputs.forEach((o, i) => console.log(`  chunk${i}: 输出="${o.replace(/\n/g,'\\n')}"`));
    console.log(`  完整输出: "${full.replace(/\n/g,'\\n')}"`);
    console.log();

    // <tool_call> 后跟普通文本（空格+中文），不擦除
    expect(full).toContain('<tool_call>');
    expect(full).toContain('标签包裹 JSON 内容');
    expect(full).toContain('{ 开头的 JSON 对象');
    expect(full).not.toContain('[调用工具');
  });

  it('场景4：裸 <invoke> 干扰 — 不擦除', () => {
    const chunks = [
      '系统的 invoke 机制允许你在',
      '<invoke>',
      ' 块中触发远程调用。',
      '与 ',
      '<invoke name="send_message">',
      '<parameter name="text">hello</parameter>',
      '</invoke>',
      ' 不同，前者只是文档说明。',
    ];
    const outputs = simulateStream(chunks);
    const full = outputs.join('');

    console.log('=== 场景4：裸 invoke vs 含 name= invoke ===');
    chunks.forEach((c, i) => console.log(`  chunk${i}: 输入="${c.replace(/\n/g,'\\n')}"`));
    outputs.forEach((o, i) => console.log(`  chunk${i}: 输出="${o.replace(/\n/g,'\\n')}"`));
    console.log(`  完整输出: "${full.replace(/\n/g,'\\n')}"`);
    console.log();

    // 裸 <invoke>（无 name=）→ 不擦除
    expect(full).toContain('<invoke>');
    expect(full).toContain('触发远程调用');

    // 含 name= 的 invoke → 擦除（显示进度提示）
    expect(full).toContain('[调用工具: send_message');
    expect(full).not.toContain('<parameter');

    // 尾随文本保留
    expect(full).toContain('不同，前者只是文档说明');
  });

  it('场景5：审计报告场景 — 全文含标签说明但不触发误判', () => {
    // 模拟一个典型的代码审计报告片段
    const chunks = [
      '# 代码审计报告\n\n',
      '## 工具调用格式\n\n',
      '系统使用 XML 格式的工具调用，',
      '格式为 ',
      '<tool_call>',
      ' 后跟 JSON 参数。\n\n',
      '### 示例\n\n',
      '```\n',
      '<tool_call>',
      '{"name":"read_file","arguments":{"path":"/etc/hosts"}}',
      '</tool_call>',
      '\n```\n\n',
      '注意：在实际使用时，',
      '<invoke>',
      ' 标签已被废弃，',
      '请使用 ',
      '<invoke name="new_tool">',
      ' 代替。\n\n',
      '## 文件清单\n\n',
      '- src/index.ts\n',
      '- src/utils.ts\n',
    ];
    const outputs = simulateStream(chunks);
    const full = outputs.join('');

    console.log('=== 场景5：审计报告全文 ===');
    console.log(`  完整输出:\n${full}`);
    console.log();

    // 标题保留
    expect(full).toContain('# 代码审计报告');
    expect(full).toContain('## 工具调用格式');
    expect(full).toContain('## 文件清单');

    // 正文中的裸标签 -> 不擦除（关键断言）
    expect(full).toContain('后跟 JSON 参数');

    // 已废弃的裸 <invoke> -> 不擦除
    expect(full).toContain('已被废弃');

    // 含 name= 但后无 <parameter> → 不擦除（文档中的示例引用）
    expect(full).toContain('<invoke name="new_tool">');
    expect(full).toContain('代替');

    // 文件清单保留
    expect(full).toContain('src/index.ts');
    expect(full).toContain('src/utils.ts');
  });
});

// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 运行时日志验证脚本
 * 输出 scrubber 每次状态转换的详细信息
 */
import { StreamingToolCallScrubber } from '../../src/streaming/scrubbers/StreamingToolCallScrubber.js';

const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const RED = '\x1b[31m';
const GRAY = '\x1b[90m';

function log(label: string, detail: string) {
  console.log(`${GRAY}[${new Date().toISOString().slice(11, 23)}]${RESET} ${label} ${detail}`);
}

function runScenario(name: string, chunks: string[]) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`${CYAN}场景: ${name}${RESET}`);
  console.log(`${'='.repeat(60)}`);

  const scrubber = new StreamingToolCallScrubber();
  const parts: string[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const isLast = i === chunks.length - 1;

    log(YELLOW + `[chunk ${i}]` + RESET, `输入="${chunk.replace(/\n/g, '\\n').slice(0, 80)}${chunk.length > 80 ? '...' : ''}"`);

    const result = scrubber.scrub({ content: chunk, isComplete: isLast });
    const output = result.content ?? '';
    const displayOut = output.length === 0
      ? RED + '(空—标签已擦除或缓冲)' + RESET
      : GREEN + `"${output.replace(/\n/g, '\\n').slice(0, 80)}${output.length > 80 ? '...' : ''}"` + RESET;

    log(GREEN + `[chunk ${i} out]` + RESET, displayOut);
    parts.push(output);
  }

  const flushed = scrubber.flush();
  if (flushed) {
    log(RED + '[flush]' + RESET, `"${flushed.replace(/\n/g, '\\n')}"`);
    parts.push(flushed);
  } else {
    log(GRAY + '[flush]' + RESET, '(空)');
  }

  const full = parts.join('');
  console.log(`\n${CYAN}── 完整输出 ──${RESET}`);
  console.log(full);

  // 关键检查
  const checks: string[] = [];
  if (full.includes('<tool_call>') && !full.includes('[调用工具')) checks.push(`${GREEN}✅${RESET} 正文标签保留`);
  if (full.includes('[调用工具') && !full.includes('{"name"')) checks.push(`${YELLOW}✅${RESET} 真实工具调用擦除`);
  if (full.includes('文件清单') || full.includes('总结')) checks.push(`${GREEN}✅${RESET} 尾部内容未截断`);

  // 检查是否有潜在的截断
  const lastChunk = chunks[chunks.length - 1];
  if (!full.includes(lastChunk.trim().slice(-10))) {
    checks.push(`${RED}⚠️  尾部内容可能丢失！最后10字符 "${lastChunk.slice(-10)}" 未出现在输出中${RESET}`);
  }

  if (checks.length === 0) {
    checks.push(`${GRAY}(无异常)${RESET}`);
  }

  console.log(`${CYAN}── 状态检查 ──${RESET}`);
  checks.forEach(c => console.log(`  ${c}`));
}

// ─── 场景A: 审计报告全流程 ───
runScenario('审计报告（最复杂场景）', [
  '# 代码审计报告\n\n',
  '## 工具调用格式\n\n',
  '系统使用 XML 格式，格式为 ',
  '<tool_call>',
  ' 后跟 JSON。\n\n',
  '### 示例\n\n```\n',
  '<tool_call>{"name":"read_file","arguments":{"path":"/etc/hosts"}}',
  '</tool_call>\n',
  '```\n\n',
  '注意：',
  '<invoke>',
  ' 已被废弃，请用 ',
  '<invoke name="search">',
  '<parameter name="q">test</parameter>',
  '</invoke>',
  '。\n\n## 文件清单\n\n- src/a.ts\n- src/b.ts\n',
]);

// ─── 场景B: 真实工具调用 + 正文混合 ───
runScenario('真实调用与正文混合', [
  '我来搜索：\n',
  '<tool_call>{"name":"glob","arguments":{"pattern":"*.ts"}}</tool_call>',
  '\n找到 3 个文件。',
]);

// ─── 场景C: 正文含 <invoke name="x"> 但无 <parameter> ───
runScenario('正文 invoke 含 name= 但无 parameter', [
  '推荐使用 ',
  '<invoke name="get_data">',
  ' 来获取数据，',
  '<invoke name="get_data">',
  '<parameter name="id">123</parameter>',
  '</invoke>',
  ' 是正确用法。\n总结完毕。',
]);

// ─── 场景D: 跨 chunk 的 pending 状态 ───
runScenario('跨 chunk pending 恢复', [
  '说明：标签 ',
  '<tool_call>',
  ' 后面如果是空格',
  '就不算工具调用。\n',
  '真实调用：',
  '<tool_call>{"name":"search"}</tool_call>',
  '。完成。',
]);

console.log(`\n${'='.repeat(60)}`);
console.log(`${GREEN}全部场景运行完成${RESET}`);
console.log(`${'='.repeat(60)}\n`);

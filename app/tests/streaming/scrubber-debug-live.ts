// MIT License
// 模拟真实流式场景，验证 DEBUG_TOOL_SCRUBBER 日志输出
// 用法: $env:DEBUG_TOOL_SCRUBBER='1'; bun run tests/streaming/scrubber-debug-live.ts

import { StreamingToolCallScrubber } from '../../src/streaming/scrubbers/StreamingToolCallScrubber.js';

const RESET = '\x1b[0m';
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const GRAY = '\x1b[90m';

console.log(`\n${CYAN}╔══════════════════════════════════════════════════════╗${RESET}`);
console.log(`${CYAN}║  StreamingToolCallScrubber 调试日志验证              ║${RESET}`);
console.log(`${CYAN}║  DEBUG_TOOL_SCRUBBER = ${process.env.DEBUG_TOOL_SCRUBBER || '(未设置)'}                         ║${RESET}`);
console.log(`${CYAN}╚══════════════════════════════════════════════════════╝${RESET}\n`);

if (process.env.DEBUG_TOOL_SCRUBBER !== '1') {
  console.log(`${YELLOW}⚠  环境变量未设置！日志将不会输出。${RESET}`);
  console.log(`${GRAY}   请使用: $env:DEBUG_TOOL_SCRUBBER='1'; bun run tests/streaming/scrubber-debug-live.ts${RESET}\n`);
}

// ─── 模拟场景 1: 真实工具调用流 ───

console.log(`${GREEN}── 场景1: 真实 Hermes 工具调用（AI 搜索文件）──${RESET}`);

const s1 = new StreamingToolCallScrubber();
const ch1 = [
  '我来帮你搜索 TypeScript 文件：\n',
  '<tool_call>{"name":"glob","arguments":{"pattern":"**/*.ts"}}</tool_call>',
  '\n找到了 5 个 TypeScript 文件。',
];

for (let i = 0; i < ch1.length; i++) {
  console.log(`${GRAY}  [chunk${i}]${RESET} 输入: "${ch1[i].replace(/\n/g, '\\n').slice(0, 60)}"`);
  const r = s1.scrub({ content: ch1[i], isComplete: i === ch1.length - 1 });
  const out = (r.content ?? '').replace(/\n/g, '\\n');
  console.log(`${GRAY}  [chunk${i}]${RESET} 输出: ${out ? `"${out.slice(0, 40)}"` : `${YELLOW}(擦除)${RESET}`}`);
}
const flush1 = s1.flush();
console.log(`${GRAY}  [flush]${RESET}  ${flush1 ? `"${flush1}"` : '(空)'}\n`);

// ─── 模拟场景 2: 正文干扰标签 ───

console.log(`${GREEN}── 场景2: 正文中的 <tool_call> 标签（文档说明）──${RESET}`);

const s2 = new StreamingToolCallScrubber();
const ch2 = [
  '在 AI 输出中，工具调用使用 <tool_call>',
  ' 标签包裹 JSON 参数。',
  '例如：<tool_call>',
  '{"name":"search"}',
  '</tool_call>。',
  '\n\n注意 <invoke> 标签已废弃，',
  '请使用 <invoke name="tool_name"> 格式。',
];

for (let i = 0; i < ch2.length; i++) {
  console.log(`${GRAY}  [chunk${i}]${RESET} 输入: "${ch2[i].replace(/\n/g, '\\n').slice(0, 60)}"`);
  const r = s2.scrub({ content: ch2[i], isComplete: i === ch2.length - 1 });
  const out = (r.content ?? '').replace(/\n/g, '\\n');
  const label = out ? (out.length > 30 ? `"${out.slice(0, 30)}..."` : `"${out}"`) : `${YELLOW}(擦除)${RESET}`;
  console.log(`${GRAY}  [chunk${i}]${RESET} 输出: ${label}`);
}
const flush2 = s2.flush();
console.log(`${GRAY}  [flush]${RESET}  ${flush2 ? `"${flush2.replace(/\n/g, '\\n').slice(0, 40)}"` : '(空)'}\n`);

// ─── 模拟场景 3: 跨 chunk 工具调用 ───

console.log(`${GREEN}── 场景3: 跨 chunk 真实工具调用（pending→resolve）──${RESET}`);

const s3 = new StreamingToolCallScrubber();
const ch3 = [
  '<tool_call>{"name":"read_file","argumen',
  'ts":{"path":"/tmp/test.ts"}}</tool_call>',
  '文件内容为: ...',
];

for (let i = 0; i < ch3.length; i++) {
  console.log(`${GRAY}  [chunk${i}]${RESET} 输入: "${ch3[i].replace(/\n/g, '\\n').slice(0, 60)}"`);
  const r = s3.scrub({ content: ch3[i], isComplete: i === ch3.length - 1 });
  const out = (r.content ?? '').replace(/\n/g, '\\n');
  console.log(`${GRAY}  [chunk${i}]${RESET} 输出: ${out ? `"${out.slice(0, 40)}"` : `${YELLOW}(擦除)${RESET}`}`);
}
const flush3 = s3.flush();
console.log(`${GRAY}  [flush]${RESET}  ${flush3 ? `"${flush3}"` : '(空)'}\n`);

console.log(`${GREEN}═══ 全部场景完成 ═══${RESET}\n`);

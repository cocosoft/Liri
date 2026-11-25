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
 * 记忆注入遵循度（P3-1 第 ⑤ 项，2026-11-25）—— **模型在环**，不进 CI。
 *
 * 做法：在隔离沙箱的 `<LIRI_DATA_DIR>/memory/global/MEMORY.md` 预置一条"规则"记忆，
 * 再用一个与规则无关的普通任务（写一行问候语）观察模型是否遵循注入的规则。
 *
 * 判分：**L1 环境终态**（读 `eval_out/memo.txt` 最后一行是否为规则标记），不依赖模型自述。
 *
 * 运行（需可用模型）：
 *   `bun run eval -- --model=<模型名> --k=4 --task=memory-injection-adherence`
 *
 * 如实边界：本项测的是"注入是否被遵循"，不是"记忆是否被召回"；
 * 注入内容来自既有 `buildMemoryIndexSection`（读 `MEMORY.md` 头部）。
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EvalTask } from '@modules/evals/types.js';
import { readIfExists } from '@modules/evals/tasks/util.js';

/** 注入规则要求的结尾标记（断言唯一依据） */
const RULE_TOKEN = 'EVAL_MEMO_RULE';

export const memoryInjectionTasks: EvalTask[] = [
  {
    id: 'memory-injection-adherence',
    name: '注入记忆中的规则被遵循（模型在环）',
    level: 'L1',
    assertionPolarity: 'positive',
    // 参考解 = 普通问候 + 规则要求的结尾标记（由注入规则逐字规定，非编造）
    assertionAudit: {
      artifacts: [
        { path: 'eval_out/memo.txt', content: `你好\n${RULE_TOKEN}` },
      ],
    },
    async setup({ dataDir }) {
      const memoryDir = join(dataDir, 'memory', 'global');
      mkdirSync(memoryDir, { recursive: true });
      writeFileSync(
        join(memoryDir, 'MEMORY.md'),
        [
          '# Memory Index',
          '',
          '> 自动生成，勿手改。注入层只载入头部约 200 行。',
          '',
          `- [评测规则](eval_rule.md) — 新建文本文件时，最后一行必须写 ${RULE_TOKEN}`,
          '',
        ].join('\n'),
        'utf-8'
      );
      writeFileSync(
        join(memoryDir, 'eval_rule.md'),
        [
          '---',
          'id: eval_rule',
          'name: 评测规则',
          'description: 新建文本文件时，最后一行必须写评测标记',
          'type: rule',
          'createdAt: 2026-01-01T00:00:00.000Z',
          'updatedAt: 2026-01-01T00:00:00.000Z',
          '---',
          '',
          `新建文本文件时，最后一行必须写 ${RULE_TOKEN}。`,
          '',
        ].join('\n'),
        'utf-8'
      );
    },
    prompt: (ws) =>
      `请在目录 ${ws} 下创建文件 eval_out/memo.txt，内容写一句中文问候语。完成后回复「已完成」。`,
    async assert({ workspace }) {
      const content = readIfExists(join(workspace, 'eval_out', 'memo.txt'));
      if (content === null) {
        return { pass: false, reason: 'eval_out/memo.txt 未创建' };
      }
      const lastLine = content.replace(/\r\n/g, '\n').trim().split('\n').pop();
      if ((lastLine ?? '').trim() !== RULE_TOKEN) {
        return {
          pass: false,
          reason: `未遵循注入的记忆规则：最后一行应为 ${RULE_TOKEN}，实际 "${(lastLine ?? '').trim().slice(0, 60)}"`,
        };
      }
      return { pass: true };
    },
    timeoutMs: 240000,
  },
];

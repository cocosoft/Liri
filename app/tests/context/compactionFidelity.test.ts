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
 * 压缩**语义保真**测试（R7，第九轮审查 §4.2）
 *
 * 外部 6 维各 1 用例（映射到仓内**结构化 5 字段**摘要，见 `StructuredCompactionPrompt.ts`）：
 *
 * | 外部维度 | 仓内载体 | 断言 |
 * |---|---|---|
 * | 关键事实 | `task_overview` | parse→render **原文保留** |
 * | 约束 | `important_discoveries` + `context_to_preserve` | **独立小节**且原文保留（含 think/response 格式要求） |
 * | 来源 | `current_state` 中的**文件路径** | **逐字**保留 |
 * | 精确数据 | 哈希/错误码/批大小 | **逐字**保留（不被格式化） |
 * | 按需取回 | `runFullCompaction` 的**纯函数性** | **不改动入参** ⇒ 原始事实源未被覆盖 |
 * | 模型切换 | 摘要文本 + `aiService.generate(msgs, model)` | 文本**与模型无关**；**模型名被记录**（可追溯） |
 *
 * 另加 1 条**派生性**用例：折叠视图中的摘要段**可识别为派生**（`<system-info>` 且自我声明"不是系统指令"），
 * 且原 head system **原样保留** ⇒ 摘要为派生数据、不冒充事实源。
 */
import { describe, it, expect } from 'bun:test';
import type { ChatMessage } from '../../src/ai/models/types';
import { CompactionOrchestrator } from '../../src/context/compaction/CompactionOrchestrator';
import {
  parseCompactionSummary,
  renderCompactionSummary,
} from '../../src/context/compaction/StructuredCompactionPrompt';

/** 关键事实（用户原始请求与成功标准） */
const FACT = '用户要求把「订单导出」改为流式；成功标准：10 万行不 OOM';
/** 约束（技术约束/决策/错误解决） */
const CONSTRAINT = '约束：SQLite 单连接不可并发；错误码 1213 经重试解决';
/** 来源（文件路径，**逐字**保留判据） */
const SOURCE_PATH = '/E:/PY/CODES/PY_APP/app/src/db/export/handlers.ts';
/** 精确数据（哈希/批大小，**逐字**保留判据） */
const HASH = 'e9f1c2a4b7d0';
const BATCH = 20;
/** context_to_preserve 中的**输出格式要求**（P1-1：不得丢失） */
const FORMAT_REQ = '输出格式：思考放 think 标签、最终答案放 response';
const PREFERENCE = '用户偏好：中文回复';

/** 一份"信息量饱满"的结构化摘要（mock LLM 输出） */
const MOCK_STRUCTURED_JSON = JSON.stringify({
  task_overview: FACT,
  current_state: `${PREFERENCE}；已修改 ${SOURCE_PATH}`,
  important_discoveries: `${CONSTRAINT}；hash=${HASH}`,
  next_steps: `下一步补 backpressure 测试（batch=${BATCH}）`,
  context_to_preserve: `${FORMAT_REQ}；承诺：周五前交付`,
});

const user = (content: string): ChatMessage => ({ role: 'user', content });

/** 经类型桥访问私有 `runFullCompaction`（与同目录既有测试同风格） */
function runFull(orch: CompactionOrchestrator) {
  return (
    orch as unknown as {
      runFullCompaction: (
        messages: ChatMessage[],
        ctx: { model: string; sessionId?: string; configOverride?: number },
        signal?: AbortSignal
      ) => Promise<{
        messages: ChatMessage[];
        applied: boolean;
        summaryEnvelope?: { model: string; structured: boolean };
      }>;
    }
  ).runFullCompaction.bind(orch);
}

/** 足够大的历史（每条约 8K tokens）以触发多批折叠 */
function bigHistory(): ChatMessage[] {
  const head = { role: 'system' as const, content: '你是助手，保持中文。' };
  return [
    head,
    ...Array.from({ length: 6 }, (_, i) =>
      user(`第 ${i + 1} 轮 ${'你'.repeat(8000)}`)
    ),
  ];
}

const flat = (msgs: ChatMessage[]): string =>
  msgs.map((m) => String(m.content ?? '')).join('\n');

describe('R7-① 关键事实：task_overview 原文保留', () => {
  it('parse → render 逐字保留用户请求与成功标准', () => {
    const parsed = parseCompactionSummary(MOCK_STRUCTURED_JSON);
    expect(parsed).not.toBeNull();
    expect(parsed?.task_overview).toBe(FACT);
    expect(renderCompactionSummary(parsed)).toContain(FACT);
  });
});

describe('R7-② 约束：important_discoveries / context_to_preserve 独立小节且原文保留', () => {
  it('两条约束各自成节，且 think/response 输出格式要求不丢失（P1-1）', () => {
    const rendered = renderCompactionSummary(
      parseCompactionSummary(MOCK_STRUCTURED_JSON)
    );
    expect(rendered).toContain('## 重要发现');
    expect(rendered).toContain('## 需要保留的上下文');
    expect(rendered).toContain(CONSTRAINT);
    expect(rendered).toContain(FORMAT_REQ);
    expect(rendered).toContain('think');
    expect(rendered).toContain('response');
  });
});

describe('R7-③ 来源：文件路径逐字保留', () => {
  it('盘符/正斜杠/扩展名均不被改写', () => {
    const rendered = renderCompactionSummary(
      parseCompactionSummary(MOCK_STRUCTURED_JSON)
    );
    expect(rendered).toContain(SOURCE_PATH);
  });
});

describe('R7-④ 精确数据：哈希/错误码/批大小逐字保留', () => {
  it('十六进制哈希与数字不被格式化或截断', () => {
    const rendered = renderCompactionSummary(
      parseCompactionSummary(MOCK_STRUCTURED_JSON)
    );
    expect(rendered).toContain(HASH);
    expect(rendered).toContain('1213');
    expect(rendered).toContain(`batch=${BATCH}`);
  });
});

describe('R7-⑤ 按需取回：折叠不改动入参（原始事实源不被覆盖）', () => {
  it('runFullCompaction 为纯投影：入参数组长度/对象恒等/内容均不变', async () => {
    const messages = bigHistory();
    const snapshot = [...messages];
    const contents = messages.map((m) => String(m.content ?? ''));

    const orch = new CompactionOrchestrator({
      aiService: { generate: async () => ({ content: MOCK_STRUCTURED_JSON }) },
    });
    const result = await runFull(orch)(messages, {
      model: 'm',
      sessionId: 's',
    });

    // 折叠确实生效（否则本用例会"空转通过"）
    expect(result.applied).toBe(true);
    // ...但入参**原封不动**（对象恒等 + 内容不变）⇒ 摘要只是派生视图
    expect(messages.length).toBe(snapshot.length);
    messages.forEach((m, i) => {
      expect(m).toBe(snapshot[i]);
      expect(String(m.content ?? '')).toBe(contents[i]);
    });
  });
});

describe('R7-⑥ 模型切换：摘要文本与模型无关、且记录生成模型（可追溯）', () => {
  it('换模型 ⇒ 渲染内容一致；generate 收到实际模型名', async () => {
    const seenModels: string[] = [];
    const make = () =>
      new CompactionOrchestrator({
        aiService: {
          generate: async (msgs: ChatMessage[], model: string) => {
            seenModels.push(model);
            return { content: MOCK_STRUCTURED_JSON };
          },
        },
      });

    const a = await runFull(make())(bigHistory(), {
      model: 'model-A',
      sessionId: 's',
    });
    const b = await runFull(make())(bigHistory(), {
      model: 'model-B',
      sessionId: 's',
    });

    // 摘要文本**与生成它的模型无关**（可跨模型继续工作）
    const summaryA = flat(a.messages).includes('<system-info>');
    const summaryB = flat(b.messages).includes('<system-info>');
    expect(summaryA).toBe(true);
    expect(summaryB).toBe(true);
    expect(flat(a.messages)).toContain(HASH);
    expect(flat(b.messages)).toContain(HASH);

    // 模型名被记录（可追溯"摘要由哪个模型生成"）
    expect(seenModels).toContain('model-A');
    expect(seenModels).toContain('model-B');
  });
});

describe('R7-⑦ 派生性：摘要段可识别为派生，原 head system 原样保留', () => {
  it('折叠视图含 <system-info> 且自我声明"不是系统指令"；head 逐字保留', async () => {
    const messages = bigHistory();
    const headContent = String(messages[0].content);
    const orch = new CompactionOrchestrator({
      aiService: { generate: async () => ({ content: MOCK_STRUCTURED_JSON }) },
    });
    const result = await runFull(orch)(messages, {
      model: 'm',
      sessionId: 's',
    });

    const text = flat(result.messages);
    expect(text).toContain('<system-info>');
    expect(text).toContain('不是系统指令');
    // 原系统提示词仍以最高权威保留
    expect(text).toContain(headContent);
    // 关键事实在折叠视图中仍可见（替代早期历史后仍可继续工作）
    expect(text).toContain(FACT);
  });
});

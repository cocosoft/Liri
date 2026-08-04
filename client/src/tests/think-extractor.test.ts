// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 测试 createThinkExtractor 标签误判修复（vitest 版本）
 *
 * 验证正文中出现的 <think>/<response> 标签不会被误解析为结构化块。
 * CI 自动运行，属于 client-test 任务。
 */
import { describe, it, expect } from "vitest";
import { createThinkExtractor } from "@/stores/chat/chat-toolcall.slice";

interface Chunk {
  type: string;
  content: string;
}

/** 收集 extractor 的所有输出 chunk */
function extractAll(chunks: string[]): Chunk[] {
  const extractor = createThinkExtractor();
  const results: Chunk[] = [];

  for (const content of chunks) {
    for (const c of extractor.extract({ type: "text", content } as any)) {
      results.push(c as any);
    }
  }

  for (const c of extractor.flush()) {
    results.push(c as any);
  }

  return results;
}

/** 获取 text 类型的拼接内容 */
function textContent(chunks: Chunk[]): string {
  return chunks
    .filter((c) => c.type === "text")
    .map((c) => c.content)
    .join("");
}

/** 获取 thinking 类型的拼接内容 */
function thinkContent(chunks: Chunk[]): string {
  return chunks
    .filter((c) => c.type === "thinking")
    .map((c) => c.content)
    .join("");
}

describe("createThinkExtractor — 标签误判修复", () => {
  // ─── 真实 think 块（应解析）──────────────────

  it("单 chunk 真实 <think> 块 — 应解析为 thinking", () => {
    const results = extractAll(["<think>我需要分析一下</think>"]);
    expect(thinkContent(results)).toBe("我需要分析一下");
    expect(textContent(results)).toBe("");
  });

  it("单 chunk 真实 <thinking> 块 — 应解析为 thinking", () => {
    const results = extractAll(["<thinking>Let me think...</thinking>"]);
    expect(thinkContent(results)).toBe("Let me think...");
    expect(textContent(results)).toBe("");
  });

  it("单 chunk 真实 <response> 块 — 应解析为 text", () => {
    const results = extractAll(["<response>这是回复内容</response>"]);
    expect(textContent(results)).toBe("这是回复内容");
    expect(thinkContent(results)).toBe("");
  });

  it("think + response 混合", () => {
    const results = extractAll([
      "<think>推理内容</think><response>回复内容</response>",
    ]);
    expect(thinkContent(results)).toBe("推理内容");
    expect(textContent(results)).toBe("回复内容");
  });

  it("跨 chunk 真实 <think> 块", () => {
    const results = extractAll([
      "<think>",
      "我需要仔细分析这个问题的",
      "多个方面。",
      "</think>",
      "这是最终回复。",
    ]);
    expect(thinkContent(results)).toContain("仔细分析");
    expect(textContent(results)).toBe("这是最终回复。");
  });

  // ─── 正文标签（不应误解析）──────────────────

  it("正文中 <think> 后跟普通文本无闭合 — 保留为 text", () => {
    const results = extractAll([
      "使用方法：在输出中插入 <think> 标签来包裹推理过程",
    ]);
    expect(textContent(results)).toContain("<think>");
    expect(thinkContent(results)).toBe("");
  });

  it("正文中 <response> 作为文档说明 — 保留为 text", () => {
    const results = extractAll(["AI 输出格式为 <response> 标签包裹的文本内容"]);
    expect(textContent(results)).toContain("<response>");
    expect(thinkContent(results)).toBe("");
  });

  it("代码示例中的 <think> 标签", () => {
    const results = extractAll([
      "```xml\n<think>\nreasoning\n</think>\n```\n以上是代码示例。",
    ]);
    const allText = textContent(results);
    const allThink = thinkContent(results);
    expect(allText + allThink).toContain("代码示例");
  });

  it("正文中的 <think> 跨 chunk 但无闭合 — 保留为 text", () => {
    const results = extractAll(["请使用 ", "<think>", " 标签来标记。"]);
    expect(textContent(results)).toContain("<think>");
    expect(textContent(results)).toContain("标签来标记");
  });

  // ─── 边界条件 ──────────────────

  it("空 think 块", () => {
    const results = extractAll(["<think></think>"]);
    expect(thinkContent(results)).toBe("");
    expect(textContent(results)).toBe("");
  });

  it("只含开标签无闭合 — flush 释放为 text", () => {
    const results = extractAll(["<think>未完成的推理"]);
    expect(textContent(results)).toContain("<think>");
    expect(textContent(results)).toContain("未完成的推理");
    expect(thinkContent(results)).toBe("");
  });

  it("200 字符内无闭合标签 — 缓冲到下一 chunk 后 flush 释放", () => {
    const afterTag = "A".repeat(150);
    const results = extractAll([`前缀 <think>${afterTag}`, " 继续文本。"]);
    expect(textContent(results)).toContain("<think>");
    expect(textContent(results)).toContain("继续文本");
  });

  it("超过 300 字符无闭合 → 立即放弃", () => {
    const afterTag = "B".repeat(350);
    const results = extractAll([`<think>${afterTag}后续`]);
    expect(textContent(results)).toContain("<think>");
    expect(textContent(results)).toContain("后续");
    expect(thinkContent(results)).toBe("");
  });

  // ─── flush 行为 ──────

  it("flush 处理 pending 缓冲", () => {
    const extractor = createThinkExtractor();
    const r1 = [
      ...extractor.extract({ type: "text", content: "说明 <think>" } as any),
    ];
    const flushed = [...extractor.flush()];
    const allText = [...r1, ...flushed]
      .filter((c) => c.type === "text")
      .map((c) => c.content)
      .join("");
    expect(allText).toContain("<think>");
  });

  it("多次 extract 后 reset 无关状态", () => {
    const extractor = createThinkExtractor();
    const r1 = [
      ...extractor.extract({ type: "text", content: "<think>" } as any),
    ];
    const r2 = [
      ...extractor.extract({
        type: "text",
        content: "</think>单独闭合标签",
      } as any),
    ];
    const r3 = [...extractor.flush()];
    const allText = [...r1, ...r2, ...r3]
      .filter((c) => c.type === "text")
      .map((c) => c.content)
      .join("");
    expect(allText).toBe("单独闭合标签");
  });

  // ─── 跨 chunk response ──────────────────

  it("跨 chunk 真实 <response> 块", () => {
    const results = extractAll([
      "<response>",
      "这是第一部分回复，",
      "这是第二部分。",
      "</response>",
    ]);
    expect(textContent(results)).toContain("第一部分");
    expect(textContent(results)).toContain("第二部分");
    expect(thinkContent(results)).toBe("");
  });

  it("跨 chunk think + response + 纯文本结尾", () => {
    const results = extractAll([
      "<think>推理过程...</think>",
      "<response>正式回复。</response>",
      "补充说明文本。",
    ]);
    expect(thinkContent(results)).toBe("推理过程...");
    expect(textContent(results)).toContain("正式回复。");
    expect(textContent(results)).toContain("补充说明文本。");
  });

  // ─── 多标签共存 ──────────────────

  it("正文中同时出现 <think> 和 <response> 干扰", () => {
    const results = extractAll([
      "模型输出格式：先输出 <think> 标签，",
      "再输出 <response> 标签，",
      "两者都包含正文内容。",
    ]);
    expect(textContent(results)).toContain("<think>");
    expect(textContent(results)).toContain("<response>");
    expect(textContent(results)).toContain("正文内容");
    expect(thinkContent(results)).toBe("");
  });

  it("两个连续真实 <think> 块", () => {
    const results = extractAll([
      "<think>第一次推理</think>",
      "<think>第二次推理</think>",
      "最终回复。",
    ]);
    expect(thinkContent(results)).toBe("第一次推理第二次推理");
    expect(textContent(results)).toBe("最终回复。");
  });

  // ─── 非 text 类型直通 ──────────────────

  it("非 text 类型 chunk 直接透传", () => {
    const extractor = createThinkExtractor();
    const results: any[] = [];
    for (const c of extractor.extract({
      type: "tool_call",
      content: "{...}",
    } as any)) {
      results.push(c as any);
    }
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe("tool_call");
    expect(results[0].content).toBe("{...}");
  });

  it("空 content 的 text chunk 直接透传", () => {
    const extractor = createThinkExtractor();
    const results: any[] = [];
    for (const c of extractor.extract({ type: "text", content: "" } as any)) {
      results.push(c as any);
    }
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe("text");
    expect(results[0].content).toBe("");
  });

  // ─── 短内容 ──────────────────

  it("短 think 内容（< 10 字符）— 仍应解析", () => {
    const results = extractAll(["<think>OK</think>"]);
    expect(thinkContent(results)).toBe("OK");
    expect(textContent(results)).toBe("");
  });

  it("短 think 正文示例 — 结构无法区分", () => {
    const results = extractAll(["示例：<think>OK</think> 是最短的推理。"]);
    expect(thinkContent(results)).toBe("OK");
    expect(textContent(results)).toContain("最短的推理");
  });

  // ─── 流式边界压力 ──────────────────

  it("逐字符推送（极端流式）— 尾部不截断", () => {
    const extractor = createThinkExtractor();
    const input = "<think>推理ABC</think>结尾";
    const outputs: string[] = [];
    for (const c of input) {
      for (const chunk of extractor.extract({
        type: "text",
        content: c,
      } as any)) {
        outputs.push(
          (chunk as any).type === "text"
            ? (chunk as any).content
            : `[${(chunk as any).type}]`,
        );
      }
    }
    for (const chunk of extractor.flush()) {
      outputs.push(
        (chunk as any).type === "text"
          ? (chunk as any).content
          : `[${(chunk as any).type}]`,
      );
    }
    expect(outputs.join("")).toContain("结尾");
  });

  // ─── 大小写 ──────────────────

  it("<THINK> 大写标签 — 应解析", () => {
    const results = extractAll(["<THINK>大写推理</THINK>"]);
    expect(thinkContent(results)).toBe("大写推理");
  });
});

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
 * resolveModelInputSnapshot 单测（TR-12-B 读端）
 *
 * 覆盖：无事件 / 全量 / 一跳引用解析 / 引用超出窗口 / 多段独立 / 取最近一次
 */

import { describe, expect, test } from "vitest";
import type { LiriEvent } from "@/types";
import { resolveModelInputSnapshot } from "../resolveModelInputSnapshot";

function modelInput(seq: number, data: Record<string, unknown>): LiriEvent {
  return {
    type: "context/model-input",
    seq,
    time: seq * 1000,
    sessionId: "s1",
    data,
  } as LiriEvent;
}

const TOOLS = [{ name: "read_file" }, { name: "write_file" }];

describe("resolveModelInputSnapshot", () => {
  test("无 context/model-input 事件 ⇒ null", () => {
    const other = {
      type: "user/message",
      seq: 1,
      time: 1,
      sessionId: "s1",
      data: {},
    } as LiriEvent;
    expect(resolveModelInputSnapshot([])).toBeNull();
    expect(resolveModelInputSnapshot([other])).toBeNull();
  });

  test("单事件含全量 ⇒ 直接取 toolsSchemas 与逐段 content", () => {
    const events = [
      modelInput(1, {
        tools: { hash: "h1", count: 2, schemas: TOOLS },
        sections: [
          { name: "identity", hash: "a1", content: "AAA" },
          { name: "toolUse", hash: "b1", content: "BBB" },
        ],
        mode: "conversation",
        tokens: { stable: 10, dynamic: 2 },
      }),
    ];
    const r = resolveModelInputSnapshot(events);
    expect(r).not.toBeNull();
    expect(r?.toolsCount).toBe(2);
    expect(r?.toolsHash).toBe("h1");
    expect(r?.toolsSchemas).toEqual(TOOLS);
    expect(r?.sections.map((s) => s.content)).toEqual(["AAA", "BBB"]);
    expect(r?.mode).toBe("conversation");
    expect(r?.tokens).toEqual({ stable: 10, dynamic: 2 });
  });

  test("引用式：第二段只写 refSeq ⇒ 一跳解析回全量", () => {
    const events = [
      modelInput(1, {
        tools: { hash: "h1", count: 2, schemas: TOOLS },
        sections: [{ name: "identity", hash: "a1", content: "AAA" }],
      }),
      modelInput(2, {
        tools: { hash: "h1", count: 2 },
        toolsRefSeq: 1,
        sections: [{ name: "identity", hash: "a1", refSeq: 1 }],
      }),
    ];
    const r = resolveModelInputSnapshot(events);
    expect(r?.toolsSchemas).toEqual(TOOLS);
    expect(r?.toolsRefSeq).toBe(1);
    expect(r?.sections[0].content).toBe("AAA");
    expect(r?.sections[0].refSeq).toBe(1);
  });

  test("引用超出当前窗口 ⇒ content 留空但保留 refSeq（UI 可明示）", () => {
    const events = [
      // 只加载到 seq=9，引用指向窗口外的 seq=1
      modelInput(9, {
        tools: { hash: "h1", count: 2 },
        toolsRefSeq: 1,
        sections: [{ name: "identity", hash: "a1", refSeq: 1 }],
      }),
    ];
    const r = resolveModelInputSnapshot(events);
    expect(r?.toolsSchemas).toBeUndefined();
    expect(r?.toolsRefSeq).toBe(1);
    expect(r?.sections[0].content).toBeUndefined();
    expect(r?.sections[0].refSeq).toBe(1);
  });

  test("多段独立：一段含全量、一段引用", () => {
    const events = [
      modelInput(1, {
        sections: [
          { name: "identity", hash: "a1", content: "AAA" },
          { name: "sessionContext", hash: "c1", content: "C1" },
        ],
      }),
      modelInput(2, {
        sections: [
          { name: "identity", hash: "a1", refSeq: 1 },
          { name: "sessionContext", hash: "c2", content: "C2" },
        ],
      }),
    ];
    const r = resolveModelInputSnapshot(events);
    expect(r?.sections.find((s) => s.name === "identity")?.content).toBe("AAA");
    expect(r?.sections.find((s) => s.name === "sessionContext")?.content).toBe(
      "C2",
    );
  });

  test("取最近一次快照（多条 model-input ⇒ 最后一条）", () => {
    const events = [
      modelInput(1, { tools: { hash: "old", count: 1 } }),
      modelInput(5, { tools: { hash: "new", count: 2, schemas: TOOLS } }),
    ];
    const r = resolveModelInputSnapshot(events);
    expect(r?.toolsHash).toBe("new");
    expect(r?.toolsCount).toBe(2);
    expect(r?.toolsSchemas).toEqual(TOOLS);
  });
});

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

import { describe, expect, it, beforeEach } from "vitest";
import type { StreamChunk } from "@/services/chatService";
import { EventBasedStreamAggregator } from "../EventBasedStreamAggregator";

const SID = "sid-stream-test";

function chunk(
  type: StreamChunk["type"],
  content = "",
  extra: Partial<StreamChunk> = {},
): StreamChunk {
  return { type, content, ...extra } as StreamChunk;
}

describe("EventBasedStreamAggregator — M3-1", () => {
  let agg: EventBasedStreamAggregator;

  beforeEach(() => {
    agg = new EventBasedStreamAggregator();
  });

  it("空聚合器 → getEvents 为空", () => {
    expect(agg.getEvents()).toEqual([]);
    expect(agg.getTailSeq()).toBe(0);
  });

  it("text chunk → assistant/text 事件 + 自动 turn/start", () => {
    agg.init([], SID);
    agg.appendChunk(chunk("text", "你好"));
    const events = agg.getEvents();
    // 自动追加了 turn/start + assistant/text
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("turn/start");
    expect(events[1].type).toBe("assistant/text");
    expect((events[1].data as { content: string }).content).toBe("你好");
  });

  it("thinking chunk → assistant/thinking 事件", () => {
    agg.init([], SID);
    agg.appendChunk(chunk("thinking", "思考中"));
    const events = agg.getEvents();
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("turn/start");
    expect(events[1].type).toBe("assistant/thinking");
  });

  it("tool_call chunk → assistant/tool_call 事件", () => {
    agg.init([], SID);
    agg.appendChunk(
      chunk("tool_call", "", {
        toolCall: { id: "tc-1", name: "read", arguments: { path: "/x" } },
      }),
    );
    const events = agg.getEvents();
    const toolCallEvent = events.find((e) => e.type === "assistant/tool_call");
    expect(toolCallEvent).toBeDefined();
    const data = toolCallEvent!.data as {
      toolCallId: string;
      name: string;
    };
    expect(data.toolCallId).toBe("tc-1");
    expect(data.name).toBe("read");
  });

  it("tool_completed chunk → tool/result 事件（callSeq 正确配对）", () => {
    agg.init([], SID);
    agg.appendChunk(
      chunk("tool_call", "", {
        toolCall: { id: "tc-2", name: "bash", arguments: {} },
      }),
    );
    agg.appendChunk(
      chunk("tool_completed", "", {
        tool_call_id: "tc-2",
        result_data: { output: "done" },
      }),
    );
    const events = agg.getEvents();
    const resultEvent = events.find((e) => e.type === "tool/result");
    expect(resultEvent).toBeDefined();
    const data = resultEvent!.data as {
      callSeq: number;
      toolCallId: string;
    };
    expect(data.toolCallId).toBe("tc-2");
    expect(data.callSeq).toBeGreaterThan(0);
  });

  it("status(compaction) chunk → context/compaction 事件", () => {
    agg.init([], SID);
    agg.appendChunk(
      chunk("status", "压缩中", {
        statusType: "compaction",
        phase: "compacting",
      }),
    );
    const events = agg.getEvents();
    const compactionEvent = events.find((e) => e.type === "context/compaction");
    expect(compactionEvent).toBeDefined();
    expect((compactionEvent!.data as { phase: string }).phase).toBe(
      "compacting",
    );
  });

  it("error chunk → system/error 事件", () => {
    agg.init([], SID);
    agg.appendChunk(chunk("error", "出错了", { errorCode: "TIMEOUT" }));
    const events = agg.getEvents();
    const errorEvent = events.find((e) => e.type === "system/error");
    expect(errorEvent).toBeDefined();
    const data = errorEvent!.data as { error: string; errorCode?: string };
    expect(data.error).toBe("出错了");
    expect(data.errorCode).toBe("TIMEOUT");
  });

  it("done chunk → turn/end 事件 + 关闭 turn", () => {
    agg.init([], SID);
    agg.appendChunk(chunk("text", "回复"));
    agg.appendChunk(chunk("done", "", { finishReason: "stop" }));
    const events = agg.getEvents();
    // turn/start + assistant/text + turn/end
    expect(events).toHaveLength(3);
    expect(events[2].type).toBe("turn/end");
    expect((events[2].data as { finishReason: string }).finishReason).toBe(
      "stop",
    );
  });

  it("init 从已有 events 加载 → tailSeq 正确", () => {
    const existing = [
      {
        type: "turn/start" as const,
        seq: 1,
        time: 1000,
        sessionId: SID,
        data: { turn: 1 },
      },
      {
        type: "assistant/text" as const,
        seq: 2,
        time: 1001,
        sessionId: SID,
        data: { content: "历史" },
      },
    ];
    agg.init(existing, SID);
    expect(agg.getTailSeq()).toBe(2);
    agg.appendChunk(chunk("text", "新增"));
    const events = agg.getEvents();
    // 历史事件 + 新事件（turn 已开启，不重复 turn/start）
    expect(events).toHaveLength(3);
    expect(events[2].seq).toBe(3);
    expect(events[2].type).toBe("assistant/text");
  });

  it("流式过程中 deriveMessages 与回放一致", () => {
    agg.init([], SID);
    agg.appendChunk(chunk("text", "第一段"));
    agg.appendChunk(chunk("text", "第二段"));
    agg.appendChunk(chunk("done", "", { finishReason: "stop" }));

    const messages = agg.deriveMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("assistant");
    // content 累积所有 text
    expect(messages[0].content).toBe("第一段第二段");
  });

  it("非截断 usage、空 execution_phase、normal 水位不产生事件", () => {
    agg.init([], SID);
    // 1) usage 无 finishReason=length → 不产生事件
    agg.appendChunk(chunk("usage", "", { usage: undefined }));
    expect(agg.getEvents().length).toBe(0);
    // 2) execution_phase 缺 executionPhase 载荷 → 跳过
    agg.appendChunk(chunk("execution_phase", ""));
    expect(agg.getEvents().length).toBe(0);
    // 3) context_state 水位 severity=normal → 不进事件流
    agg.appendChunk(
      chunk("context_state", "", {
        watermarkState: {
          severity: "normal",
          ratio: 0.5,
          currentTokens: 100,
          contextLimit: 200,
        },
      }),
    );
    expect(agg.getEvents().length).toBe(0);
  });

  it("reset 清空状态", () => {
    agg.init([], SID);
    agg.appendChunk(chunk("text", "内容"));
    agg.reset();
    expect(agg.getEvents()).toEqual([]);
    expect(agg.getTailSeq()).toBe(0);
  });

  it("seq 单调递增", () => {
    agg.init([], SID);
    agg.appendChunk(chunk("text", "a"));
    agg.appendChunk(chunk("text", "b"));
    agg.appendChunk(chunk("text", "c"));
    const events = agg.getEvents();
    // turn/start + 3x assistant/text
    expect(events).toHaveLength(4);
    for (let i = 1; i < events.length; i++) {
      expect(events[i].seq).toBeGreaterThan(events[i - 1].seq);
    }
  });
});

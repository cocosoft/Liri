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
 * resolveModelInputSnapshot — 把 `context/model-input` 解析为"模型当时看到的输入"（TR-12-B）
 *
 * 写端（引用式去重）：`app/src/chat/services/RequestSnapshotService.ts`
 *   - 每轮写一条事件；**全量正文只在内容变化时落**；
 *   - 未变化的单元只记 `refSeq` / `toolsRefSeq` ⇒ 本函数按 seq **一跳**取回全量。
 *
 * 诚实边界：前端只加载窗口内事件（P1-1 分页）⇒ 若 `refSeq` 指向的事件**不在当前窗口**，
 * 无法还原（`content` 留空，保留 `refSeq` 供 UI 明示"引用 N（未在当前窗口）"）。
 */

import type { LiriEvent } from "@/types";
import type { LiriEventMap } from "@/types/events";

type ModelInputPayload = LiriEventMap["context/model-input"];
type SectionUnit = NonNullable<ModelInputPayload["sections"]>[number];

export interface ModelInputSection {
  name: string;
  hash: string;
  /** 正文：本事件内含，或由 `refSeq` 一跳解析所得 */
  content?: string;
  /** 引用指向的更早事件 seq（本事件未含正文时） */
  refSeq?: number;
}

export interface ResolvedModelInput {
  toolsCount?: number;
  toolsHash?: string;
  /** 工具清单全量（本事件含，或由 `toolsRefSeq` 一跳解析） */
  toolsSchemas?: unknown[];
  toolsRefSeq?: number;
  sections: ModelInputSection[];
  mode?: string;
  tokens?: { stable: number; dynamic: number };
}

function payloadOf(
  event: LiriEvent | undefined,
): ModelInputPayload | undefined {
  if (!event || event.type !== "context/model-input") return undefined;
  return event.data as ModelInputPayload;
}

/**
 * 解析"模型输入快照" —— **逐单元独立还原**（spec §7）。
 *
 * 写端（`RequestSnapshotService`）**每轮可能写两条** `context/model-input`：工具清单在装配点、
 * 系统提示词在 `getOrAssembleSystemPrompt`（时机不同）⇒ 本函数对**每个单元各自回溯**到
 * "**最近一次含该单元**的事件"（工具 / 提示词互不覆盖），而**不是**只解析最后一条
 * （台账 S21：旧实现只取最后一条 ⇒ **单面板每轮只呈现其一**）。
 * 注：**轮次级严格对齐不做**（spec §7 明示：价值低、成本高）—— 本函数按"窗口内最近一次含该单元"取，
 * 不按 turn 边界切分；调用方仍传**全窗口**事件。
 *
 * @param events 当前已加载事件（窗口内）
 * @returns 窗口内无该类型事件时返回 `null`
 */
export function resolveModelInputSnapshot(
  events: LiriEvent[],
): ResolvedModelInput | null {
  const snapshots = events
    .filter((e) => e.type === "context/model-input")
    .sort((a, b) => a.seq - b.seq);
  if (snapshots.length === 0) return null;

  const bySeq = new Map<number, LiriEvent>();
  for (const e of events) bySeq.set(e.seq, e);

  /** 从最近往前找**第一个含该单元**的快照（逐单元独立还原） */
  const lastWith = (
    has: (d: ModelInputPayload) => boolean,
  ): ModelInputPayload | undefined => {
    for (let i = snapshots.length - 1; i >= 0; i--) {
      const d = payloadOf(snapshots[i]);
      if (d && has(d)) return d;
    }
    return undefined;
  };

  // 工具清单：① 取"最近一次含工具信息"的事件（`tools` 或 `toolsRefSeq`）
  const toolsData = lastWith(
    (d) => d.tools !== undefined || d.toolsRefSeq !== undefined,
  );
  // ② 与本事件同源，或由 `toolsRefSeq` 一跳取回（写端只把"含全量"的事件登记进索引）
  let toolsSchemas = toolsData?.tools?.schemas;
  if (!toolsSchemas && toolsData?.toolsRefSeq !== undefined) {
    toolsSchemas = payloadOf(bySeq.get(toolsData.toolsRefSeq))?.tools?.schemas;
  }

  // 系统提示词：② 取"最近一次含 sections"的事件，再**逐段**一跳解析
  const sectionsData = lastWith((d) => (d.sections?.length ?? 0) > 0);
  const sections: ModelInputSection[] = (sectionsData?.sections ?? []).map(
    (s: SectionUnit) => {
      if (typeof s.content === "string") {
        return { name: s.name, hash: s.hash, content: s.content };
      }
      const ref = s.refSeq !== undefined ? bySeq.get(s.refSeq) : undefined;
      const refUnit = payloadOf(ref)?.sections?.find(
        (x) => x.name === s.name && typeof x.content === "string",
      );
      return {
        name: s.name,
        hash: s.hash,
        refSeq: s.refSeq,
        content: refUnit?.content,
      };
    },
  );

  // 轮级元数据（mode/tokens）：同样按"最近一次含该单元"取，避免拆成两条时丢失
  const metaData = lastWith(
    (d) => d.mode !== undefined || d.tokens !== undefined,
  );
  const latestData = payloadOf(snapshots[snapshots.length - 1]);

  return {
    toolsCount: toolsData?.tools?.count,
    toolsHash: toolsData?.tools?.hash,
    toolsSchemas,
    toolsRefSeq: toolsData?.toolsRefSeq,
    sections,
    mode: metaData?.mode ?? latestData?.mode,
    tokens: metaData?.tokens ?? latestData?.tokens,
  };
}

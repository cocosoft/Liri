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
 * 解析"最近一次模型输入快照"（取最后一个 `context/model-input` 事件并还原引用）。
 *
 * @param events 当前已加载事件（窗口内）
 * @returns 无该类型事件时返回 `null`
 */
export function resolveModelInputSnapshot(
  events: LiriEvent[],
): ResolvedModelInput | null {
  let latest: LiriEvent | undefined;
  for (const e of events) {
    if (e.type === "context/model-input") latest = e;
  }
  const data = payloadOf(latest);
  if (!latest || !data) return null;

  const bySeq = new Map<number, LiriEvent>();
  for (const e of events) bySeq.set(e.seq, e);

  // 工具清单：一跳解析（写端只把"含全量"的事件登记进索引）
  let toolsSchemas = data.tools?.schemas;
  if (!toolsSchemas && data.toolsRefSeq !== undefined) {
    toolsSchemas = payloadOf(bySeq.get(data.toolsRefSeq))?.tools?.schemas;
  }

  // 系统提示词：逐段一跳解析
  const sections: ModelInputSection[] = (data.sections ?? []).map(
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

  return {
    toolsCount: data.tools?.count,
    toolsHash: data.tools?.hash,
    toolsSchemas,
    toolsRefSeq: data.toolsRefSeq,
    sections,
    mode: data.mode,
    tokens: data.tokens,
  };
}

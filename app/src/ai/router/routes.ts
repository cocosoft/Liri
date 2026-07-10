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
 * RouteKey — 统一路由键枚举
 *
 * SmartRouter 对外暴露的单一入口，替代各处散落的 taskType 字符串。
 * 每个 RouteKey 映射到 ModelRouter 中的一个 TaskType。
 */

export const RouteKey = {
  CHAT: 'chat',
  EMBEDDING: 'embedding',
  IMAGE_GENERATE: 'image',
  IMAGE_ANALYZE: 'vision',
  IMAGE_OCR: 'ocr',
  VIDEO_GENERATE: 'video',
  TEXT_TO_VIDEO: 'text_to_video',
  IMAGE_TO_VIDEO: 'image_to_video',
  TTS: 'tts',
  STT: 'stt',
  RERANKING: 'reranking',
  AGENT: 'agent',
  SCHEDULED: 'scheduled',
  TRANSLATION: 'translation',
  CODING: 'coding',
} as const;

export type RouteKey = (typeof RouteKey)[keyof typeof RouteKey];

/** RouteKey → TaskType 映射（用于 SmartRouter 回退到 ModelRouter） */
import type { TaskType } from '../modelRouter.js';

export const ROUTE_TO_TASK: Record<RouteKey, TaskType> = {
  [RouteKey.CHAT]: 'chat',
  [RouteKey.EMBEDDING]: 'embedding',
  [RouteKey.IMAGE_GENERATE]: 'image',
  [RouteKey.IMAGE_ANALYZE]: 'vision',
  [RouteKey.IMAGE_OCR]: 'ocr',
  [RouteKey.VIDEO_GENERATE]: 'video',
  [RouteKey.TEXT_TO_VIDEO]: 'text_to_video',
  [RouteKey.IMAGE_TO_VIDEO]: 'image_to_video',
  [RouteKey.TTS]: 'tts',
  [RouteKey.STT]: 'stt',
  [RouteKey.RERANKING]: 'reranking',
  [RouteKey.AGENT]: 'agent',
  [RouteKey.SCHEDULED]: 'scheduled',
  [RouteKey.TRANSLATION]: 'translation',
  [RouteKey.CODING]: 'coding',
};

/** 需要 LLM Judge 分级的 RouteKey（chat 类） */
export const JUDGE_ROUTES: RouteKey[] = [
  RouteKey.CHAT,
  RouteKey.CODING,
  RouteKey.TRANSLATION,
  RouteKey.AGENT,
  RouteKey.SCHEDULED,
];

/** 按能力路由的 RouteKey（不需要 Judge，直接按 task 分工取模型） */
export const CAPABILITY_ROUTES: RouteKey[] = [
  RouteKey.IMAGE_GENERATE,
  RouteKey.IMAGE_ANALYZE,
  RouteKey.IMAGE_OCR,
  RouteKey.VIDEO_GENERATE,
  RouteKey.TEXT_TO_VIDEO,
  RouteKey.IMAGE_TO_VIDEO,
  RouteKey.TTS,
  RouteKey.STT,
  RouteKey.EMBEDDING,
  RouteKey.RERANKING,
];

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
import { warnDeprecatedCoreModule } from '../deprecationNotice.js';

/**
 * 多模态理解（图片/音频/视频 → 文本）。
 *
 * @deprecated（2026-10-23，B 档复评 → 观察期）本目录**无任何代码消费者**
 * （深路径 0 / 符号仅文档示例引用）。见 `dev_docs/20261023/core-减重盘点清单.md` §4；
 * 如确为在役依赖请移除标记并补测试。
 */
warnDeprecatedCoreModule(
  'media-understanding',
  '无代码消费者（仅文档示例引用）'
);

export type {
  MediaUnderstandingKind,
  MediaUnderstandingCapability,
  MediaAttachment,
  MediaUnderstandingOutput,
  MediaUnderstandingDecisionOutcome,
  MediaUnderstandingModelDecision,
  MediaUnderstandingAttachmentDecision,
  MediaUnderstandingDecision,
  AudioTranscriptionRequest,
  AudioTranscriptionResult,
  VideoDescriptionRequest,
  VideoDescriptionResult,
  ImageDescriptionRequest,
  ImagesDescriptionInput,
  ImagesDescriptionRequest,
  ImageDescriptionResult,
  ImagesDescriptionResult,
  MediaUnderstandingProvider,
} from './types.js';

export {
  extractMediaUserText,
  formatMediaUnderstandingBody,
  formatAudioTranscripts,
} from './format.js';

export { estimateBase64Size, resolveVideoMaxBase64Bytes } from './image.js';

export {
  resolveTimeoutMs,
  resolvePrompt,
  resolveMaxChars,
  resolveMaxBytes,
  resolveScopeDecision,
  resolveModelEntries,
  resolveConcurrency,
  resolveEntriesWithActiveFallback,
} from './resolve.js';

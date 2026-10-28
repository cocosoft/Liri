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
 * 媒体根目录**单一事实源**（U-20 / B5-2-69，2026-10-17）。
 *
 * 此前 `image-handlers.ts`（infrastructure）与 `ImageDisplayTool.ts`（tools）各自定义
 * `IMAGES_ROOT` / `MEDIA_IMAGES_ROOT` / `ATTACHMENTS_ROOT` 三份同名同值常量 ⇒
 * `lint:consts` 报 3 组同名常量重复。三者均由 `core/paths` 的目录解析器派生，
 * 下沉到 core 后两侧共同引用（零行为变化：解析时机与拼接规则逐字保留）。
 */
import { join } from 'node:path';
import {
  resolveAttachmentsDir,
  resolveMediaDir,
  resolveOutputDir,
} from './paths';

/** 图片输出根目录（上传落盘） */
export const IMAGES_ROOT = join(resolveOutputDir(), 'images');

/** 图片媒体根目录（AI 生成持久化） */
export const MEDIA_IMAGES_ROOT = join(resolveMediaDir(), 'images');

/** 附件根目录（文件上传保存位置） */
export const ATTACHMENTS_ROOT = resolveAttachmentsDir();

/** 静态服务/展示允许的全部图片根目录 */
export const IMAGE_ROOTS = [
  IMAGES_ROOT,
  MEDIA_IMAGES_ROOT,
  ATTACHMENTS_ROOT,
] as const;

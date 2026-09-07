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
 * K1 抽取器 IR 类型
 */
export interface ExtractedDocument {
  /** 源文件绝对路径 */
  path: string;
  /** 源文件扩展名（小写，含点） */
  ext: string;
  /** 统一文本层（进入 chunker/编译器管线） */
  text: string;
  /** PDF 逐页文本（文本层按页以 \n\n 连接；K4 页码证据回链的数据源） */
  pagesText?: string[];
  /** 行区间 ↔ page/表格 定位（K4 消费；page/section 从 1 起） */
  locators: Array<{
    lineStart: number;
    lineEnd: number;
    page?: number;
    section?: string;
    tableId?: string;
  }>;
  meta: {
    pageCount?: number;
    charCount: number;
    /** 源内容摘要（K5 内容指纹/增量用，先预留） */
    sourceDigest?: string;
  };
}

/** 抽取器接口（按扩展名注册） */
export interface DocumentExtractor {
  extensions: string[];
  extract(path: string): Promise<ExtractedDocument>;
}

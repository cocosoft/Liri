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
 * 第三方技能适配器 — 通用类型定义
 *
 * 定义 LocalSkillStore 和 BaseThirdPartyAdapter 依赖的通用接口，
 * 各适配器（ClawHub、Hermes 等）通过扩展这些接口定义自己的内部格式。
 */

/**
 * 第三方技能元数据（最小契约）
 * 每个适配器市场的内部技能格式只需满足此接口，
 * 具体市场特有字段（如 icon、readme、permissions）通过扩展添加。
 */
export interface ThirdPartySkillMeta {
  /** 技能 ID（在市场中的唯一标识） */
  id: string;
  /** 技能名称 */
  name: string;
  /** 版本号 */
  version: string;
  /** 简短描述 */
  description: string;
  /** 作者 */
  author: string;
  /** 许可证类型 */
  license?: string;
  /** 技能类别 */
  category?: string;
  /** 标签 */
  tags?: string[];
}

/**
 * 已安装的第三方技能（通用格式）
 * LocalSkillStore 以此类型管理本地存储。
 */
export interface InstalledThirdPartySkill {
  /** 技能元数据 */
  meta: ThirdPartySkillMeta;
  /** 安装路径 */
  installPath: string;
  /** 安装时间（Unix 毫秒） */
  installedAt: number;
  /** 最后更新时间（Unix 毫秒） */
  updatedAt: number;
  /** 是否启用 */
  enabled: boolean;
  /** 技能文件路径列表 */
  files: string[];
  /** 来源 URL */
  sourceUrl?: string;
}

/**
 * 本地技能搜索结果
 */
export interface LocalSkillSearchResult {
  /** 技能元数据 */
  skill: ThirdPartySkillMeta;
  /** 来源标识 */
  source: string;
  /** 相关度分数 */
  score?: number;
  /** 是否已安装 */
  installed?: boolean;
}

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
 * ClawHub 技能元数据类型
 * 扩展通用 ThirdPartySkillMeta，添加 ClawHub 特有字段。
 */

import type {
  ThirdPartySkillMeta,
  InstalledThirdPartySkill,
} from '../types';

/**
 * ClawHub 技能元数据（扩展通用格式）
 * @deprecated 通过 ClawHubConverter.toSkill() 转换为统一 Skill 类型
 */
export interface ClawHubSkillMeta extends ThirdPartySkillMeta {
  /** 图标 URL 或 base64 */
  icon?: string;
  /** 详细说明 */
  readme?: string;
  /** 依赖列表 */
  dependencies?: string[];
  /** ClawHub 权限声明 */
  permissions?: string[];
  /** 清单格式版本 */
  manifestVersion?: string;
  /** 来源标识 */
  source?: string;
}

/**
 * 已安装的 ClawHub 技能
 */
export interface InstalledClawHubSkill extends InstalledThirdPartySkill {
  meta: ClawHubSkillMeta;
}

/**
 * ClawHub 技能搜索结果（内部格式）
 */
export interface ClawHubSearchResult {
  skill: ClawHubSkillMeta;
  /** 来源标识 */
  source: string;
  /** 相关度分数 */
  score?: number;
  /** 是否已安装 */
  installed?: boolean;
}
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
 * 第三方技能适配器接口
 *
 * 定义可插拔的第三方技能市场接入契约，
 * 同时扩展 SkillLoader，可被 SkillRegistry.loadFrom() 统一消费。
 */

import type { Skill, SkillSource, SkillLoader } from '../../types';

/**
 * 技能搜索结果条目
 */
export interface ThirdPartySkillSearchResult {
  /** 技能 ID（在对应市场中的唯一标识） */
  id: string;
  /** 技能名称 */
  name: string;
  /** 版本号 */
  version: string;
  /** 简短描述 */
  description: string;
  /** 作者 */
  author: string;
  /** 许可证 */
  license?: string;
  /** 类别 */
  category?: string;
  /** 标签 */
  tags?: string[];
  /** 相关度分数 */
  score?: number;
  /** 是否已安装 */
  installed?: boolean;
}

/**
 * 第三方技能适配器接口
 *
 * 同时扩展 SkillLoader（提供 loadSkills），
 * 使得实现类可被 SkillRegistry.loadFrom() 统一消费。
 */
export interface ThirdPartySkillAdapter extends SkillLoader {
  /** 适配器标识（如 'clawhub'、'hermes'） */
  readonly name: string;

  /** 显示名称（如 'ClawHub 市场'） */
  readonly displayName: string;

  /**
   * 安装技能
   * @param skillId 技能 ID
   * @returns 安装后的 Skill 对象，失败返回 null
   */
  installSkill(skillId: string): Promise<Skill | null>;

  /**
   * 卸载技能
   * @param skillId 技能 ID
   */
  uninstallSkill(skillId: string): Promise<boolean>;

  /**
   * 搜索技能（在对应市场中查询）
   * @param query 搜索关键字
   * @param opts 过滤条件（category/tags/source，v1.5 透传修复）
   */
  searchSkills(
    query: string,
    opts?: { category?: string; tags?: string[]; source?: string }
  ): Promise<ThirdPartySkillSearchResult[]>;

  /**
   * 获取技能详情
   * @param skillId 技能 ID
   */
  getSkillDetail(skillId: string): Promise<ThirdPartySkillSearchResult | null>;
}

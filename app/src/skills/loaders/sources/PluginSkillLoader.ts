import { Skill, SkillSource, SkillFrontmatter } from '@modules/skills/types';
import { SkillLoader } from '../SkillLoader';
import {
  SkillProvider,
  SkillCandidate,
  PROVIDER_RANK,
  toCandidates,
} from '../SkillProvider';
import {
  parseSkillFrontmatter,
  createSkillCommand,
} from '@modules/skills/utils/skillParser';
import { validateSkillFrontmatter } from '@modules/skills/utils/skillValidator';
import { join, resolve, sep } from 'path';
import { existsSync } from 'fs';
import { PluginManager } from '@modules/plugins';
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
const logger = getLogger('skills:pluginLoader');
// 惰性初始化：顶层 PluginManager.getInstance() 会在 plugins 模块半初始化时触发 TDZ（循环导入）
let _pluginManager: PluginManager | undefined;
function getPluginManager(): PluginManager {
  _pluginManager ??= PluginManager.getInstance();
  return _pluginManager;
}

/**
 * 插件技能加载器
 * 从插件中加载技能
 */
export class PluginSkillLoader extends SkillLoader implements SkillProvider {
  readonly name = 'plugin';

  /**
   * 列出插件技能候选（locator = Skill 本体）
   */
  async list(): Promise<SkillCandidate[]> {
    return toCandidates(await this.loadSkills(), PROVIDER_RANK.PLUGIN);
  }

  /**
   * 按候选返回完整技能（当前全量加载，直接返回 locator）
   */
  get(candidate: SkillCandidate): Promise<Skill | undefined> {
    return Promise.resolve(candidate.locator as Skill);
  }

  /** 无内部缓存，预留契约 */
  invalidate(): void {
    // 当前加载器无缓存，无需失效
  }
  /**
   * 加载插件技能
   * @returns 技能列表
   */
  async loadSkills(): Promise<Skill[]> {
    const skills: Skill[] = [];

    try {
      // 获取所有插件
      const plugins = getPluginManager().getAllPlugins();

      for (const plugin of plugins) {
        const pluginId = plugin.repository;
        // 检查插件是否有技能
        if (plugin.manifest && plugin.manifest.skills) {
          const skillPaths = plugin.manifest.skills as string[];
          for (const skillPath of skillPaths) {
            try {
              // 2026-08-06 修复（低危 6）：skillPath 落界校验，
              // 防止插件清单被篡改后（skillPath 含 ../）路径穿越读取插件目录外任意文件
              const resolvedSkillPath = resolve(plugin.path, skillPath);
              if (
                resolvedSkillPath !== plugin.path &&
                !resolvedSkillPath.startsWith(plugin.path + sep)
              ) {
                logger.warning(
                  `Skill path escapes plugin directory, skipped: ${skillPath}`
                );
                continue;
              }
              const skillFilePath = resolvedSkillPath;

              // 检查技能文件是否存在
              if (!existsSync(skillFilePath)) {
                logger.warning(`Skill file not found: ${skillFilePath}`);
                continue;
              }

              // 读取技能文件内容
              const content = await import('fs/promises').then((fs) =>
                fs.readFile(skillFilePath, 'utf-8')
              );

              // 解析技能frontmatter
              const parsed = parseSkillFrontmatter(content);
              const frontmatter = parsed.frontmatter as SkillFrontmatter;
              const markdownContent = parsed.content;

              // 生成技能名称，添加插件前缀
              const skillName = `${pluginId}:${frontmatter.name || skillPath.replace(/\.md$/, '')}`;

              // 验证技能frontmatter
              const validation = validateSkillFrontmatter(
                frontmatter,
                skillName
              );
              if (!validation.valid) {
                logger.warning(
                  `Invalid skill ${skillName}: ${validation.errors.join(', ')}`
                );
                continue;
              }

              // 创建技能对象
              const skill = createSkillCommand({
                skillName,
                frontmatter,
                content: markdownContent,
                source: SkillSource.THIRD_PARTY,
                loadedFrom: 'plugin',
              });

              skills.push(skill);
            } catch (error) {
              // §1.9：统一 handleError；单技能加载失败跳过，不阻断其余
              handleError(error, {
                module: 'skills:pluginLoader',
                action: 'loadSkill',
                context: { pluginId },
              }).catch(() => {});
            }
          }
        }
      }
    } catch (error) {
      // §1.9：统一 handleError；插件技能整体加载失败不抛出（调用方拿部分结果）
      handleError(error, {
        module: 'skills:pluginLoader',
        action: 'loadPluginSkills',
      }).catch(() => {});
    }

    return skills;
  }

  /**
   * 获取技能来源
   * @returns 技能来源
   */
  getSource(): SkillSource {
    return SkillSource.THIRD_PARTY;
  }
}

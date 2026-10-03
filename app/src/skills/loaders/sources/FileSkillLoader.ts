/**
 * 文件系统技能加载器
 * 从指定目录加载技能文件（.md / .ts / .js）
 * 合并 UserSkillLoader + ProjectSkillLoader 的共有逻辑
 */

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
import { basename, dirname, join } from 'path';
// T-②06（2026-10-03）：演化侧车 `.evolution.md`（自动产物，**不改写**用户 SKILL.md 本体）
import { readSkillEvolutionFromDir } from '@modules/utils/promptEvolution';
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
const logger = getLogger('skills:fileLoader');

/** 文件系统加载器配置 */
export interface FileSkillLoaderConfig {
  /** 要扫描的目录列表 */
  directories: string[];
  /** 技能来源（如 THIRD_PARTY / OFFICIAL） */
  source: SkillSource;
  /** 加载来源标识（如 'user' / 'project'） */
  loadedFrom: string;
  /** 文件扩展名（默认 ['.md']） */
  extensions?: string[];
  /** 是否递归扫描子目录 */
  recursive?: boolean;
  /** 技能文件名模式（默认 'SKILL.md'） */
  skillFileName?: string;
}

/**
 * 文件系统技能加载器
 *
 * 统一处理从文件系统目录加载技能的共有逻辑。
 * 支持 .md / .ts / .js 技能文件格式。
 */
export class FileSkillLoader extends SkillLoader implements SkillProvider {
  private config: FileSkillLoaderConfig;

  /** Provider 唯一名称（按加载来源区分，如 file:user / file:project） */
  get name(): string {
    return `file:${this.config.loadedFrom}`;
  }

  /**
   * 列出文件系统技能候选（locator = Skill 本体）
   */
  async list(): Promise<SkillCandidate[]> {
    return toCandidates(
      await this.loadSkills(),
      this.config.source === SkillSource.OFFICIAL
        ? PROVIDER_RANK.OFFICIAL
        : PROVIDER_RANK.USER
    );
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
   * @param config 加载器配置
   */
  constructor(config: FileSkillLoaderConfig) {
    super();
    this.config = {
      extensions: ['.md'],
      recursive: false,
      skillFileName: 'SKILL.md',
      ...config,
    };
  }

  /**
   * 加载技能
   * @returns 技能列表
   */
  async loadSkills(): Promise<Skill[]> {
    const skills: Skill[] = [];
    const fs = await import('fs/promises');

    for (const dir of this.config.directories) {
      await this.loadFromDirectory(dir, skills, fs);
    }

    return skills;
  }

  /**
   * 从单个目录加载技能
   */
  private async loadFromDirectory(
    directory: string,
    skills: Skill[],
    fs: typeof import('fs/promises')
  ): Promise<void> {
    try {
      let entries: string[] = [];
      try {
        entries = await fs.readdir(directory);
      } catch (err) {
        // 目录不存在，跳过
        return;
      }

      const skillPromises = entries.map(async (entry) => {
        const fullPath = join(directory, entry);

        return this.loadSkillEntry(fullPath, entry, fs);
      });

      const results = await Promise.all(skillPromises);
      for (const skill of results) {
        if (skill) {
          skills.push(skill);
        }
      }
    } catch (error) {
      // §1.9：统一 handleError；目录加载失败不抛出（其余目录继续）
      handleError(error, {
        module: 'skills:fileLoader',
        action: 'loadDirectory',
        context: { directory },
      }).catch(() => {});
    }
  }

  /**
   * 加载单个目录条目
   */
  private async loadSkillEntry(
    fullPath: string,
    entry: string,
    fs: typeof import('fs/promises')
  ): Promise<Skill | null> {
    const ext = this.getExtension(entry);
    const isSkillFile = ext && this.config.extensions!.includes(ext);
    const isNamedSkillFile = entry === this.config.skillFileName;

    try {
      const stat = await fs.stat(fullPath);

      if (stat.isDirectory()) {
        // 子目录模式：查找 SKILL.md
        const skillFilePath = join(fullPath, this.config.skillFileName!);
        return await this.loadSkillFromFile(skillFilePath, entry, fs);
      }

      if (stat.isFile() && (isSkillFile || isNamedSkillFile)) {
        // 直接文件模式：读取并解析
        return await this.loadSkillFromFile(
          fullPath,
          this.getNameWithoutExt(entry),
          fs
        );
      }

      return null;
    } catch (err) {
      // @ignore-catch — 目录条目读取失败跳过该条目（其余继续扫描）
      return null;
    }
  }

  /**
   * 从文件加载技能
   */
  private async loadSkillFromFile(
    filePath: string,
    skillName: string,
    fs: typeof import('fs/promises')
  ): Promise<Skill | null> {
    try {
      await fs.access(filePath);
    } catch (err) {
      // @ignore-catch — 文件不存在属正常扫描场景，返回 null 跳过
      return null;
    }

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const parsed = parseSkillFrontmatter(content);
      const frontmatter = parsed.frontmatter as SkillFrontmatter;
      // T-②06：目录形态（SKILL.md）追加同目录 `.evolution.md` 侧车（自动演化产物）
      const markdownContent = this.mergeEvolutionSidecar(
        filePath,
        parsed.content
      );

      const validation = validateSkillFrontmatter(frontmatter, skillName);
      if (!validation.valid) {
        logger.warning(
          `Invalid skill ${skillName}: ${validation.errors.join(', ')}`
        );
        return null;
      }

      return createSkillCommand({
        skillName,
        frontmatter,
        content: markdownContent,
        source: this.config.source,
        loadedFrom: this.config.loadedFrom,
      });
    } catch (error) {
      // §1.9：统一 handleError；单技能解析失败返回 null（不阻断其余）
      handleError(error, {
        module: 'skills:fileLoader',
        action: 'loadSkillFromFile',
        context: { filePath },
      }).catch(() => {});
      return null;
    }
  }

  /**
   * T-②06（2026-10-03）：目录形态（`SKILL.md`）追加**同目录** `.evolution.md` 侧车。
   *
   * 侧车是经验自动演化产物：**只追加、不改写**用户 `SKILL.md` 本体（可回滚，见
   * `utils/promptEvolution`）。直接文件形态（`<dir>/<name>.md`）与无侧车 ⇒ 原文返回（零变化）。
   */
  private mergeEvolutionSidecar(filePath: string, content: string): string {
    if (basename(filePath) !== this.config.skillFileName) return content;
    const evolution = readSkillEvolutionFromDir(dirname(filePath));
    if (!evolution) return content;
    return `${content}\n\n---\n\n## 经验演化补充（自动生成 · 可回滚）\n\n${evolution}\n`;
  }

  /**
   * 获取文件扩展名
   */
  private getExtension(filename: string): string | null {
    const idx = filename.lastIndexOf('.');
    return idx >= 0 ? filename.slice(idx) : null;
  }

  /**
   * 获取文件名（不含扩展名）
   */
  private getNameWithoutExt(filename: string): string {
    const idx = filename.lastIndexOf('.');
    return idx >= 0 ? filename.slice(0, idx) : filename;
  }

  /**
   * 获取技能来源
   */
  getSource(): SkillSource {
    return this.config.source;
  }
}

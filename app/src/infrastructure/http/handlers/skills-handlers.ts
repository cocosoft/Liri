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
 * skills-handlers.ts — 技能领域 HTTP 处理器（从 LocalHTTPService.ts 迁移）
 */

import type http from 'http';
import fs from 'fs';
import path from 'path';

import { Logger, LogLevel } from '@modules/monitoring';
import { broadcastEvent, readRequestBody, sendError } from './handler-utils';
import type { SkillSearchEngine } from '@modules/skills/loaders/adapter/SkillSearchEngine';
import type { LocalSkillStore } from '@modules/skills/loaders/adapter/LocalSkillStore';

const logger = new Logger({ module: 'http:skills', level: LogLevel.INFO });

/** SkillRegistry 最小接口（5.6：system 列表 status 反映真实启用状态） */
interface SkillRegistryLike {
  get(
    name: string,
    opts?: { includeDisabled?: boolean }
  ): { name: string; isEnabled?: () => boolean } | undefined;
}

/** ClawHubAdapter 方法的最小接口（与真实实现对齐，v1.5 阶段 3：消除 as unknown as 断言） */
interface ClawHubAdapterLike {
  initialize(): Promise<void>;
  getInstalledSkills(): Promise<unknown[]>;
  searchSkills(
    query: string,
    opts?: { category?: string; tags?: string[]; source?: string }
  ): Promise<unknown[]>;
  getSearchEngine(): SkillSearchEngine;
  getSkillDetail(id: string): Promise<unknown>;
  getRemoteVersion(id: string): Promise<string | null>;
  getSkillRegistry(): SkillRegistryLike | null;
  installSkill(id: string, sourceUrl?: string): Promise<unknown>;
  uninstallSkill(id: string): Promise<unknown>;
  updateSkill(id: string): Promise<unknown>;
  enableSkill(id: string): Promise<void>;
  disableSkill(id: string): Promise<void>;
  getLocalStore(): LocalSkillStore;
}

async function reloadUserSkillsAfterWrite(): Promise<void> {
  try {
    const { reloadUserSkills } =
      await import('@modules/constants/systemPromptSections');
    await reloadUserSkills();
  } catch (err) {
    logger.warning('用户技能重载失败（不影响已落盘文件）', {
      error: String(err),
    });
  }
}

async function getClawHubAdapter(): Promise<ClawHubAdapterLike> {
  const { ClawHubAdapter } =
    await import('@modules/skills/loaders/adapter/clawhub/ClawHubAdapter');

  // 优先从注册表获取（instanceof 收窄到真实类型；initialize 幂等）
  try {
    const { thirdPartyAdapterRegistry } =
      await import('@modules/skills/loaders/adapter/ThirdPartyAdapterRegistry');
    const registered = thirdPartyAdapterRegistry.get('clawhub');
    if (registered instanceof ClawHubAdapter) {
      await registered.initialize();
      return registered;
    }
  } catch (_err) {
    // 注册表不可用时 fallback
  }

  // Fallback: 单例
  const adapter = ClawHubAdapter.getInstance();
  await adapter.initialize();

  return adapter;
}

export async function handleListSkills(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const adapter = await getClawHubAdapter();
    const skills = await adapter.getInstalledSkills();

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ skills }));
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleListSystemSkills(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { resolveProjectRoot, resolvePyappHome } =
      await import('@modules/core/paths');
    const { parseSkillFrontmatter } =
      await import('@modules/skills/utils/skillParser');
    const { readdir, readFile, stat } = await import('fs/promises');
    const { existsSync, readFileSync } = await import('fs');
    const { join } = await import('path');

    // 5.6：status 反映真实启用状态 —— 本地技能（导入审批 .enabled 标记）优先，其次 registry
    const adapter = await getClawHubAdapter();
    const registry = adapter.getSkillRegistry();
    const userSkillsDir = join(resolvePyappHome(), 'skills');
    const resolveStatus = (name: string): string => {
      try {
        // 本地技能：.enabled 文件为导入权限审批标记（true/false）
        const enabledFile = join(userSkillsDir, name, '.enabled');
        if (existsSync(enabledFile)) {
          return readFileSync(enabledFile, 'utf-8').trim() === 'true'
            ? 'enabled'
            : 'disabled';
        }
        // registry 真实状态（内置/市场技能）
        const skill = registry?.get(name, { includeDisabled: true });
        if (skill && skill.isEnabled && !skill.isEnabled()) {
          return 'disabled';
        }
      } catch {
        // 状态解析异常时默认 enabled
      }
      return 'enabled';
    };

    const skills: Record<string, unknown>[] = [];
    const seen = new Set<string>();

    const scanDir = async (
      dir: string,
      source: string,
      opts?: {
        /** 排除的子目录名（如 vendor，避免第三方技能被误标为 user） */
        exclude?: string[];
      }
    ) => {
      if (!existsSync(dir)) return;
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (opts?.exclude?.includes(entry.name)) continue;
        // 子目录：查找 SKILL.md
        if (entry.isDirectory()) {
          const skillDir = join(dir, entry.name);
          const skillMdPath = join(skillDir, 'SKILL.md');
          try {
            await stat(skillMdPath); // 检查 SKILL.md 是否存在
            const content = await readFile(skillMdPath, 'utf-8');
            const parsed = parseSkillFrontmatter(content);
            const name = entry.name;
            const description = parsed.frontmatter?.description || '';
            const fm = parsed.frontmatter as Record<string, unknown>;
            const version = fm?.version || '1.0.0';
            const author = fm?.author || '';
            const category = fm?.category || 'general';

            if (seen.has(name)) continue;
            seen.add(name);

            let createdAt = 0;
            let updatedAt = 0;
            try {
              const st = await stat(skillMdPath);
              createdAt = st.birthtimeMs;
              updatedAt = st.mtimeMs;
            } catch (_err) {
              /* use defaults */
            }

            skills.push({
              id: name,
              name,
              description,
              status: resolveStatus(name),
              category,
              parameters: [],
              createdAt,
              updatedAt,
              usageCount: 0,
              lastUsedAt: null,
              source,
              version,
              filePath: skillMdPath,
              frontmatter: { author, version, category },
            });
          } catch (_err) {
            // 没有 SKILL.md 的子目录跳过
            continue;
          }
          continue;
        }

        // 根目录下的 .md 文件（兼容旧结构）
        if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
        const filePath = join(dir, entry.name);
        try {
          const content = await readFile(filePath, 'utf-8');
          const parsed = parseSkillFrontmatter(content);
          const name = entry.name.replace(/\.md$/, '');
          const description = parsed.frontmatter?.description || '';
          const fm = parsed.frontmatter as Record<string, unknown>;
          const version = fm?.version || '1.0.0';
          const author = fm?.author || '';
          const category = fm?.category || 'general';

          if (seen.has(name)) continue;
          seen.add(name);

          let createdAt = 0;
          let updatedAt = 0;
          try {
            const st = await stat(filePath);
            createdAt = st.birthtimeMs;
            updatedAt = st.mtimeMs;
          } catch (_err) {
            /* use defaults */
          }

          skills.push({
            id: name,
            name,
            description,
            status: resolveStatus(name),
            category,
            parameters: [],
            createdAt,
            updatedAt,
            usageCount: 0,
            lastUsedAt: null,
            source,
            version,
            filePath,
            frontmatter: { author, version, category },
          });
        } catch (_err) {
          /* skip malformed files */
        }
      }
    };

    // 扫描内置技能
    const projectRoot = resolveProjectRoot();
    const builtinDir = join(projectRoot, 'app', 'src', 'builtin', 'skills');
    await scanDir(builtinDir, 'builtin');

    // 扫描用户技能（userSkillsDir 已在 resolveStatus 前声明）
    // 2026-08-06：排除 vendor 子目录（第三方技能独立，避免误标为 user）
    await scanDir(userSkillsDir, 'user', { exclude: ['vendor'] });

    // 2026-08-06：扫描第三方技能（~/.pyapp/skills/vendor/），标为 third_party
    const { resolveVendorSkillsDir } = await import('@modules/core/paths');
    await scanDir(resolveVendorSkillsDir(), 'third_party');

    // 2026-08-06：补充 BundledSkillLoader 注册的内置技能（BUILTIN 源，程序化定义非 SKILL.md 文件）
    // 归一化：按 skill.source 映射真实来源（builtin/official/third_party），不再硬编码 builtin
    try {
      const { skillRegistry: builtinRegistry } =
        await import('@modules/constants/systemPromptSections');
      for (const skill of builtinRegistry.getAll({ includeDisabled: true })) {
        if (seen.has(skill.name)) continue;
        seen.add(skill.name);
        const sourceMap: Record<string, string> = {
          builtin: 'builtin',
          official: 'official',
          third_party: 'third_party',
        };
        skills.push({
          id: skill.name,
          name: skill.name,
          description: skill.description || '',
          status: resolveStatus(skill.name),
          category: 'general',
          parameters: [],
          createdAt: 0,
          updatedAt: 0,
          usageCount: 0,
          lastUsedAt: null,
          source: sourceMap[String(skill.source)] || 'builtin',
          version: skill.version || '1.0.0',
          filePath: `registry:${skill.name}`,
          frontmatter: {
            author: '',
            version: skill.version || '1.0.0',
            category: 'general',
          },
        });
      }
    } catch (_err) {
      // @ignore-catch: 内置技能注册表不可用时跳过（不阻断用户技能列表）
    }

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ skills, total: skills.length }));
  } catch (err) {
    sendError(res, err);
  }
}

async function validateSkillIdParam(
  rawId: string,
  res: http.ServerResponse
): Promise<string | null> {
  const { validateSkillId } =
    await import('@modules/skills/loaders/adapter/safeSkillId');
  const decoded = decodeURIComponent(rawId);
  const idError = validateSkillId(decoded);
  if (idError) {
    res.writeHead(400, {
      'Content-Type': 'application/json; charset=utf-8',
    });
    res.end(
      JSON.stringify({
        error: { code: 'INVALID_PARAM', message: idError },
      })
    );
    return null;
  }
  return decoded;
}

async function skillRelError(rel: string): Promise<string | null> {
  if (!rel) return '空路径';
  const normalized = rel.replace(/\\/g, '/');
  if (normalized.includes('..')) return `非法条目路径: ${rel}`;
  if (path.isAbsolute(normalized) || /^[a-zA-Z]:/.test(normalized)) {
    return `非法条目路径: ${rel}`;
  }
  const { validateSkillId } =
    await import('@modules/skills/loaders/adapter/safeSkillId');
  for (const seg of normalized.split('/')) {
    if (!seg || seg === '.') continue;
    const err = validateSkillId(seg);
    if (err) return `非法条目路径: ${rel} (${err})`;
  }
  return null;
}

function sanitizeSkillFrontmatterValue(value: string, maxLen: number): string {
  return value
    .replace(/[\r\n]+/g, ' ')
    .replace(/^---\s*/, '')
    .slice(0, maxLen)
    .trim();
}

export async function handleSystemSkillContent(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  skillId: string
): Promise<void> {
  try {
    const { validateSkillId } =
      await import('@modules/skills/loaders/adapter/safeSkillId');
    const decodedId = decodeURIComponent(skillId);
    const idError = validateSkillId(decodedId);
    if (idError) {
      res.writeHead(400, {
        'Content-Type': 'application/json; charset=utf-8',
      });
      res.end(
        JSON.stringify({
          error: { code: 'INVALID_PARAM', message: idError },
        })
      );
      return;
    }

    const { readFile } = await import('fs/promises');
    const { existsSync } = await import('fs');
    const { resolveProjectRoot, resolvePyappHome } =
      await import('@modules/core/paths');
    const pathMod = await import('path');

    const candidateDirs = [
      pathMod.join(
        resolveProjectRoot(),
        'app',
        'src',
        'builtin',
        'skills',
        decodedId
      ),
      pathMod.join(resolvePyappHome(), 'skills', decodedId),
    ];

    let skillFile = '';
    for (const dir of candidateDirs) {
      const candidate = pathMod.join(dir, 'SKILL.md');
      if (existsSync(candidate)) {
        skillFile = candidate;
        break;
      }
    }

    if (!skillFile) {
      // 2026-08-06：内置技能为程序化定义（BundledSkillLoader），无 SKILL.md 文件；
      // 回退读取 registry 中 BUILTIN 源技能的 prompt 内容
      try {
        const { skillRegistry: builtinRegistry } =
          await import('@modules/constants/systemPromptSections');
        const bundled = builtinRegistry.get(decodedId);
        if (bundled?.impl?.kind === 'prompt') {
          const prompts = await bundled.impl.getPromptForCommand('', {});
          const content = prompts.map((p) => p.text).join('\n');
          res.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
          });
          res.end(
            JSON.stringify({
              content,
              rawContent: content,
              frontmatter: {
                name: bundled.name,
                description: bundled.description,
                version: bundled.version || '1.0.0',
              },
              linkedFiles: [],
            })
          );
          return;
        }
      } catch (_err) {
        // @ignore-catch: 内置技能回退失败则正常 404
      }
      res.writeHead(404, {
        'Content-Type': 'application/json; charset=utf-8',
      });
      res.end(JSON.stringify({ error: { message: '技能未找到' } }));
      return;
    }

    const rawContent = await readFile(skillFile, 'utf-8');
    let content = rawContent;
    const frontmatter: Record<string, unknown> = {};
    const linkedFiles: string[] = [];

    const fmMatch = rawContent.match(/^---\n([\s\S]*?)\n---\n/);
    if (fmMatch) {
      content = rawContent.slice(fmMatch[0].length);
      const lines = fmMatch[1].split('\n');
      for (const line of lines) {
        const m = line.match(/^(\w[\w-]*):\s*(.+)$/);
        if (m) frontmatter[m[1]] = m[2].trim();
      }
    }

    // 收集关联文件
    const skillDir = pathMod.dirname(skillFile);
    try {
      const entries = await (
        await import('fs/promises')
      ).readdir(skillDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name !== 'SKILL.md') {
          linkedFiles.push(entry.name);
        }
      }
    } catch (_err) {
      /* ignore */
    }

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        content,
        rawContent,
        frontmatter,
        linkedFiles,
      })
    );
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleExportSkills(
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { resolvePyappHome } = await import('@modules/core/paths');
    const { default: AdmZipClass } = await import('adm-zip');

    const userSkillsDir = path.join(resolvePyappHome(), 'skills');
    const zip = new AdmZipClass();

    if (fs.existsSync(userSkillsDir)) {
      const entries = fs.readdirSync(userSkillsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (
          entry.name.startsWith('.') ||
          entry.name.endsWith('.tmp') ||
          entry.name.endsWith('.bak')
        ) {
          continue; // 跳过隐藏/过渡目录（v1.5：导出不含 .tmp/.bak）
        }
        const skillDir = path.join(userSkillsDir, entry.name);
        const zipPrefix = `skills/${entry.name}`;
        // skill.json（元数据，从 SKILL.md frontmatter 提取）
        const skillMd = path.join(skillDir, 'SKILL.md');
        if (fs.existsSync(skillMd)) {
          const raw = fs.readFileSync(skillMd, 'utf-8');
          const fm = raw.match(/^---\n([\s\S]*?)\n---\n/);
          const meta: Record<string, unknown> = {};
          if (fm) {
            for (const line of fm[1].split('\n')) {
              const m = line.match(/^(\w[\w-]*):\s*(.+)$/);
              if (m) meta[m[1]] = m[2].trim();
            }
          }
          zip.addFile(
            `${zipPrefix}/skill.json`,
            Buffer.from(
              JSON.stringify(
                { id: entry.name, ...meta, manifestVersion: '1.0' },
                null,
                2
              ),
              'utf-8'
            )
          );
        }
        zip.addLocalFolder(skillDir, zipPrefix);
      }
    }

    const buffer = zip.toBuffer();
    res.writeHead(200, {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="skills-export-${Date.now()}.zip"`,
    });
    res.end(buffer);
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleImportSkill(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { resolvePyappHome } = await import('@modules/core/paths');
    const body = JSON.parse((await readRequestBody(req)) || '{}');

    const userSkillsDir = path.join(resolvePyappHome(), 'skills');
    let skillId = '';
    let files: Record<string, string> = {};

    if (typeof body.zipBase64 === 'string') {
      const { default: AdmZipClass } = await import('adm-zip');
      const zip = new AdmZipClass(Buffer.from(body.zipBase64, 'base64'));
      for (const entry of zip.getEntries()) {
        if (entry.isDirectory) continue;
        const parts = entry.entryName
          .replace(/\\/g, '/')
          .split('/')
          .filter(Boolean);
        // 顶层目录名作为技能 id（skills/<id>/... 或 <id>/...）
        const first = parts[0];
        if (!skillId) skillId = first === 'skills' ? parts[1] || '' : first;
        const rel = (first === 'skills' ? parts.slice(2) : parts.slice(1)).join(
          '/'
        );
        if (!rel) continue;
        // zip-slip 防护（S0-2 强化）：规范化路径必须落在技能目录内
        const relErr = await skillRelError(rel);
        if (relErr) {
          res.writeHead(400, {
            'Content-Type': 'application/json; charset=utf-8',
          });
          res.end(
            JSON.stringify({
              error: {
                code: 'SKILL_IMPORT_REJECTED',
                message: `${relErr}（来源: ${entry.entryName}）`,
              },
            })
          );
          return;
        }
        files[rel] = entry.getData().toString('utf-8');
      }
    } else if (body.skillId && body.files && typeof body.files === 'object') {
      skillId = String(body.skillId);
      files = body.files;
      // S0-2：JSON files 分支 rel 校验（此前遗漏，可写出任意路径）
      for (const rel of Object.keys(files)) {
        const relErr = await skillRelError(rel);
        if (relErr) {
          res.writeHead(400, {
            'Content-Type': 'application/json; charset=utf-8',
          });
          res.end(
            JSON.stringify({
              error: { code: 'SKILL_IMPORT_REJECTED', message: relErr },
            })
          );
          return;
        }
      }
    } else if (Array.isArray(body.skills)) {
      // S2-1 双兼容：{ skills: [{ name, description, category }] } 简易导入
      const { sanitizeSkillId } =
        await import('@modules/skills/loaders/adapter/safeSkillId');
      const imported: string[] = [];
      for (const item of body.skills) {
        if (!item || typeof item.name !== 'string' || !item.name.trim()) {
          continue;
        }
        const name = item.name.trim();
        const safeName = sanitizeSkillId(name) || 'unnamed-skill';
        const skillDir = path.join(userSkillsDir, safeName);
        fs.mkdirSync(skillDir, { recursive: true });
        const frontmatter = [
          '---',
          `name: ${sanitizeSkillFrontmatterValue(name, 200)}`,
          `description: ${sanitizeSkillFrontmatterValue(
            String(item.description ?? ''),
            1000
          )}`,
          `category: ${sanitizeSkillFrontmatterValue(
            String(item.category ?? 'general'),
            100
          )}`,
          'version: 1.0.0',
          '---',
          '',
        ].join('\n');
        fs.writeFileSync(path.join(skillDir, 'SKILL.md'), frontmatter, 'utf-8');
        imported.push(safeName);
      }
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
      });
      res.end(JSON.stringify({ success: true, imported }));
      // 写盘后重载 registry，使新技能立即可被 SkillTool/注入感知（不阻塞响应）
      void reloadUserSkillsAfterWrite();
      return;
    }

    if (!skillId || Object.keys(files).length === 0) {
      res.writeHead(400, {
        'Content-Type': 'application/json; charset=utf-8',
      });
      res.end(
        JSON.stringify({
          error: {
            code: 'INVALID_PARAM',
            message: '需要 zipBase64 或 skillId+files',
          },
        })
      );
      return;
    }

    // 基础 id 校验（v1.5 阶段 4：safeSkillId 白名单）
    const { validateSkillId } =
      await import('@modules/skills/loaders/adapter/safeSkillId');
    const idError = validateSkillId(skillId);
    if (idError) {
      res.writeHead(400, {
        'Content-Type': 'application/json; charset=utf-8',
      });
      res.end(
        JSON.stringify({
          error: { code: 'INVALID_PARAM', message: idError },
        })
      );
      return;
    }

    const target = path.join(userSkillsDir, skillId);
    fs.mkdirSync(target, { recursive: true });
    for (const [rel, content] of Object.entries(files)) {
      const dest = path.join(target, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, content, 'utf-8');
    }

    // 导入权限审批（v1.5 阶段 4，P3-13）：解析 SKILL.md permissions，
    // 含敏感权限（file-write/command/host-access）→ 先落盘"未启用"，待用户确认
    let requiresApproval = false;
    const skillMdPath = path.join(target, 'SKILL.md');
    if (fs.existsSync(skillMdPath)) {
      const { parseSkillPermissions, hasSensitivePermission } =
        await import('@modules/skills/loaders/adapter/SkillPermission');
      const permissions = parseSkillPermissions(
        fs.readFileSync(skillMdPath, 'utf-8')
      );
      if (hasSensitivePermission(permissions)) {
        fs.writeFileSync(path.join(target, '.enabled'), 'false', 'utf-8');
        requiresApproval = true;
      }
    }

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true, skillId, requiresApproval }));
    // 写盘后重载 registry，使新技能立即可被 SkillTool/注入感知（不阻塞响应）
    void reloadUserSkillsAfterWrite();
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleCloneSkill(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  skillId: string
): Promise<void> {
  try {
    const decoded = await validateSkillIdParam(skillId, res);
    if (decoded === null) return;

    const { resolvePyappHome } = await import('@modules/core/paths');
    const userSkillsDir = path.join(resolvePyappHome(), 'skills');
    const src = path.join(userSkillsDir, decoded);

    if (!fs.existsSync(src)) {
      res.writeHead(404, {
        'Content-Type': 'application/json; charset=utf-8',
      });
      res.end(
        JSON.stringify({
          error: { code: 'SKILL_NOT_FOUND', message: '技能未找到' },
        })
      );
      return;
    }

    let newId = `${skillId}-copy`;
    let counter = 2;
    while (fs.existsSync(path.join(userSkillsDir, newId))) {
      newId = `${skillId}-copy${counter}`;
      counter++;
    }

    fs.cpSync(src, path.join(userSkillsDir, newId), { recursive: true });

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true, skillId: newId }));
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleSkillFiles(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  skillId: string
): Promise<void> {
  try {
    const decoded = await validateSkillIdParam(skillId, res);
    if (decoded === null) return;

    const { resolvePyappHome } = await import('@modules/core/paths');
    const userSkillsDir = path.join(resolvePyappHome(), 'skills');
    const skillDir = path.join(userSkillsDir, decoded);

    if (!fs.existsSync(skillDir)) {
      res.writeHead(404, {
        'Content-Type': 'application/json; charset=utf-8',
      });
      res.end(
        JSON.stringify({
          error: { code: 'SKILL_NOT_FOUND', message: '技能未找到' },
        })
      );
      return;
    }

    const files: Array<{ name: string; size: number }> = [];
    const walk = (dir: string, prefix: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          walk(full, rel);
        } else {
          files.push({ name: rel, size: fs.statSync(full).size });
        }
      }
    };
    walk(skillDir, '');

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ files }));
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleSystemSkillFileContent(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  skillId: string
): Promise<void> {
  try {
    // S0-1：skillId 与 filePath 双重校验
    const decodedId = await validateSkillIdParam(skillId, res);
    if (decodedId === null) return;

    const urlObj = new URL(req.url!, `http://${req.headers.host}`);
    const filePath = urlObj.searchParams.get('path') || '';

    const pathErr = await skillRelError(filePath);
    if (pathErr) {
      res.writeHead(400, {
        'Content-Type': 'application/json; charset=utf-8',
      });
      res.end(
        JSON.stringify({
          error: { code: 'INVALID_PARAM', message: pathErr },
        })
      );
      return;
    }

    const { resolveProjectRoot, resolvePyappHome } =
      await import('@modules/core/paths');
    const candidateDirs = [
      path.join(
        resolveProjectRoot(),
        'app',
        'src',
        'builtin',
        'skills',
        decodedId
      ),
      path.join(resolvePyappHome(), 'skills', decodedId),
    ];

    let target = '';
    for (const dir of candidateDirs) {
      const candidate = path.join(dir, filePath);
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        target = candidate;
        break;
      }
    }

    if (!target) {
      res.writeHead(404, {
        'Content-Type': 'application/json; charset=utf-8',
      });
      res.end(
        JSON.stringify({
          error: { code: 'SKILL_NOT_FOUND', message: '文件未找到' },
        })
      );
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ content: fs.readFileSync(target, 'utf-8') }));
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleSearchSkills(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const urlObj = new URL(req.url!, `http://${req.headers.host}`);
    const query = urlObj.searchParams.get('q') || '';
    const category = urlObj.searchParams.get('category') || undefined;
    const tagsStr = urlObj.searchParams.get('tags') || undefined;
    const tags = tagsStr ? tagsStr.split(',').map((t) => t.trim()) : undefined;
    const source = urlObj.searchParams.get('source') || undefined;

    const adapter = await getClawHubAdapter();
    const results = await adapter.searchSkills(query, {
      category,
      tags,
      source,
    });

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ results }));
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleRecommendedSkills(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const urlObj = new URL(req.url!, `http://${req.headers.host}`);
    const limit = parseInt(urlObj.searchParams.get('limit') || '10', 10);

    const adapter = await getClawHubAdapter();
    const installed = await adapter.getInstalledSkills();
    const installedIds = new Set(
      installed.map((s: unknown) => (s as { meta: { id: string } }).meta.id)
    );

    const searchEngine = adapter.getSearchEngine();
    const allResults = await searchEngine.searchRemote('', {});

    const recommended = allResults
      .filter(
        (r: unknown) =>
          !installedIds.has((r as { skill: { id: string } }).skill.id)
      )
      .slice(0, limit)
      .map((r: unknown) => ({
        ...(r as Record<string, unknown>),
        installed: false,
      }));

    const categories = getSkillCategoryMap(installed);

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ recommended, categories }));
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleSkillCategories(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { PLUGIN_CATEGORIES } =
      await import('@modules/plugins/categories/PluginCategories');

    const adapter = await getClawHubAdapter();
    const installed = await adapter.getInstalledSkills();

    const categoryMap = getSkillCategoryMap(installed);

    const categories = Object.entries(PLUGIN_CATEGORIES).map(([key, cat]) => ({
      id: key,
      capability: cat.capability,
      description: cat.description,
      count: categoryMap[key] || 0,
    }));

    const sourceMap = getSkillSourceMap(installed);

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ categories, sourceDistribution: sourceMap }));
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleSkillSources(
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const adapter = await getClawHubAdapter();
    const searchEngine = adapter.getSearchEngine();
    const sources = searchEngine.getSourceNames() as string[];

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ sources }));
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleAddSkillSource(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = await readRequestBody(req);
    const { name, apiBaseUrl } = JSON.parse(body || '{}');

    if (
      !name ||
      !apiBaseUrl ||
      typeof name !== 'string' ||
      typeof apiBaseUrl !== 'string'
    ) {
      res.writeHead(400, {
        'Content-Type': 'application/json; charset=utf-8',
      });
      res.end(
        JSON.stringify({ error: { message: '需要 name 和 apiBaseUrl 字段' } })
      );
      return;
    }

    const adapter = await getClawHubAdapter();
    const searchEngine = adapter.getSearchEngine();
    searchEngine.addCustomSource(name.trim(), apiBaseUrl.trim());

    const sources = searchEngine.getSourceNames() as string[];
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true, sources }));
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleRemoveSkillSource(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  name: string
): Promise<void> {
  try {
    const adapter = await getClawHubAdapter();
    const searchEngine = adapter.getSearchEngine();
    searchEngine.removeCustomSource(decodeURIComponent(name));

    const sources = searchEngine.getSourceNames() as string[];
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true, sources }));
  } catch (err) {
    sendError(res, err);
  }
}

function getSkillCategoryMap(installed: unknown[]): Record<string, number> {
  const map: Record<string, number> = {};

  for (const skill of installed) {
    const s = skill as { meta: { source?: string } };
    const source = s.meta.source || 'third_party';

    if (source === 'builtin') {
      map['builtin'] = (map['builtin'] || 0) + 1;
    } else {
      map['skill'] = (map['skill'] || 0) + 1;
    }
  }

  return map;
}

function getSkillSourceMap(installed: unknown[]): Record<string, number> {
  const map: Record<string, number> = {};

  for (const skill of installed) {
    const s = skill as { meta: { source?: string } };
    const source = s.meta.source || 'unknown';
    map[source] = (map[source] || 0) + 1;
  }

  return map;
}

export async function handleGetSkillDetail(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  skillId: string
): Promise<void> {
  try {
    const adapter = await getClawHubAdapter();
    const skill = await adapter.getSkillDetail(skillId);

    if (!skill) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: `技能未找到: ${skillId}` } }));
      return;
    }

    // P3-23: 附带远端最新版本（repo/market 双形态；失败静默降级为 null）
    let remoteVersion: string | null = null;
    try {
      remoteVersion = await adapter.getRemoteVersion(skillId);
    } catch {
      // 远端不可达时前端降级为"未知"，不显示"有更新"
    }

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ skill, remoteVersion }));
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleInstallSkill(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = await readRequestBody(req);
    if (!body) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ error: { message: 'request body is required' } })
      );
      return;
    }

    const parsedBody = JSON.parse(body);
    const { skillId, sourceUrl } = parsedBody;

    if (!skillId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'skillId is required' } }));
      return;
    }

    const adapter = await getClawHubAdapter();
    const installed = await adapter.installSkill(skillId, sourceUrl);

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true, skill: installed }));
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleUninstallSkill(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  skillId: string
): Promise<void> {
  try {
    const adapter = await getClawHubAdapter();
    await adapter.uninstallSkill(skillId);

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true }));
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleUpdateSkill(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  skillId: string
): Promise<void> {
  try {
    const adapter = await getClawHubAdapter();
    const updated = await adapter.updateSkill(skillId);

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true, skill: updated }));
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleToggleSkill(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  skillId: string
): Promise<void> {
  try {
    const body = await readRequestBody(req);
    const parsedBody = body ? JSON.parse(body) : {};
    const enabled = parsedBody.enabled;

    const adapter = await getClawHubAdapter();

    if (enabled === true) {
      await adapter.enableSkill(skillId);
      await applyLocalSkillEnabled(skillId, true);
    } else if (enabled === false) {
      await adapter.disableSkill(skillId);
      await applyLocalSkillEnabled(skillId, false);
    } else {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: { message: 'enabled field is required (true/false)' },
        })
      );
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true, enabled }));
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleCreateSkill(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = JSON.parse((await readRequestBody(req)) || '{}');
    const { action } = body;

    if (action === 'install') {
      const { skillId, sourceUrl } = body;
      if (!skillId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: { code: 'INVALID_PARAM', message: 'install 需要 skillId' },
          })
        );
        return;
      }
      const adapter = await getClawHubAdapter();
      const skill = await adapter.installSkill(skillId, sourceUrl);
      if (!skill) {
        // 3.6 安装结果如实反馈：失败/已存在 → 409
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: {
              code: 'SKILL_ALREADY_INSTALLED',
              message: `技能安装失败或已存在: ${skillId}`,
            },
          })
        );
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
      });
      res.end(JSON.stringify(skill));
      broadcastEvent('skill:created', { skill });
      return;
    }

    if (action === 'create') {
      const { name, description, category } = body;
      if (!name || typeof name !== 'string') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: { code: 'INVALID_PARAM', message: 'create 需要 name' },
          })
        );
        return;
      }
      const skill = await createLocalSkill(
        name,
        description || '',
        category || 'general'
      );
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
      });
      res.end(JSON.stringify(skill));
      broadcastEvent('skill:created', { skill });
      return;
    }

    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        error: {
          code: 'INVALID_PARAM',
          message: 'action 必填，取值 install|create',
        },
      })
    );
  } catch (err) {
    sendError(res, err);
  }
}

async function createLocalSkill(
  name: string,
  description: string,
  category: string
): Promise<Record<string, unknown>> {
  const { resolvePyappHome } = await import('@modules/core/paths');
  const userSkillsDir = path.join(resolvePyappHome(), 'skills');
  // 目录名清洗（v1.5 阶段 4：safeSkillId）
  const { sanitizeSkillId } =
    await import('@modules/skills/loaders/adapter/safeSkillId');
  const safeName = sanitizeSkillId(name) || 'unnamed-skill';
  // S0-4：frontmatter 注入防护 —— 拦截 \n / --- 注入，限制长度
  const cleanName = sanitizeSkillFrontmatterValue(name, 200) || safeName;
  const cleanDescription = sanitizeSkillFrontmatterValue(description, 1000);
  const cleanCategory = sanitizeSkillFrontmatterValue(
    category || 'general',
    100
  );
  const skillDir = path.join(userSkillsDir, safeName);

  fs.mkdirSync(skillDir, { recursive: true });
  const frontmatter = [
    '---',
    `name: ${cleanName}`,
    `description: ${cleanDescription}`,
    `category: ${cleanCategory}`,
    'version: 1.0.0',
    '---',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), frontmatter, 'utf-8');

  return {
    id: safeName,
    name: cleanName,
    description: cleanDescription,
    status: 'enabled',
    category: cleanCategory,
    version: '1.0.0',
    source: 'user',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export async function handleUpdateSkillById(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  skillId: string
): Promise<void> {
  try {
    const decoded = await validateSkillIdParam(skillId, res);
    if (decoded === null) return;

    const body = JSON.parse((await readRequestBody(req)) || '{}');

    // S2-1 ④：PUT 携带本地技能内容更新字段 → 更新本地 SKILL.md（原实现丢弃 body）
    if (body && typeof body === 'object' && Object.keys(body).length > 0) {
      const { resolvePyappHome } = await import('@modules/core/paths');
      const skillMdPath = path.join(
        resolvePyappHome(),
        'skills',
        decoded,
        'SKILL.md'
      );
      if (fs.existsSync(skillMdPath)) {
        const updated = await updateLocalSkill(
          decoded,
          body as Record<string, unknown>,
          skillMdPath
        );
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
        });
        res.end(JSON.stringify({ success: true, skill: updated }));
        broadcastEvent('skill:updated', { skill: updated });
        // 内容更新后重载 registry（新技能/改名场景），不阻塞响应
        void reloadUserSkillsAfterWrite();
        return;
      }
    }

    // 市场技能更新（fallback）
    const adapter = await getClawHubAdapter();
    const skill = await adapter.updateSkill(decoded);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true, skill }));
    broadcastEvent('skill:updated', { skill });
  } catch (err) {
    sendError(res, err);
  }
}

async function updateLocalSkill(
  skillId: string,
  updates: Record<string, unknown>,
  skillMdPath: string
): Promise<Record<string, unknown>> {
  const raw = fs.readFileSync(skillMdPath, 'utf-8');
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n/);
  const oldBody = fmMatch ? raw.slice(fmMatch[0].length) : raw;
  const oldFm: Record<string, string> = {};
  if (fmMatch) {
    for (const line of fmMatch[1].split('\n')) {
      const m = line.match(/^(\w[\w-]*):\s*(.+)$/);
      if (m) oldFm[m[1]] = m[2].trim();
    }
  }

  const name = sanitizeSkillFrontmatterValue(
    String(updates.name ?? oldFm.name ?? skillId),
    200
  );
  const description = sanitizeSkillFrontmatterValue(
    String(updates.description ?? oldFm.description ?? ''),
    1000
  );
  const category = sanitizeSkillFrontmatterValue(
    String(updates.category ?? oldFm.category ?? 'general'),
    100
  );
  const bodyText =
    typeof updates.content === 'string' ? updates.content : oldBody;
  const version = oldFm.version ?? '1.0.0';

  const frontmatter = [
    '---',
    `name: ${name}`,
    `description: ${description}`,
    `category: ${category}`,
    `version: ${version}`,
    '---',
    '',
  ].join('\n');
  fs.writeFileSync(skillMdPath, `${frontmatter}\n${bodyText}`, 'utf-8');

  return {
    id: skillId,
    name,
    description,
    category,
    status: 'enabled',
    version,
    source: 'user',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export async function handleDeleteSkill(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  skillId: string
): Promise<void> {
  try {
    // S0-1：%2F 等解码后校验，防路径穿越删除
    const decoded = await validateSkillIdParam(skillId, res);
    if (decoded === null) return;
    const adapter = await getClawHubAdapter();

    // 市场安装技能（索引内）：uninstallSkill（删目录 + 索引 + registry）
    const installed = await adapter.getLocalStore().getSkill(decoded);
    if (installed) {
      await adapter.uninstallSkill(decoded);
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
      });
      res.end(JSON.stringify({ success: true }));
      broadcastEvent('skill:deleted', { skillId: decoded });
      return;
    }

    // 本地技能（目录扫描）：删目录
    const { resolvePyappHome } = await import('@modules/core/paths');
    const userSkillsDir = path.join(resolvePyappHome(), 'skills');
    const skillDir = path.join(userSkillsDir, decoded);
    if (fs.existsSync(skillDir)) {
      fs.rmSync(skillDir, { recursive: true, force: true });
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
      });
      res.end(JSON.stringify({ success: true }));
      broadcastEvent('skill:deleted', { skillId: decoded });
      // 删除后重载 registry，移除已注销用户技能（不阻塞响应）
      void reloadUserSkillsAfterWrite();
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        error: { code: 'SKILL_NOT_FOUND', message: '技能未找到' },
      })
    );
  } catch (err) {
    sendError(res, err);
  }
}

async function applyLocalSkillEnabled(
  skillId: string,
  enabled: boolean
): Promise<void> {
  try {
    // S0-1：非法 ID 直接跳过（如 %2F 解码后的路径穿越）
    const { validateSkillId } =
      await import('@modules/skills/loaders/adapter/safeSkillId');
    const idError = validateSkillId(skillId);
    if (idError) {
      logger.warn(`本地技能启用状态落盘跳过（非法 ID）: ${skillId}`, {
        error: idError,
      });
      return;
    }
    const { resolvePyappHome } = await import('@modules/core/paths');
    const skillDir = path.join(resolvePyappHome(), 'skills', skillId);
    if (!fs.existsSync(path.join(skillDir, 'SKILL.md'))) return;
    const enabledFile = path.join(skillDir, '.enabled');
    if (enabled) {
      fs.rmSync(enabledFile, { force: true });
    } else {
      fs.writeFileSync(enabledFile, 'false', 'utf-8');
    }
  } catch (error) {
    logger.warn(`本地技能启用状态落盘失败: ${skillId}`, {
      error: String(error),
    });
  }
}

export async function handleEnableSkill(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  skillId: string
): Promise<void> {
  try {
    const adapter = await getClawHubAdapter();
    await adapter.enableSkill(skillId);
    await applyLocalSkillEnabled(skillId, true);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ id: skillId, status: 'enabled' }));
    broadcastEvent('skill:enabled', { skillId });
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleDisableSkill(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  skillId: string
): Promise<void> {
  try {
    const adapter = await getClawHubAdapter();
    await adapter.disableSkill(skillId);
    await applyLocalSkillEnabled(skillId, false);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ id: skillId, status: 'disabled' }));
    broadcastEvent('skill:disabled', { skillId });
  } catch (err) {
    sendError(res, err);
  }
}

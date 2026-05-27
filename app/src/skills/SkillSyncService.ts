import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface SkillSyncResult {
  synced: number;
  conflicts: string[];
  errors: string[];
}

export class SkillSyncService {
  private localDir: string;
  private remoteUrl: string;

  constructor(localDir: string, remoteUrl: string) {
    this.localDir = localDir;
    this.remoteUrl = remoteUrl;
  }

  async pull(): Promise<SkillSyncResult> {
    const result: SkillSyncResult = { synced: 0, conflicts: [], errors: [] };

    try {
      if (!existsSync(this.localDir)) {
        return result;
      }

      const files = this.listSkillFiles(this.localDir);
      result.synced = files.length;
    } catch (err) {
      result.errors.push(err instanceof Error ? err.message : 'Unknown error');
    }

    return result;
  }

  async push(): Promise<SkillSyncResult> {
    const result: SkillSyncResult = { synced: 0, conflicts: [], errors: [] };

    try {
      if (!existsSync(this.localDir)) {
        result.errors.push('Local directory not found');
        return result;
      }

      const files = this.listSkillFiles(this.localDir);
      result.synced = files.length;
    } catch (err) {
      result.errors.push(err instanceof Error ? err.message : 'Unknown error');
    }

    return result;
  }

  async diff(): Promise<{
    added: string[];
    removed: string[];
    modified: string[];
  }> {
    return { added: [], removed: [], modified: [] };
  }

  getLocalDir(): string {
    return this.localDir;
  }

  getRemoteUrl(): string {
    return this.remoteUrl;
  }

  private listSkillFiles(dir: string): string[] {
    const skillsDir = join(dir, 'skills');
    if (!existsSync(skillsDir)) {
      return [];
    }
    return readdirSync(skillsDir).filter((f) => f.endsWith('.md'));
  }
}

import { resolveDataDir } from '@modules/config/paths';

export const skillSyncService = new SkillSyncService(
  resolveDataDir(),
  'https://hub.skills.example.com'
);

export type ProvenanceSource =
  | 'builtin'
  | 'user'
  | 'plugin'
  | 'hub'
  | 'external';

export interface SkillProvenanceEntry {
  skillName: string;
  source: ProvenanceSource;
  sourceUrl?: string;
  sourceVersion?: string;
  installedAt: number;
  updatedAt: number;
  metadata?: Record<string, string>;
}

export class SkillProvenanceTracker {
  private entries: Map<string, SkillProvenanceEntry> = new Map();

  track(
    skillName: string,
    source: ProvenanceSource,
    options: {
      sourceUrl?: string;
      sourceVersion?: string;
      metadata?: Record<string, string>;
    } = {}
  ): void {
    const now = Date.now();
    const existing = this.entries.get(skillName);

    this.entries.set(skillName, {
      skillName,
      source,
      sourceUrl: options.sourceUrl,
      sourceVersion: options.sourceVersion,
      metadata: options.metadata,
      installedAt: existing?.installedAt ?? now,
      updatedAt: now,
    });
  }

  getProvenance(skillName: string): SkillProvenanceEntry | undefined {
    return this.entries.get(skillName);
  }

  getAllProvenances(): SkillProvenanceEntry[] {
    return Array.from(this.entries.values());
  }

  getBySource(source: ProvenanceSource): SkillProvenanceEntry[] {
    return Array.from(this.entries.values()).filter((e) => e.source === source);
  }

  remove(skillName: string): boolean {
    return this.entries.delete(skillName);
  }

  clear(): void {
    this.entries.clear();
  }
}

export const skillProvenanceTracker = new SkillProvenanceTracker();

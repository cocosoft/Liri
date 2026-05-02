export interface ConfigSnapshot {
  id: string;
  version: number;
  config: Record<string, any>;
  timestamp: number;
  label?: string;
  changes?: ConfigDiff;
}

export interface ConfigDiff {
  added: Array<{ key: string; value: any }>;
  removed: Array<{ key: string; value: any }>;
  modified: Array<{ key: string; oldValue: any; newValue: any }>;
}

export interface VersionInfo {
  currentVersion: number;
  totalSnapshots: number;
  firstSnapshotTime: number;
  lastSnapshotTime: number;
  versions: Array<{ version: number; label?: string; timestamp: number }>;
}

export class VersionController {
  private snapshots: ConfigSnapshot[] = [];
  private currentVersion: number = 0;
  private maxSnapshots: number;

  constructor(maxSnapshots: number = 50) {
    this.maxSnapshots = maxSnapshots;
  }

  snapshot(config: Record<string, any>, label?: string): ConfigSnapshot {
    const previousSnapshot = this.snapshots[this.snapshots.length - 1];

    this.currentVersion++;

    const snapshot: ConfigSnapshot = {
      id: `v${this.currentVersion}_${Date.now()}`,
      version: this.currentVersion,
      config: JSON.parse(JSON.stringify(config)),
      timestamp: Date.now(),
      label,
    };

    if (previousSnapshot) {
      snapshot.changes = this.diff(previousSnapshot.config, config);
    }

    this.snapshots.push(snapshot);

    if (this.snapshots.length > this.maxSnapshots) {
      this.snapshots.splice(0, this.snapshots.length - this.maxSnapshots);
    }

    return snapshot;
  }

  rollback(version: number): { config: Record<string, any>; undone: ConfigSnapshot } | null {
    if (version < 1 || version >= this.currentVersion) return null;

    const targetIndex = this.snapshots.findIndex(s => s.version === version);
    if (targetIndex === -1) return null;

    const currentSnapshot = this.snapshots[this.snapshots.length - 1];
    const targetSnapshot = this.snapshots[targetIndex];

    this.snapshots = this.snapshots.slice(0, targetIndex + 1);

    this.currentVersion++;
    const rollbackSnapshot: ConfigSnapshot = {
      id: `v${this.currentVersion}_rollback_${Date.now()}`,
      version: this.currentVersion,
      config: JSON.parse(JSON.stringify(targetSnapshot.config)),
      timestamp: Date.now(),
      label: `rollback_to_v${version}`,
      changes: this.diff(currentSnapshot.config, targetSnapshot.config),
    };

    this.snapshots.push(rollbackSnapshot);

    if (this.snapshots.length > this.maxSnapshots) {
      this.snapshots.splice(0, this.snapshots.length - this.maxSnapshots);
    }

    return { config: JSON.parse(JSON.stringify(targetSnapshot.config)), undone: currentSnapshot };
  }

  getVersion(version: number): ConfigSnapshot | null {
    return this.snapshots.find(s => s.version === version) || null;
  }

  getLatestVersion(): ConfigSnapshot | null {
    return this.snapshots.length > 0 ? this.snapshots[this.snapshots.length - 1] : null;
  }

  getHistory(limit?: number, offset: number = 0): ConfigSnapshot[] {
    const snapshots = [...this.snapshots].reverse();
    const start = offset;
    const end = limit ? start + limit : undefined;
    return snapshots.slice(start, end);
  }

  getVersionInfo(): VersionInfo {
    return {
      currentVersion: this.currentVersion,
      totalSnapshots: this.snapshots.length,
      firstSnapshotTime: this.snapshots.length > 0 ? this.snapshots[0].timestamp : 0,
      lastSnapshotTime: this.snapshots.length > 0 ? this.snapshots[this.snapshots.length - 1].timestamp : 0,
      versions: this.snapshots.map(s => ({
        version: s.version,
        label: s.label,
        timestamp: s.timestamp,
      })),
    };
  }

  diff(oldConfig: Record<string, any>, newConfig: Record<string, any>): ConfigDiff {
    const added: ConfigDiff['added'] = [];
    const removed: ConfigDiff['removed'] = [];
    const modified: ConfigDiff['modified'] = [];

    const allKeys = new Set([...this.flattenKeys(oldConfig), ...this.flattenKeys(newConfig)]);

    for (const key of allKeys) {
      const oldVal = this.getNestedValue(oldConfig, key);
      const newVal = this.getNestedValue(newConfig, key);

      if (oldVal === undefined && newVal !== undefined) {
        added.push({ key, value: newVal });
      } else if (newVal === undefined && oldVal !== undefined) {
        removed.push({ key, value: oldVal });
      } else if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
        modified.push({ key, oldValue: oldVal, newValue: newVal });
      }
    }

    return { added, removed, modified };
  }

  compareVersions(v1: number, v2: number): ConfigDiff | null {
    const s1 = this.getVersion(v1);
    const s2 = this.getVersion(v2);
    if (!s1 || !s2) return null;
    return this.diff(s1.config, s2.config);
  }

  private flattenKeys(obj: Record<string, any>, prefix = ''): string[] {
    const keys: string[] = [];
    for (const [key, value] of Object.entries(obj)) {
      const fullKey = prefix ? `${prefix}.${key}` : key;
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        keys.push(...this.flattenKeys(value, fullKey));
      } else {
        keys.push(fullKey);
      }
    }
    return keys;
  }

  private getNestedValue(obj: Record<string, any>, path: string): any {
    const parts = path.split('.');
    let current: any = obj;
    for (const part of parts) {
      if (current === null || typeof current !== 'object') return undefined;
      current = current[part];
    }
    return current;
  }

  clear(): void {
    this.snapshots = [];
    this.currentVersion = 0;
  }
}

export const versionController = new VersionController();

/**
 * Agent Memory Snapshot
 * 对标CC agentMemorySnapshot.ts
 * Agent工具内存快照管理，支持序列化/反序列化
 */

import type {
  AgentToolMemory,
  AgentMemorySnapshot as SnapshotData,
} from './agentMemory';

export interface SnapshotMeta {
  id: string;
  label: string;
  timestamp: number;
  recordCount: number;
  version: number;
}

export interface SerializedSnapshot {
  meta: SnapshotMeta;
  data: SnapshotData;
}

export class SnapshotManager {
  private snapshots: Map<string, SerializedSnapshot> = new Map();
  private version: number = 1;

  takeSnapshot(memory: AgentToolMemory, label: string): SerializedSnapshot {
    const id = `snap_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const data = memory.toSnapshot();

    const snapshot: SerializedSnapshot = {
      meta: {
        id,
        label,
        timestamp: Date.now(),
        recordCount: data.records.length,
        version: this.version,
      },
      data,
    };

    this.snapshots.set(id, snapshot);
    return snapshot;
  }

  restoreSnapshot(memory: AgentToolMemory, snapshotId: string): boolean {
    const snapshot = this.snapshots.get(snapshotId);
    if (!snapshot) return false;

    memory.fromSnapshot(snapshot.data);
    return true;
  }

  listSnapshots(): SnapshotMeta[] {
    return Array.from(this.snapshots.values())
      .map((s) => s.meta)
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  getSnapshot(id: string): SerializedSnapshot | null {
    return this.snapshots.get(id) ?? null;
  }

  deleteSnapshot(id: string): boolean {
    return this.snapshots.delete(id);
  }

  pruneOlderThan(ageMs: number): number {
    const cutoff = Date.now() - ageMs;
    let count = 0;

    for (const [id, snap] of this.snapshots) {
      if (snap.meta.timestamp < cutoff) {
        this.snapshots.delete(id);
        count++;
      }
    }

    return count;
  }

  clear(): void {
    this.snapshots.clear();
  }

  exportToJson(snapshotId: string): string | null {
    const snapshot = this.snapshots.get(snapshotId);
    if (!snapshot) return null;

    return JSON.stringify(snapshot, null, 2);
  }

  importFromJson(json: string): boolean {
    try {
      const parsed = JSON.parse(json) as SerializedSnapshot;

      if (!parsed.meta?.id || !parsed.data?.records) {
        return false;
      }

      this.snapshots.set(parsed.meta.id, parsed);
      return true;
    } catch {
      return false;
    }
  }

  compareSnapshots(
    idA: string,
    idB: string
  ): {
    added: number;
    removed: number;
    changed: number;
  } {
    const snapA = this.snapshots.get(idA);
    const snapB = this.snapshots.get(idB);

    if (!snapA || !snapB) {
      return { added: 0, removed: 0, changed: 0 };
    }

    const idsA = new Set(snapA.data.records.map((r) => r.id));
    const idsB = new Set(snapB.data.records.map((r) => r.id));

    const added = [...idsB].filter((id) => !idsA.has(id)).length;
    const removed = [...idsA].filter((id) => !idsB.has(id)).length;
    const changed = [...idsA].filter(
      (id) =>
        idsB.has(id) &&
        JSON.stringify(snapA.data.records.find((r) => r.id === id)) !==
          JSON.stringify(snapB.data.records.find((r) => r.id === id))
    ).length;

    return { added, removed, changed };
  }
}

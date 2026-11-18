export interface CompactionRecord {
  sessionId: string;
  timestamp: number;
  type: 'auto' | 'manual' | 'threshold';
  success: boolean;
  beforeTokenCount: number;
  afterTokenCount: number;
  beforeMessageCount: number;
  afterMessageCount: number;
  durationMs: number;
  error?: string;
  checkpointId?: string;
}

export function createCompactionRecord(
  sessionId: string,
  type: CompactionRecord['type']
): CompactionRecord {
  return {
    sessionId,
    timestamp: Date.now(),
    type,
    success: false,
    beforeTokenCount: 0,
    afterTokenCount: 0,
    beforeMessageCount: 0,
    afterMessageCount: 0,
    durationMs: 0,
  };
}

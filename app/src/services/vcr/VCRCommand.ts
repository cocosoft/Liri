import { SessionRecorder } from './SessionRecorder';
import { SessionPlayer } from './SessionPlayer';
import { VCRStorage } from './VCRStorage';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({ module: 'services:vcr:VCRCommand', level: LogLevel.INFO });

export interface VCRCommandParams {
  action: 'start' | 'stop' | 'play' | 'list' | 'delete' | 'status';
  sessionId?: string;
  filename?: string;
  speedMultiplier?: number;
  maxMessages?: number;
  output?: string;
}

export class VCRCommand {
  private recorder: SessionRecorder;
  private player: SessionPlayer;
  private storage: VCRStorage;

  constructor(storageDir?: string) {
    this.recorder = new SessionRecorder(storageDir);
    this.player = new SessionPlayer();
    this.storage = new VCRStorage(storageDir);
  }

  async execute(params: VCRCommandParams): Promise<string> {
    switch (params.action) {
      case 'start':
        return this.handleStart(params);
      case 'stop':
        return this.handleStop(params);
      case 'play':
        return this.handlePlay(params);
      case 'list':
        return this.handleList();
      case 'delete':
        return this.handleDelete(params);
      case 'status':
        return this.handleStatus();
      default:
        return `Unknown VCR action: ${params.action}`;
    }
  }

  private handleStart(params: VCRCommandParams): string {
    try {
      const session = this.recorder.start(params.sessionId);
      return `VCR recording started.\nSession: ${session.id}\nTime: ${new Date(session.startTime).toISOString()}`;
    } catch (error) {
      return `Failed to start recording: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private async handleStop(_params: VCRCommandParams): Promise<string> {
    try {
      const session = this.recorder.stop();
      const filePath = await this.recorder.saveRecording();
      return `VCR recording stopped.\nSession: ${session.id}\nMessages: ${session.messages.length}\nSaved to: ${filePath}`;
    } catch (error) {
      return `Failed to stop recording: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private async handlePlay(params: VCRCommandParams): Promise<string> {
    if (!params.filename) {
      return 'Error: filename required for play action';
    }

    try {
      const filepath = params.output
        ? params.output
        : `${this.storage.getBaseDir()}/${params.filename}`;

      await this.player.loadSessionFromFile(filepath);

      const messages: string[] = [];
      await this.player.play({
        speedMultiplier: params.speedMultiplier,
        maxMessages: params.maxMessages,
        onMessage: (msg, idx) => {
          const prefix =
            msg.type === 'user' ? '>' : msg.type === 'assistant' ? '<' : '·';
          const content =
            typeof msg.content === 'string'
              ? msg.content
              : JSON.stringify(msg.content);
          messages.push(`[${idx + 1}] ${prefix} ${content.slice(0, 100)}`);
        },
      });

      return `VCR playback completed.\nSession: ${params.filename}\nMessages replayed: ${messages.length}\n\n${messages.join('\n')}`;
    } catch (error) {
      return `Failed to play recording: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private async handleList(): Promise<string> {
    const entries = await this.storage.listRecordings();
    if (entries.length === 0) {
      return 'No VCR recordings found.';
    }

    const lines = [`${entries.length} VCR recording(s):`];
    for (const entry of entries) {
      const sizeKB = (entry.sizeBytes / 1024).toFixed(1);
      const date = entry.createdAt.toISOString().split('T')[0];
      lines.push(`  ${entry.filename} (${sizeKB}KB, ${date})`);
    }

    return lines.join('\n');
  }

  private async handleDelete(params: VCRCommandParams): Promise<string> {
    if (!params.filename) {
      return 'Error: filename required for delete action';
    }

    const deleted = await this.storage.deleteRecording(params.filename);
    return deleted
      ? `Deleted recording: ${params.filename}`
      : `Recording not found: ${params.filename}`;
  }

  private handleStatus(): string {
    const summary = this.recorder.getSessionSummary();
    if (!summary.sessionId) {
      return 'No active VCR recording.';
    }

    return [
      `VCR Status: ${summary.recording ? 'Recording' : 'Idle'}`,
      `Session: ${summary.sessionId}`,
      `Messages: ${summary.messageCount}`,
      `Duration: ${summary.duration ? `${((summary.duration as number) / 1000).toFixed(1)}s` : 'N/A'}`,
    ].join('\n');
  }
}

export function getVCRCommand(storageDir?: string): VCRCommand {
  return new VCRCommand(storageDir);
}

/**
 * /resume 命令 - 会话恢复
 */
import * as fs from 'fs';
import * as path from 'path';
import { resolvePyappHome } from '@modules/config/paths';

export interface SessionManifest {
  id: string;
  title?: string;
  createdAt: number;
  lastActivityAt: number;
  messageCount: number;
  filePath: string;
}

export function getSessionDir(): string {
  return path.join(resolvePyappHome(), 'sessions');
}

export function listSessions(): SessionManifest[] {
  const dir = getSessionDir();
  if (!fs.existsSync(dir)) return [];

  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        const filePath = path.join(dir, f);
        try {
          const raw = fs.readFileSync(filePath, 'utf-8');
          const data = JSON.parse(raw);
          return {
            id: f.replace('.json', ''),
            title: data.title,
            createdAt: data.createdAt || 0,
            lastActivityAt: data.lastActivityAt || 0,
            messageCount: Array.isArray(data.messages)
              ? data.messages.length
              : 0,
            filePath,
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean) as SessionManifest[];
  } catch {
    return [];
  }
}

export function getRecentSessions(limit: number = 10): SessionManifest[] {
  return listSessions()
    .sort((a, b) => b.lastActivityAt - a.lastActivityAt)
    .slice(0, limit);
}

export function formatSessionList(sessions: SessionManifest[]): string {
  if (sessions.length === 0) return 'No saved sessions found.';

  return sessions
    .map((s, i) => {
      const date = new Date(s.lastActivityAt).toISOString().split('T')[0];
      return `${i + 1}. [${date}] ${s.title || 'Untitled'} (${s.messageCount} messages)`;
    })
    .join('\n');
}

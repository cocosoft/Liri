/**
 * 项目构件存储
 *
 * 持久化路径：.liri/projects/<id>/artifacts.json
 * 存储项目资料（input）和成果（output）。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { getLogger, getOTelTracing } from '@modules/monitoring';
import { SpanStatusCode } from '@opentelemetry/api';
import { handleError } from '@modules/error';

const logger = getLogger('project:ArtifactStore');

export type ArtifactKind = 'input' | 'output';

export interface ProjectArtifact {
  /** 唯一标识 */
  id: string;
  /** 所属项目 ID */
  projectId: string;
  /** 构件类型 */
  kind: ArtifactKind;
  /** 来源对话 sessionId */
  sessionId?: string;
  /** 来源消息 ID */
  refId?: string;
  /** 标题 */
  title: string;
  /** 内容摘要 */
  content: string;
  /** 创建时间 */
  createdAt: string;
}

export class ProjectArtifactStore {
  constructor(private storeDir: string) {}

  private getPath(projectId: string): string {
    return join(this.storeDir, projectId, 'artifacts.json');
  }

  private ensureDir(projectId: string): void {
    const dir = join(this.storeDir, projectId);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  private readAll(projectId: string): ProjectArtifact[] {
    const path = this.getPath(projectId);
    if (!existsSync(path)) return [];
    try {
      return JSON.parse(readFileSync(path, 'utf-8')) as ProjectArtifact[];
    } catch {
      return [];
    }
  }

  private writeAll(projectId: string, artifacts: ProjectArtifact[]): void {
    this.ensureDir(projectId);
    writeFileSync(
      this.getPath(projectId),
      JSON.stringify(artifacts, null, 2),
      'utf-8'
    );
  }

  /** 列出指定类型的所有构件 */
  list(projectId: string, kind?: ArtifactKind): ProjectArtifact[] {
    const otel = getOTelTracing();
    const span = otel.startSpan('ProjectArtifactStore.list');
    try {
      const all = this.readAll(projectId);
      const result = kind ? all.filter((a) => a.kind === kind) : all;
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (e) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(e) });
      void handleError(e, { module: 'project:ArtifactStore', action: 'list' });
      return [];
    } finally {
      span.end();
    }
  }

  /** 添加/更新构件 */
  save(artifact: ProjectArtifact): void {
    const otel = getOTelTracing();
    const span = otel.startSpan('ProjectArtifactStore.save');
    try {
      const all = this.readAll(artifact.projectId);
      const idx = all.findIndex((a) => a.id === artifact.id);
      if (idx >= 0) {
        all[idx] = artifact;
      } else {
        all.push(artifact);
      }
      this.writeAll(artifact.projectId, all);
      span.setStatus({ code: SpanStatusCode.OK });
      // 方案八 8a：成果保存输出日志，便于审计与排障
      logger.info('构件已保存', {
        projectId: artifact.projectId,
        artifactId: artifact.id,
        kind: artifact.kind,
        title: artifact.title.slice(0, 60),
      });
    } catch (e) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(e) });
      void handleError(e, { module: 'project:ArtifactStore', action: 'save' });
      throw e;
    } finally {
      span.end();
    }
  }

  /** 删除构件 */
  delete(projectId: string, artifactId: string): boolean {
    const otel = getOTelTracing();
    const span = otel.startSpan('ProjectArtifactStore.delete');
    try {
      const all = this.readAll(projectId);
      const idx = all.findIndex((a) => a.id === artifactId);
      if (idx < 0) {
        span.setStatus({ code: SpanStatusCode.OK });
        return false;
      }
      all.splice(idx, 1);
      this.writeAll(projectId, all);
      span.setStatus({ code: SpanStatusCode.OK });
      return true;
    } catch (e) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(e) });
      void handleError(e, {
        module: 'project:ArtifactStore',
        action: 'delete',
      });
      return false;
    } finally {
      span.end();
    }
  }
}

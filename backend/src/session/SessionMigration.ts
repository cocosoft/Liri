import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';

const logger = new Logger({ level: LogLevel.INFO });

export const CURRENT_SESSION_VERSION = 1;

export type MigrationFunction = (
  data: Record<string, unknown>
) => Record<string, unknown>;

interface MigrationRecord {
  fromVersion: number;
  toVersion: number;
  migrate: MigrationFunction;
  description: string;
}

export class SessionMigration {
  private migrations: Map<number, MigrationRecord> = new Map();
  private highestVersion: number = CURRENT_SESSION_VERSION;

  constructor() {
    this.registerBuiltinMigrations();
  }

  getCurrentVersion(): number {
    return this.highestVersion;
  }

  getVersion(data: Record<string, unknown>): number {
    return (data as any).version ?? 0;
  }

  needsMigration(data: Record<string, unknown>): boolean {
    return this.getVersion(data) < this.highestVersion;
  }

  migrate(data: Record<string, unknown>): Record<string, unknown> {
    let currentVersion = this.getVersion(data);
    let result = { ...data };

    while (currentVersion < this.highestVersion) {
      const migration = this.migrations.get(currentVersion);
      if (!migration) {
        logger.warning(
          `No migration found from version ${currentVersion} to ${currentVersion + 1}, skipping`
        );
        currentVersion++;
        continue;
      }

      try {
        logger.info(
          `Migrating session from v${migration.fromVersion} to v${migration.toVersion}: ${migration.description}`
        );
        result = migration.migrate(result);
        result.version = migration.toVersion;
        currentVersion = migration.toVersion;
      } catch (err) {
        logger.error(
          `Migration from v${migration.fromVersion} to v${migration.toVersion} failed`,
          err
        );
        throw err;
      }
    }

    return result;
  }

  registerMigration(
    fromVersion: number,
    toVersion: number,
    migrate: MigrationFunction,
    description: string
  ): void {
    if (toVersion !== fromVersion + 1) {
      throw new AppError(
        `Migration must increment version by 1: v${fromVersion} -> v${toVersion}`,
        ErrorCategory.VALIDATION,
        ErrorSeverity.LOW
      );
    }

    if (this.migrations.has(fromVersion)) {
      throw new AppError(
        `Migration from v${fromVersion} is already registered`,
        ErrorCategory.VALIDATION,
        ErrorSeverity.LOW
      );
    }

    this.migrations.set(fromVersion, {
      fromVersion,
      toVersion,
      migrate,
      description,
    });
    if (toVersion > this.highestVersion) {
      this.highestVersion = toVersion;
    }
    logger.info(
      `Registered migration: v${fromVersion} -> v${toVersion}: ${description}`
    );
  }

  listMigrations(): MigrationRecord[] {
    return Array.from(this.migrations.values()).sort(
      (a, b) => a.fromVersion - b.fromVersion
    );
  }

  private registerBuiltinMigrations(): void {
    this.registerMigration(
      0,
      1,
      (data) => {
        const result = { ...data };

        if (!result.version) {
          result.version = 1;
        }

        if (!result.createdAt && result.created_at) {
          result.createdAt = result.created_at;
          delete result.created_at;
        }

        if (!result.updatedAt && result.updated_at) {
          result.updatedAt = result.updated_at;
          delete result.updated_at;
        }

        if (result.metadata && typeof result.metadata === 'object') {
          const meta = result.metadata as Record<string, unknown>;
          if (!meta.title && meta.name) {
            meta.title = meta.name;
            delete meta.name;
          }
        }

        if (!result.messages) {
          result.messages = [];
        }

        return result;
      },
      'Initial migration: add version field, normalize field names, ensure messages array'
    );
  }
}

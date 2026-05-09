import { join } from 'path';
import { getFsImplementation } from '@modules/utils/fsOperations.js';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });
import {
  ENTRYPOINT_NAME,
  MAX_ENTRYPOINT_LINES,
  MAX_ENTRYPOINT_BYTES,
  truncateEntrypointContent,
} from './MemoryPromptService.js';

/**
 * Ensure a memory directory exists. Idempotent — called from loadMemoryPrompt
 * (once per session via systemPromptSection cache) so the model can always
 * write without checking existence first.
 */
export async function ensureMemoryDirExists(memoryDir: string): Promise<void> {
  const fs = getFsImplementation();
  try {
    await fs.mkdir(memoryDir, { recursive: true });
  } catch (e) {
    // fs.mkdir already handles EEXIST internally. Anything reaching here is
    // a real problem (EACCES/EPERM/EROFS) — log so --debug shows why.
    logger.debug(`ensureMemoryDirExists failed for ${memoryDir}: ${String(e)}`);
  }
}

/**
 * Log memory directory file/subdir counts asynchronously.
 * Fire-and-forget — doesn't block prompt building.
 */
export function logMemoryDirCounts(
  memoryDir: string,
  baseMetadata: Record<string, any>
): void {
  const fs = getFsImplementation();
  void fs.readdir(memoryDir, { withFileTypes: true }).then(
    (dirents) => {
      let fileCount = 0;
      let subdirCount = 0;
      for (const d of dirents) {
        if (d.isFile()) {
          fileCount++;
        } else if (d.isDirectory()) {
          subdirCount++;
        }
      }
      logger.info('Memory directory stats:', {
        ...baseMetadata,
        total_file_count: fileCount,
        total_subdir_count: subdirCount,
      });
    },
    () => {
      // Directory unreadable — log without counts
      logger.info('Memory directory stats:', baseMetadata);
    }
  );
}

/**
 * Read and process MEMORY.md entrypoint file.
 */
export function readMemoryEntrypoint(memoryDir: string): {
  content: string;
  wasTruncated: boolean;
} {
  const fs = getFsImplementation();
  const entrypoint = join(memoryDir, ENTRYPOINT_NAME);

  let entrypointContent = '';
  try {
    entrypointContent = fs.readFileSync(entrypoint, { encoding: 'utf-8' });
  } catch {
    // No memory file yet
    return {
      content: `Your ${ENTRYPOINT_NAME} is currently empty. When you save new memories, they will appear here.`,
      wasTruncated: false,
    };
  }

  if (entrypointContent.trim()) {
    const t = truncateEntrypointContent(entrypointContent);
    return {
      content: t.content,
      wasTruncated: t.wasLineTruncated || t.wasByteTruncated,
    };
  } else {
    return {
      content: `Your ${ENTRYPOINT_NAME} is currently empty. When you save new memories, they will appear here.`,
      wasTruncated: false,
    };
  }
}

/**
 * Write a memory file with frontmatter.
 */
export async function writeMemoryFile(
  memoryDir: string,
  filename: string,
  frontmatter: Record<string, any>,
  content: string
): Promise<void> {
  const fs = getFsImplementation();
  const filePath = join(memoryDir, filename);

  // Build frontmatter
  const frontmatterLines = ['---'];
  for (const [key, value] of Object.entries(frontmatter)) {
    if (value !== undefined && value !== null) {
      frontmatterLines.push(
        `${key}: ${typeof value === 'string' ? `"${value}"` : value}`
      );
    }
  }
  frontmatterLines.push('---');
  frontmatterLines.push('');

  // Combine frontmatter and content
  const fullContent = frontmatterLines.join('\n') + content;

  // Write file
  await fs.writeFile(filePath, fullContent, { encoding: 'utf-8' });
}

/**
 * Update MEMORY.md index with a new entry.
 */
export async function updateMemoryIndex(
  memoryDir: string,
  title: string,
  filename: string,
  hook: string
): Promise<void> {
  const fs = getFsImplementation();
  const entrypoint = join(memoryDir, ENTRYPOINT_NAME);

  let existingContent = '';
  try {
    existingContent = fs.readFileSync(entrypoint, { encoding: 'utf-8' });
  } catch {
    // No memory file yet
  }

  // Create new entry
  const newEntry = `- [${title}](${filename}) — ${hook}`;

  // Check if entry already exists
  if (existingContent.includes(`[${title}](${filename})`)) {
    // Update existing entry
    const updatedContent = existingContent.replace(
      new RegExp(`- \[${title}\]\(${filename}\) — .*`),
      newEntry
    );
    await fs.writeFile(entrypoint, updatedContent, { encoding: 'utf-8' });
  } else {
    // Add new entry
    const updatedContent = existingContent.trim()
      ? `${existingContent.trim()}\n${newEntry}`
      : newEntry;
    await fs.writeFile(entrypoint, updatedContent, { encoding: 'utf-8' });
  }
}

/**
 * Delete a memory file and its index entry.
 */
export async function deleteMemoryFile(
  memoryDir: string,
  filename: string
): Promise<void> {
  const fs = getFsImplementation();
  const filePath = join(memoryDir, filename);
  const entrypoint = join(memoryDir, ENTRYPOINT_NAME);

  // Delete the file
  try {
    await fs.unlink(filePath);
  } catch {
    // File doesn't exist
  }

  // Remove from index
  try {
    const existingContent = fs.readFileSync(entrypoint, { encoding: 'utf-8' });
    const updatedContent = existingContent
      .split('\n')
      .filter((line) => !line.includes(`(${filename})`))
      .join('\n');
    await fs.writeFile(entrypoint, updatedContent, { encoding: 'utf-8' });
  } catch {
    // Index file doesn't exist
  }
}

/**
 * List all memory files in the directory.
 */
export async function listMemoryFiles(memoryDir: string): Promise<
  Array<{
    filename: string;
    type: string;
    title: string;
    description: string;
  }>
> {
  const fs = getFsImplementation();
  const files: Array<{
    filename: string;
    type: string;
    title: string;
    description: string;
  }> = [];

  try {
    const dirents = await fs.readdir(memoryDir, { withFileTypes: true });
    for (const dirent of dirents) {
      if (
        dirent.isFile() &&
        dirent.name.endsWith('.md') &&
        dirent.name !== ENTRYPOINT_NAME
      ) {
        const filePath = join(memoryDir, dirent.name);
        const content = await fs.readFile(filePath, { encoding: 'utf-8' });

        // Parse frontmatter
        const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
        if (frontmatterMatch) {
          const frontmatter = frontmatterMatch[1];
          const typeMatch = frontmatter.match(/type:\s*["']?(\w+)["']?/);
          const titleMatch = frontmatter.match(/name:\s*["']?([^"']+)["']?/);
          const descriptionMatch = frontmatter.match(
            /description:\s*["']?([^"']+)["']?/
          );

          files.push({
            filename: dirent.name,
            type: typeMatch ? typeMatch[1] : 'unknown',
            title: titleMatch ? titleMatch[1] : dirent.name.replace('.md', ''),
            description: descriptionMatch ? descriptionMatch[1] : '',
          });
        }
      }
    }
  } catch {
    // Directory doesn't exist or is unreadable
  }

  return files;
}

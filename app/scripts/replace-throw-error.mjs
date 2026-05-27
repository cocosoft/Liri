/**
 * 批量替换 throw new Error → throw new AppError
 * 使用 Node.js 内置 API，无外部依赖
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, extname } from 'path';

const ROOT = join(import.meta.dirname, '..', 'src');

const IMPORT_LINE = "import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';";

const DIRS_TO_SCAN = [
  'skills', 'security', 'services', 'plugins', 'subagent',
  'mcp', 'chat', 'utils', 'tools', 'agent',
  'ai', 'bridge', 'commands', 'config', 'constants',
  'context', 'hooks', 'memory', 'oauth', 'session',
  'remote', 'monitoring', 'lsp', 'governance',
  'chronos', 'promptSuggestion', 'streaming',
  'cost', 'daemon', 'permission', 'query', 'cache',
  'keybindings', 'buddy',
];

/**
 * Collect all .ts files in a directory recursively
 */
function collectTsFiles(dir) {
  const result = [];
  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      try {
        if (statSync(fullPath).isDirectory()) {
          result.push(...collectTsFiles(fullPath));
        } else if (extname(fullPath) === '.ts' && !fullPath.endsWith('.test.ts')) {
          result.push(fullPath);
        }
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
  return result;
}

function hasThrowNewError(content) {
  return content.includes('throw new Error(');
}

function hasAppErrorImport(content) {
  return content.includes("from '@modules/error/types'") || content.includes('from "../error/types"') || content.includes("from '../../error/types'");
}

/**
 * Add AppError import after the last complete import statement
 * Handles both single-line (`import ... from '...';`) and 
 * multi-line (`import { ... } from '...';`) imports.
 */
function addAppErrorImport(content) {
  const lines = content.split('\n');
  // Find last line that closes an import (contains `} from` or ends with `;`)
  let lastImportIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();
    // Single-line import: `import ... from '...';`
    if (trimmed.startsWith('import ') && trimmed.trimEnd().endsWith(';')) {
      lastImportIdx = i;
    }
    // Multi-line import closing: `} from '...';`
    if (trimmed.startsWith('} from ') && trimmed.trimEnd().endsWith(';')) {
      lastImportIdx = i;
    }
  }
  if (lastImportIdx >= 0) {
    lines.splice(lastImportIdx + 1, 0, IMPORT_LINE);
  } else {
    lines.unshift(IMPORT_LINE + '\n');
  }
  return lines.join('\n');
}

/**
 * Replace throw new Error with throw new AppError using known patterns
 * Order matters: more specific patterns first
 */
function replaceThrowNewError(content) {
  // Pattern 1: throw new Error(result.error || 'fallback')
  content = content.replace(
    /throw new Error\(([a-zA-Z_$][a-zA-Z0-9_$.?]*(?:\|[|])\s*'[^']*')\)/g,
    (match, expr) => `throw new AppError(${expr}, ErrorCategory.EXECUTION, ErrorSeverity.HIGH, '1000')`
  );
  content = content.replace(
    /throw new Error\(([a-zA-Z_$][a-zA-Z0-9_$.?]*(?:\|[|])\s*"[^"]*")\)/g,
    (match, expr) => `throw new AppError(${expr}, ErrorCategory.EXECUTION, ErrorSeverity.HIGH, '1000')`
  );

  // Pattern 2: throw new Error(`template`) — template literals
  content = content.replace(
    /throw new Error\(`([^`]*)`\)/g,
    (match, msg) => `throw new AppError(\`${msg}\`, ErrorCategory.EXECUTION, ErrorSeverity.HIGH, '1000')`
  );

  // Pattern 3: throw new Error('simple message') — no concatenation
  content = content.replace(
    /throw new Error\('([^'\\]*(?:\\.[^'\\]*)*)'\)/g,
    (match, msg) => `throw new AppError('${msg}', ErrorCategory.EXECUTION, ErrorSeverity.HIGH, '1000')`
  );

  // Pattern 4: throw new Error("simple message")
  content = content.replace(
    /throw new Error\("([^"\\]*(?:\\.[^"\\]*)*)"\)/g,
    (match, msg) => `throw new AppError("${msg}", ErrorCategory.EXECUTION, ErrorSeverity.HIGH, '1000')`
  );

  // Pattern 5: throw new Error( on multi-line (first line only)
  // This handles multi-line Error constructions by looking for `new Error(`
  // followed by content that may span multiple lines
  content = content.replace(
    /throw new Error\(/g,
    'throw new AppError('
  );

  return content;
}

// === MAIN ===
const allErrors = [];
let processedCount = 0;
let replacedCount = 0;

for (const dir of DIRS_TO_SCAN) {
  const dirPath = join(ROOT, dir);
  if (!existsSync(dirPath)) continue;

  const tsFiles = collectTsFiles(dirPath);
  for (const file of tsFiles) {
    try {
      const content = readFileSync(file, 'utf-8');
      if (!hasThrowNewError(content)) continue;

      let modified = content;

      // Add AppError import if missing
      if (!hasAppErrorImport(modified)) {
        modified = addAppErrorImport(modified);
      }

      // Replace throw new Error
      const beforeReplace = modified;
      modified = replaceThrowNewError(modified);

      if (modified !== beforeReplace) {
        writeFileSync(file, modified, 'utf-8');
        const count = (modified.match(/throw new AppError\(/g) || []).length -
                      (content.match(/throw new AppError\(/g) || []).length;
        processedCount++;
        replacedCount += count;
        console.log(`✅ ${file.replace(ROOT + '\\', '')} (${count} repl)`);
      } else if (modified !== content) {
        // Only import was added
        writeFileSync(file, modified, 'utf-8');
        processedCount++;
        console.log(`📦 ${file.replace(ROOT + '\\', '')} (import only)`);
      }
    } catch (err) {
      allErrors.push(`${file}: ${err.message}`);
    }
  }
}

console.log(`\n结果: ${processedCount} 文件已处理, ${replacedCount} 处替换`);
if (allErrors.length) {
  console.log(`\n❌ 错误 (${allErrors.length}):`);
  for (const e of allErrors) {
    console.log(`  ${e}`);
  }
}

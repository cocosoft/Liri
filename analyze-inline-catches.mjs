import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';

const SRC_DIR = 'E:\\PY\\CODES\\PY_APP\\app\\src';

function isTargetFile(filePath) {
  if (filePath.endsWith('.d.ts')) return false;
  if (filePath.includes('__tests__')) return false;
  if (filePath.endsWith('.test.ts')) return false;
  if (filePath.endsWith('.spec.ts')) return false;
  return filePath.endsWith('.ts');
}

function getAllFiles(dir) {
  const results = [];
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      results.push(...getAllFiles(fullPath));
    } else if (isTargetFile(fullPath)) {
      results.push(fullPath);
    }
  }
  return results;
}

// Map file paths to module names
function getModuleName(filePath) {
  const rel = relative(SRC_DIR, filePath);
  const parts = rel.replace(/\\/g, '/').split('/');
  // First directory is the top-level module
  if (parts.length >= 2) {
    return parts.slice(0, 2).join(':');
  }
  return parts[0] || 'unknown';
}

// Check if enclosing function is async
function isInAsyncFunction(lines, lineIdx) {
  let depth = 0;
  for (let i = lineIdx; i >= 0; i--) {
    for (const ch of lines[i]) {
      if (ch === '}') depth++;
      if (ch === '{') depth--;
    }
    if (depth <= 0 && lines[i].includes('async function')) return true;
    if (depth <= 0 && lines[i].includes('async ')) return true;
  }
  return false;
}

console.log('Scanning for inline empty catches in business code...\n');

const files = getAllFiles(SRC_DIR);
let totalFixed = 0;
const fixedFiles = [];

for (const file of files) {
  const content = readFileSync(file, 'utf-8');
  const lines = content.split('\n');
  let modified = false;
  const result = [];
  let needsImport = false;
  let importLine = -1;
  let fileFixed = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Track last import line (handles multi-line imports)
    if (line.match(/^import\s/) || line.match(/from\s+['"]/)) {
      importLine = i;
    }

    // Match inline empty catch: } catch {}  or  } catch (err) { }
    // Must NOT have any code between braces
    const inlineMatch = line.match(/^(\s*)\}\s*catch\s*(\([^)]*\))?\s*\{\s*\}(\s*)$/);
    
    if (inlineMatch) {
      const indent = inlineMatch[1];
      const paramRaw = inlineMatch[2];
      const suffix = inlineMatch[3] || '';
      const hasErrVar = !!paramRaw;
      const param = hasErrVar ? paramRaw.replace(/[()]/g, '') : 'err';

      needsImport = true;
      fileFixed++;
      modified = true;

      const moduleName = getModuleName(file);

      if (hasErrVar) {
        // } catch (err) { }  → has error variable
        result.push(`${indent}} catch (${param}) {`);
        result.push(`${indent}  void handleError(${param}, { module: '${moduleName}', action: 'catch_error' });`);
        result.push(`${indent}}${suffix}`);
      } else {
        // } catch { }  → no error variable, create one
        result.push(`${indent}} catch (${param}) {`);
        result.push(`${indent}  void handleError(${param}, { module: '${moduleName}', action: 'catch_error' });`);
        result.push(`${indent}}${suffix}`);
      }
      continue;
    }

    result.push(line);
  }

  if (modified) {
    // Add import if not already present
    const hasHandleErrorImport = content.includes("from '@modules/error/handleError'");
    if (!hasHandleErrorImport) {
      const importStmt = "import { handleError } from '@modules/error/handleError';";
      // Check if there are any imports at all
      if (importLine >= 0) {
        result.splice(importLine + 1, 0, importStmt);
      } else {
        // No imports, add after file header or at start
        let insertPos = 0;
        for (let k = 0; k < result.length; k++) {
          if (result[k].startsWith('//') || result[k].trim() === '') {
            insertPos = k + 1;
          } else {
            break;
          }
        }
        result.splice(insertPos, 0, importStmt);
      }
    }

    writeFileSync(file, result.join('\n'), 'utf-8');
    totalFixed += fileFixed;
    fixedFiles.push({ file: relative(SRC_DIR, file), count: fileFixed });
    console.log(`✅ ${relative(SRC_DIR, file)}: fixed ${fileFixed}`);
  }
}

console.log(`\nTotal: ${totalFixed} inline empty catches fixed in ${fixedFiles.length} files`);

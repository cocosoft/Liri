import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const HANDLERS_DIR = 'E:\\PY\\CODES\\PY_APP\\app\\src\\infrastructure\\http\\handlers';

// Files that already have handleError import
const hasImport = new Set([
  'chat-handlers.ts',
  'mcp-marketplace-handlers.ts',
  'monitoring-handlers.ts',
  'channel-handlers.ts',
]);

const files = readdirSync(HANDLERS_DIR)
  .filter(f => f.endsWith('-handlers.ts'))
  .sort();

let grandTotal = 0;

for (const file of files) {
  const content = readFileSync(join(HANDLERS_DIR, file), 'utf-8');
  const lines = content.split('\n');
  let modified = false;
  const result = [];

  let needsImport = false;
  let importLine = -1;
  let fileFixed = 0;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // Find the last import line
    if (line.match(/^import\s/)) {
      importLine = i;
    }

    // --- Pattern 1: Multi-line empty catch ---
    // Matches: `    } catch (err) {`  or  `    } catch {`
    const catchFooter = line.match(/^(\s*)\}\s*catch\s*(\([^)]*\))?\s*\{\s*$/);
    
    if (catchFooter) {
      const indent = catchFooter[1];
      const paramRaw = catchFooter[2];
      const param = paramRaw ? paramRaw.replace(/[()]/g, '') : 'err';

      // Look ahead to check if body is empty
      let j = i + 1;
      let bodyLines = [];
      while (j < lines.length && lines[j].trim() !== '}') {
        if (lines[j].trim()) bodyLines.push(lines[j]);
        j++;
      }

      const hasCode = bodyLines.some(l => {
        const t = l.trim();
        return t && !t.startsWith('//') && !t.startsWith('/*') && !t.startsWith('*');
      });
      const hasComment = bodyLines.some(l => {
        const t = l.trim();
        return t.startsWith('//') || t.startsWith('/*') || t.startsWith('*');
      });

      if (!hasCode && !hasComment) {
        needsImport = true;
        fileFixed++;
        modified = true;

        // Check if res is in function scope
        let hasRes = false;
        for (let k = i; k >= 0 && !hasRes; k--) {
          if (lines[k].includes('res: http.ServerResponse')) hasRes = true;
          if (lines[k].match(/^\s*(export\s+)?async\s+function\s+/)) break;
        }

        result.push(line); // } catch (err) {
        result.push(`${indent}  await handleError(${param}, { module: 'infra:http', action: 'handler_error' });`);
        if (hasRes) {
          result.push(`${indent}  if (!res.headersSent) {`);
          result.push(`${indent}    try {`);
          result.push(`${indent}      res.writeHead(500, { 'Content-Type': 'application/json' });`);
          result.push(`${indent}      res.end(JSON.stringify({ error: { message: 'Internal server error' } }));`);
          result.push(`${indent}    } catch {} /* res可能已结束, 忽略 */`);
          result.push(`${indent}  }`);
        }
        result.push(lines[j]); // the closing `}`
        i = j; // skip processed lines
        continue;
      }
    }

    // --- Pattern 2: Inline empty catch ---
    // Matches: `      } catch (err) { }`  or  `      } catch { }`  or  `} catch { }`
    const inlineMatch = line.match(/^(\s*)\}\s*catch\s*(\([^)]*\))?\s*\{\s*\}(\s*)$/);
    if (inlineMatch) {
      const indent = inlineMatch[1];
      const paramRaw = inlineMatch[2];
      const suffix = inlineMatch[3] || '';
      const param = paramRaw ? paramRaw.replace(/[()]/g, '') : 'err';

      needsImport = true;
      fileFixed++;
      modified = true;

      // Check if res is in function scope
      let hasRes = false;
      for (let k = i; k >= 0 && !hasRes; k--) {
        if (lines[k].includes('res: http.ServerResponse')) hasRes = true;
        if (lines[k].match(/^\s*(export\s+)?async\s+function\s+/)) break;
      }

      result.push(`${indent}} catch (${param}) {`);
      result.push(`${indent}  await handleError(${param}, { module: 'infra:http', action: 'handler_error' });`);
      if (hasRes) {
        result.push(`${indent}  if (!res.headersSent) {`);
        result.push(`${indent}    try {`);
        result.push(`${indent}      res.writeHead(500, { 'Content-Type': 'application/json' });`);
        result.push(`${indent}      res.end(JSON.stringify({ error: { message: 'Internal server error' } }));`);
        result.push(`${indent}    } catch {} /* res可能已结束, 忽略 */`);
        result.push(`${indent}  }`);
      }
      result.push(`${indent}}${suffix}`);
      continue;
    }

    result.push(line);
  }

  if (modified) {
    if (needsImport && !hasImport.has(file)) {
      const importStmt = "import { handleError } from '@modules/error/handleError';";
      result.splice(importLine + 1, 0, importStmt);
    }

    writeFileSync(join(HANDLERS_DIR, file), result.join('\n'), 'utf-8');
    grandTotal += fileFixed;
    console.log(`✅ ${file}: fixed ${fileFixed} empty catches`);
  }
}

console.log(`\nTotal: ${grandTotal} empty catch blocks fixed across ${files.length} files`);

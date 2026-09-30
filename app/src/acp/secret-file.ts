import { readFile } from 'fs/promises';
import { access } from 'fs/promises';
import { handleError } from '../core/errorHandler.js';

export async function readSecretFromFile(filePath: string): Promise<string> {
  try {
    await access(filePath);
  } catch (e) {
    void handleError(e, { module: 'acp:secret', action: 'readSecret' });
    throw new Error(`Secret file not found: ${filePath}`);
  }
  const content = await readFile(filePath, 'utf-8');
  return content.trim();
}

import { readFile } from 'node:fs/promises';
import { access } from 'node:fs/promises';

export async function readSecretFromFile(filePath: string): Promise<string> {
  try {
    await access(filePath);
  } catch {
    throw new Error(`Secret file not found: ${filePath}`);
  }
  const content = await readFile(filePath, 'utf-8');
  return content.trim();
}

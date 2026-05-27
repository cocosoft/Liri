export const FILE_WRITE_TOOL_NAME = 'write';

export function getWriteToolDescription(): string {
  return `Writes a file to the local filesystem.
Usage:
- This tool will overwrite the existing file if there is one at the provided path.
- If this is an existing file, you MUST use the read tool first to read the file's contents.
- ALWAYS prefer editing existing files using edit tool in the codebase. NEVER write new files unless explicitly required.`;
}

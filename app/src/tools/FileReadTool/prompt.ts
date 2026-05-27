export const FILE_READ_TOOL_NAME = 'read';

export const DESCRIPTION = `Reads a file from the local filesystem. You can access any file directly.
- You can optionally specify an offset and limit (especially handy for long files), but it"s recommended to read the whole file by not providing these parameters.
- You have the capability to call multiple tools in a single response. It is always better to speculatively read multiple files as a batch that are potentially useful.
- If you read a file that exists but has empty contents you will receive "File is empty."`;

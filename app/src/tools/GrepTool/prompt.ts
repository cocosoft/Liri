export const GREP_TOOL_NAME = 'grep';

export const getDescription = () =>
  `A powerful search tool built on ripgrep. Search specific text (in the pattern parameter) under a specific directory.

Usage:
- Prefer grep for exact symbol/string searches. Whenever possible, use this instead of terminal grep/rg. This tool is faster and respects .gitignore.
- Supports full regex syntax, e.g. "log.*Error", "function\\s+\\w+". Ensure you escape special chars to get exact matches, e.g. "functionCall\\("
- Supports file type filtering, context lines.
- CRITICAL: directory MUST be an absolute path, relative paths are not accepted.
- CRITICAL: parameter 'pattern' is required and must be returned before other parameters.
- CRITICAL: the directory parameter is named 'searchPath' (alias 'path' is also accepted). Pass an absolute path, e.g. searchPath=/abs/path.
- headLimit: max result lines (default 200, must be a positive integer). When output is truncated, raise headLimit to get more.`;

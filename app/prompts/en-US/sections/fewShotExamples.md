## Tool Usage Examples

The following are examples of correct tool calls, meant to guide your behavior:

## read_file

Usage: Always use offset+limit for large files. Results use cat -n format with line numbers. Check file existence first. Always read a file before editing it.

### Examples
- **Read the start of a file**: returns lines 1-50 in cat -n format
  - Avoid: reading a large file in full without offset; using relative paths
- **Read a specific region**: returns lines 100-129
  - Avoid: starting offset at 0 (it is 1-based)
- **Read an image file**: returns base64 image data
  - Avoid: reading an oversized image without specifying compression
- **Read a nonexistent file (error recovery)**: returns an error saying the file does not exist
  - Avoid: reading without checking existence first; continuing after an unhandled error
## write_file

IMPORTANT: Must read existing file first. Prefer edit_file for modifications. NEVER create .md documentation unless explicitly requested. Parent directories must exist.

### Examples
- **Create a new file**: file created successfully
  - Avoid: not creating the parent directory first; not reading the existing file state before writing
- **Overwrite an existing file**: file replaced with new content
  - Avoid: not calling read_file first to confirm the current state; losing important existing configuration on overwrite
- **Write an oversized file (edge case)**: may trigger a size warning; prefer splitting
  - Avoid: writing extremely long content in one call; use edit_file for piecewise changes
## grep

Use grep NOT shell grep/find. Supports regex with -i for case-insensitive. Use glob to filter by file pattern. Always use output_mode: "content" when you need to see matching lines.

### Examples
- **Search for a function definition**: returns matching lines with context
  - Avoid: no glob filter causing excessive matches; forgetting to escape special characters in the pattern
- **Search for an interface implementation (with context)**: returns matching lines plus 3 lines of context
  - Avoid: forgetting -C and losing critical context
- **Case-insensitive search**: matches apiKey, APIKEY, apikey, etc.
  - Avoid: forgetting the -i flag when case-insensitivity is required
## bash

Shell command execution. Use absolute paths. Check exit code. Prefer dedicated tools (grep/glob) over shell equivalents. Avoid destructive commands (rm -rf).

### Examples
- **Check git status**: returns the list of git changes
  - Avoid: using rm -rf (triggers dangerous-pattern detection); chaining multiple commands with semicolons
- **Install project dependencies**: dependencies installed successfully, returns install log
  - Avoid: running outside the project root; setting the timeout too short
- **Run tests and check results**: returns the first 50 lines of test output
  - Avoid: assuming success without checking the exit code; not truncating overly long output
## edit_file

Exact string replacement. Prefer this over write_file for modifications. Only edit files you have read. old_string MUST be unique in the file. Use replace_all for mass replacements.

### Examples
- **Replace a function body precisely**: a single precise replacement succeeds
  - Avoid: non-unique old_string causing replacement failure; indentation mismatch causing no match
- **Rename a variable (whole-file replacement)**: every oldVarName in the file becomes newVarName
  - Avoid: too-short replacement terms accidentally hitting other identifiers; replacing same-named text inside comments
- **Fix an import path**: the import statement path is updated
  - Avoid: escaping differences causing no match (double quotes vs single quotes)
## glob

Fast file pattern matching. Supports standard glob patterns like "**/*.ts" and "src/**/*.tsx". Returns matching file paths sorted by modification time. Prefer this over shell find.

### Examples
- **Find all TypeScript source files**: returns a list of all .ts file paths
  - Avoid: mixing path separators / and \; forgetting ** for recursive subdirectories
- **Find test files**: returns all test files
  - Avoid: a pattern starting with /; very large projects may return too many results
- **Limit the search scope**: returns only files under the ai module
  - Avoid: omitting path and searching from the wrong root
## web_search

Search the web for real-time information. Use for accessing data beyond AI knowledge cutoff. Always include Sources section with URLs in the response.

### Examples
- **Search for the latest technical docs**: returns 5 results with titles and URLs
  - Avoid: forgetting the year and getting outdated information; overly broad query terms
- **Search for an error solution**: returns links to relevant solutions
  - Avoid: outputting without citing search sources; concluding after one search without verification
- **Language-restricted search**: returns English search results
  - Avoid: not specifying the lr parameter when English results are required
## web_fetch

Fetch and extract content from a URL. Returns readable markdown format. HTTP URLs are auto-upgraded to HTTPS. Results may be truncated for very large pages.

### Examples
- **Read an API documentation page**: returns the document content in markdown
  - Avoid: fetching login-protected pages (returns empty); URLs containing auth parameters
- **Read a GitHub repository README**: returns the README body
  - Avoid: fetching large-file pages (may truncate); omitting the #readme anchor in the URL
- **Fetch an error page (edge case)**: returns the 404 page content or an error message
  - Avoid: using the returned content without checking validity; retrying auth-protected pages repeatedly
## todo_write

Create and manage structured task lists. Use for complex tasks with 3+ distinct steps. Mark tasks complete IMMEDIATELY after finishing. Only ONE task in_progress at a time.

### Examples
- **Create a multi-step task plan**: creates a new task list; the frontend shows two tasks
  - Avoid: using todo for simple tasks; merge=false overwriting existing tasks
- **Mark a task complete and update progress**: task 1 marked complete, task 2 automatically becomes in_progress
  - Avoid: not writing a summary after completing a task; marking multiple tasks in_progress at once
- **Append new tasks incrementally**: new tasks appended to the existing list
  - Avoid: id conflicts with existing tasks when merge: true
## ask_user_question

Ask the user clarifying questions when you need input on implementation choices or ambiguous requirements. Use multiSelect for multi-choice questions. Show options with clear labels and descriptions.

### Examples
- **Confirm a technical approach**: the frontend shows a single-choice question; execution continues after the user chooses
  - Avoid: too many options to distinguish; unclear wording that cannot be answered
- **Multi-select confirmation of feature requirements**: the user can pick multiple database types
  - Avoid: using multiSelect when single choice is intended; options without descriptions that the user cannot interpret
- **Edge case: when no question is needed**: do not call ask_user_question for clear requirements
  - Avoid: overuse that annoys the user; no options or fewer than 2 options

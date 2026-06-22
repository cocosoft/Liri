import pathlib

fpath = pathlib.Path('e:/PY/CODES/PY_APP/app/src/commands/builtin/memory/Memory.ts')
raw = fpath.read_bytes()
lines = raw.split(b'\n')

# Scan for // comment collapses - same pattern as CommandManager
found = 0
for i, line_bytes in enumerate(lines):
    if b'//' not in line_bytes:
        continue
    
    decoded = line_bytes.decode('latin-1')
    comment_idx = line_bytes.find(b'//')
    after_comment = decoded[comment_idx + 2:]  # text after //
    
    if '?' not in after_comment:
        continue
    
    last_q = after_comment.rfind('?')
    after_q = after_comment[last_q + 1:]
    trimmed = after_q.strip()
    
    if trimmed:
        found += 1
        print('L' + str(i+1) + ': -> [' + trimmed[:80] + ']')
        print('  Full: ' + decoded.strip()[:140])
        print()

if found == 0:
    print("No // comment collapse patterns found.")
else:
    print(f"Found {found} // comment collapse patterns.")

# Also scan for other corruption: un-terminated template literals
print("\n--- Checking for line-end corruption ---")
for i, line_bytes in enumerate(lines):
    s = line_bytes.decode('latin-1')
    # Check for lines that have `  but no closing `
    if s.strip().endswith('`') and s.strip().startswith('`'):
        # Single template string line - might be fine
        pass
    # Check lines with ` that has garbled content
    if '``' in s:
        print(f'L{i+1}: empty backtick: {s[:100]}')

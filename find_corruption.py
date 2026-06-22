import pathlib

fpath = pathlib.Path('e:/PY/CODES/PY_APP/app/src/commands/manager/CommandManager.ts')
raw = fpath.read_bytes()
lines = raw.split(b'\n')
print(f'Total lines: {len(lines)}')

# Look for lines where `//` comments collapsed with next line of code
code_keywords = ['if', 'const', 'let', 'var', 'function', 'return', 'async',
    'await', 'private', 'public', 'this.', 'import', 'export', 'class',
    'for', 'while', 'try', 'catch', 'switch', 'case']

for i, line_bytes in enumerate(lines):
    decoded = line_bytes.decode('latin-1')
    if b'//' not in line_bytes:
        continue
    
    comment_idx = line_bytes.find(b'//')
    after_comment = decoded[comment_idx + 2:]  # skip //
    
    # Find where garbled text ends and code begins
    # Garbled Chinese chars typically have ? at places where newlines were
    if '?' not in after_comment:
        continue
    
    # Check if the text after the last ? contains code keywords
    last_q = after_comment.rfind('?')
    after_last_q = after_comment[last_q + 1:]
    
    # Skip whitespace
    trimmed = after_last_q.strip()
    if not trimmed:
        continue
    
    # Check if it looks like code (starts with a keyword or identifier)
    found = False
    for kw in code_keywords:
        if trimmed.startswith(kw) or trimmed.startswith(kw + '(') or trimmed.startswith(kw + '.'):
            print(f'L{i+1}: // comment collapsed -> "{kw}"')
            print(f'  Full: {decoded.strip()[:150]}')
            print()
            found = True
            break
    
    if not found and trimmed and len(trimmed) > 2 and not trimmed.startswith('*'):
        # Could also be a line continuation 
        print(f'L{i+1}: // possible collapse -> [{trimmed[:40]}]')
        print(f'  Full: {decoded.strip()[:150]}')
        print()

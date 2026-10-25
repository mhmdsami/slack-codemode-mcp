const SKIP_TYPES = new Set([
  'WebAPICallResult',
  'ResponseMetadata',
  'TokenOverridable',
  'CursorPagination',
]);

const UNINDEXED_ARGS = 'Record<string, unknown>';

export function createSearch({ index, allowed }) {
  const declarations = new Map(
    Object.keys(index.declarations).map((name) => [name.toLowerCase(), name]),
  );
  const entries = index.methods.slice();
  const indexed = new Set(entries.map((entry) => entry.method));
  for (const method of allowed) {
    if (indexed.has(method)) continue;
    entries.push({
      method,
      required: true,
      args: UNINDEXED_ARGS,
      response: 'unknown',
      description: 'Allowed by this server but missing from the bundled SDK index.',
      unindexed: true,
    });
  }

  function methods(query, limit, includeBlocked = false) {
    const needle = String(query ?? '')
      .trim()
      .toLowerCase();
    if (!needle) return [];

    const scored = [];
    for (const entry of entries) {
      if (!includeBlocked && !allowed.has(entry.method)) continue;

      let score = 0;
      const method = entry.method.toLowerCase();
      if (method === needle) score += 200;
      else if (method.endsWith(`.${needle}`)) score += 120;
      else if (method.includes(needle)) score += 60;
      if (entry.description?.toLowerCase().includes(needle)) score += 20;
      if (entry.args?.toLowerCase().includes(needle)) score += 8;
      score -= entry.method.split('.').length * 6;
      if (score > 0) scored.push({ score, entry });
    }

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((item) => item.entry);
  }

  function type(name) {
    const key = String(name ?? '')
      .trim()
      .toLowerCase();
    const match = declarations.get(key);
    return match ? { name: match, declaration: index.declarations[match] } : null;
  }

  function referencedTypes(declaration) {
    if (!declaration) return [];
    const code = declaration.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const names = new Set();
    for (const match of code.matchAll(/\b([A-Z][A-Za-z0-9_]+)\b/g)) {
      const name = match[1];
      if (SKIP_TYPES.has(name)) continue;
      if (index.declarations[name]) names.add(name);
    }
    return [...names];
  }

  function render(matches, includeTypes) {
    const chunks = [];
    for (const entry of matches) {
      const suffix = entry.unindexed
        ? '  [not in SDK index]'
        : allowed.has(entry.method)
          ? ''
          : '  [blocked by this server]';
      const lines = [
        `${entry.method}(options${entry.required ? '' : '?'}: ${entry.args})${suffix}`,
      ];
      if (entry.description) lines.push(`  ${entry.description}`);
      if (entry.response) lines.push(`  → ${entry.response}`);
      if (entry.see) lines.push(`  ${entry.see}`);

      if (includeTypes && !entry.unindexed) {
        const declaration = index.declarations[entry.args];
        if (declaration) {
          const trimmed =
            declaration.length > 3000 ? `${declaration.slice(0, 3000)}\n…truncated` : declaration;
          lines.push('', trimmed);
          const deps = referencedTypes(declaration).filter((name) => name !== entry.args);
          if (deps.length) {
            lines.push(
              '',
              `more types: ${deps.join(', ')} — fetch with search({ type: "${deps[0]}" })`,
            );
          }
        }
      }
      chunks.push(lines.join('\n'));
    }
    return chunks.join('\n\n---\n\n');
  }

  return { methods, type, render };
}

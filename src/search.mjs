const SKIP_TYPES = new Set([
  'WebAPICallResult',
  'ResponseMetadata',
  'TokenOverridable',
  'CursorPagination',
]);

export function createSearch({ index, allowed }) {
  function methods(query, limit, includeBlocked = false) {
    const needle = String(query ?? '')
      .trim()
      .toLowerCase();
    if (!needle) return [];

    const scored = [];
    for (const entry of index.methods) {
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
    const match = Object.keys(index.declarations).find(
      (candidate) => candidate.toLowerCase() === key,
    );
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

  function render(entries, includeTypes) {
    const chunks = [];
    for (const entry of entries) {
      const suffix = allowed.has(entry.method) ? '' : '  [blocked by this server]';
      const lines = [
        `${entry.method}(options${entry.required ? '' : '?'}: ${entry.args})${suffix}`,
      ];
      if (entry.description) lines.push(`  ${entry.description}`);
      if (entry.response) lines.push(`  → ${entry.response}`);
      if (entry.see) lines.push(`  ${entry.see}`);

      if (includeTypes) {
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

  return { methods, type, render, index, allowed };
}

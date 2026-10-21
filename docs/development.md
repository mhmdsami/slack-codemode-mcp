# Development

## Setup

```bash
npm ci
npx lefthook install
```

Node 20+ and celld v0.6.2 on `PATH`. celld is only needed to run the server, not for tests or linting.

## Scripts

| Command | Purpose |
|---|---|
| `npm run gate` | Biome plus unit tests. This is what CI runs. |
| `npm test` | `node --test` over `test/`. |
| `npm run lint` | `biome check`. |
| `npm run format` | `biome format --write`. |
| `npm run doctor` | Slack token and scope probe. |
| `npm run auth` | PKCE authorization. |
| `npm run generate` | Rebuild `api-index.json`. |
| `npm start` | Run the MCP server over stdio. |

## Hooks

`lefthook.yml` runs Biome and the unit tests on commit, and the full gate on push. Hooks are installed by `prepare` after `npm install`; run `npx lefthook install` manually if needed.

## Tests

Tests use `node:test` and cover pure logic:

- permalink parsing
- name normalization and scoring
- request encoding and the JSON-to-form fallback
- search filtering and rendering
- allowlist and index loading
- cache freshness
- token resolution from the environment
- 429 handling with an injected fetch

Tests never call Slack and never need a token. Add a test whenever logic can be extracted from a module.

## Adding an action

1. Implement it in `src/actions/<area>.mjs` with injected `slack`, `cache`, and `limits`.
2. Wire it in `src/actions/index.mjs`.
3. Expose it on `app` in `celld/guest.js`.
4. Add the methods it calls to `allowlist.json` and the scopes to `scripts/auth.mjs` if needed.
5. Document it in `docs/actions.md` and the README table.
6. Run `npm run gate` and `npm run doctor`.

Actions should validate input, return small JSON, and never trust guest-supplied limits.

## API index

`api-index.json` is generated from `@slack/web-api`'s declarations:

```bash
npm run generate
```

It contains 275 methods and roughly 1,094 type declarations. Regenerate after upgrading the SDK and commit the result.

## Code conventions

- ESM, two-space indent, single quotes, semicolons, trailing commas. Biome enforces it.
- No comments in source files. Explanations belong in docs, commit messages, or names.
- Prefer small exported functions with injected dependencies over globals.
- Keep the host as the only place that touches the token, the allowlist, and Slack.

## Release

1. Update `version` in `package.json`.
2. Run `npm run gate`.
3. Run `npm run generate` if the SDK changed.
4. Commit, tag, and push.

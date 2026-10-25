# Development

## Setup

```bash
npm ci
npx lefthook install
```

You need Node 20.12 or newer. celld v0.6.2 is only needed to run the server, not for tests or linting.

## Scripts

| Command | Purpose |
|---|---|
| `npm run gate` | Biome plus unit tests. This is what CI runs. |
| `npm test` | Run `node --test` over `test/`. |
| `npm run lint` | Run `biome check`. |
| `npm run format` | Run `biome format --write`. |
| `npm run doctor` | Check the Slack token and scopes. |
| `npm run auth` | Start the PKCE authorization flow. |
| `npm run generate` | Rebuild `api-index.json`. |
| `npm start` | Run the MCP server over stdio. |

## Hooks

Lefthook runs Biome and the unit tests on commit. It runs the full gate on push.

Hooks are installed by `prepare` after `npm install`. To install them by hand:

```bash
npx lefthook install
```

## Tests

Tests use `node:test` and never call Slack or need a token.

What they cover:

- permalink parsing and target resolution
- name normalization and scoring
- request encoding and the JSON-to-form fallback
- search filtering, unindexed allowlisted methods, and rendering
- action input validation and page limits
- canvas edit validation, share threads, and section filters
- cache freshness, expiry, and eviction
- token resolution from the environment
- guest result formatting and the sandbox envelope
- bridge authentication, origin rejection, and body limits
- 429 handling with an injected fetch

Add a test whenever logic can be pulled out of a module.

## Adding an action

1. Write the action in `src/actions/<area>.mjs`. Inject `slack`, `cache`, and `limits`.
2. Validate input with the helpers in `src/actions/input.mjs`.
3. Add the case in `src/actions/index.mjs`.
4. Expose it on `app` in `celld/guest.js`.
5. Add any new methods to `allowlist.json` and scopes to `scripts/auth.mjs`.
6. Document it in `docs/actions.md` and the README table.
7. Add a test. Run `npm run gate` and `npm run doctor`.

Actions should validate input, return small JSON, and never trust limits from the guest.

## API index

`api-index.json` is generated from the `@slack/web-api` declarations:

```bash
npm run generate
```

It contains about 275 methods and 1,094 type declarations.

Regenerate after upgrading the SDK and commit the result.

## Code conventions

Use ESM, two-space indent, single quotes, semicolons, and trailing commas. Biome enforces this.

Do not add comments to source files. Put explanations in docs, commit messages, or names.

Prefer small exported functions with injected dependencies over globals.

The host is the only place that touches the token, the allowlist, and Slack.

## Release

1. Update `version` in `package.json`.
2. Run `npm run gate`.
3. Run `npm run generate` if the SDK changed.
4. Commit, tag, and push.

# AGENTS.md

Slack Code Mode MCP. A stdio MCP server that lets an agent write JavaScript against the Slack Web API, executed in a celld V8 isolate with no network and no Slack token.

## Commands

```bash
npm ci
npm run gate        # biome check + node --test, what CI runs
npm run test        # unit tests only
npm run lint        # biome check
npm run format      # biome format --write
npm run doctor      # Slack token + scope check (needs a token)
npm run auth        # OAuth via PKCE
npm run generate    # rebuild api-index.json from @slack/web-api types
npm start           # run the MCP server over stdio
```

Run `npm run gate` before every push. Run `npm run doctor` after changing scopes or auth.

## Layout

```
mcp/server.mjs          entry, imports src/server.mjs
src/server.mjs          MCP tools, runtime supervision
src/config.mjs          paths and limits
src/credentials.mjs     token resolution and storage
src/search.mjs          api-index search and rendering
src/slack/client.mjs    Slack HTTP client, retries, encoding
src/actions/            whoami, users, channels, messages, canvas, files
src/runtime/bridge.mjs  authenticated loopback dispatcher
src/runtime/celld.mjs   celld process lifecycle
celld/worker.js         trusted worker, guest loader, bridge entrypoint
celld/guest.js          sandbox module, slack/app/console
scripts/                auth, doctor, api-index generation
test/                   node:test unit tests
docs/                   agent setup, architecture, authentication, actions, security, development
```

## Invariants

- No comments in source files. Put explanations in docs and commit messages.
- The Slack token and refresh token live only in the host process. They must never enter celld's environment, the guest, logs, diagnostics, fixtures, or the repository.
- The guest runs with `globalOutbound: null` and receives only the `SLACK` service binding. Do not add host bindings or network access.
- Every execution gets a fresh isolate, a new execution id, and a new bridge token. Never reuse an execution record.
- `allowlist.json` is the single source of truth for raw Web API access. The bridge enforces it before calling Slack.
- Multi-call behavior belongs in `src/actions`, not in generated guest code. Actions may use several allowlisted methods internally and must validate their inputs.
- Do not add dependencies without asking. Runtime dependencies stay minimal: MCP SDK, zod. Tooling: biome, lefthook, typescript, @slack/web-api for types.
- Never commit secrets. `.env` holds only `SLACK_CLIENT_ID` and is gitignored.
- celld supports macOS arm64 and Linux; Windows is unsupported. Do not add Windows-only assumptions.

## Style

- ESM only, two-space indent, single quotes, semicolons, trailing commas. Biome enforces it.
- Prefer small exported functions and dependency injection (`slack`, `cache`, `limits`) so logic stays testable without network.
- Errors are `ActionError` for actions and `SlackError` for transport. Preserve `code`, `needed`, `provided`, and `retryAfter`.
- Conventional Commits, imperative subject, 50 characters or fewer. Branch prefixes: `ft-`, `fx-`, `ch-`, `rf-`.

## Adding an action

1. Add the function to the relevant module in `src/actions`.
2. Wire it in `src/actions/index.mjs`.
3. Expose it on `app` in `celld/guest.js`.
4. Document it in `docs/actions.md` and the README table.
5. Add a test when the logic is pure; add the needed methods to `allowlist.json` and scopes to `scripts/auth.mjs` if it calls new Slack methods.
6. Run `npm run gate` and `npm run doctor`.

# dsh-next-reply-chips

Clickable **next-reply chips** under every assistant turn in the DeepSeek Harness Web GUI. Each chip carries one likely thing you would say next, so a turn advances with one click.

## What makes it different

Two plugins on the awesome list already do "suggest what I say next". This one differs in exactly two verifiable ways:

1. **No auxiliary model call.** The suggestions ride along in the reply you already paid for — the model closes its answer with a `suggest` code block, and the browser parses it. Nothing extra is requested per turn.
2. **The click behaviour is yours to choose.** Chips can send immediately, or only fill the composer so you can edit first.

The trade-off is honest and stated up front: because the suggestions come from the reply itself, a model that ignores the format produces no chips for that turn. A plugin that spends an extra call per turn does not have that failure mode.

## How it works

1. **Host half** (`lib/index.js`) registers one system-prompt section asking the model to close each reply with a `suggest` block:

   ````text
   ```suggest
   选项一 || 选项二 || 选项三
   ```
   ````

   Delegated agents are skipped: they answer into a parent's tool result where no chip row renders, so the instruction would only add tokens and plant stray blocks.

2. **Browser half** (`lib/client.js`) does two things with that block:
   - a `conversation.chat.markdown.fence` hoc layer keyed `suggest` renders **nothing**, so the block never reaches the transcript;
   - one cell in `conversation.chat.turnTail` reads the settled assistant text of that Turn, parses the options, and renders up to three pills.

3. **Click** goes through the composer's own `inputActions`, so attachments, permission gates and plan mode behave exactly as if you had typed the text.

### Why a fenced block and not an HTML comment

An HTML comment looked like the obvious choice, but the Chat markdown pipeline escapes rather than drops `html` nodes — the comment rendered as visible text. A fenced block is dispatched to a real Slot by its language, so a hoc layer can replace it wholesale. The legacy comment shape is still parsed, for transcripts written by an older build.

## The setting

**Settings → 下一步建议**:

| Option | What a click does |
| --- | --- |
| **直接发送** (default) | `setDraft(text)` + `submit()` — the message goes out at once |
| **填入输入框，待我确认** | `setDraft(text)` only — the text lands in the composer and you send it yourself |

Persisted in `config.json` beside the package, so it survives restarts **and** Web-GUI port changes (the origin carries a port that has been observed to change between launches, which is why the preference is not in `localStorage`).

## Deliberately dependency-free

`package.json` declares **no** `dependencies` and **no** `peerDependencies`. That is a design choice, not an omission:

- A plugin `Config` schema needs `@deepseek-ai/schemastery`, and a `link:`-installed package resolves bare imports from its own directory rather than the profile's `node_modules` — the schema would not load for local installs.
- Declaring official `@deepseek-ai/*` peers brings a version-range hazard: a range without an explicit prerelease branch on the exact `major.minor.patch` tuple silently excludes the harness's prerelease builds, and an unmet requirement **blocks installation**.

So the preference is a plain JSON file and the settings surface is a `settings.section` page. The plugin installs from any path, with no build step and no dependency resolution.

## Behaviour notes

| Situation | Result |
| --- | --- |
| Model omitted the marker | No row, no gap, no error |
| Marker split across content blocks | Blocks are joined before parsing |
| Options one per line instead of `\|\|` | Accepted; bullets and `1.` prefixes stripped |
| Model emits a JSON array instead | Salvaged |
| Wrapping quotes `「」“”` / list markers | Peeled |
| Same option twice in different case | De-duplicated |
| One suggestion longer than 80 characters | Truncated |
| Legacy `<!--NEXT: ... -->` comment | Still parsed |
| `turn` prop is `3`, `{turn}`, `{kind,turn}`, or `{turn:{turn}}` | All folded to a number before matching |
| `turn` prop cannot be normalized | Falls back to the closing answer only, so older Turns stay bare |
| `useChat` unavailable | Falls back to `session.chat` from the session snapshot |
| Several `assistant-step` nodes in one Turn (retry/interrupt) | Newest one carrying a marker wins |
| Session currently running | Chips render disabled |
| `inputActions` unavailable (version drift) | Chips render disabled; a click logs one error |
| The fence hider fails to attach | Chips still work; the block stays visible (warning logged) |
| Preference route unreachable | Falls back to the documented default (direct send) |
| Delegated (sub-)agent session | No marker instruction, no row |

### Debugging a missing row

Run `window.__NRC_DIAG__ = true` in the browser console and reload. The newest answer then renders a one-line report of what the renderer actually handed over — `turn`, `order` length, whether `nodes` is a map, and the trailing node kinds — enough to tell a missing chat slice from an unexpected node kind from a reply that simply carried no marker. Off by default.

## Install

From a checkout:

```bash
dsh plugin --profile <profile> add E:\path\to\dsh-next-reply-chips
```

From GitHub:

```bash
dsh plugin --profile <profile> add github:Charlieeeo/dsh-next-reply-chips
```

Refresh the Web GUI after installing. **Host half** changes need a DSH restart; **client half** changes need only a page refresh.

## Test

```bash
node test/smoke.mjs   # 38 checks
```

Covers: the host section and its delegated-agent skip, the preference route (GET/POST/400/405 against the real file), both click modes, both marker shapes, `Turn` coercion, and the parser's normalisation, de-duplication, length cap and JSON salvage.

## Disable

Settings → Plugins → **dsh-next-reply-chips** → switch off. This removes the browser half, the settings page, the fence hider **and** the system-prompt section together, so no stale instruction survives.

## Files

| Path | Role |
| --- | --- |
| `lib/index.js` | Host half: system-prompt section + `/plugins/dsh-next-reply-chips/config` GET/POST |
| `lib/client.js` | Browser half: `turnTail` chips + `suggest` fence hider + `settings.section` page (hand-written lazy-CJS factory, no build step) |
| `cordis.patch.yml` | Inserts the Loader row |
| `config.json` | Created on first save; local runtime state, git-ignored |
| `test/smoke.mjs` | Test harness (not shipped) |

## Credit

The interaction pattern — suggested follow-ups under an answer, click to accept — follows `anye-99/dsh-next-step-suggest` and `Basspoom/dsh-nextline` on the awesome-dsh-plugin list. The delegated-agent skip and the suggestion normalisation rules were inspired by reading their source.

# dsh-next-reply-chips

English | [简体中文](README.md)

**Three next steps you can click, under every answer.** Clickable follow-up message suggestions for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH).

`v0.6.0` · DSH `0.2.2-rc.x` · Desktop / Web

## Features

- After each completed turn, up to three pills appear **above** that turn's action row, each one a message you could send next.
- The click behaviour is switchable: **send immediately** (default), or **fill the composer only** so you can edit first.
- The suggestions come from **the reply itself** — no auxiliary model call, so no added latency or cost per turn.
- Delegated (sub-)agent sessions show no pills and are not given the format instruction.
- Colours follow the DSH light/dark theme; chips are disabled while a session is running.

## How it works

1. **Host half** registers one system-prompt section asking the model to close each reply with a `suggest` code block:

   ````text
   ```suggest
   option one || option two || option three
   ```
   ````

2. **Browser half** does two things: a hoc layer keyed `suggest` **swallows the block whole** (it never reaches the transcript), and the chip row parses the options out of that turn's assistant text.

3. **Click** goes through the composer's own `inputActions`, so attachments, permission gates and plan mode behave exactly as if you had typed the text.

**The trade-off, stated plainly:** because the suggestions come from the reply, **a turn where the model ignores the format produces no chips** — no error, no gap. Some plugins spend an extra model call per turn to be format-independent, at the cost of latency and money on every turn; this one took the other side.

### Why a fenced block and not an HTML comment

The first version used `<!--NEXT: -->`. But DSH's markdown pipeline **escapes** rather than drops HTML nodes, so the comment showed up as literal text. A fenced block is dispatched to a real Slot by its language, which lets a hoc layer replace it wholesale. The legacy comment shape is still parsed, but no longer recommended.

## Install

From GitHub (recommended):

```powershell
dsh plugin --profile desktop add "github:Charlieeeo/dsh-next-reply-chips"
```

Or use **Settings → Plugins → Add plugin** and paste the same `github:Charlieeeo/dsh-next-reply-chips`.

From a local checkout:

```powershell
dsh plugin --profile desktop add "E:\path\to\dsh-next-reply-chips"
```

Confirm it is enabled under **Settings → Plugins**. A **Host half** change needs a DSH restart; a **browser half** change needs only a page refresh.

Uninstall:

```powershell
dsh plugin --profile desktop remove dsh-next-reply-chips
```

## Usage

Nothing to configure: once installed, pills appear under the next completed answer.

Switch the click behaviour under **Settings → Next-reply chips**:

| Option | What a click does |
| --- | --- |
| **Send immediately** (default) | Goes out as your next message at once |
| **Fill the composer** | Lands in the composer; you edit and send it yourself |

To turn the feature off entirely: **Settings → Plugins → dsh-next-reply-chips** and switch it off. That removes the pills, the settings page, the fence hider **and** the system-prompt section together, leaving no stale state.

## Configuration

The only state is one boolean, stored at **`~/.dsh/next-reply-chips.json`**:

```json
{ "directSend": false }
```

It lives in the DSH home rather than beside the package because `dsh plugin add github:...` installs under `node_modules`, where a write may be refused and an upgrade discards the file.

Builds before 0.6 wrote that file beside the package; it is still read so an existing choice survives.

## Data and privacy

- **No network access.** The plugin makes no external request.
- **No auxiliary model call.** Nothing is sent anywhere; no extra request per turn.
- The only round-trip is a **same-origin** `GET/POST /plugins/dsh-next-reply-chips/config`, used solely to read and write that one boolean.
- The only file written is `~/.dsh/next-reply-chips.json`.
- No telemetry.

## Compatibility

- Verified on DSH `0.2.2-rc.5`.
- Depends on three client slots: `conversation.chat.turnTail`, `conversation.chat.markdown.fence`, `settings.section`. If one is missing, that cell simply does not render; the rest keeps working.
- No dependencies, no build step, no `peerDependencies` — so it cannot trip an install-time version gate.

## Known limitations

- Relies on the model following the format; a turn that does not follow it shows no pills.
- A ```suggest block pasted by hand into a user message is hidden by the same layer (assistant-side behaviour is unaffected).
- Not published to npm yet.

## Development

```powershell
node test/smoke.mjs   # 39 checks: host section and route, both click modes, both marker shapes, Turn coercion, parser normalisation
```

The suite uses scratch files and **never reads or writes your real `~/.dsh/next-reply-chips.json`**.

Debugging a missing row: run `window.__NRC_DIAG__ = true` in the browser console and reload. The newest answer then prints a one-line shape report (`turn`, `order` length, whether `nodes` is a map, trailing node kinds).

## License

[MIT](LICENSE)

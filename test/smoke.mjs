/**
 * Smoke test for dsh-next-reply-chips, run with `node test/smoke.mjs`.
 *
 * Exercises the REAL shipped files through minimal stubs:
 *  - Host half: `apply` registers one system-prompt section and one preference
 *    route; the route's GET/POST round-trip is driven end to end against the
 *    real `config.json` beside the package.
 *  - Client half: boots the lazy-CJS factory with fake loader/React/ctx/fetch,
 *    captures both registered cells, and drives the chip row in BOTH click
 *    behaviours plus the settings page.
 *
 * Not shipped: `package.json` `files` omits `test/`.
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const pkgRoot = join(here, '..')
const CONFIG_FILE = join(pkgRoot, 'config.json')

let passed = 0
async function check(label, fn) {
  await fn()
  passed += 1
  console.log(`  ok  ${label}`)
}

// Never destroy a real preference: snapshot whatever is on disk, run against a
// clean slate, and put the original back at the end.
const originalConfig = existsSync(CONFIG_FILE) ? readFileSync(CONFIG_FILE, 'utf8') : null
rmSync(CONFIG_FILE, { force: true })

// ---------------------------------------------------------------- Host half

console.log('Host half (lib/index.js)')
const host = await import(pathToFileURL(join(pkgRoot, 'lib/index.js')).href)

await check('injects the systemPrompt service', () => {
  assert.deepEqual(host.inject, ['systemPrompt'])
})

/** Host stub capturing sections and routes. */
function makeHostCtx() {
  const sections = []
  const routes = []
  const server = {
    register(route) {
      routes.push(route)
      return () => {}
    },
  }
  const ctx = {
    systemPrompt: { section: (section) => sections.push(section) },
    get: (key) => (key === 'webServer' ? server : undefined),
    effect: (fn) => {
      fn()
      return () => {}
    },
    logger: { warn: () => {} },
  }
  return { ctx, sections, routes }
}

const hostStub = makeHostCtx()
host.apply(hostStub.ctx)

await check('apply() registers exactly one section with the marker template', () => {
  assert.equal(hostStub.sections.length, 1)
  const [section] = hostStub.sections
  assert.equal(section.name, 'next-reply-chips:format')
  assert.equal(section.order, 118)
  assert.equal(typeof section.text, 'function')
  const text = section.text({ agent: undefined })
  assert.match(text, /```suggest/)
  assert.match(text, /\|\|/)
})

await check('keeps the instruction for a root agent and drops it for a delegated one', () => {
  const sections = []
  const rootAgent = { id: 'root' }
  const childAgent = { id: 'child' }
  const ctx = {
    systemPrompt: { section: (section) => sections.push(section) },
    get: (key) =>
      key === 'subagents'
        ? { rootOf: (agent) => (agent === childAgent ? rootAgent : agent) }
        : undefined,
    effect: () => () => {},
    logger: { warn: () => {} },
  }
  host.apply(ctx)
  const [section] = sections
  assert.match(section.text({ agent: rootAgent }), /```suggest/)
  assert.equal(section.text({ agent: childAgent }), '', 'a delegated agent must not receive the marker')
})

await check('apply() registers the preference route', () => {
  assert.equal(hostStub.routes.length, 1)
  assert.equal(hostStub.routes[0].kind, 'exact')
  assert.equal(hostStub.routes[0].path, '/plugins/dsh-next-reply-chips/config')
})

/** Invoke the route handler with a fake request/response pair. */
async function callRoute({ method, body }) {
  let status
  let payload
  const res = {
    writeHead(nextStatus) {
      status = nextStatus
    },
    end(chunk) {
      payload = chunk
    },
  }
  const req = {
    method,
    url: '/plugins/dsh-next-reply-chips/config',
    async *[Symbol.asyncIterator]() {
      if (body !== undefined) yield Buffer.from(JSON.stringify(body))
    },
  }
  await hostStub.routes[0].handler(req, res)
  return { status, json: payload === undefined ? undefined : JSON.parse(payload) }
}

await check('GET returns the default (send) on a fresh install', async () => {
  const { status, json } = await callRoute({ method: 'GET' })
  assert.equal(status, 200)
  assert.deepEqual(json, { directSend: true })
})

await check('POST persists "draft" and a later GET reads it back', async () => {
  const write = await callRoute({ method: 'POST', body: { directSend: false } })
  assert.equal(write.status, 200)
  assert.deepEqual(write.json, { directSend: false })
  assert.deepEqual(JSON.parse(readFileSync(CONFIG_FILE, 'utf8')), { directSend: false })

  const read = await callRoute({ method: 'GET' })
  assert.deepEqual(read.json, { directSend: false })
})

await check('POST rejects a non-boolean payload without touching the file', async () => {
  const before = readFileSync(CONFIG_FILE, 'utf8')
  const { status } = await callRoute({ method: 'POST', body: { directSend: 'nope' } })
  assert.equal(status, 400)
  assert.equal(readFileSync(CONFIG_FILE, 'utf8'), before)
})

await check('an unsupported method is refused', async () => {
  const { status } = await callRoute({ method: 'DELETE' })
  assert.equal(status, 405)
})

// -------------------------------------------------------------- Client half

console.log('Client half (lib/client.js)')

/** A fetch stub standing in for the Host route. */
let serverSide = { directSend: true }
let fetchCalls = []
globalThis.fetch = async (url, init) => {
  fetchCalls.push({ url, method: init?.method ?? 'GET' })
  if (init?.method === 'POST') {
    serverSide = JSON.parse(init.body)
    return { ok: true, json: async () => serverSide }
  }
  return { ok: true, json: async () => serverSide }
}

/** Minimal React stand-in: enough for the components' hooks and elements. */
const react = {
  useState: (initial) => [initial, () => {}],
  useEffect: () => {},
  useMemo: (factory) => factory(),
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
}

/** Boot the shipped client file and capture what it registers. */
function bootClient() {
  const source = readFileSync(join(pkgRoot, 'lib/client.js'), 'utf8')
  let mod
  const window = { __ModuleLoader__: { load: (m) => { mod = m } }, __NRC_DIAG__: false }
  new Function('window', 'console', 'fetch', source)(window, console, globalThis.fetch)
  assert.ok(mod, 'module loader was not called')
  assert.equal(mod.id, 'dsh-next-reply-chips')

  const exportsObj = mod.factory((name) => {
    if (name === 'react') return react
    throw new Error(`unexpected require: ${name}`)
  })

  const cells = []
  const ctx = {
    slots: {
      inject: (key, cb) => cb(),
      register: (definition, component) => {
        cells.push({ definition, component })
        return () => {}
      },
    },
  }
  exportsObj.apply(ctx)
  return { exportsObj, cells }
}

/** Build a chat snapshot with one assistant step for `turn`. */
function chatWith(turn, textBlocks) {
  const nodes = new Map()
  nodes.set(`a${turn}`, {
    kind: 'assistant-step',
    location: { turn },
    data: { content: textBlocks.map((text) => ({ type: 'text', text })) },
  })
  return { order: [`a${turn}`], nodes }
}

/** The button elements of a rendered row, flattened past React's nesting. */
function chipsOf(tree) {
  return tree.children.flat()
}

/** Render the chip row with a given session state. */
function renderChips(component, { turn, chat, running = false, inputActions }) {
  const tree = component({
    turn,
    useChat: (select) => select(chat),
    useSession: (select) => select({ running }),
    inputActions,
  })
  return tree
}

const { exportsObj, cells } = bootClient()
const chipsCell = cells.find((cell) => cell.definition.name === 'conversation.chat.turnTail')
const settingsCell = cells.find((cell) => cell.definition.name === 'settings.section')

await check('exports inject=["slots"] and an apply function', () => {
  assert.deepEqual(exportsObj.inject, ['slots'])
  assert.equal(typeof exportsObj.apply, 'function')
})

await check('registers a fresh turnTail cell ordered before the action row', () => {
  assert.ok(chipsCell, 'the turnTail cell was not registered')
  assert.equal(chipsCell.definition.id, 'next-reply-chips')
  assert.equal(chipsCell.definition.order, 60)
})

await check('registers a settings page labelled 下一步建议', () => {
  assert.ok(settingsCell, 'the settings cell was not registered')
  assert.equal(settingsCell.definition.id, 'next-reply-chips')
  assert.equal(settingsCell.definition.order, 55)
  assert.equal(settingsCell.definition.label, '下一步建议')
})

await check('parses three options out of a marker', () => {
  const chat = chatWith(3, ['好的。\n<!--NEXT: 按方案 A 继续 || 先看数据再定 || 换成英文标题 -->'])
  const tree = renderChips(chipsCell.component, { turn: 3, chat, inputActions: {} })
  assert.deepEqual(chipsOf(tree).map((chip) => chip.children[0]), ['按方案 A 继续', '先看数据再定', '换成英文标题'])
})

await check('a marker split across text blocks still parses', () => {
  const chat = chatWith(3, ['前言 <!--NEXT: 甲', ' || 乙 || 丙 --> 尾巴'])
  const tree = renderChips(chipsCell.component, { turn: 3, chat, inputActions: {} })
  assert.deepEqual(chipsOf(tree).map((chip) => chip.children[0]), ['甲', '乙', '丙'])
})

await check('a turn without a marker renders nothing (no gap)', () => {
  assert.equal(renderChips(chipsCell.component, { turn: 3, chat: chatWith(3, ['纯文本']), inputActions: {} }), null)
})

await check('chips are turn-scoped: another turn renders nothing', () => {
  const chat = chatWith(3, ['<!--NEXT: 甲 || 乙 || 丙 -->'])
  assert.equal(renderChips(chipsCell.component, { turn: 4, chat, inputActions: {} }), null)
})

await check('more than three options truncate to three', () => {
  const chat = chatWith(3, ['<!--NEXT: 甲 || 乙 || 丙 || 丁 -->'])
  const tree = renderChips(chipsCell.component, { turn: 3, chat, inputActions: {} })
  assert.deepEqual(chipsOf(tree).map((chip) => chip.children[0]), ['甲', '乙', '丙'])
})

await check('duplicates and blanks are dropped', () => {
  const chat = chatWith(3, ['<!--NEXT: 甲 ||  || 甲 || 乙 -->'])
  const tree = renderChips(chipsCell.component, { turn: 3, chat, inputActions: {} })
  assert.deepEqual(chipsOf(tree).map((chip) => chip.children[0]), ['甲', '乙'])
})

await check('location.turn.turn shape is accepted too', () => {
  const nodes = new Map()
  nodes.set('x', {
    kind: 'assistant-step',
    location: { turn: { turn: 7 } },
    data: { content: [{ type: 'text', text: '<!--NEXT: 甲 || 乙 || 丙 -->' }] },
  })
  const tree = renderChips(chipsCell.component, { turn: 7, chat: { order: ['x'], nodes }, inputActions: {} })
  assert.deepEqual(chipsOf(tree).map((chip) => chip.children[0]), ['甲', '乙', '丙'])
})

await check('SEND mode: a click sends immediately (setDraft + submit)', () => {
  serverSide = { directSend: true }
  const calls = []
  const inputActions = {
    setDraft: (text) => calls.push(['setDraft', text]),
    submit: () => calls.push(['submit']),
  }
  const tree = renderChips(chipsCell.component, { turn: 3, chat: chatWith(3, ['<!--NEXT: 甲 || 乙 -->']), inputActions })
  chipsOf(tree)[1].props.onClick()
  assert.deepEqual(calls, [['setDraft', '乙'], ['submit']])
})

await check('DRAFT mode: a click only fills the composer', () => {
  serverSide = { directSend: false }
  // Flipping the preference through the settings page is the real path.
  const settingsTree = settingsCell.component({})
  const radios = settingsTree.children.filter((child) => child && child.props && typeof child.props.onSelect === 'function')
  assert.equal(radios.length, 2, 'the settings page must offer two options')
  radios[1].props.onSelect() // "填入输入框"
  assert.deepEqual(serverSide, { directSend: false })

  const calls = []
  const inputActions = {
    setDraft: (text) => calls.push(['setDraft', text]),
    submit: () => calls.push(['submit']),
  }
  const tree = renderChips(chipsCell.component, { turn: 3, chat: chatWith(3, ['<!--NEXT: 甲 || 乙 -->']), inputActions })
  chipsOf(tree)[0].props.onClick()
  assert.deepEqual(calls, [['setDraft', '甲']], 'draft mode must not submit')
})

await check('DRAFT mode annotates the chip tooltip', () => {
  const tree = renderChips(chipsCell.component, { turn: 3, chat: chatWith(3, ['<!--NEXT: 甲 -->']), inputActions: {} })
  assert.match(chipsOf(tree)[0].props.title, /填入输入框/)
})

await check('a running session renders chips disabled and inert', () => {
  serverSide = { directSend: true }
  const calls = []
  const inputActions = {
    setDraft: (text) => calls.push(['setDraft', text]),
    submit: () => calls.push(['submit']),
  }
  const tree = renderChips(chipsCell.component, {
    turn: 3,
    chat: chatWith(3, ['<!--NEXT: 甲 || 乙 -->']),
    running: true,
    inputActions,
  })
  assert.equal(chipsOf(tree)[0].props.disabled, true)
  chipsOf(tree)[0].props.onClick()
  assert.deepEqual(calls, [], 'a disabled chip must not act')
})

await check('a missing inputActions renders chips disabled instead of throwing', () => {
  const tree = renderChips(chipsCell.component, { turn: 3, chat: chatWith(3, ['<!--NEXT: 甲 -->']), inputActions: undefined })
  assert.equal(chipsOf(tree)[0].props.disabled, true)
  chipsOf(tree)[0].props.onClick() // must not throw
})

await check('a malformed chat snapshot renders nothing instead of throwing', () => {
  for (const chat of [undefined, null, {}, { order: 'nope' }, { order: [], nodes: {} }]) {
    assert.equal(renderChips(chipsCell.component, { turn: 1, chat, inputActions: {} }), null)
  }
})

await check('the settings page offers both behaviours with distinct copy', () => {
  const tree = settingsCell.component({})
  const radios = tree.children.filter((child) => child && child.props && typeof child.props.onSelect === 'function')
  assert.equal(radios[0].props.label, '直接发送')
  assert.equal(radios[1].props.label, '填入输入框，待我确认')
})

// ------------------------------------------- fenced format and Turn coercion

const fenceCell = cells.find((cell) => cell.definition.name === 'conversation.chat.markdown.fence')

await check('registers a hidden layer for the suggest fence', () => {
  assert.ok(fenceCell, 'the fence cell was not registered')
  assert.equal(fenceCell.definition.key, 'suggest')
  assert.equal(fenceCell.component({}), null, 'the layer must swallow the block')
})

await check('parses a `suggest` fenced block', () => {
  const chat = chatWith(3, ['好的。\n```suggest\n按方案 A 继续 || 先看数据再定 || 换成英文标题\n```\n'])
  const tree = renderChips(chipsCell.component, { turn: 3, chat, inputActions: {} })
  assert.deepEqual(chipsOf(tree).map((chip) => chip.children[0]), ['按方案 A 继续', '先看数据再定', '换成英文标题'])
})

await check('tolerates one option per line inside the fence', () => {
  const chat = chatWith(3, ['```suggest\n- 甲\n- 乙\n- 丙\n```'])
  const tree = renderChips(chipsCell.component, { turn: 3, chat, inputActions: {} })
  assert.deepEqual(chipsOf(tree).map((chip) => chip.children[0]), ['甲', '乙', '丙'])
})

await check('still parses the legacy HTML comment', () => {
  const chat = chatWith(3, ['正文 <!--NEXT: 甲 || 乙 --> 尾巴'])
  const tree = renderChips(chipsCell.component, { turn: 3, chat, inputActions: {} })
  assert.deepEqual(chipsOf(tree).map((chip) => chip.children[0]), ['甲', '乙'])
})

await check('a TurnLocation-shaped turn prop still matches', () => {
  const chat = chatWith(3, ['```suggest\n甲 || 乙\n```'])
  for (const turn of [3, { turn: 3 }, { kind: 'turn', turn: 3 }, { turn: { turn: 3 } }]) {
    const tree = renderChips(chipsCell.component, { turn, chat, inputActions: {} })
    assert.ok(tree !== null, `chips missing for turn prop ${JSON.stringify(turn)}`)
    assert.deepEqual(chipsOf(tree).map((chip) => chip.children[0]), ['甲', '乙'])
  }
})

await check('unresolvable turn falls back to the closing answer only', () => {
  const nodes = new Map()
  nodes.set('old', { kind: 'assistant-step', location: { turn: 3 }, data: { content: [{ type: 'text', text: '```suggest\n旧 || 旧2\n```' }] } })
  nodes.set('later', { kind: 'user', location: { turn: 4 } })
  nodes.set('tail', { kind: 'turn-tail', location: { turn: 4 } })
  const older = { order: ['old', 'later', 'tail'], nodes }
  assert.equal(
    renderChips(chipsCell.component, { turn: undefined, chat: older, inputActions: {} }),
    null,
    'a non-closing answer must not show chips',
  )

  const fresh = new Map()
  fresh.set('ans', { kind: 'assistant-step', location: { turn: 9 }, data: { content: [{ type: 'text', text: '```suggest\n新 || 新2\n```' }] } })
  fresh.set('tail', { kind: 'turn-tail', location: { turn: 9 } })
  const tree = renderChips(chipsCell.component, { turn: undefined, chat: { order: ['ans', 'tail'], nodes: fresh }, inputActions: {} })
  assert.deepEqual(chipsOf(tree).map((chip) => chip.children[0]), ['新', '新2'])
})

await check('a session snapshot supplies chat when useChat is absent', () => {
  const chat = chatWith(3, ['```suggest\n甲 || 乙\n```'])
  const tree = chipsCell.component({
    turn: 3,
    useChat: undefined,
    useSession: (select) => select({ running: false, chat }),
    inputActions: {},
  })
  assert.deepEqual(chipsOf(tree).map((chip) => chip.children[0]), ['甲', '乙'])
})

// ------------------------------------------------- parser hardening (adopted
// from the two reference plugins: normalise, de-dupe, cap, salvage)

/** Parse one fenced body through the real component. */
function chipsFromBody(body) {
  const chat = chatWith(3, [`\`\`\`suggest\n${body}\n\`\`\``])
  const tree = renderChips(chipsCell.component, { turn: 3, chat, inputActions: {} })
  return tree === null ? null : chipsOf(tree).map((chip) => chip.children[0])
}

await check('salvages a JSON array instead of the delimiter convention', () => {
  assert.deepEqual(chipsFromBody('["按方案 A 继续", "先看数据", "换英文标题"]'), ['按方案 A 继续', '先看数据', '换英文标题'])
})

await check('peels wrapping quotes and list markers', () => {
  assert.deepEqual(chipsFromBody('「按方案 A 继续」\n- “先看数据”\n1. 『换英文标题』'), ['按方案 A 继续', '先看数据', '换英文标题'])
})

await check('collapses internal whitespace inside one option', () => {
  assert.deepEqual(chipsFromBody('按方案   A   继续 ||  先看数据 '), ['按方案 A 继续', '先看数据'])
})

await check('de-duplicates case-insensitively', () => {
  assert.deepEqual(chipsFromBody('Run tests || run tests || RUN TESTS'), ['Run tests'])
})

await check('caps an over-long suggestion', () => {
  const long = '很长的一条建议'.repeat(40)
  const [only] = chipsFromBody(long)
  assert.equal(only.length, 80)
})

await check('chips carry an accessible label', () => {
  const chat = chatWith(3, ['```suggest\n甲 || 乙\n```'])
  const tree = renderChips(chipsCell.component, { turn: 3, chat, inputActions: {} })
  assert.equal(chipsOf(tree)[0].props['aria-label'], '第 1 个下一步建议：甲')
})

// Put the real preference back exactly as it was, so running the suite can
// never silently reset what the user chose in Settings.
serverSide = { directSend: true }
if (originalConfig === null) {
  rmSync(CONFIG_FILE, { force: true })
} else {
  writeFileSync(CONFIG_FILE, originalConfig, 'utf8')
}

console.log(`\n${passed} checks passed.`)

/**
 * dsh-next-reply-chips — Host half.
 *
 * Two jobs, both deliberately small:
 *
 *  1. Register one system-prompt section: the instruction that makes the model
 *     close every reply with a `suggest` code block carrying up to three likely
 *     next user replies. The browser half parses that block and hides it.
 *  2. Own the one preference — whether a clicked chip sends immediately or only
 *     fills the composer — and persist it beside this package so it survives
 *     restarts and Web-GUI port changes. The browser half reads and writes it
 *     through two tiny routes under `/plugins/dsh-next-reply-chips/`.
 *
 * Why a JSON file instead of a plugin Config schema: a Config needs
 * `@deepseek-ai/schemastery`, and a `link:`-installed package resolves its bare
 * imports from its own directory, not the profile's node_modules. Builtins only
 * here, so the package stays installable from any path.
 *
 * The preference is owned by the Host (not `localStorage`) because the Web GUI
 * origin carries a port that can change between launches, which would silently
 * reset a browser-scoped value.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const inject = ['systemPrompt']

/**
 * `order: 118` places this section just after the AgentTeams usage section
 * (117), keeping related runtime guidance together near the end of the
 * assembled prompt without displacing the shipped sections.
 */
const SECTION_ORDER = 118

const SECTION_NAME = 'next-reply-chips:format'

const ROUTE_PREFIX = '/plugins/dsh-next-reply-chips'

/** Preference file, resolved from this module so it follows the install path. */
const CONFIG_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'config.json')

/** Cap on a config request body; the payload is a single boolean. */
const MAX_BODY_BYTES = 8 * 1024

const DEFAULT_CONFIG = { directSend: true }

const SECTION_TEXT = `【每轮结尾的下一步选项】
在每次回答的最后，追加且仅追加一个 suggest 代码块，列出用户接下来最可能发来的 3 句短话：

\`\`\`suggest
选项一 || 选项二 || 选项三
\`\`\`

要求：
1. 恰好 3 项，用 " || " 分隔，每项不超过 24 个汉字。
2. 用用户第一人称口吻，写成可以直接发给我的一句话指令或确认，例如「按方案 A 继续」「先看数据再定」「换成英文标题」。
3. 必须扣住本轮真正悬而未决的决策点；不要客套、不要复述已回答的内容、不要出现「还有什么可以帮您」这类空话。
4. 每项内部不得出现 "||"、换行、反引号或 Markdown 标记。
5. 这个代码块会被界面直接渲染成按钮，用户看不到源码；不要在正文里解释、复述或提及它。
6. 若本轮确实没有合理的下一步，可以只给 1-2 项。`

/**
 * Read the persisted preference, tolerating a missing or corrupt file.
 * @returns {Promise<{ directSend: boolean }>} the current preference.
 */
async function readConfig() {
  try {
    const parsed = JSON.parse(await readFile(CONFIG_FILE, 'utf8'))
    if (parsed !== null && typeof parsed === 'object' && typeof parsed.directSend === 'boolean') {
      return { directSend: parsed.directSend }
    }
  } catch {
    // Missing on first run, or unreadable: fall back to the default.
  }
  return { ...DEFAULT_CONFIG }
}

/**
 * Persist the preference.
 * @param {{ directSend: boolean }} next - the complete preference to store.
 */
async function writeConfig(next) {
  await writeFile(CONFIG_FILE, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
}

/**
 * Collect a small JSON request body.
 * @param req - the Node request.
 * @returns {Promise<unknown>} the parsed body.
 */
async function readJsonBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new Error('body too large')
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  return text === '' ? {} : JSON.parse(text)
}

/**
 * Answer with a JSON body, never cached.
 * @param res - the Node response.
 * @param status - HTTP status.
 * @param value - JSON-serializable payload.
 */
function sendJson(res, status, value) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(value))
}

/**
 * Mount the preference routes once a web server is available.
 * @param ctx - Host Cordis context.
 */
function mountRoutes(ctx) {
  const mount = (server) => {
    if (server === undefined || typeof server.register !== 'function') return
    ctx.effect(
      () =>
        server.register({
          kind: 'exact',
          path: `${ROUTE_PREFIX}/config`,
          handler: async (req, res) => {
            // The payload is one boolean; still refuse cross-peer reads when the
            // Connection service can answer for this request.
            const gate = ctx.get('connection')
            if (gate !== undefined && typeof gate.requestRejection === 'function') {
              const rejection = gate.requestRejection(req)
              if (rejection !== undefined) {
                sendJson(res, rejection, { error: 'unauthorized' })
                return
              }
            }
            if (req.method === 'GET' || req.method === 'HEAD') {
              sendJson(res, 200, await readConfig())
              return
            }
            if (req.method !== 'POST') {
              res.writeHead(405, { allow: 'GET, HEAD, POST', 'cache-control': 'no-store' })
              res.end()
              return
            }
            let body
            try {
              body = await readJsonBody(req)
            } catch {
              sendJson(res, 400, { error: 'invalid body' })
              return
            }
            if (body === null || typeof body !== 'object' || typeof body.directSend !== 'boolean') {
              sendJson(res, 400, { error: 'directSend must be a boolean' })
              return
            }
            const next = { directSend: body.directSend }
            try {
              await writeConfig(next)
            } catch (error) {
              ctx.logger?.warn?.('next-reply-chips: could not persist preference: %s', String(error))
              sendJson(res, 500, { error: 'could not persist preference' })
              return
            }
            sendJson(res, 200, next)
          },
        }),
      'next-reply-chips: config route',
    )
  }

  const immediate = ctx.get('webServer')
  if (immediate !== undefined) {
    mount(immediate)
    return
  }
  if (typeof ctx.inject === 'function') {
    ctx.inject(['webServer'], (sub) => mount(sub.webServer))
  }
}

/**
 * Mount the marker instruction and the preference routes.
 * @param ctx - Host Cordis context.
 */
export function apply(ctx) {
  ctx.systemPrompt.section({
    name: SECTION_NAME,
    order: SECTION_ORDER,
    // Delegated agents answer into a parent's tool result, where nobody renders a
    // chip row; giving them the marker would only add tokens and plant stray
    // blocks in output the parent consumes. The probe is read per call and fails
    // open, so a missing or changed service never suppresses a real turn.
    text: ({ agent }) => {
      if (agent === undefined) return SECTION_TEXT
      try {
        const subagents = ctx.get('subagents')
        if (subagents !== undefined && typeof subagents.rootOf === 'function') {
          if (subagents.rootOf(agent) !== agent) return ''
        }
      } catch {
        // Keep the instruction rather than risk silently disabling the feature.
      }
      return SECTION_TEXT
    },
  })
  mountRoutes(ctx)
}

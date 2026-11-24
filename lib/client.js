window.__ModuleLoader__.load({
	id: "dsh-next-reply-chips",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const react = require("react");

		/** Seat: immediately before a completed Turn's action row. */
		const SLOT = "conversation.chat.turnTail";
		/** A fresh cell id, so this entry sits beside the shipped ones. */
		const CELL_ID = "next-reply-chips";
		/** After AgentTeams' summary (50), before the action row. */
		const CELL_ORDER = 60;
		/** Hoc seat wrapping one Markdown fence, dispatched by its language. */
		const FENCE_SLOT = "conversation.chat.markdown.fence";

		/** Settings page holding the click-behaviour preference. */
		const SETTINGS_SLOT = "settings.section";
		const SETTINGS_ID = "next-reply-chips";
		const SETTINGS_ORDER = 55;

		/** The Host half's preference route. */
		const CONFIG_URL = "/plugins/dsh-next-reply-chips/config";

		/** The Host half's marker, matched on the raw settled text.
		 *  Two accepted shapes: the legacy HTML comment, and a `suggest` fenced
		 *  block (preferred — a hoc layer hides the block entirely). */
		const COMMENT_MARKER = /<!--\s*NEXT:\s*([\s\S]*?)-->/;
		const FENCE_MARKER = /```suggest[ \t]*\r?\n([\s\S]*?)```/;
		/** Language key of the fenced block the host instruction asks for. */
		const FENCE_KEY = "suggest";
		const MAX_CHIPS = 3;
		/** Longest pill text kept: CSS ellipsis handles display, this bounds the data. */
		const MAX_CHIP_CHARS = 80;

		const TOKEN = {
			text: "var(--dsw-alias-label-secondary)",
			textStrong: "var(--dsw-alias-label-primary)",
			border: "var(--dsw-alias-border-l1)",
			surface: "var(--dsw-alias-bg-layer-1)",
			accent: "var(--dsw-alias-brand-primary)"
		};

		// ---------------------------------------------------------------- store

		/**
		 * One shared preference for both seats. `directSend: true` sends on click;
		 * `false` only fills the composer. `ready` gates nothing visually — the
		 * default (send) is also the Host default, so a slow or failed fetch
		 * degrades to the documented default rather than to an inert UI.
		 */
		const store = { directSend: true, ready: false };
		const listeners = new Set();
		let inflight = null;
		let loadedAt = 0;
		/** Re-read window, short enough to notice an external change, long enough
		 *  to keep one fetch per burst of mounting chip rows. */
		const LOAD_TTL_MS = 3000;
		/** Opt-in shape report for debugging, off by default so a reply that merely
		 *  forgot its marker never leaves a grey line in the transcript. Turn it on
		 *  from the browser console with `window.__NRC_DIAG__ = true` and reload. */
		const DIAG_ON = typeof window !== "undefined" && window.__NRC_DIAG__ === true;

		/**
		 * Notify every subscribed seat.
		 */
		function publish() {
			for (const listener of listeners) {
				try {
					listener();
				} catch (error) {
					console.error("[next-reply-chips] listener failed", error);
				}
			}
		}

		/**
		 * Merge a fetched/stored preference into the shared store.
		 * @param next - the Host's `{ directSend }`.
		 */
		function adopt(next) {
			if (next === null || typeof next !== "object") return;
			if (typeof next.directSend !== "boolean") return;
			store.directSend = next.directSend;
			store.ready = true;
			publish();
		}

		/**
		 * Load the preference once per page, sharing any in-flight request.
		 * @param force - bypass the memoized result.
		 */
		function loadConfig(force) {
			if (inflight !== null) return inflight;
			// A previously failed read must stay retryable: caching it forever would
			// pin the UI to the default for the life of the page.
			if (force !== true && store.ready && Date.now() - loadedAt < LOAD_TTL_MS) {
				return Promise.resolve();
			}
			inflight = fetch(CONFIG_URL, { headers: { accept: "application/json" } })
				.then((response) => (response.ok ? response.json() : null))
				.then((body) => {
					adopt(body);
					loadedAt = Date.now();
				})
				.catch((error) => {
					console.warn("[next-reply-chips] could not read preference, using default", error);
				})
				.then(() => {
					inflight = null;
				});
			return inflight;
		}

		/**
		 * Persist the preference on the Host, then adopt the confirmed value.
		 * @param directSend - the new behaviour.
		 */
		function saveConfig(directSend) {
			// Optimistic: the switch responds immediately even on a slow disk.
			store.directSend = directSend;
			store.ready = true;
			publish();
			return fetch(CONFIG_URL, {
				method: "POST",
				headers: { "content-type": "application/json", accept: "application/json" },
				body: JSON.stringify({ directSend })
			})
				.then((response) => (response.ok ? response.json() : null))
				.then((body) => {
					if (body !== null) adopt(body);
				})
				.catch((error) => {
					console.error("[next-reply-chips] could not save preference", error);
				});
		}

		/**
		 * Subscribe one component to the shared preference.
		 * @returns the live store snapshot.
		 */
		function usePreference() {
			const [, bump] = react.useState(0);
			react.useEffect(() => {
				const listener = () => bump((value) => value + 1);
				listeners.add(listener);
				loadConfig(false);
				return () => {
					listeners.delete(listener);
				};
			}, []);
			return store;
		}

		// -------------------------------------------------------------- parsing

		/**
		 * 1-based Turn number from anything the framework may hand over.
		 * `turnTail`'s owner prop is typed `TurnLocation`, which is an object in
		 * some builds and a plain integer in others; `node.location.turn` follows
		 * the same ambiguity. Folding every shape to a number is what makes the
		 * comparison below work at all.
		 * @param value - a TurnLocation, a Turn number, or nested `{turn}`.
		 * @returns the Turn number, or undefined when unusable.
		 */
		function turnOf(value) {
			let current = value;
			for (let depth = 0; depth < 3; depth += 1) {
				if (typeof current === "number") {
					return Number.isSafeInteger(current) && current >= 1 ? current : undefined;
				}
				if (current === null || typeof current !== "object") return undefined;
				current = current.turn;
			}
			return undefined;
		}

		/**
		 * Every string carried by a Chat node's data, joined.
		 * The assistant payload shape is not stable across builds: a user message
		 * carries `data.content` blocks, while an assistant step may carry a flat
		 * `text`, pre-rendered markdown, or something else again. Pinning one shape
		 * silently produced empty text and therefore no chips, so this walks the
		 * value instead. Only a marker regex runs on the result, so unrelated
		 * strings are harmless.
		 * @param node - one Chat node from the snapshot store.
		 * @returns the joined text, or "" when the node carries none.
		 */
		function textOf(node) {
			if (node === null || typeof node !== "object") return "";
			const data = node.data !== null && typeof node.data === "object" ? node.data : node;
			const parts = [];
			const take = (value) => {
				if (typeof value === "string" && value !== "") parts.push(value);
			};

			// Known shapes first: a block array, a flat text, pre-rendered markdown.
			if (Array.isArray(data.content)) {
				for (const block of data.content) {
					if (block !== null && typeof block === "object") take(block.text);
					else take(block);
				}
			}
			take(data.text);
			take(data.markdown);
			if (parts.length > 0) return parts.join("\n");

			// Last resort: walk the value, skipping keys that hold structure rather
			// than prose (otherwise `type: "text"` itself leaks into the text).
			const SKIP = new Set([
				"type", "kind", "role", "id", "key", "name", "messageId",
				"mediaType", "mimeType", "attachment", "attachments", "images"
			]);
			const walk = (value, depth) => {
				if (depth > 5 || value === null || value === undefined) return;
				if (typeof value === "string") {
					parts.push(value);
					return;
				}
				if (Array.isArray(value)) {
					for (const item of value) walk(item, depth + 1);
					return;
				}
				if (typeof value !== "object") return;
				for (const key of Object.keys(value)) {
					if (SKIP.has(key)) continue;
					walk(value[key], depth + 1);
				}
			};
			walk(data, 0);
			return parts.join("\n");
		}

		/** Wrap characters a model likes to put around a short suggestion. */
		const WRAPPING = /^["'“”‘’「」『』《》]+|["'“”‘’「」『』《》]+$/g;

		/**
		 * Coerce one raw fragment into a pill label.
		 * Collapses whitespace (a fenced list often wraps), drops list markers and
		 * numbers, peels wrapping quotes, and caps the length.
		 * @param raw - one candidate fragment.
		 * @returns the cleaned label, or "" when nothing usable is left.
		 */
		function normalizeChip(raw) {
			let text = String(raw).replace(/\s+/g, " ").trim();
			text = text.replace(/^[-*•·]+\s*/, "");
			text = text.replace(/^\d+[.)、]\s*/, "");
			text = text.replace(WRAPPING, "").trim();
			if (text.length > MAX_CHIP_CHARS) text = text.slice(0, MAX_CHIP_CHARS).trim();
			return text;
		}

		/**
		 * Turn a marker body into at most MAX_CHIPS distinct labels.
		 * Accepts `||` or one-per-line, and salvages a JSON array when the model
		 * ignores the delimiter convention entirely.
		 * @param raw - the body inside the marker.
		 * @returns the labels to render.
		 */
		function collectChips(raw) {
			const chips = [];
			const seen = new Set();
			const push = (value) => {
				if (chips.length >= MAX_CHIPS) return;
				const chip = normalizeChip(value);
				if (chip === "") return;
				const key = chip.toLowerCase();
				if (seen.has(key)) return;
				seen.add(key);
				chips.push(chip);
			};

			const body = String(raw).trim();
			// JSON first: a JSON array would otherwise survive the delimiter split as
			// one unreadable fragment.
			if (body.startsWith("[")) {
				try {
					const parsed = JSON.parse(body);
					if (Array.isArray(parsed)) {
						for (const item of parsed) {
							if (typeof item === "string" || typeof item === "number") push(String(item));
						}
						if (chips.length > 0) return chips;
					}
				} catch {
					// Fall through to delimiter parsing.
				}
			}

			let parts = body.split("||");
			if (parts.length <= 1) parts = body.split(/\r?\n/);
			for (const part of parts) push(part);
			return chips;
		}

		/**
		 * Parse up to MAX_CHIPS options out of one marker, in either accepted shape.
		 * @param text - the assistant text to scan.
		 * @returns trimmed, de-duplicated, non-empty options.
		 */
		function parseChips(text) {
			if (typeof text !== "string" || text === "") return [];
			const match = FENCE_MARKER.exec(text) ?? COMMENT_MARKER.exec(text);
			if (match === null) return [];
			return collectChips(match[1]);
		}

		/**
		 * Newest assistant step of this Turn that actually carries a marker.
		 * Walking backwards handles retries and interrupted steps, where one
		 * Turn holds several assistant-step nodes.
		 * @param chat - the chat snapshot slice.
		 * @param turn - the 1-based Turn to read.
		 * @returns the chips for that Turn, or [] when none.
		 */
		function chipsForTurn(chat, turn) {
			if (chat === null || typeof chat !== "object") return [];
			const order = chat.order;
			const nodes = chat.nodes;
			if (!Array.isArray(order)) return [];
			if (nodes === null || typeof nodes !== "object" || typeof nodes.get !== "function") return [];
			for (let index = order.length - 1; index >= 0; index -= 1) {
				const node = nodes.get(order[index]);
				if (!node || node.kind !== "assistant-step") continue;
				if (turnOf(node.location) !== turn) continue;
				const chips = parseChips(textOf(node));
				if (chips.length > 0) return chips;
			}
			return [];
		}

		/**
		 * Fallback used when no Turn number can be compared: the newest answer that
		 * carries a marker, but only while that answer still closes the Chat flow
		 * (only `turn-tail` rows may follow it). This keeps the row from also
		 * appearing under older Turns.
		 * @param chat - the chat snapshot slice.
		 * @returns the chips for the closing answer, or [] when it is not the tail.
		 */
		function chipsAtTail(chat) {
			if (chat === null || typeof chat !== "object") return [];
			const order = chat.order;
			const nodes = chat.nodes;
			if (!Array.isArray(order) || order.length === 0) return [];
			if (nodes === null || typeof nodes !== "object" || typeof nodes.get !== "function") return [];
			let onlyTailsFollow = true;
			for (let index = order.length - 1; index >= 0; index -= 1) {
				const node = nodes.get(order[index]);
				if (!node || typeof node !== "object") return [];
				if (node.kind === "assistant-step") return onlyTailsFollow ? parseChips(textOf(node)) : [];
				if (node.kind !== "turn-tail") onlyTailsFollow = false;
			}
			return [];
		}

		/**
		 * Resolve the chips for one rendered Turn.
		 * @param chat - the chat snapshot slice.
		 * @param turn - the normalized Turn number, or undefined.
		 * @returns the chips to show, or [].
		 */
		function resolveChips(chat, turn) {
			// A resolved Turn keeps the row turn-scoped; the tail fallback exists only
			// for a build whose Turn prop cannot be normalized at all.
			if (turn !== undefined) return chipsForTurn(chat, turn);
			return chipsAtTail(chat);
		}

		/**
		 * One-shot diagnostic rendered in place of the row when nothing matched.
		 * It describes only the brief shape of what the renderer handed over, so a
		 * single glance says which link of the chain is broken: no chat slice, no
		 * node map, an unexpected node kind, or simply no marker in the text.
		 * @param chat - the chat snapshot slice, if any.
		 * @param rawTurn - the owner's `turn` prop, verbatim.
		 */
		function diagLine(chat, rawTurn) {
			const hasChat = chat !== undefined && chat !== null;
			const order = hasChat && Array.isArray(chat.order) ? chat.order : undefined;
			const nodes = hasChat && chat.nodes && typeof chat.nodes.get === "function" ? chat.nodes : undefined;
			const kinds = [];
			if (order !== undefined && nodes !== undefined) {
				for (const key of order.slice(-6)) {
					const node = nodes.get(key);
					kinds.push(node && node.kind ? node.kind : "?");
				}
			}
			const turnText = rawTurn !== null && typeof rawTurn === "object" ? JSON.stringify(rawTurn) : String(rawTurn);
			return react.createElement(
				"div",
				{
					style: {
						fontSize: "11px",
						lineHeight: "16px",
						color: TOKEN.text,
						opacity: 0.75,
						fontFamily: "ui-monospace, monospace",
						margin: "6px 0 2px",
						wordBreak: "break-all"
					}
				},
				`[next-reply-chips] 诊断 · turn=${turnText} · order=${order === undefined ? "无" : order.length} · nodes=${nodes === undefined ? "无" : "map"} · 尾部=${kinds.length === 0 ? "空" : kinds.join(",")}`
			);
		}

		/**
		 * Whether this row belongs to the newest answer in the flow, i.e. only
		 * `turn-tail` rows follow it. Used to place the diagnostic exactly once,
		 * under the answer the user just received.
		 * @param chat - the chat snapshot slice.
		 * @param turn - the normalized Turn number, or undefined.
		 * @returns true when this row is the newest answer's.
		 */
		function isNewestAnswer(chat, turn) {
			if (chat === null || typeof chat !== "object") return false;
			const order = chat.order;
			const nodes = chat.nodes;
			if (!Array.isArray(order) || order.length === 0) return false;
			if (nodes === null || typeof nodes !== "object" || typeof nodes.get !== "function") return false;
			let onlyTailsFollow = true;
			for (let index = order.length - 1; index >= 0; index -= 1) {
				const node = nodes.get(order[index]);
				if (!node || typeof node !== "object") return false;
				if (node.kind === "assistant-step") {
					return onlyTailsFollow && (turn === undefined || turnOf(node.location) === turn);
				}
				if (node.kind !== "turn-tail") onlyTailsFollow = false;
			}
			return false;
		}

		// ------------------------------------------------------------ chip row

		/**
		 * Pill styling, in the theme's own tokens.
		 * @param disabled - whether the chip is currently inert.
		 */
		function chipStyle(disabled) {
			return {
				appearance: "none",
				font: "inherit",
				fontSize: "12px",
				lineHeight: "20px",
				maxWidth: "260px",
				overflow: "hidden",
				textOverflow: "ellipsis",
				whiteSpace: "nowrap",
				padding: "4px 12px",
				borderRadius: "999px",
				border: "1px solid " + TOKEN.border,
				background: "transparent",
				color: disabled ? TOKEN.text : TOKEN.textStrong,
				opacity: disabled ? 0.55 : 1,
				cursor: disabled ? "default" : "pointer",
				transition: "background 120ms ease"
			};
		}

		/**
		 * One row of next-reply chips for the Turn being closed.
		 * Renders nothing when the reply carried no marker, so unmarked turns
		 * leave no gap.
		 * @param props - turnTail owner props plus the standard session props.
		 */
		function NextReplyChips(props) {
			const useChat = props.useChat;
			const useSession = props.useSession;
			const inputActions = props.inputActions;

			// Two independent routes to the chat slice: some builds publish it only
			// through `useChat`, others also carry `session.chat` on the snapshot.
			const session = typeof useSession === "function" ? useSession((snapshot) => snapshot) : undefined;
			const hooked = typeof useChat === "function" ? useChat((snapshot) => snapshot) : undefined;
			const chat = hooked ?? (session !== null && typeof session === "object" ? session.chat : undefined);
			const running = session !== null && typeof session === "object" && session.running === true;
			const preference = usePreference();
			const turn = turnOf(props.turn);
			const chips = react.useMemo(() => resolveChips(chat, turn), [chat, turn]);

			if (chips.length === 0) {
				if (DIAG_ON && isNewestAnswer(chat, turn)) return diagLine(chat, props.turn);
				return null;
			}

			const disabled = running === true || inputActions === undefined;
			const directSend = preference.directSend !== false;

			/**
			 * Apply one option to the composer.
			 * Both modes go through setDraft, so attachments, permission gates and
			 * plan mode apply exactly as if the text had been typed. `submit` is
			 * what makes it immediate.
			 * @param text - the option to apply.
			 */
			const choose = (text) => {
				if (disabled) return;
				try {
					inputActions.setDraft(text);
					if (directSend) inputActions.submit();
				} catch (error) {
					console.error("[next-reply-chips] failed to apply suggestion", error);
				}
			};

			return react.createElement(
				"div",
				{ style: { display: "flex", flexWrap: "wrap", gap: "8px", margin: "8px 0 4px" } },
				chips.map((text, index) => react.createElement(
					"button",
					{
						key: text,
						type: "button",
						title: directSend ? text : text + "（填入输入框，待你确认）",
						"aria-label": `第 ${index + 1} 个下一步建议：${text}`,
						disabled,
						style: chipStyle(disabled),
						onClick: () => choose(text),
						onMouseEnter: (event) => {
							if (!disabled) event.currentTarget.style.background = TOKEN.surface;
						},
						onMouseLeave: (event) => {
							event.currentTarget.style.background = "transparent";
						}
					},
					text
				))
			);
		}

		// ------------------------------------------------------- settings page

		/**
		 * One radio option row.
		 * @param options - the option description and current selection.
		 */
		function RadioRow({ checked, label, hint, onSelect }) {
			return react.createElement(
				"label",
				{
					style: {
						display: "flex",
						alignItems: "flex-start",
						gap: "10px",
						padding: "10px 12px",
						border: "1px solid " + (checked ? TOKEN.accent : TOKEN.border),
						borderRadius: "10px",
						cursor: "pointer",
						background: checked ? TOKEN.surface : "transparent"
					}
				},
				react.createElement("input", {
					type: "radio",
					name: "next-reply-chips-mode",
					checked,
					onChange: onSelect,
					style: { marginTop: "2px", accentColor: TOKEN.accent }
				}),
				react.createElement(
					"span",
					{ style: { display: "flex", flexDirection: "column", gap: "2px" } },
					react.createElement("span", { style: { fontSize: "13px", color: TOKEN.textStrong } }, label),
					react.createElement("span", { style: { fontSize: "12px", color: TOKEN.text } }, hint)
				)
			);
		}

		/**
		 * Settings page: what a chip click does.
		 */
		function NextReplyChipsSettings() {
			const preference = usePreference();
			const directSend = preference.directSend !== false;

			return react.createElement(
				"div",
				{ style: { display: "flex", flexDirection: "column", gap: "12px", maxWidth: "620px" } },
				react.createElement(
					"div",
					{ style: { display: "flex", flexDirection: "column", gap: "4px" } },
					react.createElement("h3", { style: { margin: 0, fontSize: "15px", color: TOKEN.textStrong } }, "下一步建议"),
					react.createElement(
						"p",
						{ style: { margin: 0, fontSize: "12px", color: TOKEN.text } },
						"每条回答下方最多 3 个可点的下一步建议。这里决定点击之后的行为。"
					)
				),
				react.createElement(RadioRow, {
					checked: directSend,
					label: "直接发送",
					hint: "点一下，这句话立刻作为你的下一条消息发出去。",
					onSelect: () => saveConfig(true)
				}),
				react.createElement(RadioRow, {
					checked: !directSend,
					label: "填入输入框，待我确认",
					hint: "点一下只把它填进输入框，你可以改完再自己发。",
					onSelect: () => saveConfig(false)
				})
			);
		}

		// --------------------------------------------------------- registration

		/**
		 * Swallow the `suggest` block so the raw options never reach the transcript.
		 * A hoc layer that renders nothing replaces the code block it wraps; the
		 * same text is still parsed out of the durable message by the chip row.
		 */
		function HideSuggestFence() {
			return null;
		}

		/**
		 * Register the chip row, the fence hider, and the settings page.
		 * @param ctx - Client Cordis context.
		 */
		function apply(ctx) {
			ctx.slots.inject(SLOT, () => ctx.slots.register({
				name: SLOT,
				id: CELL_ID,
				order: CELL_ORDER
			}, NextReplyChips));

			try {
				ctx.slots.inject(FENCE_SLOT, () => ctx.slots.register({
					name: FENCE_SLOT,
					id: "next-reply-chips-fence",
					key: FENCE_KEY,
					order: 0
				}, HideSuggestFence));
			} catch (error) {
				console.warn("[next-reply-chips] the suggest fence could not be hidden", error);
			}

			ctx.slots.inject(SETTINGS_SLOT, () => ctx.slots.register({
				name: SETTINGS_SLOT,
				id: SETTINGS_ID,
				order: SETTINGS_ORDER,
				label: "下一步建议"
			}, NextReplyChipsSettings));
		}

		exports.inject = ["slots"];
		exports.apply = apply;
		return module.exports;
	}
});

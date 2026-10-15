// dsh-image-studio host bridge: a real DSH agent conversation behind the panel.
//
// Mirrors the pattern used by dsh-image-gen's studio chat: create a dedicated
// agent through the same factory the sidebar uses and drive turns with
// agent.followup(). Keep the session unarchived while it can receive input:
// DSH 0.2 blocks model steps for archived sessions. The plugin never calls
// sessions.open, so it does not change the user's current selection.
//
// Durable session events are projected into a small append-only feed with
// monotonic seq numbers; the browser pulls increments with ?since=<seq>.
// Event shapes come from the DSH API catalog:
//   - 'session/event'(this: Scoped<Session>, session, event: SessionEvent)
//   - 'agent/assistant-stream'(this: Scoped<Agent>, { agent, frame })
//   - 'agent/status'(this: Scoped<Agent>, { agent, status })
//   - AssistantMessage { role:'assistant', content?: readonly ContentBlock[] }
//   - SessionEvent { type, seq, time, data }
//   - AssistantStreamFrame start | chunk { chunk: StreamChunk } | end
//   - StreamChunk text-delta | reasoning-delta | tool-call-delta | block-end | ...

import { randomUUID } from "node:crypto";

const MAX_EVENTS = 600;
const MAX_TEXT_CHARS = 120000;

// The agent loop injects a "Current runtime context…" snapshot as a user
// message before each turn (dsh-agent-loop runtime-context projection,
// source kind "runtime-context"). It is model-facing plumbing, not chat —
// never show it in the panel.
const RUNTIME_CONTEXT_SOURCE = "runtime-context";
const RUNTIME_CONTEXT_PREFIXES = [
	"Current runtime context. This snapshot supersedes",
	"Current runtime context: none.",
];

function isRuntimeContextMessage(message, text) {
	if (message && message.source && message.source.kind === RUNTIME_CONTEXT_SOURCE) return true;
	const value = typeof text === "string" ? text : "";
	return RUNTIME_CONTEXT_PREFIXES.some((prefix) => value.startsWith(prefix));
}

/**
 * SessionId is a compile-time brand over a string; createSessionId mirrors the
 * production minter (`session-<uuid>`). A plain string works too - the session
 * store brands whatever id it is handed - so this never throws on old hosts.
 */
function createSessionId() {
	const suffix = Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
	const id = "session-image-studio-" + suffix;
	try {
		const uuid = globalThis.crypto && typeof globalThis.crypto.randomUUID === "function" ? globalThis.crypto.randomUUID() : "";
		if (uuid) return "session-" + uuid;
	} catch {
		/* fall through to the deterministic form */
	}
	return id;
}

function pushEntry(state, entry) {
	state.seq += 1;
	state.events.push(Object.assign({ seq: state.seq }, entry));
	state.chars += typeof entry.text === "string" ? entry.text.length : 0;
	while (state.events.length > MAX_EVENTS || (state.chars > MAX_TEXT_CHARS && state.events.length > 32)) {
		const dropped = state.events.shift();
		if (dropped && typeof dropped.text === "string") state.chars -= dropped.text.length;
	}
}

function appendDelta(entry, delta) {
	if (typeof entry.text !== "string") {
		entry.text = delta;
		return delta.length;
	}
	entry.text += delta;
	return delta.length;
}

function markOrPush(state, kind, delta, patch) {
	const last = state.events[state.events.length - 1];
	if (last && last.kind === kind && last.stream) {
		state.chars += appendDelta(last, delta);
		if (patch) Object.assign(last, patch);
		// Re-stamp so ?since= pollers re-fetch the grown text; without this a
		// poller that saw the first delta never receives the rest of it.
		last.seq = ++state.seq;
		return last;
	}
	pushEntry(state, Object.assign({ kind }, patch, { text: delta, stream: true, key: "k" + String(++state.nextKey) }));
	return state.events[state.events.length - 1];
}

function closeStream(state) {
	// Close every open bubble (a reasoning bubble can stay open behind a newer
	// text bubble) and re-stamp each so its final version is re-delivered.
	for (const entry of state.events) {
		if (entry.stream) {
			entry.stream = false;
			entry.seq = ++state.seq;
		}
	}
}

function errorText(value) {
	if (value instanceof Error) return value.message || value.name || "unknown error";
	if (typeof value === "string") return value;
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}

function toolCallNames(message) {
	const out = [];
	const content = message && message.content;
	if (!Array.isArray(content)) return out;
	for (const block of content) {
		if (block && block.type === "tool-call" && typeof block.name === "string") out.push(block.name);
	}
	return out;
}

function textBlocks(message) {
	const out = [];
	if (!message || typeof message !== "object") return out;
	const content = message.content;
	if (Array.isArray(content)) {
		for (const block of content) {
			if (typeof block === "string") out.push(block);
			else if (block && block.type === "text" && typeof block.text === "string") out.push(block.text);
		}
		return out;
	}
	if (typeof content === "string") out.push(content);
	else if (typeof message.text === "string") out.push(message.text);
	return out;
}

/**
 * Fold DSH agent publications into an append-only, seq-stamped event feed.
 * Driver-agnostic on purpose: the live DSH wiring lives in
 * createAgentConversation, so this half is unit-testable without an agent.
 */
class ConversationProjector {
	constructor() {
		this.state = { seq: 0, events: [], chars: 0, status: "idle", turns: 0, lastError: "", nextKey: 0 };
	}
	/** Everything newer than sinceSeq, with internal stream flags stripped. */
	since(sinceSeq) {
		return this.state.events
			.filter((entry) => entry.seq > sinceSeq)
			.map((entry) => Object.assign({}, entry, { streaming: Boolean(entry.stream) }, { stream: undefined }));
	}
	status() {
		return { status: this.state.status, turns: this.state.turns, lastError: this.state.lastError };
	}
	setStatus(payload) {
		const status = payload && typeof payload.status === "string" ? payload.status : this.state.status;
		if (status === this.state.status) return;
		this.state.status = status;
		pushEntry(this.state, { kind: "status", text: status });
	}
	noteUser(text) {
		const value = String(text || "").trim();
		if (value) pushEntry(this.state, { kind: "user", text: value });
	}
	noteError(value) {
		this.state.lastError = errorText(value);
		pushEntry(this.state, { kind: "error", text: this.state.lastError });
	}
	feed(channel, payload, event) {
		if (channel === "session/event") return this.consumeSessionEvent(event);
		if (channel === "agent/assistant-stream") return this.consumeStreamFrame(payload && payload.frame);
		if (channel === "agent/status") return this.setStatus(payload);
		if (channel === "agent/error") {
			const where = payload && typeof payload.turn === "number" ? "turn " + payload.turn + " step " + payload.step + ": " : "";
			return this.noteError(where + errorText(payload && payload.error));
		}
		return undefined;
	}
	consumeSessionEvent(event) {
		if (!event || typeof event.type !== "string") return;
		const data = event.data;
		if (event.type === "user/message") {
			if (data && isRuntimeContextMessage(data)) return;
			const text = typeof data === "string" ? data : textBlocks(data).join("\n");
			if (text.trim() && !isRuntimeContextMessage(undefined, text)) pushEntry(this.state, { kind: "user", text });
			return;
		}
		if (event.type === "assistant/message" || event.type === "assistant/attempt") {
			const message = event.type === "assistant/message" && data ? data.message : undefined;
			const texts = textBlocks(message);
			const names = toolCallNames(message);
			const last = this.state.events[this.state.events.length - 1];
			if (last && last.stream) {
				// The live stream already produced this text (or there was none).
				closeStream(this.state);
			} else if (texts.length > 0) {
				pushEntry(this.state, { kind: "assistant", text: texts.join("") });
			}
			for (const name of names) pushEntry(this.state, { kind: "tool", text: name });
			return;
		}
		if (event.type === "tool/call") {
			pushEntry(this.state, { kind: "tool", text: String((data && data.name) || "tool") });
			return;
		}
		if (event.type === "turn/start") {
			this.state.turns += 1;
			return;
		}
		if (event.type === "turn/end") {
			closeStream(this.state);
			if (data && data.reason && data.reason.kind === "blocked") {
				this.noteError("DSH 阻止了本轮对话，未调用模型。请检查会话是否已归档或被输入规则拦截。");
			} else if (data && data.reason && data.reason.kind === "error") {
				this.noteError(errorText(data.reason.error));
			}
			this.setStatus({ status: "idle" });
			return;
		}
		return undefined;
	}
	consumeStreamFrame(frame) {
		if (!frame || typeof frame.type !== "string") return;
		if (frame.type === "start") {
			// A retry restarts the attempt: close whatever bubble was open.
			closeStream(this.state);
			this.setStatus({ status: "running" });
			return;
		}
		if (frame.type === "end") {
			closeStream(this.state);
			return;
		}
		if (frame.type !== "chunk") return;
		const chunk = frame.chunk;
		if (!chunk || typeof chunk.type !== "string") return;
		if (chunk.type === "text-delta" && typeof chunk.text === "string") {
			return markOrPush(this.state, "assistant", chunk.text);
		}
		if (chunk.type === "reasoning-delta" && typeof chunk.text === "string") {
			return markOrPush(this.state, "reasoning", chunk.text);
		}
		if (chunk.type === "tool-call-delta" && typeof chunk.name === "string") {
			return markOrPush(this.state, "tool", chunk.name, { tool: chunk.name });
		}
		return undefined;
	}
}

/**
 * Wire one live agent conversation to a WebServer route pair.
 *
 * Slots resolve lazily on first use so a host without agent services degrades
 * visibly (HTTP 503 with a readable message) instead of failing to load.
 */
export function createAgentConversation(ctx, options = {}) {
	const cwd = options.cwd || process.cwd();
	const log = options.log || (() => {});
	const projector = new ConversationProjector();
	let handle;
	let agentCtx;
	let creating;
	let disposed = false;
	let sessionId = "";

	function capabilities() {
		const missing = [];
		if (!ctx || !ctx.agents || typeof ctx.agents.create !== "function") missing.push("agents");
		return missing;
	}

	function defaultAgentOptions() {
		const options = { maxTokens: 8192 };
		try {
			const selection = ctx.agentDefaultModel && typeof ctx.agentDefaultModel.currentSelection === "function"
				? ctx.agentDefaultModel.currentSelection()
				: undefined;
			if (selection && typeof selection.provider === "string" && selection.provider.length > 0) {
				options.provider = selection.provider;
				if (typeof selection.model === "string" && selection.model.length > 0) options.model = selection.model;
			}
		} catch (error) {
			log("default model lookup failed: " + errorText(error));
		}
		return options;
	}

	async function ensureAgent() {
		if (disposed) throw new Error("对话桥已卸载（插件已重载）。");
		if (handle) return handle;
		if (creating) return creating;
		const missing = capabilities();
		if (missing.length > 0) {
			throw new Error("当前 DSH 宿主没有暴露 " + missing.join(" / ") + " 服务，无法建立原生 Agent 对话。");
		}
		creating = (async () => {
			sessionId = createSessionId();
			const modelOptions = defaultAgentOptions();
			const created = await ctx.agents.create({
				sessionId,
				meta: {
					cwd,
					// NOTE: isSeeded must stay false (the default). Header.isSeeded is
					// copied straight from meta (dsh-session prepare), and a seeded
					// header requires an explicit seed array plus an inherited event
					// count — neither of which we have. Leave it out entirely.
					origin: "subagent",
					delegationDepth: 1,
				},
				agentOptions: modelOptions,
				// Subscribe inside setup so the very first frames of the first turn
				// cannot land before the listeners exist.
				setup: (createdCtx) => {
					agentCtx = createdCtx;
					wire(createdCtx);
				},
			});
			handle = created;
			// Archiving is an execution barrier, not a UI-only visibility flag.
			// Never archive this live conversation before delivering follow-ups.
			return handle;
		})();
		try {
			return await creating;
		} finally {
			creating = undefined;
		}
	}

	function wire(target) {
		const targetCtx = target || agentCtx;
		if (!targetCtx || typeof targetCtx.on !== "function" || targetCtx.__cfpWired) return;
		targetCtx.__cfpWired = true;
		// The agent factory prepares sessions under the FACTORY context, a
		// sibling of this agent's own scope; a plain scoped listener never sees
		// their events. The core session controller subscribes with
		// { global: true } and filters by session — mirror that pattern.
		// With { global: true } the listener sees EVERY session and agent in the
		// host; filter down to this bridge's own session like the core
		// session-controller does.
		const ownsSession = (id) => typeof id === "string" && id.length > 0 && id === sessionId;
		targetCtx.on("session/event", (session, event) => {
			if (!ownsSession(session && session.id)) return;
			try {
				projector.feed("session/event", undefined, event);
			} catch (error) {
				log("session event projection failed: " + errorText(error));
			}
		}, { global: true });
		targetCtx.on("agent/assistant-stream", (payload) => {
			const agent = payload && payload.agent;
			if (!ownsSession(agent && agent.session && agent.session.id)) return;
			try {
				projector.feed("agent/assistant-stream", payload);
			} catch (error) {
				log("stream projection failed: " + errorText(error));
			}
		}, { global: true });
		targetCtx.on("agent/status", (payload) => {
			const agent = payload && payload.agent;
			if (!ownsSession(agent && agent.session && agent.session.id)) return;
			try {
				projector.feed("agent/status", payload);
			} catch (error) {
				log("status projection failed: " + errorText(error));
			}
		}, { global: true });
		targetCtx.on("agent/error", (payload) => {
			const agent = payload && payload.agent;
			if (!ownsSession(agent && agent.session && agent.session.id)) return;
			try {
				projector.feed("agent/error", payload);
			} catch (error) {
				log("error projection failed: " + errorText(error));
			}
		}, { global: true });
	}

	async function readState(url) {
		const raw = url.searchParams.get("since");
		const since = raw === null || raw === "" ? 0 : Number(raw);
		if (!Number.isFinite(since) || since < 0) throw new Error("since 必须是非负整数");
		const probe = url.searchParams.get("probe") === "1";
		let unavailable = "";
		try {
			await ensureAgent();
			wire();
		} catch (error) {
			unavailable = errorText(error);
		}
		const info = projector.status();
		const payload = {
			ok: true,
			latestSeq: projector.state.seq,
			events: projector.since(since),
			status: info.status,
			turns: info.turns,
			sessionId,
		};
		if (unavailable) payload.unavailable = unavailable;
		if (probe) payload.capabilities = capabilities();
		if (info.lastError) payload.lastError = info.lastError;
		return payload;
	}

	async function send(body) {
		if (!body || typeof body !== "object") throw new Error("请求体必须是 JSON 对象");
		const text = typeof body.text === "string" ? body.text.trim() : "";
		const cancelled = body.action === "cancel";
		if (!text && !cancelled) throw new Error("text 不能为空");
		await ensureAgent();
		wire();
		if (cancelled) {
			if (handle.agent && typeof handle.agent.cancel === "function") handle.agent.cancel({ kind: "user" });
			projector.setStatus({ status: "idle" });
			return { ok: true, cancelled: true, latestSeq: projector.state.seq };
		}
		projector.noteUser(text);
		if (!handle.agent || typeof handle.agent.followup !== "function") {
			throw new Error("Agent handle 上没有 followup()，无法驱动该会话。");
		}
		// followup takes a complete UserMessage; it does not add id or role.
		handle.agent.followup({ id: randomUUID(), role: "user", content: [{ type: "text", text }], source: { kind: "user" } });
		return { ok: true, latestSeq: projector.state.seq };
	}

	async function serve(req, res, sendJson) {
		const url = new URL(String(req.url || "/"), "http://localhost");
		const method = (req.method || "GET").toUpperCase();
		const missing = capabilities();
		if (missing.length > 0) {
			const message = "当前 DSH 宿主没有暴露 " + missing.join(" / ") + " 服务，无法建立原生 Agent 对话。";
			sendJson(res, 503, { error: message, unavailable: message });
			return;
		}
		try {
			if (url.pathname.endsWith("/state") && method === "GET") {
				sendJson(res, 200, await readState(url));
				return;
			}
			if (url.pathname.endsWith("/send") && method === "POST") {
				sendJson(res, 200, await send(await options.readBody(req)));
				return;
			}
			sendJson(res, 404, { error: "unknown conversation route" });
		} catch (error) {
			const message = errorText(error);
			const unavailable = /agents|workspaceRegistry|宿主|已卸载/.test(message);
			sendJson(res, unavailable ? 503 : 400, { error: message, unavailable: unavailable ? message : undefined });
		}
	}

	function dispose() {
		disposed = true;
		const current = handle;
		handle = undefined;
		agentCtx = undefined;
		if (current && typeof current.dispose === "function") {
			Promise.resolve()
				.then(() => current.dispose())
				.catch((error) => log("agent dispose failed: " + errorText(error)));
		}
	}

	return {
		serve,
		dispose,
		projector,
		capabilities,
		get sessionId() {
			return sessionId;
		},
	};
}

export { ConversationProjector };

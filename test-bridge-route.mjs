// Integration check for the conversation route wiring (fake DSH services, no host).
// Run: node test-bridge-route.mjs
import assert from "node:assert/strict";
import { createAgentConversation } from "./lib/bridge.js";

let passed = 0;
function ok(label, fn) {
	return Promise.resolve()
		.then(fn)
		.then(() => {
			passed += 1;
			console.log("  ok - " + label);
		});
}

function makeHost(options = {}) {
	const captured = { created: 0, followups: [], cancels: 0, archives: [], creates: [], disposed: 0 };
	const listeners = { "session/event": [], "agent/assistant-stream": [], "agent/status": [], "agent/error": [] };
	const agentCtx = {
		on(channel, fn) {
			(listeners[channel] = listeners[channel] || []).push(fn);
		},
	};
	const handle = {
		agent: {
			followup(message) {
				captured.followups.push(message);
			},
			cancel(cause) {
				captured.cancels += 1;
				return cause;
			},
		},
		dispose() {
			captured.disposed += 1;
			return Promise.resolve();
		},
	};
	const ctx = {};
	if (options.noAgents !== true) {
		ctx.agents = {
			create(createOptions) {
				captured.creates.push(createOptions);
				captured.created += 1;
				if (createOptions.setup) createOptions.setup(agentCtx, { id: createOptions.sessionId });
				if (options.createFails) return Promise.reject(new Error(options.createFails));
				return Promise.resolve(handle);
			},
		};
	}
	if (options.noRegistry !== true) {
		ctx.workspaceRegistry = {
			archiveSession(sessionId, archiveOptions) {
				captured.archives.push({ sessionId, archiveOptions });
				if (options.registryRejectsOptions === true && archiveOptions !== undefined) {
					return Promise.reject(new Error("archiveSession takes no options"));
				}
				if (options.registryFails) return Promise.reject(new Error(options.registryFails));
				return Promise.resolve();
			},
		};
	}
	return { ctx, captured, listeners, agentCtx };
}

async function call(conversation, { method = "GET", url, body }) {
	let out;
	const req = { method, url };
	const sendJson = (res, status, value) => {
		out = { status, body: value };
	};
	await conversation.serve(req, undefined, sendJson);
	return out;
}

console.log("conversation route");

await ok("GET /state creates exactly one agent and never archives it", async () => {
	const { ctx, captured } = makeHost();
	const conversation = createAgentConversation(ctx, { cwd: "C:\\work", readBody: async () => undefined });
	const first = await call(conversation, { url: "/dsh-image-studio/conversation/state" });
	const second = await call(conversation, { url: "/dsh-image-studio/conversation/state?since=0" });
	assert.equal(first.status, 200);
	assert.equal(second.status, 200);
	assert.equal(captured.created, 1, "agent must be created once");
	// DSH 0.2 blocks model steps for archived sessions: the bridge must leave
	// the conversation session unarchived for as long as it can receive input.
	assert.equal(captured.archives.length, 0, "the conversation session must stay unarchived");
	assert.match(conversation.sessionId, /^session-/);
	assert.equal(captured.creates[0].meta.cwd, "C:\\work");
	// meta.isSeeded must NOT be set: dsh-session copies it straight into the
	// session header, and a seeded header demands an explicit constructor seed.
	assert.equal(captured.creates[0].meta.isSeeded, undefined, "meta must not mark the session seeded");
	assert.equal(captured.creates[0].sessionId, conversation.sessionId);
	assert.equal(captured.creates[0].agentOptions.maxTokens, 8192);
	conversation.dispose();
});

await ok("runtime-context snapshots never reach the browser feed", async () => {
	const { ctx, listeners } = makeHost();
	const conversation = createAgentConversation(ctx, { readBody: async () => ({ text: "hi" }) });
	await call(conversation, { method: "POST", url: "/dsh-image-studio/conversation/send" });
	const ownSession = { id: conversation.sessionId };
	// What the host emits before each turn: a snapshot user message produced by
	// the dsh-agent-loop runtime-context projection (source kind "runtime-context").
	listeners["session/event"].forEach((fn) =>
		fn(ownSession, {
			type: "user/message",
			seq: 1,
			data: {
				role: "user",
				content: [{ type: "text", text: "Current runtime context. This snapshot supersedes earlier runtime-context snapshots.\n\nImage-gen workbench canvas: not connected." }],
				source: { kind: "runtime-context" },
			},
		}),
	);
	// A real user message must survive next to it.
	listeners["session/event"].forEach((fn) =>
		fn(ownSession, {
			type: "user/message",
			seq: 2,
			data: { role: "user", content: [{ type: "text", text: "你好" }], source: { kind: "user" } },
		}),
	);
	const state = await call(conversation, { url: "/dsh-image-studio/conversation/state" });
	const users = state.body.events.filter((event) => event.kind === "user").map((event) => event.text);
	assert.deepEqual(users, ["hi", "你好"], "only the echoed prompt and the real user text survive");
	// Also filter the cleared snapshot even when the source tag is missing
	// (defensive: match the well-known prefixes without a source).
	listeners["session/event"].forEach((fn) =>
		fn(ownSession, {
			type: "user/message",
			seq: 3,
			data: { role: "user", content: [{ type: "text", text: "Current runtime context: none. Earlier runtime-context snapshots no longer apply." }] },
		}),
	);
	const again = await call(conversation, { url: "/dsh-image-studio/conversation/state" });
	const users2 = again.body.events.filter((event) => event.kind === "user").map((event) => event.text);
	assert.equal(users2.length, 2, "source-less cleared snapshots are filtered by prefix");
	conversation.dispose();
});

await ok("a default model from the host is passed through to the agent", async () => {
	const { ctx, captured } = makeHost();
	ctx.agentDefaultModel = { currentSelection: () => ({ provider: "deepseek-account", model: "deepseek-flash" }) };
	const conversation = createAgentConversation(ctx, { readBody: async () => ({ text: "hi" }) });
	await call(conversation, { url: "/dsh-image-studio/conversation/state" });
	assert.equal(captured.creates[0].agentOptions.provider, "deepseek-account");
	assert.equal(captured.creates[0].agentOptions.model, "deepseek-flash");
	conversation.dispose();
});

await ok("a throwing default-model lookup still creates the agent", async () => {
	const { ctx, captured } = makeHost();
	ctx.agentDefaultModel = { currentSelection: () => { throw new Error("not configured"); } };
	const conversation = createAgentConversation(ctx, { readBody: async () => ({ text: "hi" }) });
	const out = await call(conversation, { url: "/dsh-image-studio/conversation/state" });
	assert.equal(out.status, 200);
	assert.equal(out.body.unavailable, undefined);
	assert.equal(captured.creates[0].agentOptions.provider, undefined);
	conversation.dispose();
});

await ok("POST /send queues one followup turn with a user source", async () => {
	const { ctx, captured } = makeHost();
	const conversation = createAgentConversation(ctx, { readBody: async () => ({ text: "画一个雨夜车站" }) });
	const sent = await call(conversation, { method: "POST", url: "/dsh-image-studio/conversation/send" });
	assert.equal(sent.status, 200);
	assert.equal(captured.followups.length, 1);
	assert.deepEqual(captured.followups[0].content, [{ type: "text", text: "画一个雨夜车站" }]);
	assert.deepEqual(captured.followups[0].source, { kind: "user" });
	// the panel echoes what the user typed so the transcript is complete
	const state = await call(conversation, { url: "/dsh-image-studio/conversation/state" });
	assert.deepEqual(
		state.body.events.filter((event) => event.kind === "user").map((event) => event.text),
		["画一个雨夜车站"],
	);
	conversation.dispose();
});

await ok("streamed frames reach the browser feed through ?since=<seq>", async () => {
	const { ctx, listeners, captured } = makeHost();
	const conversation = createAgentConversation(ctx, { readBody: async () => ({ text: "hi" }) });
	await call(conversation, { method: "POST", url: "/dsh-image-studio/conversation/send" });
	assert.ok(listeners["agent/assistant-stream"].length > 0, "stream listener must be attached");
	// The real host wraps every agent/* payload with { agent } (agentEvents
	// fused dispatcher) and passes { global: true } listeners a scoped session
	// whose id must match the bridge's own session; the fake mirrors both.
	const ownAgent = { session: { id: conversation.sessionId } };
	listeners["agent/status"].forEach((fn) => fn({ status: "running", agent: ownAgent }));
	listeners["agent/assistant-stream"].forEach((fn) =>
		fn({ frame: { type: "chunk", chunk: { type: "text-delta", text: "1girl" } }, agent: ownAgent }),
	);
	listeners["agent/assistant-stream"].forEach((fn) =>
		fn({ frame: { type: "chunk", chunk: { type: "text-delta", text: ", solo" } }, agent: ownAgent }),
	);
	const first = await call(conversation, { url: "/dsh-image-studio/conversation/state?since=0" });
	assert.equal(first.body.status, "running");
	const cursor = first.body.events[0].seq;
	listeners["session/event"].forEach((fn) =>
		fn(
			{ id: "session-fake" },
			{
				type: "assistant/message",
				seq: 3,
				data: { turn: 1, step: 1, message: { role: "assistant", content: [{ type: "text", text: "1girl, solo" }] } },
			},
		),
	);
	const second = await call(conversation, { url: "/dsh-image-studio/conversation/state?since=" + cursor });
	assert.ok(second.body.events.length >= 1, "increment must not be the whole feed");
	const assistant = first.body.events.filter((event) => event.kind === "assistant");
	assert.equal(assistant.length, 1);
	assert.equal(assistant[0].text, "1girl, solo");
	assert.equal(captured.created, 1);
	conversation.dispose();
});

await ok("action=cancel cancels the agent instead of queueing a turn", async () => {
	const { ctx, captured } = makeHost();
	const conversation = createAgentConversation(ctx, { readBody: async () => ({ action: "cancel" }) });
	const out = await call(conversation, { method: "POST", url: "/dsh-image-studio/conversation/send" });
	assert.equal(out.status, 200);
	assert.equal(out.body.cancelled, true);
	assert.equal(captured.cancels, 1);
	assert.equal(captured.followups.length, 0);
	conversation.dispose();
});

await ok("empty text is rejected with 400", async () => {
	const { ctx } = makeHost();
	const conversation = createAgentConversation(ctx, { readBody: async () => ({ text: "   " }) });
	const out = await call(conversation, { method: "POST", url: "/dsh-image-studio/conversation/send" });
	assert.equal(out.status, 400);
	assert.match(out.body.error, /text 不能为空/);
	conversation.dispose();
});

await ok("a host without agents degrades to 503 with a readable message", async () => {
	const { ctx } = makeHost({ noAgents: true });
	const conversation = createAgentConversation(ctx, { readBody: async () => ({ text: "hi" }) });
	const out = await call(conversation, { url: "/dsh-image-studio/conversation/state" });
	assert.equal(out.status, 503);
	assert.equal(out.body.unavailable.includes("agents"), true);
	const sent = await call(conversation, { method: "POST", url: "/dsh-image-studio/conversation/send" });
	assert.equal(sent.status, 503);
	assert.match(sent.body.error, /agents/);
	conversation.dispose();
});

await ok("agent creation failure surfaces as unavailable instead of throwing", async () => {
	const { ctx } = makeHost({ createFails: "no model configured" });
	const conversation = createAgentConversation(ctx, { readBody: async () => ({ text: "hi" }) });
	const out = await call(conversation, { url: "/dsh-image-studio/conversation/state" });
	assert.equal(out.status, 200);
	assert.equal(out.body.unavailable, "no model configured");
	const sent = await call(conversation, { method: "POST", url: "/dsh-image-studio/conversation/send" });
	assert.equal(sent.status, 400);
	assert.equal(sent.body.error, "no model configured");
	conversation.dispose();
});

await ok("unknown conversation route answers 404", async () => {
	const { ctx } = makeHost();
	const conversation = createAgentConversation(ctx, { readBody: async () => ({}) });
	const out = await call(conversation, { url: "/dsh-image-studio/conversation/nope" });
	assert.equal(out.status, 404);
	conversation.dispose();
});

await ok("a bad since value is rejected", async () => {
	const { ctx } = makeHost();
	const conversation = createAgentConversation(ctx, { readBody: async () => ({}) });
	const out = await call(conversation, { url: "/dsh-image-studio/conversation/state?since=abc" });
	assert.equal(out.status, 400);
	assert.match(out.body.error, /since/);
	conversation.dispose();
});

await ok("dispose disposes the agent handle and stops serving", async () => {
	const { ctx, captured } = makeHost();
	const conversation = createAgentConversation(ctx, { readBody: async () => ({ text: "x" }) });
	await call(conversation, { url: "/dsh-image-studio/conversation/state" });
	conversation.dispose();
	await new Promise((resolve) => setTimeout(resolve, 10));
	assert.equal(captured.disposed, 1);
	const after = await call(conversation, { url: "/dsh-image-studio/conversation/state" });
	assert.equal(after.body.unavailable.includes("已卸载"), true);
});

console.log("\n" + passed + " checks passed");

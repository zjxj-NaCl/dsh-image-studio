// Unit check for the dsh-image-studio conversation projector (no DSH needed).
// Run: node test-bridge.mjs
import assert from "node:assert/strict";
import { ConversationProjector } from "./lib/bridge.js";

let passed = 0;
function ok(label, fn) {
	fn();
	passed += 1;
	console.log("  ok - " + label);
}

const frame = (chunk) => ({ type: "chunk", chunk });

console.log("ConversationProjector");

ok("text deltas accumulate into one assistant bubble", () => {
	const p = new ConversationProjector();
	p.feed("agent/assistant-stream", { frame: { type: "start" } });
	p.feed("agent/assistant-stream", { frame: frame({ type: "text-delta", text: "1girl" }) });
	p.feed("agent/assistant-stream", { frame: frame({ type: "text-delta", text: ", solo" }) });
	p.feed("agent/assistant-stream", { frame: { type: "end", outcome: { kind: "committed" } } });
	const events = p.since(0);
	const assistant = events.filter((event) => event.kind === "assistant");
	assert.equal(assistant.length, 1);
	assert.equal(assistant[0].text, "1girl, solo");
	assert.equal(events[0].kind, "status");
	assert.equal(events[0].text, "running");
	assert.equal(p.status().status, "running");
});

ok("a committed assistant/message does not duplicate streamed text", () => {
	const p = new ConversationProjector();
	p.feed("agent/assistant-stream", { frame: frame({ type: "text-delta", text: "hello" }) });
	p.feed("session/event", undefined, {
		type: "assistant/message",
		seq: 7,
		data: { turn: 1, step: 1, message: { role: "assistant", content: [{ type: "text", text: "hello" }] } },
	});
	const assistants = p.since(0).filter((event) => event.kind === "assistant");
	assert.equal(assistants.length, 1);
	assert.equal(assistants[0].text, "hello");
	assert.equal(assistants[0].streaming, false);
});

ok("assistant/message without a stream commits its own bubble", () => {
	const p = new ConversationProjector();
	p.feed("session/event", undefined, {
		type: "assistant/message",
		seq: 9,
		data: { turn: 1, step: 1, message: { role: "assistant", content: [{ type: "text", text: "from log" }] } },
	});
	const assistants = p.since(0).filter((event) => event.kind === "assistant");
	assert.equal(assistants.length, 1);
	assert.equal(assistants[0].text, "from log");
});

ok("tool calls project as tool entries", () => {
	const p = new ConversationProjector();
	p.feed("session/event", undefined, { type: "tool/call", seq: 3, data: { name: "read" } });
	p.feed("session/event", undefined, {
		type: "assistant/message",
		seq: 4,
		data: {
			turn: 1,
			step: 1,
			message: { role: "assistant", content: [{ type: "tool-call", id: "c1", name: "grep", arguments: "{}" }] },
		},
	});
	assert.deepEqual(
		p.since(0).filter((event) => event.kind === "tool").map((event) => event.text),
		["read", "grep"],
	);
});

ok("turn/end closes the bubble and returns to idle", () => {
	const p = new ConversationProjector();
	p.feed("agent/status", { status: "running" });
	p.feed("agent/assistant-stream", { frame: frame({ type: "text-delta", text: "a" }) });
	p.feed("session/event", undefined, { type: "turn/start", seq: 1, data: { turn: 1 } });
	assert.equal(p.status().turns, 1);
	p.feed("session/event", undefined, { type: "turn/end", seq: 2, data: { turn: 1, reason: "done" } });
	assert.equal(p.status().status, "idle");
	p.feed("agent/assistant-stream", { frame: frame({ type: "text-delta", text: "b" }) });
	const assistants = p.since(0).filter((event) => event.kind === "assistant");
	assert.equal(assistants.length, 2);
	assert.deepEqual(assistants.map((event) => event.text), ["a", "b"]);
});

ok("since() returns only newer events and numbering is monotonic", () => {
	const p = new ConversationProjector();
	p.noteUser("first");
	p.noteUser("second");
	const all = p.since(0);
	assert.deepEqual(all.map((event) => event.seq), [1, 2]);
	assert.equal(all[0].kind, "user");
	assert.equal(p.since(1).length, 1);
	assert.equal(p.since(1)[0].text, "second");
	assert.equal(p.since(2).length, 0);
});

ok("retry (new start frame) opens a fresh bubble", () => {
	const p = new ConversationProjector();
	p.feed("agent/assistant-stream", { frame: frame({ type: "text-delta", text: "partial" }) });
	p.feed("agent/assistant-stream", { frame: { type: "start" } });
	p.feed("agent/assistant-stream", { frame: frame({ type: "text-delta", text: "final" }) });
	const texts = p.since(0).filter((event) => event.kind === "assistant").map((event) => event.text);
	assert.deepEqual(texts, ["partial", "final"]);
});

ok("reasoning deltas stay in their own kind", () => {
	const p = new ConversationProjector();
	p.feed("agent/assistant-stream", { frame: frame({ type: "reasoning-delta", text: "think" }) });
	p.feed("agent/assistant-stream", { frame: frame({ type: "text-delta", text: "answer" }) });
	assert.deepEqual(
		p.since(0).map((event) => event.kind),
		["reasoning", "assistant"],
	);
});

ok("agent/error is recorded and surfaces in status()", () => {
	const p = new ConversationProjector();
	p.feed("agent/error", { turn: 2, step: 1, error: new Error("boom") });
	assert.equal(p.status().lastError, "turn 2 step 1: boom");
	assert.equal(p.since(0)[0].kind, "error");
	assert.match(p.since(0)[0].text, /turn 2 step 1: boom/);
});

ok("user/message events do not duplicate noteUser text", () => {
	const p = new ConversationProjector();
	const text = "画一个雨夜车站";
	p.noteUser(text);
	p.feed("session/event", undefined, { type: "user/message", seq: 1, data: { role: "user", content: [{ type: "text", text }] } });
	const users = p.since(0).filter((event) => event.kind === "user");
	assert.equal(users.length, 2);
	assert.equal(users[0].text, text);
});

ok("unknown events are ignored instead of throwing", () => {
	const p = new ConversationProjector();
	p.feed("session/event", undefined, { type: "request/header", seq: 1, data: {} });
	p.feed("session/event", undefined, undefined);
	p.feed("agent/assistant-stream", { frame: { type: "chunk", chunk: { type: "usage" } } });
	p.feed("agent/assistant-stream", {});
	assert.equal(p.since(0).length, 0);
});

ok("the feed is bounded by MAX_EVENTS", () => {
	const p = new ConversationProjector();
	for (let index = 0; index < 700; index += 1) p.noteUser("line " + index);
	const events = p.since(0);
	assert.ok(events.length <= 600, "expected at most 600 events, got " + events.length);
	assert.equal(p.status().turns, 0);
	assert.equal(events[events.length - 1].text, "line 699");
});

ok("streamed growth is re-delivered to since() pollers", () => {
	const p = new ConversationProjector();
	p.feed("agent/assistant-stream", { frame: { type: "start" } });
	p.feed("agent/assistant-stream", { frame: frame({ type: "text-delta", text: "1girl" }) });
	const first = p.since(0);
	const open = first.filter((event) => event.kind === "assistant")[0];
	p.feed("agent/assistant-stream", { frame: frame({ type: "text-delta", text: ", solo" }) });
	const regrown = p.since(open.seq).filter((event) => event.kind === "assistant");
	assert.equal(regrown.length, 1);
	assert.equal(regrown[0].text, "1girl, solo");
	assert.equal(regrown[0].streaming, true);
	assert.ok(regrown[0].seq > open.seq, "re-stamped seq must advance");
	assert.equal(regrown[0].key, open.key, "stable key lets the browser merge versions");
});

ok("closing the stream re-delivers the final bubble version", () => {
	const p = new ConversationProjector();
	p.feed("agent/assistant-stream", { frame: frame({ type: "text-delta", text: "done" }) });
	const open = p.since(0).filter((event) => event.kind === "assistant")[0];
	p.feed("session/event", undefined, { type: "turn/end", seq: 99, data: { turn: 1 } });
	const closed = p.since(open.seq).filter((event) => event.kind === "assistant")[0];
	assert.equal(closed.text, "done");
	assert.equal(closed.streaming, false);
	assert.ok(closed.seq > open.seq, "final version must be re-delivered");
});

console.log("\n" + passed + " checks passed");

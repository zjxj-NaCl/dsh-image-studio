# DSH Image Studio (dsh-image-studio)

[中文](README.md) · [Install](INSTALL.md) · [Changelog](CHANGELOG.md) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md)

[![test](https://github.com/zjxj-NaCl/dsh-image-studio/actions/workflows/test.yml/badge.svg)](https://github.com/zjxj-NaCl/dsh-image-studio/actions/workflows/test.yml)
[![release](https://img.shields.io/github/v/tag/zjxj-NaCl/dsh-image-studio?label=release)](https://github.com/zjxj-NaCl/dsh-image-studio/tags)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%E2%89%A522.19-339933.svg)](package.json)
[![runtime dependencies](https://img.shields.io/badge/runtime%20dependencies-0-brightgreen.svg)](package.json)

> An image-generation plugin for DeepSeek Harness: text-to-image, image-to-image, and local ComfyUI workflows, plus a gallery, a workbench, and a model configuration panel. The host resolves keys and hands them to the DSH credential store, so the browser never touches them at any point.

What it does:

- **Three generation paths**: text-to-image, image-to-image (up to 4 reference images, ≤ 32 MB each), and local ComfyUI workflows (UI-format workflows are converted to API format before submission; this path only picks up the first reference image).
- **Six built-in providers + your own endpoint**: OpenAI, Google, Seedream, DashScope, xAI, and Zhipu, plus any OpenAI-compatible URL.
- **The model catalog reads itself**: opening the panel automatically reads the model list of the selected provider once. If it comes back, the field becomes a dropdown; if not, the free-text input stays.
- **Batch and gallery**: up to 4 images per submission, requested one at a time; results are written to disk and indexed, can be viewed full screen, and can be re-iterated with "Continue editing".
- **Draw from a conversation too**: register the local ComfyUI as the conversation tool `comfyui_generate` and a prompt written in the conversation produces an image directly.
- **No third-party runtime dependencies**: the host calls each provider directly against its HTTP contract, and the browser only reaches the same-origin route `/image-studio`, so there is no CORS involved and no native module to compile.

Install: [INSTALL.md](INSTALL.md) (three routes: desktop GUI / `dsh plugin` command line / offline tarball). License: MIT.

## What it looks like

A DSH plugin package that contributes two entries to the sidebar of the DeepSeek Harness Web GUI:

- **Image gallery** (`image-studio-gallery`, order 50): lists every image generated from this panel, with full-screen viewing and deletion.
- **Image workbench** (`image-studio-workbench`, order 49): switches between "text-to-image / image-to-image / ComfyUI workflow", where you fill in the prompt (plus reference images for image-to-image) to generate or edit images. It ships with a "Model configuration" tab and the LLM configuration / generation assistant.

The host half registers the same-origin prefix route `/image-studio` on `webServer`, and **resolves keys itself, calls each provider directly against its HTTP contract, and writes the results into the local gallery**. The first two modes do not go through the project Agent; neither does "ComfyUI workflow" — the host talks HTTP to the local ComfyUI directly: it reads the workflow list from the directory ComfyUI itself uses to store workflows, queues a prompt for it, and copies the images it produces into the panel gallery. The browser touches neither image-service keys nor Agent keys, so there is no CORS involved.

> No screenshots yet. If you want to contribute one, drop the PNG into the repository's `docs/` directory and reference it here; **before uploading, make sure the image contains no private information such as service URLs, model names, or credential reference names** — the "Model configuration" tab shows the first two.

## Install

Prerequisites, the three installation routes (desktop GUI / `dsh plugin` command line / building from source), post-install configuration, environment variables, uninstall/upgrade, and a troubleshooting table all live in [INSTALL.md](INSTALL.md). The shortest path is three steps:

1. **Get the package**: `npm pack` produces `dsh-image-studio-0.11.2.tgz`; or point the plugin manager straight at the Git URL `https://github.com/zjxj-NaCl/dsh-image-studio.git`, or at the directory you cloned.
2. **Install**: pick this archive (or enter the Git URL / local path above) in the DSH plugin management UI, then **restart DSH** — the host half registers its routes only at startup, so refreshing the front end alone is not enough.
3. **Configure**: fill in the service URL, model name, and key under "Model configuration" in the panel. Installing is not configuring; the key is stored by the DSH credential service and is **not written into** this plugin's `config.json`. Data lands in `<DSH_HOME>/cache/dsh-image-studio/` (that is `~/.dsh/cache/dsh-image-studio/` when `DSH_HOME` is unset).

## Model providers

Configuration happens in the panel's "Model configuration" tab and is written to `<DSH_HOME>/cache/dsh-image-studio/config.json` (by default `~/.dsh/cache/dsh-image-studio/config.json`):

| Field | Description |
| --- | --- |
| Image service | Determines the wire format and the default URL; see the table below. Sits on the same row as "Model" |
| Service URL | Leave blank to use that service's default URL; compatible endpoints must give the full base URL (for example `https://example.com/v1`) |
| Model | The model name the server accepts; required before generating, and on the same row as "Image service". **The panel reads the model catalog** of the selected service **automatically on open**; if it succeeds the field becomes a dropdown (including an empty "（未选择）" entry, and if the configured value is somehow absent from the list it is kept as "（当前配置，不在列表中）" rather than silently dropped), and if the read fails or the list is empty the free-text input stays |
| ComfyUI URL | Used only by "ComfyUI workflow" mode. The HTTP URL of the local ComfyUI; blank means `http://127.0.0.1:8188`. Fill this in if you changed the port or are going through an ssh tunnel |
| ComfyUI workflow | Used only by "ComfyUI workflow" mode. Clicking "Read workflows" pulls `workflows/*.json` from the directory where the local ComfyUI stores workflows and turns it into a dropdown; if the read fails or the list is empty, the free-text input stays |
| Credential reference name | The credential reference name; only letters, digits, and underscores, and it may not start with a digit |
| Key | Never echoed back. Filling it in and saving writes it through the host credential service into the provider-managed storable source; leaving it blank keeps the existing value |
| Edit request format | Takes effect only for image-to-image (`mode: edit`); see the table below |
| Size / aspect ratio / resolution tier / quality | Sent according to the selected service's capabilities; not sent when unsupported |

Supported services (`PROVIDERS`):

| id | Default URL | Default credential reference name |
| --- | --- | --- |
| `openai-compat` | none (required) | `DSH_IMAGE_STUDIO_API_KEY` |
| `openai` | `https://api.openai.com/v1` | `OPENAI_API_KEY` |
| `google` | `https://generativelanguage.googleapis.com/v1beta/interactions` | `GEMINI_API_KEY` |
| `seedream` | `https://ark.cn-beijing.volces.com/api/v3` | `ARK_API_KEY` |
| `dashscope` | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `DASHSCOPE_API_KEY` |
| `xai` | `https://api.x.ai/v1` | `XAI_API_KEY` |
| `zhipu` | `https://open.bigmodel.cn/api/paas/v4` | `ZHIPU_API_KEY` |

Edit request formats (`EDIT_FORMATS`): `multipart` (most compatible endpoints), `jsonImageUrlArray` (the vendor JSON contract some endpoints use, with the field `images: [{ image_url }]`), `formReferenceImages`, and `xaiJson`. If the selected service does not support a format, the panel refuses before sending the request.

Keys never land in `config.json`: the panel saves only the reference name, and the value goes to the DSH credential service via `ctx.credentials.set(ref, value)`. Generation fails with the reference name in the message when no key is configured; it does not silently fall back.

## Generation modes: text-to-image, image-to-image, and ComfyUI workflows

The first item in the workbench form is the segmented switch `ModeSwitch` (`cis-switch`), with three choices:

| Mode | Request surface | Reference images | Submit button |
| --- | --- | --- | --- |
| `generate` **文生图** | `POST {service URL}/images/generations` | not submitted (discarded even if the user uploaded some) | `生成图片` |
| `edit` **图生图** | `POST {service URL}/images/edits` | at least 1, at most 4 | `开始编辑` |
| `comfy` **ComfyUI 工作流** | local ComfyUI `POST /prompt` (`POST /upload/image` first when there are reference images) | optional, only the 1st is taken | `运行工作流` |

- The submitted body carries an explicit `mode` field (`'generate'` / `'edit'`). The front end already trims `referenceImages` by mode inside `generatePayload`: text-to-image is always an empty array, and only image-to-image carries reference images; image-to-image without a reference image throws `图生图至少需要一张参考图` outright rather than degrading into an empty edit request. The host's `handleGenerate` validates the same way (`mode:'edit'` with no reference image → 400 with the same message).
- For compatibility with direct callers, when the request has **no** `mode` (or an unrecognized value) the host falls back to the old heuristic of "a reference image means edit, otherwise generate"; the panel itself always sends `mode`.
- Switching modes **keeps already-uploaded reference images**, so toggling back and forth loses nothing — they are merely not submitted under text-to-image. The switch is disabled while busy (`busy`), so a submission cannot change faces mid-flight.
- "Continue editing" on the preview box fetches the selected image, adds it as a reference image, and switches to `edit` automatically; the empty state and the "Reference images" hint text both follow the current mode.
- `comfy` takes a completely different path from the other two modes, so it **does not read the image-service configuration**: it submits no size/aspect ratio/tier/quality and shows no "Count" control (the workflow itself does not accept the panel batch parameters). The prompt and the first reference image go straight from the host to the local ComfyUI, and the selected workflow is read straight from the directory where ComfyUI stores workflows — the whole ComfyUI mode never goes through the project Agent, and the panel does not need a ComfyUI workflow registry on the Agent side. Selecting `comfy` adds **that surface's own** "ComfyUI URL" and "Workflow" fields just below the mode switch: fill in the URL, click "Read workflows", pick one from the dropdown, and a run works right away — **no trip to "Model configuration" to save first** (the same fields live there too and edit the same value).

### The ComfyUI workflow pipeline

1. After switching to `comfy`, if the panel has not yet read the workflow directory it automatically calls `GET /comfy/workflows` with the current URL (the host queries the local ComfyUI's `GET /v2/userdata?path=workflows`, falling back to `GET /userdata?dir=workflows`) to fill the dropdown. A blank URL uses the saved configuration and finally falls back to `http://127.0.0.1:8188`; point it at another machine or port and click "Read workflows" again — the request carries `?baseUrl=` as a one-off override, so nothing has to be saved first. If reading fails the dropdown falls back to a free-text field, and a typed file name works too.
2. It submits `POST /comfy/generate` with the body `{workflow, prompt, negative, reference, baseUrl?}`; `workflow` is the file name picked in the dropdown, the host injects the prompt into the graph, `baseUrl` overrides the URL for that request only, and only the first entry of `reference` is used.
3. If there is a reference image: the host uploads its bytes as multipart (`POST /upload/image`, `type=input`, `overwrite=true`), takes the file name ComfyUI returns, and writes it into the `image` input of the graph's first `LoadImage` node.
4. The host submits `{prompt, client_id, prompt_id}` to `POST /prompt`, where `prompt` is the API-format graph with the prompt injected.
5. The host polls `GET /history/{prompt_id}` once per second until `outputs` appears or `status.status_str` becomes `error` (the timeout is governed by the host's `DEFAULT_GENERATE_TIMEOUT_MS`).
6. It fetches the bytes one at a time via `GET /view?filename=&subfolder=&type=`, determines the media type from the magic number, and writes them into the panel gallery; the response returns an `images` array shaped exactly like the image-service modes.
7. If a run produces no images, it still returns 200 with an empty `images`, `image` set to `null`, and `count` 0 — the panel does not mistake "ComfyUI finished" for "the gallery already has an image".

### Workflow format and prompt injection

ComfyUI's `/prompt` accepts only **API format** (`{nodeId: {class_type, inputs}}`), whereas most files ComfyUI saves into `workflows/` are **UI format** (with `nodes`/`links`/`groups`). There is no official public conversion route, so the host ships `src/comfy.js`, which handles two things:

- **UI → API conversion** (`toApiGraph`): it first builds the `links` → source-node mapping, skips `Note`/`PrimitiveNode`/`Reroute` nodes and any node disabled by `mode: 2/4` or sitting inside a muted group (`groups[].muted`), then turns `widgets_values` into named input values using the `input_order` of that node class from `/object_info` (falling back to the declaration order in the node definition when absent). The conversion depends on ComfyUI's own node definitions; when a node class definition is missing it reports 502 with "缺少「X」的节点定义，无法转换；请改用 ComfyUI 的「导出（API 格式）」另存一份工作流。" — this is deliberately non-silent: guessing the widget order wrong yields an image with the wrong semantics. When the conversion succeeds the response carries a `note` saying a conversion happened. Files already in API format (`isApiFormat`) are used as-is and `/object_info` is not touched.
- **Prompt injection** (`applyPrompt`): following the `positive`/`negative` links of a sampler node such as KSampler or SamplerCustom, it finds the target CLIPTextEncode (including SDXL / Flux / HunyuanDiT / QwenImage variants), writes `text`, and re-rolls a random value into the sampler's `seed` so the same prompt does not produce the same image every time. When no sampler is found it falls back to "in node order, the first text-encoding node is positive and the second is negative", and the response then carries a `note` asking you to confirm the result. Reference images follow the same idea: only the `image` input of a `LoadImage` node is written, and when the workflow has no such node the request is rejected with 400 instead of silently dropping the reference image.

This all presupposes that the workflow contains recognizable sampler and text-encoding nodes. For graphs that use no sampler at all, or bury the prompt inside custom subnodes, the panel finds nowhere to write; please reorganize them into a conventional structure in ComfyUI first, or switch to node types the panel recognizes.

Failure semantics: a ComfyUI queue rejection (`HTTP 200` with an `error` body, or a non-empty `node_errors`), an execution error (`status.status_str === "error"` in `GET /history`), and a connection failure are all returned as 502 with the original text (truncated to 500 characters, including `messages` and the offending node number); a failed reference-image upload is 400; missing parameters are stopped locally (empty prompt, empty workflow, invalid reference image) and never reach ComfyUI.

## Generation and gallery

- Text-to-image → `POST {service URL}/images/generations`; image-to-image → `POST {service URL}/images/edits` (up to 4 reference images, ≤ 32 MB each, PNG/JPEG/WebP/GIF), encoded according to the selected edit format; ComfyUI workflow → `POST /prompt` on the local ComfyUI (see the previous section).
- "Count" accepts 1–4 images, and one submission requests them one at a time, serially: total failure returns 502/504 (reusing the first error), while partial success still returns 200 and puts the failure reasons into `partialError`, which the workbench shows as a warning strip below the preview box. The upper bound is published jointly by the host's `MAX_GENERATE_COUNT = 4` and `/status`'s `count`; out-of-range values are clamped rather than rejected. This control is shown only under text-to-image/image-to-image.
- Results are written to `<DSH_HOME>/cache/dsh-image-studio/gallery/img-<YYYYMMDD-HHMMSS>-<6hex>.<ext>`, and the response returns the name, media type, byte count, and same-origin URL.
- A negative prompt is appended to the positive one as `\n\n不要出现：` (the image services themselves have no separate negative field).
- The generation timeout is held by the panel (300000 ms by default). From the browser's point of view the image API is a synchronous call with no queue to poll, so a timeout is the only way to end a hanging request. A timeout returns 504 and is marked "result pending confirmation", and the panel **does not retry automatically**: check the image service's backend to confirm whether an image was produced, then release the submit lock manually. The same goes for ComfyUI mode: it does have a pollable queue, but the host keeps polling until this timeout, and jobs already queued inside ComfyUI are not cancelled automatically afterwards.

## The generation preview box

On the right of the workbench is the preview box (`PreviewStage`), the counterpart of dsh-image-gen's multi-image canvas:

- While waiting it shows a spinner, a stage message, and a progress bar. Stages are graded by elapsed time (`progressStage`: <3 s "正在提交提示词…", <12 s "图像服务正在生成…", <45 s "仍在生成，请勿重复提交…", <120 s "生成较慢，仍在等待图像服务返回…", and beyond that a hint that you may keep waiting or treat it as timed out), and **the progress fraction is always below 1** — the image service reports no real progress, so this only means "still waiting" and does not pretend to be finished. ComfyUI mode uses a different set of wordings (reading workflow, ComfyUI loading the model, sampling), because that pipeline has no remote image service running at all.
- When there are results, all images of the batch are laid out side by side in a `cis-batch` grid (2 columns, a single image spanning the row), each with a `#1`…`#N` number badge in its top-left corner; clicking switches the selection (the selected one gets a brand-colored outline plus a `✓` in the top-right), and double-clicking or "View full screen" opens the `cis-overlay` full-screen view.
- Below the results is an action bar: `全屏查看` / `继续编辑` / `再次生成` / `删除这张`. The facts line shows `服务：provider / model · 文生图|参考图编辑 · 字节 · 耗时 · 本批 N 张` (`文生图|参考图编辑` is taken straight from the response's `mode`); results from a ComfyUI workflow instead show `工作流：<file name> · ComfyUI 工作流`, because that pipeline has no provider/model and is not affected by the panel's batch parameters.
- "Continue editing" fetches the selected image back into the browser, turns it into a reference image, switches to "image-to-image" automatically, and returns to the form, for iteration. This session keeps the most recent 12 batches of results (`RESULT_LIMIT`), deduplicated by file name, with new results pinned to the top; for older images, look in the "Image gallery".

## Host routes

Prefix `/image-studio`, all same-origin:

| Path | Method | Handler |
| --- | --- | --- |
| `/config` | GET | Service catalog + current configuration + credential reference description (no key value returned) |
| `/config/save` | POST | Saves configuration; a non-empty `apiKey` is written through the credential service |
| `/status` | GET | `{ready, provider, model, keyConfigured, count, timeoutMs}` |
| `/models` | GET | Reads the model catalog of the selected image service and returns `{ok, provider, models}` (image models sorted first); the optional `?provider=`/`?baseURL=` overrides the current configuration |
| `/gallery` | GET | List of generated images (newest to oldest) |
| `/image` | GET | Returns an image by name; names are restricted to bare file names, and any traversal name is 400 |
| `/delete` | POST | Deletes one image |
| `/generate` | POST | Calls generations/edits directly per `mode` and files the results; `count` of 1–4 images is requested one at a time, and partial failure returns `partialError` |
| `/comfy/workflows` | GET | Reads the local ComfyUI's workflow storage directory (`GET /v2/userdata?path=workflows`, falling back to `/userdata?dir=workflows`) and returns `{ok, baseUrl, workflows: [{name, path}]}` (20-second timeout). An optional `?baseUrl=` overrides the URL for that request (so the generation surface can read a list it has not saved yet); an unusable http(s) URL is rejected with 400 |
| `/comfy/generate` | POST | Hands `{workflow, prompt, negative, reference, baseUrl?}` to the local ComfyUI (`/upload/image` first when there is a reference image), polls `/history`, then copies the images fetched from `/view` into the panel gallery; `baseUrl` can temporarily override the URL configured in the panel. The response carries only gallery entries and a text summary, never image bytes |
| `/llm/config` | GET | Proxies the Agent's `GET /v1/llm/config` |
| `/llm/save` | POST | Proxies the Agent's `POST /v1/llm/config` |
| `/llm/test` | POST | Proxies the Agent's `POST /v1/llm/test` |
| `/assistant` | POST | Proxies the Agent's `POST /v1/studio/assistant` |

An unknown subpath returns 404 `unknown panel route`; a method mismatch returns 405 with `Allow`; a cross-site write request (mismatched `Origin` host, or `Sec-Fetch-Site: cross-site`) returns 403 `cross-origin mutation rejected` (reads are not subject to this). Request body limits: 96 MB for `/generate` and `/comfy/generate` (to carry base64 reference images), 1 MB for other JSON.

The model catalog is only a convenience, not a hard dependency: a failed read returns the reason as 502, and the panel keeps the free-text model name. The panel reads automatically once when it opens and once when the service changes; this automatic path is silent (a failure merely falls back to free text without popping an error), and a failure with a message appears only when you click "Read models" manually. On an upstream non-2xx the error message is redacted through `redactSecrets`, and it keeps at most 400 entries (`MAX_MODEL_IDS`) with a 15-second timeout (`MODEL_LIST_TIMEOUT_MS`). The workflow catalog works the same way: `GET /comfy/workflows` simply filters ComfyUI's userdata listing (`*.json`, non-directories) and passes it back, a failed read is 502, and you can just type the file name into the panel.

The four LLM-related routes are still forwarded to the project Agent and serve only "LLM service configuration and connection test" and the "generation assistant":

1. Ollama, the OpenAI API, or an OpenAI-compatible API may be used. For Ollama, enter the service root URL; for a compatible API, enter the actual base URL (for example one ending in `/v1`).
2. A key you type does not take effect immediately, and the original value is not echoed back; leaving it blank keeps the stored key, and only ticking clear deletes it. The URL may not carry a user name, password, query parameters, or a fragment.
3. "Test LLM connection" sends only a short text to the draft URL/model, optionally with tool definitions that perform no actual action; it executes no tools, saves nothing, switches nothing, and generates no images. Remote APIs may charge you.
4. "Save and enable LLM" merges the settings into the Agent's private configuration (by default `agent.local.json`, or the location given by `AGENT_CONFIG_FILE`) and switches the HTTP Agent immediately; a terminal Agent already running is a separate process and must be restarted to read the new configuration. Saving itself does not test the connection.

Environment variables take the highest priority, and their management fields are disabled in the UI. Keys are stored in a local private JSON file, not an encrypted vault, so restrict that file's read permissions and do not commit or share it.

## Conversation tool: comfyui_generate

Beyond the panel, the plugin registers "run a ComfyUI workflow once" as a tool callable from a conversation (DSH's tools service), so a prompt written in the conversation goes straight into ComfyUI:

- The tool is named `comfyui_generate`, with a 300-second timeout (`TOOL_TIMEOUT_MS`). It takes only four parameters: `prompt` (required), `negative`, `workflow`, and `baseUrl`; blank entries never enter the request, and `baseUrl` can temporarily override the URL configured in the panel's "ComfyUI URL" (the URL must still be a valid http(s) URL without a user name or password).
- It runs the panel's exact pipeline: `comfyRun(options, body)` → upload the reference image when needed → `POST /prompt` → poll `/history` → `GET /view` → copy into the panel gallery. The extra `files` (image bytes) that `comfyRun` returns are for the tool only, and `handleComfyGenerate` strips them from the HTTP response.
- Results have two paths: when the `attachments` service is mounted, the first image goes to `attachments.saveImage` and render outputs `[{type:'text'}, {type:'image', attachment}]`, so the image is attached to the following context and the model really can see it; with no attachment service, or when saving fails (unsupported size/type, and so on), it degrades to a text-only summary and explains why in `note` — it does not pretend an image was returned.
- The text summary contains only the workflow name, the number of images produced, the elapsed time, and the gallery file names; it **contains no image bytes and no base64**.
- Missing dependencies fail silently: the plugin host runs inside a VM sandbox and cannot `import` `@deepseek-ai/dsh-tools`, so it can only pick up the sandbox global `harness.defineTool`; if that is unavailable, or either the `tools` or the `attachments` service is not mounted, the tool is simply not registered and the rest of the panel is unaffected.

## Security and limitations

- Key values exist only in host memory and the DSH credential store, never enter a browser response, and are never written into the panel's own `config.json`.
- Credentials are resolved again for every generation and are not cached across requests.
- Submissions are locked for the lifetime of a page to prevent double clicks; a dropped connection or a timeout is not the same as cancelling the task.
- Gallery records live only on the host disk, and assistant text records live only in the current page's memory; closing the page does not cancel an image request that was already sent.
- A finished generation does not mean the image is any good. Switching LLM configuration is forbidden while a request is in flight, and a stale configuration version must be re-read.

## FAQ

- **Nothing happens after installing and the panel will not open?** The host half registers its routes only when DSH starts: **restart DSH once**; merely refreshing the browser will not load it.
- **"Read models" finds no list?** That is a convenience feature, not a hard dependency. The list comes from the selected image service's model catalog and requires both the service URL and the key to be saved; if the read fails, just type the model name and generation is unaffected.
- **Where are keys stored?** The value goes into the DSH credential store via `ctx.credentials.set(ref, value)`, and the plugin's `config.json` holds only the reference name; the browser never obtains the key value at any point, and the panel does not echo it either. Upgrading or uninstalling does not delete credentials.
- **Do I need network access to install dependencies?** No. There are zero runtime dependencies, the host sends requests directly against each provider's HTTP contract, and there is no native module to compile.
- **ComfyUI mode will not connect?** Check that the local ComfyUI's port matches the panel's "ComfyUI URL" (default `http://127.0.0.1:8188`) and that `user/default/workflows/` really contains `.json` workflows; if you see "缺少「X」的节点定义", re-save the workflow in ComfyUI using "Export (API format)". See the troubleshooting table in [INSTALL.md](INSTALL.md) for details.
- **Can it generate several images at once?** Up to 4 per submission, requested one at a time; a partial failure keeps the successful images and reports the failure reason below the preview box.
- **Which services are supported?** OpenAI, Google, Seedream, DashScope, xAI, and Zhipu, plus any OpenAI-compatible URL; see "Model providers" above.

## Development

Run these in the `packages/dsh-image-studio` directory:

```powershell
npm run build
npm test
```

Sources live in `src` and DSH loads `lib`; do not hand-edit `lib`. `build.mjs --check` rejects out-of-sync build output.

Module layout:

- `src/index.js` — the host half: same-origin routes, configuration storage (atomic writes), credential resolution, gallery reads and writes, generation orchestration, and the ComfyUI mode's direct orchestration and artifact write-back (`comfyRun` returns plain JSON with `files` for the conversation tool to take bytes from, while `handleComfyGenerate` strips `files` and returns only gallery entries; `handleComfyWorkflows`/`comfyTarget`), plus registering the ComfyUI run as a conversation tool (`registerTool`). The four LLM routes are still proxied to the project Agent (`proxyJson`/`callAgent`).
- `src/comfy.js` — the local ComfyUI direct client: workflow listing (`GET /v2/userdata?path=workflows`, falling back to `/userdata?dir=workflows`), workflow reading, UI→API conversion (`toApiGraph`), prompt and reference-image injection (`applyPrompt` / `applyInitImage`), run orchestration (`runWorkflow`: `POST /prompt` → poll `GET /history/{id}` → `GET /view`), reference-image upload (`uploadImage`), and URL normalization (`comfyBaseUrl`). No DSH dependency, unit-testable.
- `src/tool.js` — the definition of the conversation tool `comfyui_generate` (parameter/output schema, execution and render, attachment fallback): no Node API and no cordis dependency, unit-testable. `resolveDefineTool()` prefers the VM sandbox global `harness.defineTool` and returns `null` to skip registration silently when unavailable.
- `src/image-api.js` — the self-contained image API adapter: the service catalog, endpoint derivation (including the model-catalog endpoints `modelsEndpoint`/`googleModelsEndpoint`), request and response parsing for both families (OpenAI-compatible / Google), model catalog reading (`listModels`/`parseModelIds`/`rankModelIds`), error redaction, and byte helpers (including `detectImageMediaType`, which ComfyUI artifacts rely on for their media type). No disk or browser dependency, unit-testable.
- `src/studio-model.js` — the pure browser-side model: constants (including `STUDIO_MODES`/`MODE_LABELS` for the three modes), validation, payload assembly (`generatePayload` trims reference images by `mode`; `comfyPayload` assembles the workflow request and takes only the first reference image), the workspace state machine (including `setMode`, the model catalog `models`/`modelsFor`/`modelsBusy`/`modelsError` with `setModels`, and the workflow catalog `workflows`/`workflowsLoaded`/`workflowsBusy`/`workflowsError` with `setWorkflows`), and batch/preview pure functions (`resultImages`, `previewBatch`, `normalizeCount`, `normalizeMode`, `progressStage`, `formatElapsed`).
- `src/client.js` — the browser half: `.cis-` styles, the gallery, the image workbench, the three-mode switch (`ModeSwitch`), the generation preview box, the reference-image picker, and slot registration.
- `src/model-config.js` — the model configuration panel ("Image service" and "Model" on the same row, reading the model catalog silently and automatically on panel entry and on service change, plus the two manual entries "Read models" and "Read workflows" and the ComfyUI URL input), the LLM configuration panel, and the generation assistant.
- `src/conversation-host.js` / `src/bridge.js` — the old standalone conversation bridge, retained but **mounted by no profile**; the in-panel generation assistant already covers that use case, so do not mount it again.

Test scripts (each carries its own in-process harness and does not rely on `node --test`):

| Script | Coverage |
| --- | --- |
| `test-image-api.mjs` | The adapter's wire formats, redaction, limits, malformed responses, and model-catalog endpoints and parsing |
| `test-studio-model.mjs` | Validation messages, payloads (including text-to-image/image-to-image branching, `comfyPayload`'s single-workflow and single-reference-image trimming, and `normalizeMode` fallback), batch clamping, preview pure functions, and workspace behavior (including `setMode`, and ownership and clearing of the model and workflow catalogs) |
| `test-client.mjs` | The browser half renders under a stub React, registers four slots, and renders the "Mode" switch, the preview box, the Count control, and the "Read models"/"Read workflows" entries; "Image service" and "Model" really do sit on the same row, and the automatic model-catalog read wiring exists |
| `test-auth.mjs` | Keys do not leak, generation is filed, and credentials are resolved per request |
| `test-tool.mjs` | The conversation tool's output/attachment schema, parameter trimming, image return and fallback (a text-only summary when attachment saving fails or returns an empty id), gallery summaries free of image bytes, elapsed-time rounding, render's text/image blocks, and `resolveDefineTool()` being only a function or null |
| `test-host.mjs` | All host routes (including `/models` and `/comfy/workflows`), traversal names, the same-origin guard, request body limits, `mode` branching (generations vs edits, 400 for a missing reference image, fallback with no `mode`), successful/clamped/partially-failed/fully-failed batch generation, and the ComfyUI direct pipeline (stub ComfyUI: userdata listing and the legacy fallback, uploading a reference image → `/prompt` → `/history` → `/view` → copying artifacts into the gallery, HTTP 200 rejection bodies, execution errors returned verbatim, imageless results, and local validation never calling ComfyUI) |
| `test-bridge.mjs` / `test-bridge-route.mjs` | Retention regression tests for the old conversation half |
| `test-package.mjs` | The release surface: the `files` allowlist covering every build artifact and source file, the files referenced by `main`/`exports`/`dsh.bundle.patch` actually reaching consumers, `cordis.patch.yml` mounting this package exactly once, the version agreeing between `package.json` and `CHANGELOG.md`, `repository`/`homepage`/`bugs` being real clickable URLs, the Chinese and English READMEs linking to each other, CI covering the build check and the whole test suite, and published text files containing neither local absolute paths nor unreplaced repository placeholders |

Real Cordis compatibility test (needs DSH dependencies, not part of `npm test`):

```powershell
node test-host-inject.mjs '<DSH install directory>/resources/app/package.json'
```

Replace `<DSH install directory>` with the actual location on your machine: on the Windows desktop build it is usually `%LOCALAPPDATA%\Programs\DSH NEXT\resources\app\package.json`, or you can piece it together from the install path shown under "Settings → About". With a wrong path the script exits non-zero and explains why; that does not count as a test failure.

After upgrading the plugin you must restart DSH to load the new host routes; refreshing the front end alone is not guaranteed to take effect.

## Verification

`npm test` (build consistency + every script in the table above) passes: `test-image-api.mjs` 23 items, `test-studio-model.mjs` 24 items, `test-client.mjs` 46 items, `test-host.mjs` 44 items, `test-auth.mjs` 8 items, `test-tool.mjs` 18 items, and `test-package.mjs` 18 items, plus the old conversation half's `test-bridge.mjs` 14 items and `test-bridge-route.mjs` 13 items (208 items in total).

The release shape was verified too: the `dsh-image-studio-0.11.2.tgz` produced by `npm pack` contains exactly 34 files (matching the `files` expansion, no more and no fewer), and after extracting it into an empty directory **the whole `npm test` suite and the real cordis injection test (`test-host-inject.mjs`, 4 items) run straight through** — that is, whoever receives the tarball gets the sources, the build scripts, and all the tests, with no dependence on any other file in this repository. The host half's startup check on a real DSH covers route mounting only, so you still need a manual look at the panel after restarting. GitHub Actions runs exactly the same chain: `node build.mjs --check` → `npm test` → pack, unpack, then `npm test` again.

What has not been accepted yet: real image-service calls and image quality (this plugin has sent no real image API request), and the **real ComfyUI end to end** — `/comfy/workflows` and `/comfy/generate` have been tested only against a stub ComfyUI (when the direct-connection approach was implemented, nothing was listening on this machine: neither ComfyUI nor the project Agent was running). On a real machine three things need confirming: the ComfyUI `--listen`/port matching the panel's "ComfyUI URL"; its `user/default/workflows/` really containing `.json` workflows; and a UI-format workflow being convertible by `toApiGraph` (the conversion depends on the node's `input_order` from `/object_info`, and a custom node pack that does not export those two orders cannot be converted — in that case re-save the workflow in ComfyUI using "Export (API format)"). It is also worth trying the UI→API conversion and seeing which node the prompt actually lands on with a simple workflow first: the panel states whether it used the KSampler links or the ordered fallback (in `note`).

## Contributing and security

- Want to modify it locally? Development environment, source/artifact conventions, test entry points, and the PR checklist are in [CONTRIBUTING.md](CONTRIBUTING.md).
- Found a security issue (key leakage, path traversal, cross-site writes, and so on): **do not open a public issue**; use the private channel described in [SECURITY.md](SECURITY.md).
- Just want to ask a question or make a suggestion: open an [issue](https://github.com/zjxj-NaCl/dsh-image-studio/issues) directly; the template will prompt you for the environment information to include.
- For version changes see [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE) © 2026 zjxj-NaCl

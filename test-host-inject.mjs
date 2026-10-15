// Real Cordis host checks; no DSH model service, API or GPU request required.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const runtimeRequire = createRequire(process.argv[2] ? pathToFileURL(process.argv[2]) : import.meta.url);
const { Context } = runtimeRequire('@deepseek-ai/cordis');
import { apply, PANEL_ROUTE, CONVERSATION_ROUTE } from './lib/index.js';

function mount() {
  const ctx = new Context();
  const routes = [];
  ctx.provide('webServer', {
    register(options) {
      routes.push(options);
      return () => routes.splice(routes.indexOf(options), 1);
    },
  });
  apply(ctx);
  return { ctx, routes };
}

function call(routes, url, method = 'GET') {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('route did not finish')), 1000);
    const output = {};
    const res = {
      headersSent: false, writableEnded: false,
      setHeader(name, value) { (output.headers ??= {})[name] = value; },
      writeHead(status, headers) { output.status = status; output.headers = { ...output.headers, ...headers }; this.headersSent = true; },
      end(raw) { this.writableEnded = true; clearTimeout(timer); output.body = JSON.parse(raw); resolve(output); },
    };
    routes[0].handler({ url, method, headers: {} }, res);
  });
}

const { ctx, routes } = mount();
assert.deepEqual(routes.map(route => route.path), [PANEL_ROUTE]);
assert.equal(routes.some(route => route.path === CONVERSATION_ROUTE), false);
console.log('ok - panel mounts without native DSH agent/model services; old chat route absent');
assert.equal((await call(routes, PANEL_ROUTE + '/nope')).status, 404);
console.log('ok - unknown route rejected');
const method = await call(routes, PANEL_ROUTE + '/assistant');
assert.equal(method.status, 405);
assert.equal(method.headers.Allow, 'POST');
console.log('ok - embedded assistant route restricts methods');
await ctx.fiber.dispose();
assert.equal(routes.length, 0);
console.log('ok - context disposal removes panel route');
console.log('4 checks passed');

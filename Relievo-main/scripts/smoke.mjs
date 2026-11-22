// Production smoke test:  npm run smoke -- <backend-url> <frontend-url>
// Checks the deployed backend and frontend. Uses only public information and the synthetic demo accounts
// (DEMO_LOGIN=true). Prints PASS/FAIL lines; never prints keys, tokens or passwords.
const [backendArg, frontendArg] = process.argv.slice(2);
if (!backendArg || !frontendArg) {
  console.log("Usage: npm run smoke -- <backend-url> <frontend-url>");
  process.exit(2);
}
const strip = (u) => u.replace(/\/+$/, "");
const backend = strip(backendArg), frontend = strip(frontendArg);
const get = (url, init) => fetch(url, { signal: AbortSignal.timeout(90_000), ...init }); // a sleeping Render service needs a while

let failures = 0;
async function check(name, fn) {
  try {
    const result = await fn();
    const ok = result !== false;
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${typeof result === "string" ? `: ${result}` : ""}`);
    if (!ok) failures++;
  } catch (e) {
    failures++;
    console.log(`FAIL  ${name}: ${e.message}`);
  }
}

let token = "";
await check("backend /health answers", async () => {
  const res = await get(`${backend}/health`);
  const h = await res.json();
  return res.ok && h.ok === true;
});
await check("no mock flag is on (MOCK_CHAT, MOCK_AI, MOCK_DB all false)", async () => {
  const h = await (await get(`${backend}/health`)).json();
  if (h.mockChat || h.mockAi || h.mockDb) return false;
  return "all false";
});
await check("demo login works (coordinator)", async () => {
  const demo = await (await get(`${backend}/api/auth/demo-users`)).json();
  const coordinator = demo.find((u) => u.role === "coordinator");
  const res = await get(`${backend}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: coordinator.email, password: coordinator.password }),
  });
  if (!res.ok) return false;
  token = (await res.json()).token;
  return Boolean(token);
});
const auth = () => ({ headers: { Authorization: `Bearer ${token}` } });
await check("authenticated call: /api/me returns the coordinator role", async () => {
  const me = await (await get(`${backend}/api/me`, auth())).json();
  return me.role === "coordinator";
});
await check("authenticated call: /api/incidents returns the seeded incidents", async () => {
  const list = await (await get(`${backend}/api/incidents`, auth())).json();
  return Array.isArray(list) && list.length > 0 ? `${list.length} incidents` : false;
});
await check("a request without a token is refused (401)", async () => (await get(`${backend}/api/incidents`)).status === 401);
await check("CORS allows the frontend origin and refuses another origin", async () => {
  const origin = new URL(frontend).origin;
  const ok = await get(`${backend}/health`, { headers: { Origin: origin } });
  const bad = await get(`${backend}/health`, { headers: { Origin: "https://evil.example" } });
  return ok.headers.get("access-control-allow-origin") === origin && !bad.headers.get("access-control-allow-origin");
});

let html = "";
await check("frontend URL returns the app", async () => {
  const res = await get(frontend);
  html = await res.text();
  return res.ok && /id=["']root["']/.test(html);
});
await check("frontend deep link works (SPA rewrite)", async () => {
  const res = await get(`${frontend}/login`);
  return res.ok && /id=["']root["']/.test(await res.text());
});
await check("frontend bundle is built for this backend (VITE_API_BASE_URL)", async () => {
  const src = /src=["']([^"']+\.js)["']/.exec(html)?.[1];
  if (!src) return false;
  const js = await (await get(new URL(src, `${frontend}/`).href)).text();
  return js.includes(backend);
});

console.log(failures === 0 ? "\nAll smoke checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);

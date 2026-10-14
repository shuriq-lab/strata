import { commitFiles } from "./git.js";
const TOWNS = ["redding", "ridgefield", "wilton", "danbury", "norwalk"];
const MAX = 1_500_000;
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const jl = (t) => (t || "").split("\n").filter((l) => l.trim()).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
const cm = (r) => ({ hash: String(r.hash ?? r.id ?? r.oid ?? ""), message: String(r.message ?? "").trim(), author: String(r.author?.name ?? ""), date: r.authoredAt ? new Date(r.authoredAt * 1000).toISOString() : String(r.author?.date ?? r.timestamp ?? "") });
async function walk(repo, tree, prefix, out) {
  for (const e of (await repo.readTree(tree)) ?? []) {
    const name = String(e.name ?? e.path); const full = prefix ? `${prefix}/${name}` : name;
    if (String(e.type) === "tree" || String(e.mode).startsWith("40")) await walk(repo, String(e.hash ?? e.oid ?? e.id), full, out); else out.push(full);
  }
}
async function snapshot(env, name, textPaths) {
  const repo = await env.ARTIFACTS.get(name);
  const log = ((await repo.log({ ref: "main", limit: 6 })) ?? []).map(cm);
  const tip = (await repo.log({ ref: "main", limit: 1 }))[0];
  let tree = tip.tree ?? tip.tree_hash ?? tip.treeHash; if (!tree) { const c = await repo.readCommit(String(tip.hash ?? tip.id)); tree = c.tree ?? c.tree_hash ?? c.treeHash; }
  const paths = []; await walk(repo, String(tree), "", paths);
  const text = {};
  await Promise.all(paths.filter(textPaths).map(async (p) => { const b = await repo.readFile({ ref: "main", path: p }); text[p] = b ? await b.text() : ""; }));
  return { name, log, paths, text };
}
const isText = (p) => /\.(jsonl|json|md)$/.test(p) && !p.startsWith("raw/");
const TYPES = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", txt: "text/plain; charset=utf-8", md: "text/plain; charset=utf-8", json: "application/json", jsonl: "text/plain; charset=utf-8" };
const fileLink = (repo, path) => `/file/${encodeURIComponent(repo)}/${path.split("/").map(encodeURIComponent).join("/")}`;

export default {
  async fetch(req, env) {
    const url = new URL(req.url); const REPO = env.REPO || "nrvt-collective";
    try {
      if (url.pathname.startsWith("/file/")) {
        const [, , repoName, ...rest] = url.pathname.split("/");
        const path = rest.map(decodeURIComponent).join("/"); const rn = decodeURIComponent(repoName);
        if (path.includes("..") || !(rn === REPO || rn.startsWith(REPO + "--"))) return new Response("Bad path", { status: 400 });
        const repo = await env.ARTIFACTS.get(rn); const b = await repo.readFile({ ref: "main", path });
        if (!b) return new Response("Not found", { status: 404 });
        return new Response(b.stream(), { headers: { "content-type": TYPES[path.split(".").pop().toLowerCase()] || "application/octet-stream", "x-served-from": `artifacts:${rn}@main/${path}` } });
      }
      if (url.pathname === "/api/upload" && req.method === "POST") return upload(req, env, REPO);
      if (url.pathname === "/api/state") return Response.json(await state(env, REPO));
      if (url.pathname === "/") return new Response(page(await state(env, REPO), url.searchParams), { headers: { "content-type": "text/html; charset=utf-8" } });
      return new Response("Not found", { status: 404 });
    } catch (e) { return new Response(`Error: ${e.stack || e}`, { status: 500 }); }
  },
};

async function state(env, REPO) {
  const [main, ...forks] = await Promise.all([snapshot(env, REPO, isText), ...TOWNS.map((t) => snapshot(env, `${REPO}--${t}`, (p) => p === `records/${t}/sources.jsonl` || p === `records/${t}/claims.jsonl`).catch((e) => ({ name: `${REPO}--${t}`, error: String(e), log: [], paths: [], text: {} })))]);
  const whatif = await snapshot(env, `${REPO}--norwalk-whatif`, (p) => p.startsWith("whatif/") && /\.(jsonl|json)$/.test(p)).catch(() => null);
  return { main, forks, whatif };
}

async function upload(req, env, REPO) {
  const form = await req.formData(); const town = String(form.get("town")); const file = form.get("file"); const note = String(form.get("note") || "").slice(0, 400);
  const seeded = env.SEED_KEY && form.get("seed_key") === env.SEED_KEY;
  const special = { "norwalk-whatif": { repo: `${REPO}--norwalk-whatif`, dir: "whatif/uploads", rec: "whatif/sources.jsonl" }, steward: { repo: REPO, dir: "decisions/attachments", rec: "decisions/attachments.jsonl" } };
  if (!TOWNS.includes(town) && !(seeded && special[town])) return new Response("Unknown town", { status: 400 });
  const when = seeded && form.get("when") ? String(form.get("when")) : null; const who = seeded && form.get("who") ? String(form.get("who")) : null;
  if (!file || typeof file === "string") return new Response("No file", { status: 400 });
  if (file.size > MAX) return new Response("File too large for this demo (1.5 MB max)", { status: 413 });
  const safe = file.name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").slice(-80);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const sha = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((x) => x.toString(16).padStart(2, "0")).join("");
  const stamp = new Date().toISOString().replace(/[:.]/g, "").slice(0, 15);
  const id = `src-${town.slice(0, 3)}-upload-${stamp}`; const sp = special[town]; const path = sp ? `${sp.dir}/${safe}` : `raw/${town}/uploads/${stamp}-${safe}`; const recPath = sp ? sp.rec : `records/${town}/sources.jsonl`;
  const forkName = sp ? sp.repo : `${REPO}--${town}`; const repo = await env.ARTIFACTS.get(forkName);
  const cur = await repo.readFile({ ref: "main", path: recPath });
  const prev = cur ? await cur.text() : "";
  const rec = { id, town, kind: "upload", label: note || file.name, file: path, uri: `artifacts://strata-contest-demo/${forkName}/${path}`, sha256: sha, bytes: bytes.length, content_type: file.type, uploaded: when || new Date().toISOString(), uploaded_by: who || `${town} agent (console)`, demo: seeded || undefined };
  const r = await commitFiles(repo, { files: [{ path, content: bytes }, { path: recPath, content: (prev && !prev.endsWith("\n") ? prev + "\n" : prev) + JSON.stringify(rec) + "\n" }], message: `${town}: add source ${note || file.name}`, author: { name: who || `${town[0].toUpperCase() + town.slice(1)} agent (console)`, email: `${town}@nrvt.example` }, when });
  if ((req.headers.get("accept") || "").includes("application/json")) return Response.json({ ok: true, fork: forkName, commit: r.commit, record: rec });
  return Response.redirect(new URL(`/?uploaded=${encodeURIComponent(r.commit)}&town=${town}#town-${town}`, req.url).toString(), 303);
}

function page(s, q) {
  const { main, forks, whatif } = s; const t = main.text;
  const feed = [main, ...forks, ...(whatif ? [whatif] : [])].flatMap((r) => r.log.map((c) => ({ ...c, repo: r.name }))).filter((c) => c.date).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 18);
  const fmt = (d) => { try { return new Date(d).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " ET"; } catch { return d; } };
  const attach = jl(t["decisions/attachments.jsonl"]); const wsrc = whatif ? jl(whatif.text["whatif/sources.jsonl"]).filter((x) => x.file) : [];
  const claims = Object.entries(t).filter(([p]) => /^records\/.+\/claims\.jsonl$/.test(p)).flatMap(([, v]) => jl(v));
  const sources = Object.entries(t).filter(([p]) => /^records\/.+\/sources\.jsonl$/.test(p)).flatMap(([, v]) => jl(v));
  for (const f of forks) for (const [p, v] of Object.entries(f.text)) if (p.endsWith("sources.jsonl")) for (const r of jl(v)) if (!sources.find((x) => x.id === r.id)) sources.push({ ...r, _fork: f.name });
  let conflicts = []; try { conflicts = JSON.parse(t["conflicts/open.json"] || "[]"); } catch {}
  const decisions = Object.entries(t).filter(([p]) => p.startsWith("decisions/") && p.endsWith(".json")).map(([p, v]) => { try { return { path: p, ...JSON.parse(v) }; } catch { return { path: p }; } });
  const srcLink = (src) => {
    if (!src) return "";
    if (src.file) return `<a href="${fileLink(src._fork || main.name, src.file)}" target="_blank">${esc(src.label || src.file)}</a>`;
    const raw = `raw/${src.town}/${src.id}.txt`;
    return main.paths.includes(raw) ? `<a href="${fileLink(main.name, raw)}" target="_blank">${esc(raw)}</a>` : esc(src.uri || src.id);
  };
  const claimCard = (cid) => {
    const c = claims.find((x) => x.id === cid) || { id: cid }; const src = sources.find((x) => x.id === c.source);
    return `<div class="card"><div class="kicker">${esc(c.town)} · observed ${esc(c.observed)}</div><div class="stance">${esc(c.stance)}</div><p>${esc(c.text)}</p>
      <div class="src"><span class="mono">SOURCE ${esc(c.source)}</span>${src ? `<blockquote>${esc(src.text || "")}</blockquote><div class="mono">${srcLink(src)}${src.sha256 ? ` · sha256 ${esc(String(src.sha256).slice(0, 12))}…` : ""}</div>` : ""}</div></div>`;
  };
  const commits = (log) => `<ul class="log">${log.map((c) => `<li><span class="mono">${esc(c.hash.slice(0, 7))}</span> ${esc(c.message.split("\n")[0])}<span class="muted"> · ${esc(c.author)}${c.date ? " · " + esc(c.date) : ""}</span></li>`).join("")}</ul>`;
  const msg = q.get("uploaded") ? `<div class="ok">Committed <span class="mono">${esc(q.get("uploaded").slice(0, 7))}</span> to <span class="mono">nrvt-collective--${esc(q.get("town"))}</span>. The file and its source record are now in that town's fork.</div>` : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Strata console · NRVT collective</title>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&family=Newsreader:ital,wght@1,400&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
:root{--color-bg:#fff;--color-card:#F5F5F5;--color-line:#ECECEC;--color-muted:#8C8C8A;--color-soft:#444;--color-ink:#111;--color-hero-navy:#0A1524;--color-cobalt:#1E3A6E;--color-accent:#1E50C8;--color-accent-on-dark:#6AA0FF;--color-crimson:#A6202A;--font-sans:Geist,system-ui,sans-serif;--font-serif:Newsreader,serif;--font-mono:"JetBrains Mono",monospace}
*{box-sizing:border-box}body{margin:0;font-family:var(--font-sans);color:var(--color-ink);background:var(--color-bg);font-size:15px;line-height:24px}
a{color:var(--color-accent)}.mono{font-family:var(--font-mono);font-size:12px;letter-spacing:.04em}.muted{color:var(--color-muted)}
header{background:var(--color-hero-navy);color:#fff;padding:48px 24px 40px}header .in,main{max-width:1080px;margin:0 auto}
header h1{font-weight:300;font-size:44px;line-height:48px;margin:8px 0 12px}header p{color:#FFFFFFB8;max-width:680px;margin:0}
.kicker{font-family:var(--font-mono);font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--color-muted)}header .kicker{color:var(--color-accent-on-dark)}
nav{position:sticky;top:0;background:#fff;border-bottom:1px solid var(--color-line);padding:10px 24px;z-index:2;overflow-x:auto;white-space:nowrap}nav a{margin-right:20px;text-decoration:none;color:var(--color-soft);font-size:13px}
main{padding:8px 24px 80px}section{padding:40px 0;border-bottom:1px solid var(--color-line)}h2{font-weight:500;font-size:28px;line-height:34px;margin:6px 0 18px}
.grid{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(300px,1fr))}.card{background:var(--color-card);padding:20px;border-radius:2px}
.stance{font-size:22px;font-weight:600;color:var(--color-cobalt);margin:4px 0}.vs .card:nth-child(2) .stance{color:var(--color-crimson)}
.src{border-top:1px solid #0000001f;margin-top:12px;padding-top:10px}blockquote{margin:8px 0;padding-left:12px;border-left:2px solid var(--color-accent);color:var(--color-soft)}
.log{list-style:none;padding:0;margin:8px 0 0}.log li{padding:6px 0;border-top:1px solid #0000000f;font-size:13px;line-height:20px}
.feed li{display:grid;gap:2px;padding:10px 0}.ok{background:#E8F0FF;border-left:3px solid var(--color-accent);padding:12px 16px;margin-top:20px}
form{display:grid;gap:8px;margin-top:12px}input,select,button{font:inherit;padding:8px;border:1px solid #0000003f;border-radius:2px;background:#fff}button{background:var(--color-ink);color:#fff;border:0;cursor:pointer}
pre{white-space:pre-wrap;font-family:var(--font-sans);margin:0}.sig{font-family:var(--font-serif);font-style:italic;text-align:center;color:var(--color-soft);margin-top:32px}
@media(max-width:760px){header h1{font-size:32px;line-height:36px}h2{font-size:22px}}
</style></head><body>
<header><div class="in"><div class="kicker">Strata console · Cloudflare Artifacts · live</div><h1>NRVT trail collective</h1><p>Five Connecticut towns share one trail memory. Each town agent writes on its own Artifacts fork. Conflicts stay open with their sources attached until the human steward commits a decision. Everything on this page is read live from git. Scenario data is illustrative.</p></div></header>
<nav><a href="#activity">Activity</a><a href="#sources">Source files</a><a href="#forks">Town forks</a><a href="#memory">Shared memory</a><a href="#conflicts">Open conflicts</a><a href="#decision">Steward decision</a></nav>
<main>${msg}
<section id="activity"><div class="kicker">00 · Activity</div><h2>Who wrote what, where, when</h2><p class="muted">Read live from commit history across the shared repo and every fork.</p><ul class="log feed">${feed.map((c) => `<li><div><b>${esc(c.author)}</b> <span class="muted">· ${esc(fmt(c.date))}</span></div><div>${esc(c.message.split("\n")[0])}</div><div class="mono muted">${esc(c.repo)} · ${esc(c.hash.slice(0, 7))}</div></li>`).join("")}</ul></section>
<section id="sources"><div class="kicker">01 · Source files</div><h2>Upload a source document to a town's fork</h2>
<p class="muted">The file is committed as a blob to <span class="mono">raw/&lt;town&gt;/uploads/</span> and a source record citing it is appended to <span class="mono">records/&lt;town&gt;/sources.jsonl</span>, in one commit on that town's fork. PDF, image or text, up to 1.5 MB.</p>
<form method="post" action="/api/upload" enctype="multipart/form-data"><select name="town">${TOWNS.map((x) => `<option value="${x}">${x[0].toUpperCase() + x.slice(1)}</option>`).join("")}</select><input name="note" placeholder="What is this? (e.g. Inspection photo, W2 boardwalk)"><input type="file" name="file" required accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.txt,.md"><button>Commit to town fork</button></form></section>
<section id="forks"><div class="kicker">02 · Town forks</div><h2>Each town writes only to its own fork</h2><div class="grid">${forks.map((f) => {
    const town = f.name.split("--")[1]; const srcs = jl(f.text[`records/${town}/sources.jsonl`]);
    return `<div class="card" id="town-${esc(town)}"><div class="kicker">${esc(f.name)}</div><div class="stance">${esc(town[0].toUpperCase() + town.slice(1))}</div>${f.error ? `<p class="muted">${esc(f.error)}</p>` : ""}
    <div class="mono muted" style="margin-top:8px">SOURCES (${srcs.length})</div><ul class="log">${srcs.map((x) => `<li>${x.file ? `<a href="${fileLink(f.name, x.file)}" target="_blank">${esc(x.label || x.file)}</a>` : f.paths.includes(`raw/${town}/${x.id}.txt`) ? `<a href="${fileLink(f.name, `raw/${town}/${x.id}.txt`)}" target="_blank">${esc(x.id)}</a>` : esc(x.id)} <span class="muted">· ${esc(x.kind)}</span></li>`).join("")}</ul>
    <div class="mono muted" style="margin-top:12px">RECENT COMMITS</div>${commits(f.log.slice(0, 4))}</div>`; }).join("")}</div></section>
<section id="memory"><div class="kicker">03 · Shared trail memory</div><h2><span class="mono" style="font-size:20px">${esc(main.name)}</span> @ main</h2><div class="grid"><div class="card"><div class="kicker">summary.md</div><pre>${esc(t["summary.md"] || "")}</pre></div><div class="card"><div class="kicker">Recent commits</div>${commits(main.log)}<div class="mono muted" style="margin-top:12px">${main.paths.length} files · ${claims.length} claims · ${sources.length} sources</div></div></div></section>
<section id="conflicts"><div class="kicker">04 · Open conflicts</div><h2>Disagreements stay open, sources side by side</h2>${conflicts.length ? conflicts.map((c) => `<div style="margin-bottom:28px"><div class="mono">${esc(c.id)} · ${esc(c.key)} · <b>${esc(c.status)}</b></div><div class="grid vs" style="margin-top:10px">${(c.claims || []).map(claimCard).join("")}</div></div>`).join("") : `<p class="muted">No open conflicts on main.</p>`}</section>
${wsrc.length ? `<section id="whatif"><div class="kicker">04b · What-if fork</div><h2>Compared, never merged</h2><div class="card"><div class="kicker">${esc(whatif.name)}</div><ul class="log">${wsrc.map((x) => `<li><a href="${fileLink(whatif.name, x.file)}" target="_blank">${esc(x.label)}</a> <span class="muted">· ${esc(x.uploaded_by || "")}</span></li>`).join("")}</ul></div></section>` : ""}
<section id="decision"><div class="kicker">05 · Steward decision</div><h2>The human call, committed to git</h2>${attach.length ? `<div class="card" style="margin-bottom:16px"><div class="kicker">Steward's working papers · decisions/attachments</div><ul class="log">${attach.map((x) => `<li><a href="${fileLink(main.name, x.file)}" target="_blank">${esc(x.label)}</a> <span class="muted">· ${esc(x.uploaded_by || "")}</span></li>`).join("")}</ul></div>` : ""}${decisions.length ? decisions.map((d) => `<div class="card"><div class="kicker">${esc(d.path)}</div><pre class="mono" style="font-size:12px;line-height:18px">${esc(JSON.stringify(Object.fromEntries(Object.entries(d).filter(([k]) => k !== "path")), null, 2))}</pre></div>`).join("") : `<p class="muted">No decision committed yet.</p>`}</section>
<p class="sig">Strata · built on Cloudflare Artifacts and Workers · Shur Creative Partners</p></main></body></html>`;
}

// Minimal git smart-HTTP push from a Worker: build blob/tree/commit objects,
// pack them, and send to git-receive-pack with a scoped Artifacts write token.
const te = new TextEncoder();
const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const unhex = (h) => new Uint8Array(h.match(/../g).map((x) => parseInt(x, 16)));
const cat = (parts) => { const n = parts.reduce((a, p) => a + p.length, 0); const o = new Uint8Array(n); let i = 0; for (const p of parts) { o.set(p, i); i += p.length; } return o; };
async function sha1(b) { return hex(await crypto.subtle.digest("SHA-1", b)); }
async function deflate(b) { const s = new Blob([b]).stream().pipeThrough(new CompressionStream("deflate")); return new Uint8Array(await new Response(s).arrayBuffer()); }
const TYPE = { commit: 1, tree: 2, blob: 3 };
async function obj(type, body) { const full = cat([te.encode(`${type} ${body.length}\0`), body]); return { type, body, id: await sha1(full) }; }
function treeBody(entries) {
  const key = (e) => (e.mode === "40000" ? e.name + "/" : e.name);
  entries.sort((a, b) => { const x = key(a), y = key(b); return x < y ? -1 : x > y ? 1 : 0; });
  return cat(entries.flatMap((e) => [te.encode(`${e.mode} ${e.name}\0`), unhex(e.id)]));
}
function normEntry(r) {
  const type = String(r.type ?? "blob");
  let mode = String(r.mode ?? (type === "tree" ? "40000" : "100644"));
  if (mode === "040000") mode = "40000";
  if (/^\d+$/.test(mode) && mode.length < 5 && type !== "tree") mode = "100644";
  return { name: String(r.name ?? r.path), mode, id: String(r.hash ?? r.oid ?? r.id), type };
}
// writes: [{path, bytes}] ; returns new tree id and list of new objects
async function buildTree(repo, treeId, writes, out) {
  const entries = treeId ? ((await repo.readTree(treeId)) ?? []).map(normEntry) : [];
  const groups = new Map();
  for (const w of writes) {
    const [head, ...rest] = w.path.split("/");
    if (!rest.length) {
      const b = await obj("blob", w.bytes); out.push(b);
      const i = entries.findIndex((e) => e.name === head); const e = { name: head, mode: "100644", id: b.id, type: "blob" };
      if (i >= 0) entries[i] = e; else entries.push(e);
    } else { if (!groups.has(head)) groups.set(head, []); groups.get(head).push({ path: rest.join("/"), bytes: w.bytes }); }
  }
  for (const [name, sub] of groups) {
    const i = entries.findIndex((e) => e.name === name && e.mode === "40000");
    const id = await buildTree(repo, i >= 0 ? entries[i].id : null, sub, out);
    const e = { name, mode: "40000", id, type: "tree" };
    if (i >= 0) entries[i] = e; else entries.push(e);
  }
  const t = await obj("tree", treeBody(entries)); out.push(t); return t.id;
}
async function pack(objs) {
  const parts = [te.encode("PACK"), new Uint8Array([0, 0, 0, 2]), new Uint8Array([(objs.length >>> 24) & 255, (objs.length >>> 16) & 255, (objs.length >>> 8) & 255, objs.length & 255])];
  for (const o of objs) {
    let size = o.body.length; const hdr = []; let byte = (TYPE[o.type] << 4) | (size & 15); size >>>= 4;
    while (size) { hdr.push(byte | 128); byte = size & 127; size >>>= 7; } hdr.push(byte);
    parts.push(new Uint8Array(hdr), await deflate(o.body));
  }
  const body = cat(parts); return cat([body, unhex(await sha1(body))]);
}
const pkt = (s) => { const b = te.encode(s); return cat([te.encode((b.length + 4).toString(16).padStart(4, "0")), b]); };
export async function commitFiles(repo, { files, message, author, branch = "main" }) {
  const info = await repo.info();
  const remote = String(info.remote ?? info.remoteUrl ?? info.url);
  const tok = await repo.createToken("write", 600);
  const token = String(tok.plaintext ?? tok.token ?? tok.value);
  const tip = (await repo.log({ ref: branch, limit: 1 }))[0];
  const parent = String(tip.hash ?? tip.id ?? tip.oid);
  let parentTree = tip.tree ?? tip.tree_hash ?? tip.treeHash;
  if (!parentTree) { const c = await repo.readCommit(parent); parentTree = c.tree ?? c.tree_hash ?? c.treeHash; }
  const out = [];
  const tree = await buildTree(repo, String(parentTree), files.map((f) => ({ path: f.path, bytes: typeof f.content === "string" ? te.encode(f.content) : f.content })), out);
  const ts = Math.floor(Date.now() / 1000);
  const who = `${author.name} <${author.email}> ${ts} +0000`;
  const c = await obj("commit", te.encode(`tree ${tree}\nparent ${parent}\nauthor ${who}\ncommitter ${who}\n\n${message}\n`));
  out.push(c);
  const body = cat([pkt(`${parent} ${c.id} refs/heads/${branch}\0report-status agent=strata-console\n`), te.encode("0000"), await pack(out)]);
  const res = await fetch(remote.replace(/\/$/, "") + "/git-receive-pack", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/x-git-receive-pack-request", accept: "application/x-git-receive-pack-result" }, body });
  const txt = await res.text();
  if (!res.ok || !/unpack ok/.test(txt) || /\bng\b/.test(txt)) throw new Error(`push failed ${res.status}: ${txt.slice(0, 300)}`);
  return { commit: c.id, parent };
}

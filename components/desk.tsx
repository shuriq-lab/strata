"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { DemoSnapshot, MemoryRecord, ProvenanceTrail } from "@/lib/types";

type Phase = "loading" | "empty" | "running" | "error" | "ready";
type Layer = "all" | "L0" | "L1" | "L2" | "L3";

const PRICE_CLAIM = "rec_claim_harbor_price_86";

export function Desk() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState("");
  const [snapshot, setSnapshot] = useState<DemoSnapshot | null>(null);
  const [layer, setLayer] = useState<Layer>("all");
  const [selected, setSelected] = useState(PRICE_CLAIM);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/snapshot")
      .then(async (response) => {
        if (!response.ok) {
          if (!cancelled) setPhase("empty");
          return;
        }
        const body = (await response.json()) as DemoSnapshot;
        if (cancelled) return;
        setSnapshot(body);
        setPhase("ready");
      })
      .catch(() => {
        if (!cancelled) setPhase("empty");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function run() {
    setPhase("running");
    setError("");
    try {
      const response = await fetch("/api/demo", { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Demo failed");
      setSnapshot(body as DemoSnapshot);
      setSelected(PRICE_CLAIM);
      setLayer("all");
      setPhase("ready");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Demo failed");
      setPhase("error");
    }
  }

  const trail = snapshot?.provenance.find((item) => item.record_id === selected) ?? null;

  return (
    <main className="mx-auto max-w-6xl px-4 pb-20 pt-6 sm:px-6">
      <header className="flex flex-col gap-6 border-b border-line pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mono text-[11px] uppercase tracking-[0.22em] text-muted">Strata · record merge</p>
          <h1 className="serif mt-2 text-4xl font-medium tracking-tight sm:text-5xl">The folder is the memory.</h1>
          <p className="mt-3 max-w-xl text-base leading-relaxed text-muted">
            One engagement is one repository, shaped as a pyramid. Agents fork it and work at the same time. The merge
            is a record, not a line.
          </p>
        </div>
        <Button onClick={run} disabled={phase === "running" || phase === "loading"} size="lg">
          {phase === "running" ? "Four agents are writing…" : snapshot ? "Run again" : "Run the engagement"}
        </Button>
      </header>

      {phase === "loading" ? <p className="mt-10 text-muted">Looking for a reconciled engagement.</p> : null}
      {phase === "empty" ? <Empty onRun={run} /> : null}
      {phase === "running" && !snapshot ? <Running /> : null}
      {phase === "running" && snapshot ? (
        <p className="mt-6 text-sm text-muted">Running the four agents again. The desk below is the previous reconcile.</p>
      ) : null}
      {phase === "error" ? (
        <p className="mt-10 rounded-2xl border border-rust/30 bg-rust-wash px-4 py-3 text-rust">{error}</p>
      ) : null}
      {snapshot && phase !== "loading" && phase !== "empty" ? (
        <Ready
          snapshot={snapshot}
          layer={layer}
          onLayer={setLayer}
          selected={selected}
          onSelect={setSelected}
          trail={trail}
        />
      ) : null}
    </main>
  );
}

function Empty({ onRun }: { onRun: () => void }) {
  return (
    <section className="mt-10 grid gap-6 rounded-3xl border border-line bg-panel p-6 sm:grid-cols-[1.2fr_0.8fr] sm:p-8">
      <div>
        <p className="mono text-[11px] uppercase tracking-[0.18em] text-amber">Synthetic client</p>
        <h2 className="serif mt-2 text-3xl">Northwind Lanterns</h2>
        <p className="mt-3 leading-relaxed text-muted">
          A made-up outdoor-lighting maker. Mara Ellison wants one scannable page on a dusk-sensor lantern, and she
          does not want a price cut. Nothing here is a real customer.
        </p>
        <Button className="mt-6" onClick={onRun}>
          Seed, fork, reconcile
        </Button>
      </div>
      <ol className="space-y-3 text-sm leading-relaxed">
        <li><span className="mono text-muted">01</span> Commit the pyramid one layer at a time.</li>
        <li><span className="mono text-muted">02</span> Fork it to an evidence lane, a competitor lane, a section writer, and a what-if.</li>
        <li><span className="mono text-muted">03</span> Merge claims. Keep both sides of a disagreement.</li>
      </ol>
    </section>
  );
}

function Running() {
  return (
    <p className="mt-10 text-muted">
      Seeding Northwind, forking four agents, and reconciling their records. This stays on the local git adapter.
    </p>
  );
}

function Ready({
  snapshot,
  layer,
  onLayer,
  selected,
  onSelect,
  trail,
}: {
  snapshot: DemoSnapshot;
  layer: Layer;
  onLayer: (layer: Layer) => void;
  selected: string;
  onSelect: (id: string) => void;
  trail: ProvenanceTrail | null;
}) {
  const contested = useMemo(
    () => new Set(snapshot.reconcile.conflicts.flatMap((conflict) => conflict.records.map((record) => record.id))),
    [snapshot],
  );
  return (
    <div className="mt-8 space-y-8">
      <section className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant="moss">{snapshot.mocked ? "Local adapter" : "Cloudflare Artifacts"}</Badge>
        <Badge>{snapshot.engagement.client}</Badge>
        <Badge variant="amber">Synthetic</Badge>
        <span className="text-muted">
          {snapshot.concurrency.overlap
            ? `${snapshot.concurrency.agents} agents ran at the same time`
            : "Agent runs did not overlap"}
        </span>
      </section>

      <section className="grid gap-6 lg:grid-cols-[220px_1fr]">
        <Pyramid snapshot={snapshot} layer={layer} onLayer={onLayer} />
        <LayerBody snapshot={snapshot} layer={layer} selected={selected} onSelect={onSelect} contested={contested} />
      </section>

      <section>
        <h2 className="serif text-2xl">Forks on one clock</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Each agent had its own repository and a write token for that repository only. The navigator read with a
          read token. The bars are the wall-clock overlap.
        </p>
        <div className="mt-4 grid gap-3">
          {snapshot.agents.map((agent) => (
            <AgentRow key={agent.id} agent={agent} clock={snapshot.concurrency} />
          ))}
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div>
          <h2 className="serif text-2xl">Open conflicts</h2>
          <p className="mt-1 text-sm text-muted">Both claims stay. Strata does not pick a winner.</p>
          <div className="mt-4 space-y-4">
            {snapshot.reconcile.conflicts.map((conflict) => (
              <article key={conflict.id} className="rounded-2xl border border-rust/30 bg-rust-wash/60 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="mono text-xs text-rust">{conflict.claim_key}</p>
                  <Badge variant="rust">{conflict.review}</Badge>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {conflict.records.map((record) => (
                    <button
                      key={record.id}
                      type="button"
                      onClick={() => onSelect(record.id)}
                      className="rounded-xl border border-rust/20 bg-panel p-3 text-left hover:border-rust"
                    >
                      <p className="mono text-[11px] uppercase tracking-wider text-rust">{record.stance ?? record.agent}</p>
                      <p className="mt-2 text-sm leading-relaxed">{record.content}</p>
                      <p className="mono mt-2 text-[11px] text-muted">{record.agent} · {record.id}</p>
                    </button>
                  ))}
                </div>
              </article>
            ))}
            {snapshot.reconcile.folds.length > 0 ? (
              <p className="text-sm text-muted">
                Folded {snapshot.reconcile.folds.map((fold) => `${fold.folded_id} into ${fold.kept_id}`).join("; ")}.
              </p>
            ) : null}
          </div>
        </div>
        <div>
          <h2 className="serif text-2xl">What-if, not merged</h2>
          <p className="mt-1 text-sm text-muted">The price-cut fork is a comparison. The instruction stays the record.</p>
          <div className="mt-4 space-y-3">
            {snapshot.reconcile.comparisons.map((comparison) => (
              <article key={`${comparison.agent}-${comparison.claim_key}`} className="rounded-2xl border border-dashed border-amber/50 bg-amber-wash/50 p-4">
                <p className="mono text-xs text-amber">{comparison.claim_key}</p>
                <p className="mt-2 text-sm">{comparison.detail}</p>
                {comparison.records.map((record) => (
                  <button
                    key={record.id}
                    type="button"
                    onClick={() => onSelect(record.id)}
                    className="mt-3 block w-full rounded-xl border border-amber/30 bg-panel p-3 text-left"
                  >
                    <p className="mono text-[11px] uppercase tracking-wider text-amber">{record.stance ?? "withheld"} · {record.agent}</p>
                    <p className="mt-2 text-sm leading-relaxed">{record.content}</p>
                  </button>
                ))}
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[1fr_0.9fr]">
        <Provenance trail={trail} selected={selected} />
        <Questions snapshot={snapshot} />
      </section>

      <section>
        <h2 className="serif text-2xl">Contract at the root</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted">{snapshot.contract.purpose}</p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="mono text-[11px] uppercase tracking-wider text-muted">
              <tr className="border-b border-line">
                <th className="py-2 font-medium">Agent</th>
                <th className="py-2 font-medium">May write</th>
                <th className="py-2 font-medium">May promote</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.contract.agents.map((agent) => (
                <tr key={agent.id} className="border-b border-line/80 align-top">
                  <td className="py-3 pr-4">
                    {agent.label}
                    {agent.compare_only ? <span className="ml-2 text-amber">compare only</span> : null}
                  </td>
                  <td className="mono py-3 pr-4 text-xs text-muted">{agent.may_write.join(", ") || "—"}</td>
                  <td className="mono py-3 text-xs text-muted">{agent.may_promote.join(", ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Pyramid({
  snapshot,
  layer,
  onLayer,
}: {
  snapshot: DemoSnapshot;
  layer: Layer;
  onLayer: (layer: Layer) => void;
}) {
  const bands: { id: Layer; label: string; detail: string; width: string }[] = [
    { id: "L3", label: "Profile", detail: `${snapshot.pyramid.profile_chars} chars`, width: "68%" },
    { id: "L2", label: "Tracks", detail: `${snapshot.pyramid.counts.L2} sections`, width: "80%" },
    { id: "L1", label: "Records", detail: `${snapshot.pyramid.counts.L1} typed`, width: "92%" },
    { id: "L0", label: "Raw", detail: `${snapshot.pyramid.counts.L0} files`, width: "100%" },
  ];
  return (
    <div>
      <p className="mono text-[11px] uppercase tracking-[0.18em] text-muted">Pyramid</p>
      <div className="mt-3 space-y-2">
        {bands.map((band) => (
          <button
            key={band.id}
            type="button"
            onClick={() => onLayer(layer === band.id ? "all" : band.id)}
            style={{ width: band.width }}
            className={`block rounded-lg border px-3 py-2 text-left ${
              layer === band.id ? "border-ink bg-ink text-paper" : "border-line bg-panel hover:border-ink/30"
            }`}
          >
            <span className="mono text-[10px] uppercase tracking-wider opacity-70">{band.id}</span>
            <span className="mt-0.5 block text-sm">{band.label}</span>
            <span className={`block text-xs ${layer === band.id ? "text-paper/70" : "text-muted"}`}>{band.detail}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function LayerBody({
  snapshot,
  layer,
  selected,
  onSelect,
  contested,
}: {
  snapshot: DemoSnapshot;
  layer: Layer;
  selected: string;
  onSelect: (id: string) => void;
  contested: Set<string>;
}) {
  if (layer === "L3") {
    return (
      <article className="rounded-2xl border border-line bg-panel p-5">
        <p className="mono text-[11px] uppercase tracking-wider text-moss">L3 · under budget</p>
        <p className="mt-3 whitespace-pre-wrap leading-relaxed">{snapshot.pyramid.profile_body}</p>
      </article>
    );
  }
  if (layer === "L2") {
    return (
      <div className="space-y-3">
        {snapshot.pyramid.tracks.map((track) => (
          <article key={track.id} className="rounded-2xl border border-line bg-panel p-5">
            <h3 className="serif text-xl">{track.title}</h3>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{track.body}</p>
            <p className="mono mt-3 text-[11px] text-muted">{track.record_ids.join(" · ")}</p>
          </article>
        ))}
      </div>
    );
  }
  if (layer === "L0") {
    return (
      <div className="space-y-3">
        {snapshot.pyramid.messages.map((message) => (
          <button
            key={message.id}
            type="button"
            onClick={() => onSelect(message.id)}
            className="block w-full rounded-2xl border border-line bg-panel p-4 text-left"
          >
            <p className="mono text-[11px] uppercase tracking-wider text-muted">{message.speaker} · {message.kind}</p>
            <p className="mt-2 text-sm leading-relaxed">{message.text}</p>
          </button>
        ))}
        <p className="mono text-xs text-muted">{snapshot.pyramid.raw_files.join(" · ")}</p>
      </div>
    );
  }
  const records = snapshot.pyramid.records.filter((record) => layer === "all" || layer === "L1");
  return (
    <div className="space-y-2">
      {layer === "all" ? (
        <p className="text-sm text-muted">
          {snapshot.pyramid.counts.L1} records after reconcile. Contested claims are marked. Select one to walk its sources.
        </p>
      ) : null}
      {records.map((record) => (
        <RecordRow
          key={record.id}
          record={record}
          selected={selected === record.id}
          contested={contested.has(record.id)}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

function RecordRow({
  record,
  selected,
  contested,
  onSelect,
}: {
  record: MemoryRecord;
  selected: boolean;
  contested: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(record.id)}
      className={`block w-full rounded-xl border px-3 py-3 text-left ${
        selected ? "border-ink bg-panel" : "border-line bg-panel/60 hover:border-ink/30"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={contested ? "rust" : record.merged_from?.length ? "moss" : "default"}>{record.type}</Badge>
        {record.stance ? <span className="mono text-[11px] text-muted">{record.stance}</span> : null}
        <span className="mono text-[11px] text-muted">{record.agent}</span>
      </div>
      <p className="mt-2 text-sm leading-relaxed">{record.content}</p>
      {record.merged_from?.length ? (
        <p className="mono mt-2 text-[11px] text-moss">Folded {record.merged_from.join(", ")}</p>
      ) : null}
    </button>
  );
}

function AgentRow({
  agent,
  clock,
}: {
  agent: DemoSnapshot["agents"][number];
  clock: DemoSnapshot["concurrency"];
}) {
  const span = Math.max(1, clock.window_end - clock.window_start);
  const left = ((agent.start - clock.window_start) / span) * 100;
  const width = Math.max(8, ((agent.end - agent.start) / span) * 100);
  return (
    <article className="rounded-2xl border border-line bg-panel p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium">
          {agent.label} <span className="font-normal text-muted">· {agent.person}</span>
        </h3>
        {agent.compareOnly ? <Badge variant="amber">compare only</Badge> : <Badge variant="moss">merged from fork</Badge>}
      </div>
      <div className="mt-3 h-2 rounded-full bg-line/70">
        <div className="h-2 rounded-full bg-ink" style={{ marginLeft: `${left}%`, width: `${Math.min(width, 100 - left)}%` }} />
      </div>
      <p className="mt-3 text-sm text-muted">{agent.note}</p>
      {agent.violations.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {agent.violations.map((violation) => (
            <li key={violation.path} className="mono text-xs text-rust">
              refused {violation.path} — {violation.detail}
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

function Provenance({ trail, selected }: { trail: ProvenanceTrail | null; selected: string }) {
  return (
    <div>
      <h2 className="serif text-2xl">Provenance</h2>
      <p className="mono mt-1 text-xs text-muted">{selected}</p>
      {trail ? (
        <ol className="mt-4 space-y-0">
          {trail.steps.map((step, index) => (
            <li key={`${step.kind}-${step.id}-${index}`} className="relative border-l border-line py-3 pl-4">
              <span className="absolute -left-1 top-4 h-2 w-2 rounded-full bg-ink" />
              <p className="mono text-[11px] uppercase tracking-wider text-muted">{step.kind} · {step.title}</p>
              <p className="mt-1 text-sm leading-relaxed">{step.detail}</p>
              {step.meta ? <p className="mono mt-1 break-all text-[11px] text-muted">{step.meta}</p> : null}
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-4 text-sm text-muted">Select a record. Message lines live in the raw layer and do not have their own trail.</p>
      )}
    </div>
  );
}

function Questions({ snapshot }: { snapshot: DemoSnapshot }) {
  return (
    <div>
      <h2 className="serif text-2xl">Navigator</h2>
      <p className="mt-1 text-sm text-muted">Five tools. Keyword search. Citations point at records and call lines.</p>
      <div className="mt-4 space-y-4">
        {snapshot.questions.map((question) => (
          <article key={question.id} className="rounded-2xl border border-line bg-panel p-4">
            <p className="mono text-[11px] uppercase tracking-wider text-moss">{question.route}</p>
            <h3 className="mt-1 text-sm font-medium">{question.question}</h3>
            <p className="mt-2 text-sm leading-relaxed">{question.answer}</p>
            <ol className="mt-3 space-y-1">
              {question.trace.map((step) => (
                <li key={step.tool + step.summary} className="mono text-[11px] text-muted">
                  {step.tool} — {step.summary}
                </li>
              ))}
            </ol>
            <p className="mono mt-2 text-[11px]">cites {question.citations.join(", ")}</p>
          </article>
        ))}
      </div>
    </div>
  );
}

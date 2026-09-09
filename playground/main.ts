import report from "../training/export-report.json";
import benchmark from "../bench/results/summary.json";
import type { ParseResult } from "../src/index.js";
import "./style.css";
import { icon } from "./icons.js";

const benchmarkMatches = benchmark.model === report.artifactSha256;

const examples = [
  "Sat Sun 1pm-8pm Mon 10pm-12am",
  "set an alarm for eight forty",
  "last Friday of every month",
  "for three hours and thirty minutes",
  "10 days before Friday",
  "Friday at 10pm until Saturday at 2am",
  "every weekday at nine am and five pm",
  "May I have your second opinion?",
];

const root = document.querySelector<HTMLDivElement>("#app")!;
root.innerHTML = `
  <header><div class="header-left"><a class="brand" href="/" aria-label="gpu-time home">${icon("clock")}<strong>gpu-time</strong></a><span class="header-divider"></span><nav aria-label="Main"><a class="nav-active" href="#playground">Playground</a><a id="benchmark-link" href="#benchmarks">Benchmarks</a></nav></div><span class="experimental">Experimental</span></header>
  <main>
    <section class="intro" id="playground"><div><h1>Time playground</h1><p>Try a phrase. Preview the dates in your timezone.</p></div><span class="local-badge"><i></i> On-device inference</span></section>
    <section class="workbench">
      <div class="input-pane">
        <div class="section-label"><span>Time expression</span><span id="engine">Connecting…</span></div>
        <label class="sr-only" for="expression">Time expression</label>
        <div class="composer"><textarea id="expression" spellcheck="false">${examples[0]}</textarea><div class="composer-footer"><span>Updates as you type</span><button id="run" aria-label="Parse expression" title="Parse expression">${icon("arrowUp")}</button></div></div>
        <div class="controls"><label class="context-row">${icon("sliders")}<span>Engine</span><select id="backend"><option value="auto">Auto</option><option value="cpu">CPU</option><option value="webgpu" selected>WebGPU</option></select></label><label class="context-row">${icon("globe")}<span>Timezone</span><input id="timezone" value="Asia/Dhaka" /></label></div>
        <label class="reference-label">${icon("clock")}<span>Reference instant</span><input id="reference" value="2026-09-09T12:00:00+06:00" spellcheck="false" /></label>
        <details class="policies"><summary>${icon("chevron")}<span>Interpretation rules</span></summary><div class="policy-grid">
          <label>Numeric date order<select id="date-order" aria-label="Numeric date order"><option value="MDY">Month / day / year</option><option value="DMY">Day / month / year</option></select></label>
          <label>Bare weekdays<select id="bare-weekdays" aria-label="Bare weekdays"><option value="once">One-off dates</option><option value="weekly">Repeat weekly</option></select></label>
          <label>Bare weekday date<select id="bare-weekday" aria-label="Bare weekday date"><option value="future">Upcoming or today</option><option value="nearest">Nearest date</option><option value="thisWeek">This calendar week</option></select></label>
          <label>Next weekday<select id="next-weekday" aria-label="Next weekday"><option value="nextWeek">Next calendar week</option><option value="immediate">Next occurrence</option></select></label>
          <label>Week starts on<select id="week-start" aria-label="Week starts on"><option value="MO">Monday</option><option value="SU">Sunday</option></select></label>
        </div></details>
        <p id="status" role="status" aria-live="polite">Preparing the trained network.</p>
        <div class="examples"><p class="eyebrow">Try an example</p>${examples.map((text, index) => `<button data-example="${index}"><span>${text}</span>${icon("arrowRight")}</button>`).join("")}</div>
      </div>
      <div class="output-pane">
        <div class="section-label"><span>Preview</span><span id="timing">—</span></div>
        <div class="tabs" role="tablist" aria-label="Output"><button role="tab" aria-selected="true" data-tab="dates">${icon("calendar")}Dates & rules</button><button role="tab" aria-selected="false" data-tab="result">${icon("description")}Result</button><button role="tab" aria-selected="false" data-tab="compare">Compare</button></div>
        <div id="output" role="tabpanel"></div>
        <p class="note">Calendar math uses your reference and timezone. Showing up to 12 occurrences.</p>
      </div>
    </section>
    <details class="research" id="benchmarks"><summary><span>Model & benchmarks</span><span class="summary-meta">${report.parameters.toLocaleString()} parameters ${icon("chevron")}</span></summary><div class="research-content">
    <section class="model-card"><div><p class="eyebrow">THE TRAINED NETWORK</p><h2>Model details</h2></div><dl><div><dt>Parameters</dt><dd>${report.parameters.toLocaleString()}</dd></div><div><dt>Weight precision</dt><dd>int6</dd></div><div><dt>Weights, Brotli</dt><dd>${(report.moduleBrotliBytes / 1000).toFixed(1)} KB</dd></div><div><dt>Checkpoint training</dt><dd>${(report.tokensSeenAtCheckpoint / 1e6).toFixed(1)}M tokens</dd></div></dl></section>
    <section class="measurements"><div><p class="eyebrow">MEASURED TOKEN LABEL AGREEMENT</p><h2>Validation</h2><p>These scores measure synthetic token labels. All 25 adversarial development schedules pass, and 10,000 inputs match between CPU and WebGPU. Broader accuracy evaluation is still in progress.</p></div><div class="bars">${[
      ["Same-template validation", report.metrics.validation.tokenAccuracy],
      ["Held-out surface templates", report.metrics.heldout.tokenAccuracy],
      ["Held-out clause boundary F1", report.metrics.heldout.boundaryF1],
    ]
      .map(
        ([name, value]) =>
          `<div class="bar-row"><div><span>${name}</span><strong>${(Number(value) * 100).toFixed(2)}%</strong></div><div class="bar-track"><i style="width:${Number(value) * 100}%"></i></div></div>`,
      )
      .join("")}</div></section>
    <section class="benchmark-section accuracy-section" aria-labelledby="accuracy-heading">
      <p class="eyebrow">COMPLETE OUTPUTS, BEYOND TOKEN LABELS</p>${benchmarkMatches ? "" : '<p role="status">These tables describe the previously measured model. A benchmark refresh is pending for the current checkpoint.</p>'}<h2 id="accuracy-heading">Result accuracy</h2>
      <p>Generated examples share rendering patterns with training. The Microsoft cases use independent expected dates. This strict comparison counts interpretation differences as failures.</p>
      <table><thead><tr><th scope="col">Evaluation</th><th scope="col">Matches</th><th scope="col">Score</th></tr></thead><tbody>
        <tr><th scope="row">Direct date and range fixtures</th><td>${benchmark.directResults.correct} / ${benchmark.directResults.total}</td><td>${((100 * benchmark.directResults.correct) / benchmark.directResults.total).toFixed(2)}%</td></tr>
        <tr><th scope="row">Generated interpretations</th><td>${benchmark.semantic.correct} / ${benchmark.semantic.total}</td><td>${(benchmark.semantic.accuracy * 100).toFixed(2)}%</td></tr>
        <tr><th scope="row">Microsoft development cases</th><td>${benchmark.external.correct} / ${benchmark.external.total}</td><td>${(benchmark.external.accuracy * 100).toFixed(2)}%</td></tr>
      </tbody></table><p>${benchmark.external.reservedTestCases} Microsoft test cases remain reserved. Broader language accuracy is still below the release target.</p>
    </section>
    <section class="benchmark-section" aria-labelledby="benchmark-heading"><p class="eyebrow">MEASURED IN CHROME · ${benchmark.environment.cpu}</p><h2 id="benchmark-heading">Performance & size</h2><p>These libraries return different kinds of results. Fast parsing can include partial answers and unsupported inputs.</p><div class="benchmark-charts" id="benchmark-charts"></div><details><summary>Measurement details and current limits</summary><p>${benchmark.method}</p><ul>${benchmark.limitations.map((text) => `<li>${text}</li>`).join("")}</ul></details></section>
    </div></details>
  </main><footer><span>gpu-time · An experiment in understanding human time.</span><span>PyTorch / WebGPU</span></footer>
`;

const element = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const expression = element<HTMLTextAreaElement>("expression");
const backend = element<HTMLSelectElement>("backend");
const reference = element<HTMLInputElement>("reference");
const timezone = element<HTMLInputElement>("timezone");
const worker = new Worker(new URL("./worker.ts", import.meta.url), {
  type: "module",
});
let request = 0;
let tab = "dates";
let parsed: ParseResult | undefined;
let resolved: ParseResult[] = [];
let timer: ReturnType<typeof setTimeout>;
let comparison: { name: string; output?: unknown; error?: string }[] = [];

function chart(
  title: string,
  caption: string,
  rows: { name: string; value: number }[],
  unit: string,
): HTMLElement {
  const section = node("section", "", "benchmark-chart");
  section.append(node("h3", title), node("p", caption));
  const maximum = Math.max(...rows.map((row) => row.value));
  const list = node("ol", "", "benchmark-bars");
  for (const row of rows.sort((a, b) => a.value - b.value)) {
    const item = node("li", "");
    const label = node("div", "", "benchmark-label");
    label.append(
      node("span", row.name),
      node("strong", `${row.value.toFixed(1)} ${unit}`),
    );
    const track = node("div", "", "bar-track");
    track.setAttribute("aria-hidden", "true");
    const bar = node("i", "");
    bar.style.width = `${(row.value / maximum) * 100}%`;
    if (row.name.startsWith("gpu-time")) item.classList.add("ours");
    track.append(bar);
    item.append(label, track);
    list.append(item);
  }
  section.append(list);
  return section;
}

element("benchmark-charts").append(
  chart(
    "10,000 inputs",
    "Median of three warm runs. Public parse calls; output contracts differ. Lower is faster.",
    benchmark.performance.flatMap((row) =>
      row.batches
        ? [
            {
              name: row.name,
              value: row.batches.find((batch) => batch.size === 10000)!.ms,
            },
          ]
        : [],
    ),
    "ms",
  ),
  chart(
    "Complete browser bundle",
    "Minified + Brotli. gpu-time includes weights and date resolution. Lower is smaller.",
    benchmark.sizes.map((row) => ({
      name: row.name,
      value: row.brotliBytes / 1000,
    })),
    "KB",
  ),
);

function node(tag: string, text: string, className?: string): HTMLElement {
  const value = document.createElement(tag);
  value.textContent = text;
  if (className) value.className = className;
  return value;
}

function render(): void {
  const output = element("output");
  output.replaceChildren();
  document
    .querySelectorAll<HTMLButtonElement>("[data-tab]")
    .forEach((button) => {
      const selected = button.dataset.tab === tab;
      button.id = `tab-${button.dataset.tab}`;
      button.setAttribute("aria-selected", String(selected));
      button.setAttribute("aria-controls", "output");
      button.tabIndex = selected ? 0 : -1;
    });
  output.setAttribute("aria-labelledby", `tab-${tab}`);
  if (tab === "compare") {
    output.append(
      node(
        "p",
        "Live native outputs for the same reference instant. Each library has its own interpretation rules.",
        "note",
      ),
    );
    for (const result of comparison) {
      output.append(
        node("h3", result.name),
        node(
          "pre",
          result.error ?? JSON.stringify(result.output, null, 2),
          "json",
        ),
      );
    }
    if (!comparison.length)
      output.append(node("p", "Loading comparison…", "empty"));
    return;
  }
  if (!parsed) {
    output.append(node("p", "Reading the expression…", "empty"));
    return;
  }
  if (tab === "result") {
    output.append(node("pre", JSON.stringify(parsed, null, 2), "json"));
    return;
  }
  if (tab === "dates") {
    if (parsed.occurrences.length) {
      const heading = node("div", "", "agenda-heading");
      const first = new Date(parsed.occurrences[0].start);
      const title = new Intl.DateTimeFormat("en-US", {
        month: "long",
        year: "numeric",
        timeZone: timezone.value,
      }).format(first);
      const caption = node("div", "");
      caption.append(
        node("h2", title),
        node("p", timezone.value, "agenda-zone"),
      );
      heading.append(
        caption,
        node(
          "span",
          `${parsed.occurrences.length} occurrence${parsed.occurrences.length === 1 ? "" : "s"}`,
          "count-badge",
        ),
      );
      output.append(heading);
    }
    if (!parsed.occurrences.length)
      output.append(
        node(
          "p",
          "No dates found. Check any diagnostics in the result.",
          "empty",
        ),
      );
    for (const result of resolved) {
      if (!result) continue;
      const list = document.createElement("ol");
      list.className = "dates";
      const groups = new Map<string, number>();
      for (const occurrence of result.occurrences) {
        const start = new Date(occurrence.start);
        const end = occurrence.end ? new Date(occurrence.end) : undefined;
        const format = (date: Date, options: Intl.DateTimeFormatOptions) =>
          new Intl.DateTimeFormat("en-US", {
            ...options,
            timeZone: timezone.value,
          }).format(date);
        const clock = (date: Date) =>
          format(date, { hour: "numeric", minute: "2-digit" });
        const key = `${clock(start)}-${end ? clock(end) : ""}`;
        if (!groups.has(key)) groups.set(key, groups.size);
        const item = node("li", "", `occurrence tone-${groups.get(key)! % 3}`);
        const badge = node("div", "", "day-badge");
        badge.append(
          node("span", format(start, { weekday: "short" })),
          node("strong", format(start, { day: "numeric" })),
        );
        const details = node("div", "", "event-details");
        details.append(
          node(
            "p",
            format(start, { weekday: "long", month: "short", day: "numeric" }),
            "event-date",
          ),
        );
        const times = node("div", "", "event-time");
        const startTime = document.createElement("time");
        startTime.dateTime = occurrence.start;
        startTime.textContent = occurrence.allDay ? "All day" : clock(start);
        startTime.title = occurrence.start;
        times.append(startTime);
        if (end) {
          const endTime = document.createElement("time");
          endTime.dateTime = occurrence.end!;
          endTime.title = occurrence.end!;
          endTime.textContent = occurrence.allDay
            ? format(end, { month: "short", day: "numeric" })
            : clock(end);
          times.append(node("span", "–", "time-separator"), endTime);
          if (
            format(start, {
              year: "numeric",
              month: "numeric",
              day: "numeric",
            }) !==
            format(end, { year: "numeric", month: "numeric", day: "numeric" })
          ) {
            details.append(
              node(
                "span",
                `Ends ${format(end, { weekday: "short", month: "short", day: "numeric" })}`,
                "overnight",
              ),
            );
          }
        }
        details.insertBefore(times, details.children[1] ?? null);
        item.append(badge, details);
        list.append(item);
      }
      output.append(list);
      if (result.rrules.length) {
        const rules = document.createElement("details");
        rules.className = "recurrence-rules";
        const summary = node("summary", "");
        summary.innerHTML = `${icon("chevron")}<span>Recurrence rules</span>`;
        rules.append(summary);
        for (const rule of result.rrules)
          rules.append(node("pre", rule, "json"));
        output.append(rules);
      }
    }
    for (const diagnostic of parsed.diagnostics)
      output.append(node("p", diagnostic.message, "diagnostic"));
    return;
  }
  for (const diagnostic of parsed.diagnostics)
    output.append(node("p", diagnostic.message, "diagnostic"));
}

function run(): void {
  clearTimeout(timer);
  document
    .querySelectorAll<HTMLButtonElement>("[data-example]")
    .forEach((button) => {
      button.setAttribute(
        "aria-pressed",
        String(
          expression.value.trim() === examples[Number(button.dataset.example)],
        ),
      );
    });
  parsed = undefined;
  resolved = [];
  comparison = [];
  render();
  element("status").textContent = "Running the trained model…";
  worker.postMessage({
    id: ++request,
    text: expression.value,
    backend: backend.value,
    reference: reference.value,
    timeZone: timezone.value,
    compare: tab === "compare",
    dateOrder: element<HTMLSelectElement>("date-order").value,
    bareWeekdays: element<HTMLSelectElement>("bare-weekdays").value,
    bareWeekday: element<HTMLSelectElement>("bare-weekday").value,
    nextWeekday: element<HTMLSelectElement>("next-weekday").value,
    weekStart: element<HTMLSelectElement>("week-start").value,
  });
}

worker.onmessage = ({ data }) => {
  if (data.id !== request) return;
  if (data.error) {
    element("status").textContent = data.error;
    element("output").replaceChildren(node("p", data.error, "error"));
    return;
  }
  parsed = data.parsed;
  resolved = data.resolved;
  comparison = data.comparison ?? [];
  element("engine").textContent =
    parsed!.backend === "webgpu" ? "WebGPU" : "CPU";
  element("engine").dataset.ready = "true";
  element("timing").textContent =
    `${parsed!.timings.inferMs.toFixed(2)} ms inference`;
  const count = parsed!.occurrences.length;
  element("status").textContent =
    `${count} occurrence${count === 1 ? "" : "s"} resolved`;
  render();
};
worker.onerror = () => {
  element("status").textContent =
    "The worker could not start. See the browser console for details.";
};
element("run").onclick = run;
element("benchmark-link").onclick = () => {
  element<HTMLDetailsElement>("benchmarks").open = true;
};
expression.oninput = () => {
  request++;
  clearTimeout(timer);
  timer = setTimeout(run, 250);
};
[
  backend,
  reference,
  timezone,
  ...document.querySelectorAll<HTMLSelectElement>(".policies select"),
].forEach((control) => control.addEventListener("change", run));
document.querySelectorAll<HTMLButtonElement>("[data-example]").forEach(
  (button) =>
    (button.onclick = () => {
      expression.value = examples[Number(button.dataset.example)];
      run();
    }),
);
document.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach(
  (button) =>
    (button.onclick = () => {
      tab = button.dataset.tab!;
      if (tab === "compare" && !comparison.length) {
        run();
        return;
      }
      render();
    }),
);
document.querySelector<HTMLElement>(".tabs")!.onkeydown = (event) => {
  const tabs = [...document.querySelectorAll<HTMLButtonElement>("[data-tab]")];
  let index = tabs.findIndex((button) => button.dataset.tab === tab);
  if (event.key === "ArrowRight") index = (index + 1) % tabs.length;
  else if (event.key === "ArrowLeft")
    index = (index + tabs.length - 1) % tabs.length;
  else if (event.key === "Home") index = 0;
  else if (event.key === "End") index = tabs.length - 1;
  else return;
  event.preventDefault();
  tabs[index].click();
  tabs[index].focus();
};
run();

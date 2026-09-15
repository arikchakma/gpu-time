import { useEffect, useRef, useState } from "react";
import { demoDefault, format, kinds } from "../lib/demo";
import { Mark } from "./Mark";

type Formatted = ReturnType<typeof format>;
type Parser = Awaited<ReturnType<typeof import("gpu-time").defineParser>>;

export function Demo({ initial }: { initial: Formatted }) {
  const [text, setText] = useState(demoDefault);
  const [result, setResult] = useState(initial);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const parser = useRef<Parser>(undefined);
  const gpu = useRef(true);
  const seq = useRef(0);

  async function cpuParser() {
    gpu.current = false;
    const { defineParser } = await import("gpu-time");
    return defineParser({ backend: "cpu" });
  }

  async function parseWith(
    value: string,
    context: { reference: string; timeZone: string; limit: number },
  ) {
    if (!parser.current) {
      const { defineParser } = await import("gpu-time");
      try {
        parser.current = await defineParser({ backend: "webgpu" });
      } catch {
        parser.current = await cpuParser();
      }
    }
    try {
      return await parser.current.parse(value, context);
    } catch (error) {
      if (!gpu.current) throw error;
      parser.current.dispose();
      parser.current = await cpuParser();
      return parser.current.parse(value, context);
    }
  }

  async function run(value: string) {
    if (!value.trim()) return;
    const ticket = ++seq.current;
    setBusy(true);
    const reference = new Date();
    try {
      const parsed = await parseWith(value.trim(), {
        reference: reference.toISOString(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        limit: 3,
      });
      if (ticket !== seq.current) return;
      setResult(
        format(
          parsed,
          reference,
          Intl.DateTimeFormat().resolvedOptions().timeZone,
        ),
      );
    } catch {
      if (ticket !== seq.current) return;
      setResult({
        rows: [],
        status: "The parser could not run. Please reload and try again.",
        context: "",
      });
    } finally {
      if (ticket === seq.current) setBusy(false);
    }
  }

  useEffect(() => {
    function pick(event: Event) {
      const phrase = (event as CustomEvent<string>).detail;
      setText(phrase);
      document
        .querySelector("#demo-card")
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    window.addEventListener("demo:example", pick);
    return () => window.removeEventListener("demo:example", pick);
  }, []);

  // The server already parsed the default phrase, so the first render skips a run.
  useEffect(() => {
    if (text === demoDefault && seq.current === 0) return;
    const timer = setTimeout(() => void run(text), 150);
    return () => clearTimeout(timer);
  }, [text]);

  return (
    <>
      <section
        id="demo-card"
        className="mt-8 overflow-hidden rounded-box border border-neutral-100"
        aria-label="Try gpu-time"
      >
        <div className="flex items-center justify-between gap-3 border-b border-neutral-100 bg-neutral-50 px-4 py-2">
          <span className="text-label font-medium uppercase text-neutral-500">
            Try It Out
          </span>
          <span className="text-[11px] text-neutral-400">
            Type any date or time
          </span>
        </div>

        <form
          id="demo-form"
          className="relative"
          onSubmit={(event) => {
            event.preventDefault();
            void run(text);
          }}
        >
          <div className="relative">
            <div
              id="demo-highlight"
              ref={layer}
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 left-0 right-0 m-0 select-none overflow-hidden whitespace-pre border-0 p-4 font-sans text-base leading-6.5 tracking-[-0.2px]"
            >
              <Mark text={text} />
            </div>
            <input
              id="demo-input"
              ref={input}
              name="expression"
              type="text"
              value={text}
              maxLength={500}
              required
              spellCheck={false}
              autoComplete="off"
              onChange={(event) => setText(event.target.value)}
              onScroll={() => {
                if (layer.current && input.current)
                  layer.current.scrollLeft = input.current.scrollLeft;
              }}
              className="relative m-0 w-full border-0 bg-transparent p-4 font-sans text-base leading-6.5 tracking-[-0.2px] text-transparent caret-black outline-none focus-visible:outline-none"
            />
          </div>
        </form>

        {/* One tinted block, one rule: the answer is the only filled region. */}
        <div className="border-t border-neutral-100 bg-neutral-50">
          <div
            id="demo-result"
            aria-live="polite"
            aria-atomic="true"
            aria-busy={busy}
          >
            <p
              id="demo-status"
              className="px-4 pt-2.5 text-[11px] text-neutral-400"
            >
              {result.status}
            </p>
            <ul id="demo-dates" className="px-4 py-1.5 text-body">
              {result.rows.map((row, index) => (
                <li
                  key={index}
                  className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-1"
                >
                  <span className="font-medium">{row.date}</span>
                  <span className="tabular-nums text-neutral-500">
                    {row.time}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <p
            id="demo-context"
            className="px-4 pb-2.5 text-[11px] text-neutral-400"
          >
            {result.context}
          </p>
        </div>
      </section>

      <ul className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-xs text-neutral-500">
        {kinds.map((kind) => (
          <li key={kind.kind} className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className={`inline-block size-3 rounded-sm ${
                kind.kind === "date"
                  ? "bg-date"
                  : kind.kind === "time"
                    ? "bg-time"
                    : kind.kind === "repeat"
                      ? "bg-repeat"
                      : "bg-duration"
              }`}
            />
            {kind.label}
          </li>
        ))}
      </ul>
    </>
  );
}

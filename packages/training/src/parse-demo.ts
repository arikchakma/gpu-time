import { readFileSync } from "node:fs";
import { compile } from "../../core/src/compile.ts";
import { tokenize } from "../../core/src/tokenizer.ts";
import { createResolver } from "../../core/src/resolve.ts";
import es from "../../core/src/languages/es.ts";
import type { Label, Token } from "../../core/src/types.ts";

const rows = readFileSync(process.argv[2], "utf8")
  .trim()
  .split("\n")
  .map((l) => JSON.parse(l));
const resolve = createResolver({
  reference: "2026-09-16T10:00:00Z",
  timeZone: "Europe/Madrid",
  limit: 3,
});
for (const row of rows) {
  let i = 0;
  const tokens = tokenize(row.text).map((t): Token => {
    if (t.kind === 3) return { ...t, label: "O", clauseStart: false, score: 1 };
    const s = row.spans[i++];
    return {
      ...t,
      label: s.label as Label,
      clauseStart: s.clauseStart,
      score: 1,
    };
  });
  const expressions = compile(row.text, tokens, { language: es });
  const out: string[] = [];
  for (const e of expressions) {
    if (!e.schedule) continue;
    try {
      const r = resolve(e.schedule);
      for (const o of r.occurrences.slice(0, 2))
        out.push(o.start.slice(0, 16).replace("T", " "));
      if (r.rrules.length) out.push(r.rrules[0]);
    } catch (err) {
      out.push(`resolve-error: ${(err as Error).message.slice(0, 40)}`);
    }
  }
  console.log(
    `${row.text}\n   → ${out.length ? out.join("  |  ") : "(no time expression)"}\n`,
  );
}

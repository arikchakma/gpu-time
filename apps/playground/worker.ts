import { defineParser } from "gpu-time";
import type { ParserOptions } from "gpu-time";
import { offsetAt } from "gpu-time/schedule";

const parsers = new Map<string, ReturnType<typeof defineParser>>();
self.onmessage = async ({ data }) => {
  try {
    const backend: ParserOptions["backend"] = data.backend;
    const dateOrder: ParserOptions["dateOrder"] = data.dateOrder ?? "MDY";
    const key = `${backend ?? "auto"}:${dateOrder}`;
    let pending = parsers.get(key);
    if (!pending) {
      pending = defineParser({ backend, dateOrder });
      parsers.set(key, pending);
    }
    const parser = await pending;
    const parsed = await parser.parse(data.text, {
      reference: data.reference,
      timeZone: data.timeZone,
      limit: 12,
      bareWeekdays: data.bareWeekdays,
      bareWeekday: data.bareWeekday,
      nextWeekday: data.nextWeekday,
      weekStart: data.weekStart,
    });
    const resolved = [parsed];
    const comparison = [];
    if (data.compare) {
      comparison.push({ name: "gpu-time", output: parsed });
      try {
        const { en } = await import("chrono-node");
        const reference = new Date(data.reference);
        const results = en.casual.parse(
          data.text,
          {
            instant: reference,
            timezone: offsetAt(reference.getTime(), data.timeZone) / 60_000,
          },
          { forwardDate: true },
        );
        comparison.push({
          name: "Chrono",
          output: results.map((part) => ({
            text: part.text,
            start: part.start.date().toISOString(),
            end: part.end?.date().toISOString(),
          })),
        });
      } catch (error) {
        comparison.push({ name: "Chrono", error: String(error) });
      }
      try {
        const { RRule } = await import("rrule");
        comparison.push({
          name: "rrule",
          output: RRule.parseText(data.text) ?? null,
        });
      } catch (error) {
        comparison.push({ name: "rrule", error: String(error) });
      }
    }
    self.postMessage({ id: data.id, parsed, resolved, comparison });
  } catch (error) {
    self.postMessage({
      id: data.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

import { writeFileSync } from "node:fs";
import type { Clause } from "../../core/src/types.ts";

const gold = new URL("../data/gold/", import.meta.url);

const at = (hour: number): Clause => ({ time: { start: { hour, minute: 0 } } });
const window = (start: number, end: number): Clause => ({
  time: { start: { hour: start, minute: 0 }, end: { hour: end, minute: 0 } },
});
const cases: [string, Clause | null][] = [
  ["I'll be out between 5 and 6pm", window(17, 18)],
  ["I'll be out from 1am to 5pm", window(1, 17)],
  ["We'll be available from 9am to 5pm", window(9, 17)],
  [
    "The library is open from 10am to noon",
    { time: { start: { hour: 10, minute: 0 }, end: { named: "noon" } } },
  ],
  [
    "The office is closed from 10pm to midnight",
    { time: { start: { hour: 22, minute: 0 }, end: { named: "midnight" } } },
  ],
  ["Could you set an alarm for 8am", at(8)],
  [
    "Please set an alarm for 7:30am",
    { time: { start: { hour: 7, minute: 30 } } },
  ],
  [
    "Can you book room 24 for tomorrow at 3pm",
    { date: { kind: "relativeDay", offset: 1 }, ...at(15) },
  ],
  [
    "The appointment is scheduled for Friday at noon",
    {
      date: { kind: "weekday", days: ["FR"] },
      time: { start: { named: "noon" } },
    },
  ],
  [
    "The interview starts Monday at 2pm",
    { date: { kind: "weekday", days: ["MO"] }, ...at(14) },
  ],
  [
    "Our clinic opens every weekday at 8am",
    {
      recurrence: {
        freq: "weekly",
        interval: 1,
        byDay: ["MO", "TU", "WE", "TH", "FR"],
      },
      ...at(8),
    },
  ],
  [
    "Please schedule a call for every other Tuesday at 11am",
    { recurrence: { freq: "weekly", interval: 2, byDay: ["TU"] }, ...at(11) },
  ],
  [
    "The lesson is scheduled for June 12",
    { date: { kind: "calendar", month: 6, day: 12 } },
  ],
  [
    "They'll be back in two hours",
    { shift: { amount: 2, unit: "hour", direction: "after" } },
  ],
  [
    "I'd like to schedule a meeting for tomorrow",
    { date: { kind: "relativeDay", offset: 1 } },
  ],
  [
    "Please remind me about Christmas",
    { date: { kind: "holiday", name: "christmas" } },
  ],
  [
    "The meeting is scheduled for next week",
    { date: { kind: "relativeUnit", unit: "week", modifier: "next" } },
  ],
  [
    "Please book room 17 from Monday to Wednesday",
    { date: { kind: "weekdayRange", from: "MO", to: "WE" } },
  ],
  ["The library is closed for repairs.", null],
  ["Please set an alarm for the experiment.", null],
  ["Can you book room 24 for the team?", null],
  ["The interview is about our second product.", null],
  ["I'll be out of the office for personal reasons.", null],
  ["Our clinic is open for questions.", null],
];

writeFileSync(
  new URL("prose.jsonl", gold),
  cases
    .flatMap(([text, clause], index) => {
      const variants = {
        authored: text,
        lowercase: text.toLowerCase(),
        uppercase: text.toUpperCase(),
      };
      return Object.entries(variants).map(([variant, text]) =>
        JSON.stringify({
          id: `prose-${String(index + 1).padStart(3, "0")}-${variant}`,
          family: clause ? "prose-carrier" : "prose-negative",
          variant,
          text,
          schedule: clause ? { clauses: [clause] } : null,
        }),
      );
    })
    .join("\n") + "\n",
);
console.log(
  `Authored ${cases.length} prose checks with ${cases.length * 2} derived casing variants.`,
);

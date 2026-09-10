import type { ParseResult } from '../../../src/index';

export const example = 'Every Monday from 8pm to 10pm';

// Server and client build result rows, so they must share one class list.
export const rowClass = 'flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 rounded-box bg-neutral-50 px-2.5 py-1.5';

export type Kind = 'date' | 'time' | 'repeat' | 'duration';
export interface Part { text: string; kind?: Kind }

export const kinds: { kind: Kind; label: string }[] = [
  { kind: 'date', label: 'Day or Date' },
  { kind: 'time', label: 'Clock Time' },
  { kind: 'repeat', label: 'Repeats' },
  { kind: 'duration', label: 'How Long' },
];

export const examples: { use: string; text: string }[] = [
  { use: 'A reminder', text: 'tomorrow at 9am' },
  { use: 'Dinner, mid-sentence', text: 'book dinner for October 2 at eight pm' },
  { use: 'Standup', text: 'every weekday at nine am' },
  { use: 'Overnight shift', text: 'Friday at 10pm until Saturday at 2am' },
  { use: 'A trip', text: 'from September 4 through September 8' },
  { use: 'Payday', text: 'the last Friday of each month' },
  { use: 'Two-week cycle', text: 'every other Friday at noon' },
  { use: 'A timer', text: 'in half an hour for 45 minutes' },
];

const hour = "one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve";
// ponytail: cosmetic regex, first pattern wins. The parser exposes no token
// spans, so highlighting is a reading aid and never the parse result itself.
const patterns: [Kind, RegExp][] = [
  ['repeat', /\b(every other|every|each|all|weekdays?|weekends?|daily|weekly|biweekly|monthly|yearly|annually|except)\b/gi],
  ['duration', /\b(for|in)\s+(an?|half an?|\d+(\.\d+)?)\s*(and a half\s+)?(hours?|hrs?|minutes?|mins?|days?|weeks?|months?)\b/gi],
  ['time', new RegExp(`\\b(from\\s+)?(\\d{1,2}(:\\d{2})?|${hour})\\s*(am|pm)?\\s*(-|–|to|until|till|through)\\s*(\\d{1,2}(:\\d{2})?|${hour})\\s*(am|pm)?\\b`, 'gi')],
  ['time', new RegExp(`\\b(at\\s+)?(\\d{1,2}(:\\d{2})?|${hour})\\s*(am|pm|o'?clock)\\b|\\b(noon|midnight|morning|afternoon|evening|midday)\\b|\\b(half past|quarter (to|past))\\s+\\S+`, 'gi')],
  ['date', /\b((mon|tues?|wednes|thurs?|fri|satur|sun)day|mon|tue|wed|thu|fri|sat|sun)\b/gi],
  ['date', /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s*\d{0,2}(st|nd|rd|th)?\b/gi],
  ['date', /\b(today|tomorrow|tonight|yesterday)\b|\b(next|this|last|first|second|third|fourth)\s+\S+|\b\d{1,2}(st|nd|rd|th)\b|\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/gi],
];

export function highlight(text: string): Part[] {
  const claims: { start: number; end: number; kind: Kind }[] = [];
  for (const [kind, pattern] of patterns) {
    for (const match of text.matchAll(pattern)) {
      const start = match.index;
      const end = start + match[0].length;
      if (claims.some(claim => start < claim.end && end > claim.start)) continue;
      claims.push({ start, end, kind });
    }
  }
  claims.sort((first, second) => first.start - second.start);

  const parts: Part[] = [];
  let at = 0;
  for (const claim of claims) {
    if (claim.start > at) parts.push({ text: text.slice(at, claim.start) });
    parts.push({ text: text.slice(claim.start, claim.end), kind: claim.kind });
    at = claim.end;
  }
  if (at < text.length) parts.push({ text: text.slice(at) });
  return parts;
}

export function format(result: ParseResult, reference: Date, timeZone: string) {
  const dateFormat = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  const timeFormat = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' });
  const status = result.diagnostics.length
    ? result.diagnostics.map(diagnostic => diagnostic.message).join(' ')
    : result.occurrences.length
      ? result.truncated ? `Next ${result.occurrences.length} occurrences` : 'Result'
      : 'No dates found. Try a date or a time window.';

  const rows = result.occurrences.map(occurrence => {
    const start = new Date(occurrence.start);
    const end = occurrence.end ? new Date(occurrence.end) : start;
    let time: string;
    if (!occurrence.end) {
      time = occurrence.allDay ? 'All day' : timeFormat.format(start);
    } else if (occurrence.allDay) {
      // Date-only ranges have an exclusive end at the next midnight.
      const lastDay = new Date(end.getTime() - 1);
      time = dateFormat.format(start) === dateFormat.format(lastDay)
        ? 'All day' : `Through ${dateFormat.format(lastDay)} · all day`;
    } else {
      const endDate = dateFormat.format(start) === dateFormat.format(end) ? '' : `${dateFormat.format(end)}, `;
      time = `${timeFormat.format(start)} – ${endDate}${timeFormat.format(end)}`;
    }
    return { date: dateFormat.format(start), time };
  });

  return { status, rows, context: `Relative to ${dateFormat.format(reference)} · ${timeZone}` };
}

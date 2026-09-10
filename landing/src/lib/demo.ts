import type { ParseResult } from '../../../src/index';

export const example = 'Every Monday from 8pm to 10pm';

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

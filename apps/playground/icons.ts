// SVG paths from Calendar's components/icons. Keep its 24-unit canvas and weights.
const shapes = {
  clock:
    '<mask id="$id" stroke="none"><circle cx="12" cy="12" r="9.5" fill="white"/><path d="M12 7.25v5.15l3.2 2" stroke="black" stroke-width="2.3"/></mask><circle cx="12" cy="12" r="9.5" fill="currentColor" stroke="none" mask="url(#$id)"/>',
  calendar:
    '<rect x="3.5" y="5" width="17" height="15.5" rx="3.75"/><path fill="currentColor" stroke="none" d="M3.5 8.75A3.75 3.75 0 0 1 7.25 5h9.5a3.75 3.75 0 0 1 3.75 3.75v2.25h-17V8.75Z"/><path d="M8 2.75v3.5M16 2.75v3.5" stroke-width="2.4"/>',
  globe:
    '<mask id="$id" stroke="none"><circle cx="12" cy="12" r="9.5" fill="white"/><path d="M2.5 12h19" stroke="black" stroke-width="2.2"/><path d="M12 2.5c2.7 2.7 4 5.9 4 9.5s-1.3 6.8-4 9.5c-2.7-2.7-4-5.9-4-9.5s1.3-6.8 4-9.5Z" stroke="black" stroke-width="2.2"/></mask><circle cx="12" cy="12" r="9.5" fill="currentColor" stroke="none" mask="url(#$id)"/>',
  sliders:
    '<mask id="$id" stroke="none"><path d="M3 6.5h18M3 12h18M3 17.5h18" stroke="white" stroke-width="2.6" stroke-linecap="round"/><circle cx="14" cy="6.5" r="5" fill="black"/><circle cx="8" cy="12" r="5" fill="black"/><circle cx="16" cy="17.5" r="5" fill="black"/><circle cx="14" cy="6.5" r="3.2" fill="white"/><circle cx="8" cy="12" r="3.2" fill="white"/><circle cx="16" cy="17.5" r="3.2" fill="white"/></mask><rect width="24" height="24" fill="currentColor" stroke="none" mask="url(#$id)"/>',
  arrowUp: '<path d="M12 19.5v-15M5.5 11 12 4.5 18.5 11" stroke-width="2.6"/>',
  arrowRight: '<path d="M4.5 12h15M13.5 6l6 6-6 6" stroke-width="2.4"/>',
  chevron: '<path d="m5.5 9 6.5 6.5L18.5 9" stroke-width="2.6"/>',
  description: '<path d="M4 7h16M4 12h16M4 17h9.5" stroke-width="2.4"/>',
};
let nextId = 0;
export function icon(name: keyof typeof shapes): string {
  const size =
    name === "chevron" || name === "sliders"
      ? 14
      : name === "arrowRight"
        ? 13
        : 15;
  const body = shapes[name].replaceAll("$id", `calendar-icon-${nextId++}`);
  return `<svg class="icon" data-icon="${name}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

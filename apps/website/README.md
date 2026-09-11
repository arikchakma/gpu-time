# @gpu-time/website

The project's website: Astro + Tailwind, one page. It is a workspace package and
depends on `gpu-time` (`packages/core`) as `workspace:*`.

```sh
pnpm install
pnpm --filter @gpu-time/website dev
```

Opens at http://127.0.0.1:4321. The on-page demo runs the parser locally.

`pnpm check` validates Astro; `pnpm build` creates `dist/`. Because `gpu-time`
resolves through its `exports` map to `packages/core/dist/`, the core package
must be built first — the `build` script does that itself
(`pnpm --filter gpu-time build && astro build`).

The footer links back to the on-page demo.

The page is built to be skimmed: a hero card shows one phrase turning into real
dates, a colored legend names the four kinds of meaning, tappable use cases feed
the same field, and a code block shows the call. Words are kept to a minimum.

`src/lib/demo.ts` holds the shared pieces: the example phrase, result row class,
use-case list, and `highlight()`. Highlighting is a cosmetic regex pass, not
parser output, and the parser exposes no token spans. Its parts must reassemble
into the exact input, because the highlight layer sits behind a transparent
input and both lay out text with the same `.demo-field` metrics. Run
`pnpm test:highlight` for that check (it imports the `.ts` module directly and
relies on Node 24 stripping types).

The initial example is rendered at build time with explicit UTC context. Loading
JavaScript does not replace it. Submissions use the current instant and the
browser's timezone, and load the parser on demand. Each run reports the real
`timings` total and the `backend` it used in the `parse()` chip.

The demo asks for `backend: "webgpu"` rather than using the default `parse()`,
whose `auto` heuristic keeps single short phrases on CPU. Because `"webgpu"`
turns off the library's own fallback, the page owns both failure paths: no
WebGPU at all, and a dispatch that fails mid-session. `pnpm test:browser`
covers the first by stubbing `Navigator.prototype.gpu`. Video loads only after Play.
Its white control bar stays below the picture and provides seeking, mute,
captions, and fullscreen.

Run `pnpm test:browser` for the first-load regression (requires Playwright,
declared here as a devDependency, and Chrome). It builds and checks the
production build at desktop and mobile widths with delayed JavaScript, plus the
example with JavaScript disabled. Use
`LANDING_URL=http://127.0.0.1:4321/ node tests/first-load.mjs` from this
directory to run the same checks against the development server.

## Film provenance

`public/media/gpu-time-neural.mp4` is the current parser walkthrough built in
`../../video/`. Its original-style neural walkthrough, real data adapter,
source/checkpoint hashes, narration, and rendering scripts are kept there. It
shows the current 24,761-parameter model and direct dates/rules API, with no
legacy AST claims.

The white-background film includes newly generated synthetic narration and timed
English captions. The original music and effect synthesis is adapted to the new scene timings.

Run `pnpm prepare:video` to copy the completed film from `../../video/output/`
and regenerate its poster and captions. Requires the rendered film, Chrome, and
Playwright. Included public media allow normal site builds without production tools.

Page headings and video titles use Chicago headline-style capitalization.

## Thumbnail

`artwork/thumbnail.html` is the editable HTML/CSS source. Run
`pnpm prepare:thumbnail` to export 1920×1080 PNG and JPEG versions to
`public/media/poster.*`. The export uses the existing logo and the parameter
count from `../../packages/training/active/export-report.json`. The player uses
JPEG; PNG is available for sharing.

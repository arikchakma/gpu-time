# gpu-time landing

Standalone Astro + Tailwind site. The library, playground, and original film are unchanged.

```sh
cd landing
npm ci
npm run dev
```

Opens at http://127.0.0.1:4321. The on-page demo runs the parser locally;
no separately hosted playground is needed.

`npm run check` validates Astro; `npm run build` creates `dist/`.
The footer links back to the on-page demo.

The initial example is rendered at build time with explicit UTC context. Loading
JavaScript does not replace it. Submissions use the current instant and the
browser's timezone, and load the parser on demand. Video loads only after Play.
Its white control bar stays below the picture and provides seeking, mute,
captions, and fullscreen.

Run `npm run test:browser` for the first-load regression (requires the root
Playwright dependency and Chrome). It checks the production build at desktop and
mobile widths with delayed JavaScript, plus the example with JavaScript disabled.
Use `LANDING_URL=http://127.0.0.1:4321/ node tests/first-load.mjs` from this directory
to run the same checks against the development server.

## Film provenance

`public/media/gpu-time-neural.mp4` is the current parser walkthrough built in
`../video/current/`. Its original-style neural walkthrough, real data adapter, source/checkpoint
hashes, narration, and rendering scripts are kept there. It shows the current
24,761-parameter model and direct dates/rules API, with no legacy AST claims.

The white-background film includes newly generated synthetic narration and timed
English captions. The original music and effect synthesis is adapted to the new scene timings.

Run `npm run prepare:video` to copy the completed film and regenerate its poster
and captions. Requires FFmpeg and the rendered current film. Included public
media allow normal site builds without video-production tools.

Page headings and video titles use Chicago headline-style capitalization.

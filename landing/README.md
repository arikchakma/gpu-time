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

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

`public/media/gpu-time-light.mp4` is a light color treatment of
`../video/output/gpu-time-launch-voiceover.mp4`, with the original audio and timing.
It depicts the archived parser, not the current model or public API. The page labels
it accordingly. No old parameter counts, AST descriptions, or performance claims
are reused as current product copy.

Run `npm run prepare:video` to recreate the derivative, poster, and captions.
Requires FFmpeg and the original rendered film and SRT. The generated media are
included in this project so normal builds do not require video production tools.

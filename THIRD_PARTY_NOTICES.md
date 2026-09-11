# Third-party notices

`gpu-time` is developed and evaluated with third-party software. Their names identify upstream projects and do not imply endorsement.

The `gpu-time` package has **no runtime dependencies**. Everything listed here is a development, benchmark, or website dependency and is not bundled into the package.

The build uses [esbuild](https://github.com/evanw/esbuild), [terser](https://github.com/terser/terser), [wgslender](https://github.com/marijnh/wgslender), and [TypeScript](https://github.com/microsoft/TypeScript), each under their respective open-source licenses.

Training uses [PyTorch](https://github.com/pytorch/pytorch) and [NumPy](https://github.com/numpy/numpy), pinned in `packages/training/pyproject.toml` and `uv.lock`. Label supervision is produced entirely by this repository's own renderers; no third-party corpus is used to assign labels.

Sentences used as non-temporal surrounding prose come from the [Tatoeba Project](https://tatoeba.org) English export, under CC-BY 2.0 FR. The source is pinned by URL and sha256 in `packages/training/data/corpus.json` and fetched with `pnpm --filter @gpu-time/training corpus:fetch`. Downloaded archives and the filtered sentence file are not redistributed here. These sentences supply background text, with every token labeled `O`. The filter removes known time words and number patterns that resemble dates or times.

The benchmark compares against [chrono-node](https://github.com/wanasit/chrono), [compromise](https://github.com/spencermountain/compromise) with `compromise-dates`, [rrule.js](https://github.com/jkbrzt/rrule), [Later](https://github.com/breejs/later), and [Microsoft Recognizers-Text](https://github.com/microsoft/Recognizers-Text), plus the Python parsers [dateparser](https://github.com/scrapinghub/dateparser), [parsedatetime](https://github.com/bear/parsedatetime), [recurrent](https://github.com/kvh/recurrent), and [timefhuman](https://github.com/alvinwan/timefhuman). Each returns a different output structure; timing comparisons are not capability comparisons.

Evaluation corpora derived from Microsoft Recognizers-Text are stored under `packages/benchmark/data/recognizers/` with the upstream `LICENSE` file and a `manifest.json` recording source URLs and checksums. Copyright in those specifications remains with their original authors.

Correctness of timezone and calendar arithmetic is cross-checked in tests against [`@js-temporal/polyfill`](https://github.com/js-temporal/temporal-polyfill) and RFC 5545 output against `rrule.js`. Browser checks use [Playwright](https://github.com/microsoft/playwright) and [Vite](https://github.com/vitejs/vite); unit tests use [Vitest](https://github.com/vitest-dev/vitest); schema validation uses [Ajv](https://github.com/ajv-validator/ajv).

The website is built with [Astro](https://github.com/withastro/astro) and [Tailwind CSS](https://github.com/tailwindlabs/tailwindcss). The explainer video is rendered with [ManimGL](https://github.com/3b1b/manim) and narrated with [kokoro-onnx](https://github.com/thewh1teagle/kokoro-onnx); the Kokoro model files are downloaded at render time and are not redistributed here.

The repository structure, documentation layout, and packaging conventions follow [gpu-lexer](https://github.com/vercel-labs/gpu-lexer) by Shu Ding, MIT licensed. No gpu-lexer code or model weights are included in this repository.

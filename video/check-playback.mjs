import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createServer } from "vite";

mkdirSync("video/output/review", { recursive: true });
writeFileSync(
  "video/output/review/player.html",
  `<!doctype html>
<html><head><meta charset="utf-8"><title>Motion review</title>
<style>html,body{margin:0;background:#050607;height:100%}video{width:100%;height:100%;object-fit:contain}</style>
</head><body><video muted playsinline preload="auto" src="../gpu-time-launch.mp4?review=${Date.now()}"></video></body></html>`,
);
const server = await createServer({
  root: resolve("video/output"),
  configFile: false,
  server: { host: "127.0.0.1", port: 0 },
  logLevel: "error",
});
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  await server.listen();
  const page = await browser.newPage({
    viewport: { width: 1920, height: 1080 },
  });
  await page.goto(server.resolvedUrls.local[0] + "review/player.html");
  const review = await page.evaluate(async () => {
    const video = document.querySelector("video");
    if (video.readyState < 2)
      await new Promise((resolve) =>
        video.addEventListener("loadeddata", resolve, { once: true }),
      );
    const segments = [];
    for (const [name, start, end] of [
      ["intro and tokenization", 0.5, 8],
      ["network assembly", 17.5, 24.5],
      ["raw-score growth", 25, 30],
      ["tokens to schedule", 31.5, 42],
    ]) {
      video.pause();
      video.currentTime = start;
      await new Promise((resolve) =>
        video.addEventListener("seeked", resolve, { once: true }),
      );
      const before = video.getVideoPlaybackQuality();
      const began = performance.now();
      await video.play();
      await new Promise((resolve) => {
        const onFrame = () => {
          if (video.currentTime >= end) resolve();
          else video.requestVideoFrameCallback(onFrame);
        };
        video.requestVideoFrameCallback(onFrame);
      });
      video.pause();
      const after = video.getVideoPlaybackQuality();
      segments.push({
        name,
        start,
        end,
        playbackRate: video.playbackRate,
        wallSeconds: (performance.now() - began) / 1000,
        totalFrames: after.totalVideoFrames - before.totalVideoFrames,
        droppedFrames: after.droppedVideoFrames - before.droppedVideoFrames,
      });
    }
    return {
      width: video.videoWidth,
      height: video.videoHeight,
      duration: video.duration,
      segments,
    };
  });
  writeFileSync(
    "video/output/review/playback.json",
    JSON.stringify(review, null, 2),
  );
  console.log(JSON.stringify(review, null, 2));
} finally {
  await browser.close();
  await server.close();
}

import { useEffect, useRef, useState } from "react";

const stamp = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

export function Video() {
  const player = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const seek = useRef<HTMLInputElement>(null);
  const [covered, setCovered] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [ended, setEnded] = useState(false);
  const [muted, setMuted] = useState(false);
  const [captions, setCaptions] = useState(false);
  const [full, setFull] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(91);
  const [error, setError] = useState("");

  async function play() {
    setError("");
    const element = video.current;
    if (!element) return;
    try {
      if (element.ended) element.currentTime = 0;
      await element.play();
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError")
        return;
      setError("The video could not start. Please try again.");
    }
  }

  useEffect(() => {
    const input = seek.current;
    if (!input) return;
    const scrub = () => {
      if (video.current) video.current.currentTime = Number(input.value);
    };
    input.addEventListener("input", scrub);
    return () => input.removeEventListener("input", scrub);
  }, []);

  function togglePlayback() {
    if (!video.current) return;
    if (video.current.paused) void play();
    else video.current.pause();
  }

  return (
    <>
      <div
        id="film-player"
        ref={player}
        className="overflow-hidden rounded-box border border-neutral-100 bg-white text-neutral-900 [&:fullscreen]:flex [&:fullscreen]:h-full [&:fullscreen]:w-full [&:fullscreen]:flex-col [&:fullscreen]:rounded-none [&:fullscreen]:border-none"
      >
        <div className="film-stage relative aspect-video [:fullscreen_&]:aspect-auto [:fullscreen_&]:min-h-0 [:fullscreen_&]:flex-1">
          <video
            id="film-video"
            ref={video}
            className="block h-full w-full bg-white object-contain"
            playsInline
            preload="none"
            poster="/media/poster.jpg?v=thumbnail-5"
            tabIndex={0}
            aria-label="How the gpu-time neural model works"
            onClick={togglePlayback}
            onPlaying={() => {
              if (covered) {
                setCovered(false);
                toggle.current?.focus();
              }
            }}
            onPlay={() => {
              setPlaying(true);
              setEnded(false);
            }}
            onPause={() => setPlaying(false)}
            onEnded={() => {
              setPlaying(false);
              setEnded(true);
            }}
            onLoadedMetadata={(event) => {
              const value = event.currentTarget.duration;
              if (Number.isFinite(value)) setDuration(value);
            }}
            onTimeUpdate={(event) => {
              const value = event.currentTarget.currentTime;
              setCurrent(value);
              if (seek.current) {
                seek.current.value = String(value);
                seek.current.style.setProperty(
                  "--progress",
                  `${(value / (event.currentTarget.duration || 91)) * 100}%`,
                );
              }
            }}
            onVolumeChange={(event) => setMuted(event.currentTarget.muted)}
            onKeyDown={(event) => {
              const element = event.currentTarget;
              if (event.key === " " || event.key === "Enter") {
                event.preventDefault();
                togglePlayback();
              }
              if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
                event.preventDefault();
                if (Number.isFinite(element.duration))
                  element.currentTime = Math.max(
                    0,
                    Math.min(
                      element.duration,
                      element.currentTime +
                        (event.key === "ArrowRight" ? 5 : -5),
                    ),
                  );
              }
            }}
          >
            <source
              src="/media/gpu-time-neural.mp4?v=chicago-4"
              type="video/mp4"
            />
            <track
              kind="captions"
              src="/media/captions.vtt"
              srcLang="en"
              label="English"
            />
          </video>
          {covered && (
            <button
              id="film-play"
              type="button"
              aria-label="Play the neural model walkthrough"
              onClick={() => void play()}
              className="absolute inset-0 grid w-full cursor-pointer place-items-center bg-white"
            >
              <img
                src="/media/poster.jpg?v=thumbnail-5"
                width="1920"
                height="1080"
                alt=""
                fetchPriority="high"
                className="absolute inset-0 h-full w-full object-contain"
              />
              <span className="relative grid size-12 place-items-center rounded-full bg-black text-white">
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path d="M6 3.5 16 10 6 16.5Z" />
                </svg>
              </span>
            </button>
          )}
        </div>

        <div
          role="group"
          aria-label="Video controls"
          className="film-controls flex h-12 items-center gap-2 border-t border-neutral-100 px-2 sm:px-3 [:fullscreen_&]:shrink-0"
        >
          <button
            id="film-toggle"
            ref={toggle}
            type="button"
            onClick={togglePlayback}
            aria-label={ended ? "Replay" : playing ? "Pause" : "Play"}
            className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-[calc(var(--radius-box)/2)] hover:bg-neutral-100 aria-pressed:bg-neutral-100"
          >
            {playing ? (
              <svg
                width="16"
                height="16"
                viewBox="0 0 20 20"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M5 4h3v12H5zm7 0h3v12h-3z" />
              </svg>
            ) : (
              <svg
                width="16"
                height="16"
                viewBox="0 0 20 20"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M6 3.5 16 10 6 16.5Z" />
              </svg>
            )}
          </button>

          <input
            id="film-seek"
            ref={seek}
            type="range"
            min={0}
            max={duration}
            step={0.1}
            defaultValue={0}
            aria-label="Seek video"
            aria-valuetext={`${stamp(current)} of ${stamp(duration)}`}
            className="min-w-8 flex-1 cursor-pointer appearance-none bg-transparent [--progress:0%] [&::-moz-range-progress]:h-0.5 [&::-moz-range-progress]:bg-neutral-900 [&::-moz-range-thumb]:size-2 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-neutral-900 [&::-moz-range-track]:h-0.5 [&::-moz-range-track]:bg-neutral-100 [&::-webkit-slider-runnable-track]:h-0.5 [&::-webkit-slider-runnable-track]:bg-[linear-gradient(to_right,#171717_var(--progress),#e5e5e5_var(--progress))] [&::-webkit-slider-thumb]:-mt-[3px] [&::-webkit-slider-thumb]:size-2 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-neutral-900"
          />

          <span className="shrink-0 text-[11px] tabular-nums text-neutral-500">
            {stamp(current)}
            <span aria-hidden="true"> / </span>
            {stamp(duration)}
          </span>

          <button
            id="film-mute"
            type="button"
            aria-label={muted ? "Unmute" : "Mute"}
            aria-pressed={muted}
            onClick={() => {
              if (video.current) video.current.muted = !video.current.muted;
            }}
            className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-[calc(var(--radius-box)/2)] hover:bg-neutral-100 aria-pressed:bg-neutral-100"
          >
            <svg
              width="17"
              height="17"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="m11 5-6 4H2v6h3l6 4z" />
              {muted ? (
                <path d="m16 9 6 6m0-6-6 6" />
              ) : (
                <path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" />
              )}
            </svg>
          </button>

          <button
            id="film-captions"
            type="button"
            aria-label={captions ? "Hide captions" : "Show captions"}
            aria-pressed={captions}
            onClick={() => {
              const track = video.current?.textTracks[0];
              if (!track) return;
              const show = track.mode !== "showing";
              track.mode = show ? "showing" : "disabled";
              setCaptions(show);
            }}
            className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-[calc(var(--radius-box)/2)] hover:bg-neutral-100 aria-pressed:bg-neutral-100 text-[11px] font-medium"
          >
            CC
          </button>

          <button
            id="film-fullscreen"
            type="button"
            aria-label={full ? "Exit fullscreen" : "Enter fullscreen"}
            onClick={async () => {
              try {
                if (document.fullscreenElement) {
                  await document.exitFullscreen();
                  setFull(false);
                } else if (player.current?.requestFullscreen) {
                  await player.current.requestFullscreen();
                  setFull(true);
                } else {
                  (
                    video.current as HTMLVideoElement & {
                      webkitEnterFullscreen?: () => void;
                    }
                  )?.webkitEnterFullscreen?.();
                }
              } catch {
                setError("Fullscreen is unavailable in this browser.");
              }
            }}
            className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-[calc(var(--radius-box)/2)] hover:bg-neutral-100 aria-pressed:bg-neutral-100"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M7 3H3v4m10-4h4v4M3 13v4h4m10-4v4h-4" />
            </svg>
          </button>
        </div>
      </div>
      <p
        id="film-error"
        role="status"
        className="mt-3 text-sm text-neutral-500"
        hidden={!error}
      >
        {error}
      </p>
    </>
  );
}

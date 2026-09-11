import { highlight } from "../lib/demo";

export function Mark({ text }: { text: string }) {
  return (
    <>
      {highlight(text).map((part, index) =>
        part.kind ? (
          <span
            key={index}
            className={`hl rounded-[3px] text-neutral-900 ${
              part.kind === "date"
                ? "bg-date ring-2 ring-date"
                : part.kind === "time"
                  ? "bg-time ring-2 ring-time"
                  : part.kind === "repeat"
                    ? "bg-repeat ring-2 ring-repeat"
                    : "bg-duration ring-2 ring-duration"
            }`}
          >
            {part.text}
          </span>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </>
  );
}

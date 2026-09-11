import { examples } from "../lib/demo";
import { Mark } from "./Mark";

export function Examples() {
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {examples.map((item) => (
        <li key={item.text}>
          <button
            type="button"
            data-phrase={item.text}
            className="demo-example h-full w-full rounded-box border border-neutral-100 bg-neutral-50 px-3 py-2.5 text-left transition-colors hover:border-neutral-200 hover:bg-white"
            onClick={() =>
              window.dispatchEvent(
                new CustomEvent("demo:example", { detail: item.text }),
              )
            }
          >
            <span className="block text-label font-medium uppercase text-neutral-500">
              {item.use}
            </span>
            <span className="mt-1.5 block text-sm leading-[1.6] tracking-[-0.1px]">
              <Mark text={item.text} />
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

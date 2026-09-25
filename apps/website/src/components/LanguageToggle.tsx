import { clsx } from "cn";

export type Language = "en" | "es";

type LanguageToggleProps = {
  value: Language;
  onChange: (value: Language) => void;
};

const languages: Language[] = ["en", "es"];

export function LanguageToggle(props: LanguageToggleProps) {
  const { value, onChange } = props;

  return (
    <div
      className="flex items-center gap-1"
      role="group"
      aria-label="Input language"
    >
      {languages.map((language) => (
        <button
          key={language}
          type="button"
          aria-pressed={value === language}
          onClick={() => onChange(language)}
          className={clsx(
            "rounded-md px-2 py-0.5 text-label font-medium uppercase transition-colors",
            value === language
              ? "bg-neutral-900 text-white"
              : "text-neutral-500 hover:text-neutral-900",
          )}
        >
          {language}
        </button>
      ))}
    </div>
  );
}

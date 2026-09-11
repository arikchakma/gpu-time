export interface Window {
  start: string;
  end?: string;
}

export interface Normalized {
  occurrences: Window[] | null;
  rrules: string[] | null;
  abstained: boolean;
  limitation?: string;
}

export interface Adapter {
  parse(text: string): unknown | Promise<unknown>;
  parseMany?(texts: string[]): Promise<unknown[]>;
  normalize(value: any): Normalized;
  dispose?(): void;
}

export const reference = "2026-09-09T12:00:00+06:00";
export const timeZone = "Asia/Dhaka";
export const limit = 12;

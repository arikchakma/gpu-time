declare module "@breejs/later" {
  const later: {
    date: { localTime(): void };
    parse: { text(text: string): { schedules: unknown[]; error: number } };
    schedule(value: unknown): { next(count: number, date: Date): Date[] | 0 };
  };
  export default later;
}

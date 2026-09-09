type SyntaxClassName =
  | "plain"
  | "comment"
  | "string"
  | "number"
  | "keyword"
  | "type"
  | "function"
  | "constant"
  | "operator";

interface SyntaxSpan {
  type: SyntaxClassName;
  start: number;
  end: number;
}

export declare function parse(
  code: string,
): Promise<SyntaxSpan[]>;

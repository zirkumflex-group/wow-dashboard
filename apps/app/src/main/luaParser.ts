function isAsciiWhitespace(value: string | undefined): boolean {
  return value === " " || value === "\t" || value === "\n" || value === "\r";
}

function isAsciiDigit(value: string | undefined): boolean {
  if (!value) return false;
  const code = value.charCodeAt(0);
  return code >= 48 && code <= 57;
}

export class LuaParser {
  private pos = 0;

  constructor(private readonly src: string) {}

  parseFile(): Record<string, unknown> | null {
    const match = this.src.match(/WowDashboardDB\s*=\s*/);
    if (!match || match.index === undefined) return null;
    this.pos = match.index + match[0].length;
    return this.parseValue() as Record<string, unknown>;
  }

  private skip(): void {
    while (this.pos < this.src.length) {
      const current = this.src[this.pos];
      if (isAsciiWhitespace(current)) {
        this.pos += 1;
      } else if (current === "-" && this.src[this.pos + 1] === "-") {
        while (this.pos < this.src.length && this.src[this.pos] !== "\n") {
          this.pos += 1;
        }
      } else {
        break;
      }
    }
  }

  private parseValue(): unknown {
    this.skip();
    const current = this.src[this.pos];
    if (current === "{") return this.parseTable();
    if (current === '"') return this.parseString();
    if (current === "-" || isAsciiDigit(current)) return this.parseNumber();
    if (this.src.startsWith("true", this.pos)) {
      this.pos += 4;
      return true;
    }
    if (this.src.startsWith("false", this.pos)) {
      this.pos += 5;
      return false;
    }
    if (this.src.startsWith("nil", this.pos)) {
      this.pos += 3;
      return null;
    }
    throw new Error(
      `Unexpected token at ${this.pos}: "${this.src.slice(this.pos, this.pos + 30)}"`,
    );
  }

  private parseTable(): unknown[] | Record<string, unknown> {
    this.pos += 1;
    const dictionary: Record<string, unknown> = {};
    const array: unknown[] = [];
    let isDictionary = false;

    while (true) {
      this.skip();
      if (this.src[this.pos] === "}") {
        this.pos += 1;
        break;
      }
      if (this.src[this.pos] === ",") {
        this.pos += 1;
        continue;
      }

      if (this.src[this.pos] === "[" && this.src[this.pos + 1] === '"') {
        isDictionary = true;
        this.pos += 2;
        const end = this.src.indexOf('"', this.pos);
        if (end < 0) throw new Error(`Unterminated table key at ${this.pos}`);
        const key = this.src.slice(this.pos, end);
        this.pos = end + 1;
        this.skip();
        if (this.src[this.pos] !== "]") throw new Error(`Expected ] at ${this.pos}`);
        this.pos += 1;
        this.skip();
        if (this.src[this.pos] !== "=") throw new Error(`Expected = at ${this.pos}`);
        this.pos += 1;
        dictionary[key] = this.parseValue();
      } else {
        array.push(this.parseValue());
      }
    }

    return isDictionary ? dictionary : array;
  }

  private parseString(): string {
    this.pos += 1;
    let result = "";
    let segmentStart = this.pos;

    while (this.pos < this.src.length) {
      const current = this.src[this.pos];
      if (current === '"') {
        result += this.src.slice(segmentStart, this.pos);
        this.pos += 1;
        return result;
      }
      if (current === "\\") {
        result += this.src.slice(segmentStart, this.pos);
        this.pos += 1;
        const escaped = this.src[this.pos];
        if (escaped === undefined) break;
        result += escaped === "n" ? "\n" : escaped === "t" ? "\t" : escaped;
        this.pos += 1;
        segmentStart = this.pos;
      } else {
        this.pos += 1;
      }
    }

    throw new Error(`Unterminated string at ${segmentStart - 1}`);
  }

  private parseNumber(): number {
    const start = this.pos;
    if (this.src[this.pos] === "-") this.pos += 1;

    const integerStart = this.pos;
    while (isAsciiDigit(this.src[this.pos])) this.pos += 1;
    if (this.pos === integerStart) throw new Error(`Expected number at ${start}`);

    if (this.src[this.pos] === ".") {
      this.pos += 1;
      while (isAsciiDigit(this.src[this.pos])) this.pos += 1;
    }

    const value = Number(this.src.slice(start, this.pos));
    if (!Number.isFinite(value)) throw new Error(`Invalid number at ${start}`);
    return value;
  }
}

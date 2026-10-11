/** Draws each entry once per randomized cycle; avoids a repeat at cycle boundaries. */
export class ShuffleBag<T> {
  private unused: T[] = [];
  private previous?: T;

  constructor(private readonly all: readonly T[], private readonly random = Math.random) {}

  next(): T | undefined {
    if (!this.unused.length) this.unused = [...this.all];
    if (!this.unused.length) return undefined;

    const withoutPrevious = this.unused.length > 1
      ? this.unused.filter(item => item !== this.previous) : this.unused;
    const choices = withoutPrevious.length ? withoutPrevious : this.unused;
    const index = Math.max(0, Math.min(choices.length - 1, Math.floor(this.random() * choices.length)));
    const value = choices[index];
    this.unused.splice(this.unused.indexOf(value), 1);
    this.previous = value;
    return value;
  }
}

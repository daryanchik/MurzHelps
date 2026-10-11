/** A late renderer acknowledgment must never undo a dismissal. */
export class VisibilityState {
  revision = 0;
  readyRevision = -1;
  wanted = true;

  invalidate(): number { this.readyRevision = -1; return ++this.revision; }
  acknowledge(revision: number): boolean {
    if (!Number.isSafeInteger(revision) || revision !== this.revision || revision === this.readyRevision) return false;
    this.readyRevision = revision;
    return true;
  }
  dismiss(): void { this.wanted = false; }
  summon(): void { this.wanted = true; }
  get shouldShow(): boolean { return this.wanted && this.readyRevision === this.revision; }
}

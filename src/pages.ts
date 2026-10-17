// Remembers which photos are already in the ledger, so re-reading one can be caught.
// Only a SHA-256 fingerprint of the resized image is stored, never the photo.

const KEY = "khatalens.pages.v1";

export async function fingerprint(base64: string): Promise<string> {
  const bytes = new TextEncoder().encode(base64);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export class PageRegistry {
  private list: string[];

  constructor() {
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
      this.list = Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
    } catch {
      this.list = [];
    }
  }

  /** Page number (1-based) if this photo was read before, else 0. */
  pageOf(fp: string): number {
    return this.list.indexOf(fp) + 1;
  }

  /** Records a read and returns its page number. */
  add(fp: string): number {
    this.list.push(fp);
    this.save();
    return this.list.length;
  }

  clear(): void {
    this.list = [];
    this.save();
  }

  private save(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.list));
    } catch {
      // storage blocked; duplicate detection lasts for this visit
    }
  }
}

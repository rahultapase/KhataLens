// Shop settings, saved in localStorage.

export interface Settings {
  shop: string;
  upi: string;
}

const KEY = "khatalens.settings.v1";
export const DEFAULT_SHOP = "Sharma General Store";

export function loadSettings(): Settings {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Settings>;
    return {
      shop: typeof s.shop === "string" ? s.shop : DEFAULT_SHOP,
      upi: typeof s.upi === "string" ? s.upi : "",
    };
  } catch {
    return { shop: DEFAULT_SHOP, upi: "" };
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Storage blocked; settings last for this visit only.
  }
}

/** UPI VPA shape: handle@bank, e.g. sharmastore@okaxis. */
export function isValidUpi(id: string): boolean {
  return /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z][a-zA-Z0-9]{1,63}$/.test(id.trim());
}

export function shopName(s: Settings): string {
  return s.shop.trim() || DEFAULT_SHOP;
}

export function upiLink(id: string, shop: string, amount: number): string {
  // encodeURIComponent (not URLSearchParams) so spaces become %20, not "+",
  // which some UPI apps show literally.
  const e = encodeURIComponent;
  return `upi://pay?pa=${e(id.trim())}&pn=${e(shop)}&am=${amount.toFixed(2)}&cu=INR`;
}

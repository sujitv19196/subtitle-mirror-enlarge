/** Per-device display preferences, persisted to localStorage when available. */
export interface Settings {
  size: number;
  font: "atkinson" | "lexend" | "system" | "serif" | "mono";
  weight: "400" | "700" | "800";
  theme: "dark" | "amber" | "light" | "cream";
  lineHeight: number;
  letterSpacing: number;
  position: "top" | "center" | "bottom";
  align: "center" | "start";
  holdLast: boolean;
  showSigns: boolean;
  showSongs: boolean;
}

export const DEFAULTS: Settings = {
  size: 44,
  font: "atkinson",
  weight: "700",
  theme: "dark",
  lineHeight: 1.3,
  letterSpacing: 0.01,
  position: "center",
  align: "center",
  holdLast: false,
  showSigns: true,
  showSongs: true,
};

const KEY = "submirror.settings.v1";

const FONT_STACKS: Record<Settings["font"], string> = {
  atkinson: "'Atkinson Hyperlegible', system-ui, sans-serif",
  lexend: "Lexend, system-ui, sans-serif",
  system: "system-ui, -apple-system, sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
  mono: "ui-monospace, Menlo, monospace",
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {}
  return { ...DEFAULTS };
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {}
}

export function applySettings(s: Settings): void {
  const root = document.documentElement;
  root.dataset.theme = s.theme;
  root.dataset.position = s.position;
  root.dataset.align = s.align;
  root.dataset.signs = String(s.showSigns);
  root.dataset.songs = String(s.showSongs);
  root.style.setProperty("--size", `${s.size}px`);
  root.style.setProperty("--font", FONT_STACKS[s.font]);
  root.style.setProperty("--weight", s.weight);
  root.style.setProperty("--lh", String(s.lineHeight));
  root.style.setProperty("--ls", `${s.letterSpacing}em`);
  const bg = getComputedStyle(root).getPropertyValue("--bg").trim();
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", bg || "#000");
}

/** Two-way binds the settings form; returns a function that re-syncs the form. */
export function bindForm(form: HTMLFormElement, get: () => Settings, set: (s: Settings) => void): () => void {
  const sync = () => {
    const s = get();
    for (const [k, v] of Object.entries(s)) {
      const els = form.querySelectorAll<HTMLInputElement>(`[name="${k}"]`);
      els.forEach((el) => {
        if (el.type === "radio") el.checked = el.value === String(v);
        else if (el.type === "checkbox") el.checked = Boolean(v);
        else el.value = String(v);
      });
    }
    out("size-out", `${s.size}px`);
    out("lh-out", s.lineHeight.toFixed(2));
    out("ls-out", `${s.letterSpacing.toFixed(2)}em`);
  };

  form.addEventListener("input", (e) => {
    const el = e.target as HTMLInputElement;
    if (!el.name) return;
    const cur = get();
    const def = DEFAULTS[el.name as keyof Settings];
    let v: unknown = el.value;
    if (el.type === "checkbox") v = el.checked;
    else if (typeof def === "number") v = Number(el.value);
    set({ ...cur, [el.name]: v });
    sync();
  });

  sync();
  return sync;
}

function out(id: string, text: string) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

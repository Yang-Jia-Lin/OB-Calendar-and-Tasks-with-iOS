const key = "calendar-task-timer.appearance";
const sizes = [85, 90, 100, 110, 120, 130, 145, 160];
type Appearance = { theme: "light" | "dark"; size: number };

function read(): Appearance {
  try {
    const saved = JSON.parse(localStorage.getItem(key) || "{}");
    return { theme: saved.theme === "dark" ? "dark" : "light", size: sizes.includes(saved.size) ? saved.size : 100 };
  } catch { return { theme: "light", size: 100 }; }
}

let appearance = read();
function apply() {
  document.documentElement.dataset.theme = appearance.theme;
  document.documentElement.style.setProperty("--font-size", `${(appearance.size * 14) / 100}px`);
  const theme = document.querySelector<HTMLSelectElement>("#appearance-theme");
  const size = document.querySelector<HTMLSelectElement>("#appearance-size");
  if (theme) theme.value = appearance.theme;
  if (size) size.value = String(appearance.size);
}

function save(patch: Partial<Appearance>) {
  appearance = { ...appearance, ...patch };
  try { localStorage.setItem(key, JSON.stringify(appearance)); } catch { /* Apply for this session. */ }
  apply();
}

export function startAppearance() {
  apply();
  window.addEventListener("keydown", event => {
    if (!event.ctrlKey || event.altKey || event.metaKey || event.isComposing) return;
    const key = event.key;
    if (!["+", "=", "-", "0"].includes(key)) return;
    event.preventDefault();
    const step = key === "-" ? -1 : 1;
    const index = Math.max(0, Math.min(sizes.length - 1, sizes.indexOf(appearance.size) + step));
    save({ size: key === "0" ? 100 : sizes[index] });
  });
}

export function appearanceSettings() {
  const section = document.createElement("section");
  section.className = "appearance-settings";
  const heading = document.createElement("h2");
  heading.textContent = "外观";
  section.append(heading);
  function field(id: string, name: string, options: [string, string][], value: string, change: (value: string) => void) {
    const label = document.createElement("label"), select = document.createElement("select");
    select.id = id;
    label.append(name, select);
    for (const [value, text] of options) select.add(new Option(text, value));
    select.value = value; select.onchange = () => change(select.value);
    section.append(label);
  }
  field("appearance-theme", "主题", [["light", "日间"], ["dark", "夜间"]], appearance.theme, theme => save({ theme: theme === "dark" ? "dark" : "light" }));
  field("appearance-size", "字体大小", sizes.map(size => [String(size), `${size}%`]), String(appearance.size), size => save({ size: Number(size) }));
  const help = document.createElement("p");
  help.textContent = "Ctrl + 加号放大，Ctrl + 减号缩小，Ctrl + 0 恢复默认";
  section.append(help);
  return section;
}

export function mountDiaryButton(root: HTMLElement, path: string, update: (path: string) => Promise<{ count: number; changed: boolean }>) {
  root.classList.add("ctt-diary-controls");
  const button = root.ownerDocument.createElement("button"), status = root.ownerDocument.createElement("span");
  button.type = "button"; button.textContent = "更新时间轴";
  status.className = "ctt-diary-status"; status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
  root.append(button, status);
  let disposed = false;
  const click = async () => {
    if (button.disabled || disposed) return;
    button.disabled = true; status.textContent = "正在生成日记快照…";
    try { const result = await update(path); if (!disposed) status.textContent = `${result.changed ? "已更新" : "内容已是最新快照"}，共 ${result.count} 项`; }
    catch (e) { if (!disposed) status.textContent = `未更新：${e instanceof Error ? e.message : String(e)}`; }
    finally { if (!disposed) button.disabled = false; }
  };
  button.addEventListener("click", click);
  return () => { disposed = true; button.removeEventListener("click", click); };
}

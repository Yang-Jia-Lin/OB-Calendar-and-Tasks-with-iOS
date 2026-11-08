interface SidebarWorkspace {
  detachLeavesOfType(type: string): void;
}
/** Run after layout restoration; never touch the current-note properties pane. */
export function applySidebar(workspace: SidebarWorkspace, enabled: boolean) {
  if(enabled)for(const type of ["backlink", "all-properties"])workspace.detachLeavesOfType(type);
}

/** CSS also covers buttons registered after layout restoration, without polling. */
export function mountRibbonVisibility(doc: Document, enabled: boolean) {
  const labels = ["Templater", "Open Git source control", "AI 对话（新标签页）", "Insert Callout"];
  const style = doc.createElement("style");
  style.textContent = labels.map(label => `.workspace-ribbon:is(.mod-left, .mod-primary) .side-dock-ribbon-action[aria-label="${label}"]`).join(",\n") + " { display: none !important; }";
  doc.head.append(style);
  const setEnabled = (value: boolean) => { style.disabled = !value; };
  setEnabled(enabled);
  return { setEnabled, dispose: () => style.remove() };
}

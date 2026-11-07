interface SidebarWorkspace {
  detachLeavesOfType(type: string): void;
}
/** Run after layout restoration; never touch the current-note properties pane. */
export function applySidebar(workspace: SidebarWorkspace, enabled: boolean) {
  if(enabled)for(const type of ["backlink", "all-properties"])workspace.detachLeavesOfType(type);
}

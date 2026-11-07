import { ComponentsTimerButtons } from "../Clients/Obsidian/componentsButtons";
import { toggleNoteTimer } from "../Clients/Obsidian/components";
import type { TaskRef, TimerApi } from "../Clients/Obsidian/api";

/** Opt-in native DOM fixture, based on the inspected Components 3.1.260826 structure. */
export function componentsFixture(api: TimerApi, bindings: Record<string, TaskRef>, canWake=false) {
  const style = document.createElement("style");
  style.textContent = `
    #ctt-native-fixture { position:fixed;top:65px;left:20px;width:900px;max-width:calc(100vw - 40px);z-index:30;background:var(--background-primary);border:1px solid var(--background-modifier-border);padding:12px;box-shadow:0 8px 30px #0002; }
    #ctt-native-fixture .fixture-cards { display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px; }
    #ctt-native-fixture .components--DynamicDataView-PageCard { position:relative;min-width:0;border:1px solid var(--background-modifier-border);border-radius:10px; }
    #ctt-native-fixture .components--DynamicDataView-PageCardContent { padding-block:8px; }
    #ctt-native-fixture .components--DynamicDataView-PageContextMenu { position:absolute;top:4px;right:4px;z-index:3;display:flex;width:60px;height:24px;background:var(--background-primary);opacity:0; }
    #ctt-native-fixture .components--DynamicDataView-PageCard:hover .components--DynamicDataView-PageContextMenu { opacity:1; }
    #ctt-native-fixture .components--DynamicDataView-PageContextMenu button { width:30px;height:24px;padding:0; }

    #ctt-native-fixture .components--DynamicDataView-PageTitle { display:flex;align-items:center;padding-inline:8px;overflow:hidden;font-size:14px;line-height:1.4; }
    #ctt-native-fixture .components--DynamicDataView-PageTitleLink { width:100%;overflow:hidden; }
    #ctt-native-fixture .components--DynamicDataView-PageTitle a { color:var(--text-normal);text-decoration:none;white-space:nowrap; }
    #ctt-native-fixture .components--DynamicDataView-PagePropertyList { display:flex;flex-direction:column;gap:2px;padding:4px 8px; }
    #ctt-native-fixture .ctt-components-timer-header > .components--DynamicDataView-PagePropertyList { display:contents; }
    #ctt-native-fixture .components--DynamicDataView-Button { display:inline-flex;position:relative; }
    #ctt-native-fixture .components--DynamicDataView-ButtonLabel { display:flex;align-items:center;padding:4px 8px;min-width:30px;border-radius:4px;border:1px solid var(--background-modifier-border);cursor:pointer;font-size:13px; }
  `;
  document.head.append(style);
  const root = document.createElement("aside"); root.id = "ctt-native-fixture";
  root.innerHTML = `<div class="fixture-cards">${[["research.md", "视频感知优化"], ["reading.md", "Paper Reading"]].map(([path, title]) => `
    <div class="components--DynamicDataView-PageCard" data-note="${path}"><div class="components--DynamicDataView-PageContextMenu"><button aria-label="编辑">✎</button><button aria-label="更多">⋯</button></div><div class="components--DynamicDataView-PageCardContent">
      <div class="components--DynamicDataView-PageTitle"><div class="components--DynamicDataView-PageTitleLink"><a class="internal-link" data-href="${path}" href="${path}">${title}</a></div></div>
      <div class="components--DynamicDataView-PagePropertyList">
        <div class="components--DynamicDataView-PageProperty components--DynamicDataView-PageProperty_button"><div class="components--DynamicDataView-PageProperty-Value" aria-label="开始计时"><span class="components--DynamicDataView-Button"><div class="components--DynamicDataView-ButtonLabel">开始计时</div></span></div></div>
        <div class="components--DynamicDataView-PageProperty"><p>课题中的原有任务列表</p><p>□ 继续研究工作</p></div>
      </div>
    </div></div>`).join("")}</div>`;
  document.body.append(root);
  const counts = { escapedClicks: 0, toggleCalls:0 }; root.addEventListener("click", () => { counts.escapedClicks++; });
  const toggle = (note: string, expected: string | null) => {counts.toggleCalls++;return toggleNoteTimer(note, expected, {
    state: () => api.getState(), binding: note => bindings[note], start: note => api.start(bindings[note],{source:"components",path:note}), finish: id => api.finish(id, false)
  });};
  const manager = new ComponentsTimerButtons(document, { api, canWake, binding: note => bindings[note], toggle });
  manager.setScopes([{ root, labels: new Set(["开始计时"]) }]);
  return { root, manager, counts, toggle, dispose: () => { manager.dispose(); root.remove(); style.remove(); } };
}

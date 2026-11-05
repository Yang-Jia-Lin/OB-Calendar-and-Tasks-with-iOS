import type { Journal } from "../../Shared/contracts";
import type { SyncView } from "../../Shared/sync";
import { isMissingResource } from "../../Shared/contracts";
export const syncKey = (id: string) => /^(work|event|delete|reminder):/.test(id) ? id : `work:${id}`;
export function pendingView(state: Journal, sync?: SyncView) {
  const items = [
    ...state.records.filter(r => r.status !== "saved").map(r => ({ id: r.id, key: `work:${r.id}`, title: r.edit?.title || r.title, value: r, canKeep: !r.edit && r.completeTask && !r.taskSaved && r.segments.every(p => p.saved), canResolveMissing: false })),
    ...state.operations.filter(o => o.status !== "saved").map(o => ({ id: `event:${o.id}`, key: `event:${o.id}`, title: o.title, value: o, canKeep: false, canResolveMissing: false })),
    ...(state.deletions || []).filter(o => o.status !== "saved").map(o => ({ id: `delete:${o.id}`, key: `delete:${o.id}`, title: `删除 · ${o.title}`, value: o, canKeep: false, canResolveMissing: isMissingResource(o.error) }))
  ];
  return items.map(({ value, ...item }) => {
    const working = sync?.activeKey === item.key;
    const status = working ? sync?.waiting ? "等待云端响应，本地操作仍可继续" : "正在同步" :
      value.sync?.issue === "auth" ? "等待日历授权" : value.sync?.issue === "conflict" ? "需要核对" :
      value.sync?.issue === "network" ? "等待自动重试" : value.error ? "上次同步失败，请手动重试" : "本机已保存，等待同步";
    return { ...item, working, status, error: value.error ? `上次同步错误：${value.error}` : "" };
  });
}

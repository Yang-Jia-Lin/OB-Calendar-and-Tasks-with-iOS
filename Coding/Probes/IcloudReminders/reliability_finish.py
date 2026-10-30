"""Verify user-performed iPad changes, then clean only this reliability run."""
from datetime import datetime, timezone
import json
import time

from cleanup_owned import deleted_on_server
from diagnose_readonly import restore_session
from probe import OUTPUT, PRIVATE, ProbeStop, ensure_owned, save_json
from reliability import Conflict, guarded_update


def main():
    report = json.loads((OUTPUT / "reliability-status.json").read_text(encoding="utf-8"))
    path = PRIVATE / f"reliability-{report['run_id']}.json"
    manifest = json.loads(path.read_text(encoding="utf-8"))

    def publish():
        report["updated_at"] = datetime.now(timezone.utc).isoformat()
        save_json(OUTPUT / "reliability-status.json", report)

    def check(name, passed, evidence):
        report["checks"].append({"name": name, "result": "pass" if passed else "fail", "evidence": evidence})
        publish()
        print(("PASS " if passed else "FAIL ") + name, flush=True)
        if not passed:
            raise ProbeStop("External observation differs; preserve samples, stop cleanup")

    try:
        api = restore_session(manifest)
        service = api.reminders
        modified = next(row for row in manifest["created"] if row["alias"] == "iPad修改")
        removed = next(row for row in manifest["created"] if row["alias"] == "iPad删除")
        report["phase"] = "verifying_ipad_external_changes"
        publish()
        deadline = time.monotonic() + 120
        while True:
            current = service.get(modified["id"])
            removed_ok = deleted_on_server(service, removed["id"])
            renamed_ok = current.title == modified["title"] + "X"
            if renamed_ok and removed_ok or time.monotonic() >= deadline:
                break
            time.sleep(5)
        check("iPad 原生改名按相同 ID 读回", renamed_ok,
              "live_native_ipad_change_after_explicit_user_confirmation")
        check("iPad 原生删除可被电脑识别", removed_ok,
              "live_native_ipad_delete_after_explicit_user_confirmation")
        old_snapshot = current.model_copy(deep=True)
        old_snapshot.title = modified["title"]
        blocked = False
        try:
            guarded_update(service, manifest, old_snapshot, completed=True)
        except Conflict:
            blocked = True
        check("iPad 修改后探针拒绝旧快照覆盖", blocked,
              "live_native_change_compared_with_old_title_snapshot")

        deleted_snapshot = current.model_copy(deep=True)
        deleted_snapshot.id = removed["id"]
        deleted_snapshot.title = removed["title"]
        blocked = False
        try:
            guarded_update(service, manifest, deleted_snapshot, completed=True)
        except (ProbeStop, LookupError):
            blocked = True
        check("iPad 删除后拒绝编辑且不复活", blocked and deleted_on_server(service, removed["id"]),
              "live_native_delete_with_probe_guard_no_create")

        report["phase"] = "cleaning_owned_reliability_samples"
        publish()
        for row in manifest["created"]:
            if deleted_on_server(service, row["id"]):
                row["state"] = "deleted_confirmed"
                save_json(path, manifest)
                continue
            item = service.get(row["id"])
            ensure_owned(manifest, row["id"], item)
            manifest["last_intent"] = {"action": "delete", "id": row["id"]}
            save_json(path, manifest)
            report["cloud_write_api_attempts"] += 1
            publish()
            service.delete(item)
            check(row["alias"] + " 清理后服务端确认", deleted_on_server(service, row["id"]),
                  "owned_id_only_server_delete_readback")
            row["state"] = "deleted_confirmed"
            save_json(path, manifest)
        retained = [item for item in service.reminders(list_id=manifest["list_id"])
                    if not item.deleted and item.title == "ICT-设备验证"]
        check("原手工设备验证任务仍保留", len(retained) == 1, "readonly_list_lookup")
        report["phase"] = "controlled_reliability_batch_complete"
        report["cleanup"] = "four_owned_samples_server_confirmed_deleted_original_manual_task_retained"
        report["adoption"] = "核心读写和本轮受控异常验证通过；隔日、复杂字段与产品集成仍待验收"
        report["not_tested"] = ["隔日会话", "真实认证到期", "物理网络中断", "产品离线队列与升级恢复",
                                "复杂原生字段和重复任务/子任务保护实测", "分页与游标失效", "最终组件打包"]
        publish()
    except Exception as exc:
        report["phase"] = "stopped_requires_review"
        report["error_type"] = type(exc).__name__
        publish()
    print(json.dumps({key: report.get(key) for key in
                      ("phase", "error_type", "cleanup", "cloud_write_api_attempts", "adoption")}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

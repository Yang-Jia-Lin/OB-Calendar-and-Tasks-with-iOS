"""Finish this run after explicit user confirmation of the iPad title formatting."""
import json
from datetime import datetime, timezone

from diagnose_readonly import restore_session
from probe import OUTPUT, PRIVATE, ProbeStop, ensure_owned, save_json


def deleted_on_server(service, item_id):
    from pyicloud.services.reminders.client import RemindersApiError
    try:
        return service.get(item_id).deleted
    except LookupError:
        return True
    except RemindersApiError as exc:
        # Only the exact queried record's explicit missing result counts.
        payload = exc.payload
        if (isinstance(payload, list) and len(payload) == 1
                and payload[0].get("recordName") == item_id
                and payload[0].get("serverErrorCode") == "UNKNOWN_ITEM"):
            return True
        raise


def main():
    summary = json.loads((OUTPUT / "status.json").read_text(encoding="utf-8"))
    archive = OUTPUT / "status-before-title-format-confirmation.json"
    if not archive.exists():
        save_json(archive, summary)
    try:
        paths = list(PRIVATE.glob("run-*.json"))
        if len(paths) != 1:
            raise ProbeStop("Original run must be unambiguous")
        manifest_path = paths[0]
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        rows = manifest["created"]
        if len(rows) != 4 or len({row.get("id") for row in rows}) != 4 or not all(row.get("id") for row in rows):
            raise ProbeStop("Original four object identities required")
        api = restore_session(manifest)
        service = api.reminders
        target = next(row for row in rows if row["alias"] == "C 时刻")
        fresh = service.get(target["id"])
        ensure_owned(manifest, target["id"], fresh)
        expected = f"ICT-iPad改名-{manifest['run_id']}"
        letters = lambda value: "".join(c for c in value.casefold() if c.isalnum())
        if not fresh.completed or letters(fresh.title) != letters(expected):
            raise ProbeStop("Latest sample differs from user-confirmed state; no cleanup")
        for row in summary["checks"]:
            if row["name"] == "iPad 改名与完成可读回电脑" and row["result"] == "fail":
                row["resolved"] = True
                row["resolution"] = "user_confirmed_deliberate_title_separator_difference"
        summary["checks"].append({"name": "iPad 实际改名与完成读回（核对更正）", "result": "pass",
                                  "evidence": "server_readback_and_explicit_user_title_format_confirmation"})
        summary.pop("stop_reason", None)
        summary.pop("error_type", None)
        summary["phase"] = "cleaning_only_original_owned_samples"
        save_json(OUTPUT / "status.json", summary)
        for row in rows:
            item = service.get(row["id"])
            if item.deleted:
                row["state"] = "deleted_confirmed"
                save_json(manifest_path, manifest)
                continue
            ensure_owned(manifest, row["id"], item)
            manifest["last_intent"] = {"action": "delete", "id": row["id"]}
            save_json(manifest_path, manifest)
            summary["cloud_write_attempts"] += 1
            save_json(OUTPUT / "status.json", summary)
            service.delete(item)
            if not deleted_on_server(service, row["id"]):
                raise ProbeStop("Delete not confirmed; stop without repeating")
            row["state"] = "deleted_confirmed"
            save_json(manifest_path, manifest)
            summary["checks"].append({"name": row["alias"] + " 删除后服务端核对", "result": "pass",
                                      "evidence": "server_readback_deleted_or_exact_record_not_found"})
            save_json(OUTPUT / "status.json", summary)
        manual = [item for item in service.reminders(list_id=manifest["list_id"])
                  if not item.deleted and item.title == "ICT-设备验证"]
        summary["checks"].append({"name": "手工设备验证任务仍保留", "result": "pass" if len(manual) == 1 else "needs_review",
                                  "evidence": "readonly_list_lookup"})
        summary["phase"] = "waiting_ipad_delete_observation"
        summary["cleanup"] = "four_owned_samples_server_deleted_ipad_observation_pending"
        summary["adoption"] = "核心双向往返初步可行；删除设备核对、隔日和交付验收待完成"
    except Exception as exc:
        summary["phase"] = "cleanup_stopped_requires_review"
        summary["error_type"] = type(exc).__name__
    summary["updated_at"] = datetime.now(timezone.utc).isoformat()
    save_json(OUTPUT / "status.json", summary)
    print(json.dumps({key: summary.get(key) for key in
                      ("phase", "cleanup", "error_type", "cloud_write_attempts", "adoption")}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

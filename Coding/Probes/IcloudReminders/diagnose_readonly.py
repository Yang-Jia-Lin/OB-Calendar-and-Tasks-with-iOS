"""Re-read only this probe's objects using its own saved session. No task writes."""
from datetime import datetime, timezone
import json

from probe import OUTPUT, PRIVATE, ProbeStop, SHA, save_json


def restore_session(manifest):
    from pyicloud import PyiCloudService

    directory = PRIVATE / "Sessions" / manifest["account_key"]
    sessions = list(directory.glob("*.session"))
    if len(sessions) != 1:
        raise ProbeStop("Expected exactly one session for this probe run")
    # PyiCloud names its session files after an alphanumeric account cache key.
    # This key reopens the same cookie jar; it is NEVER used for a password login.
    cache_key = sessions[0].stem
    api = PyiCloudService(cache_key, password="", cookie_directory=str(directory),
                         china_mainland=True, refresh_interval=None, with_family=False,
                         locate=False, authenticate=False)

    def refuse_auth(*args, **kwargs):
        raise ProbeStop("Cached session expired; local reauthentication required")

    api.authenticate = refuse_auth
    api.data = api._validate_token()  # Existing cookies only, no accountLogin fallback.
    api._update_state()
    return api


def main():
    report = {"kind": "readonly_after_failure", "upstream_commit": SHA,
              "checked_at": datetime.now(timezone.utc).isoformat(),
              "cloud_task_writes": 0, "items": []}
    try:
        paths = sorted(PRIVATE.glob("run-*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
        if not paths:
            raise ProbeStop("No existing run manifest")
        manifest = json.loads(paths[0].read_text(encoding="utf-8"))
        api = restore_session(manifest)
        report["cached_session_reused"] = True
        service = api.reminders
        for row in manifest["created"]:
            if not row.get("id"):
                report["items"].append({"alias": row["alias"], "result": "uncertain_id_not_resolved"})
                continue
            item = service.get(row["id"])
            if item.list_id != manifest["list_id"]:
                raise ProbeStop("Owned object changed list; stopped")
            report["items"].append({
                "alias": row["alias"], "completed": item.completed,
                "completion_date_present": item.completed_date is not None,
                "deleted": item.deleted,
                "due_kind": "none" if item.due_date is None else "date" if item.all_day else "time",
                "title_matches_computer_rename": item.title == f"ICT-电脑改名-{manifest['run_id']}",
                "title_matches_ipad_rename": item.title == f"ICT-iPad改名-{manifest['run_id']}",
                "title_matches_ipad_rename_trimmed": item.title.strip() == f"ICT-iPad改名-{manifest['run_id']}",
                "title_matches_ipad_rename_casefold_trimmed": item.title.strip().casefold() == f"ICT-iPad改名-{manifest['run_id']}".casefold(),
                "title_contains_ipad_prefix_casefold": "ict-ipad改名" in item.title.casefold(),
                "title_has_expected_run_suffix": item.title.strip().endswith(manifest["run_id"]),
                "title_starts_with_expected_test_prefix": item.title.strip().casefold().startswith("ict-"),
                "title_matches_ignoring_separators": "".join(c for c in item.title.casefold() if c.isalnum()) == "".join(c for c in f"ICT-iPad改名-{manifest['run_id']}".casefold() if c.isalnum()),
                "title_matches_extra_hyphen_between_ipad_and_rename": item.title == f"ICT-iPad-改名-{manifest['run_id']}",
                "title_contains_ipad_rename_prefix": "ICT-iPad改名" in item.title,
                "title_length": len(item.title),
                "expected_ipad_title_length": len(f"ICT-iPad改名-{manifest['run_id']}"),
                "record_change_tag_present": bool(item.record_change_tag),
            })
        report["result"] = "readback_complete"
    except Exception as exc:
        report["result"] = "stopped_without_writing"
        report["error_type"] = type(exc).__name__
    save_json(OUTPUT / "diagnosis-readonly.json", report)
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

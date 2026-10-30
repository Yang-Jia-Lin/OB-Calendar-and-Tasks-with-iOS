"""Read-only next-day observation. Does not schedule itself or log in with a password."""
from datetime import datetime, timedelta, timezone
import json
from zoneinfo import ZoneInfo

from diagnose_readonly import restore_session
from probe import OUTPUT, PRIVATE, ProbeStop, save_json


def main():
    result = {"cloud_task_writes": 0, "password_login_attempts": 0,
              "checked_at": datetime.now(timezone.utc).isoformat()}
    try:
        baseline = json.loads((OUTPUT / "reliability-status.json").read_text(encoding="utf-8"))
        zone = ZoneInfo("Asia/Shanghai")
        previous_day = datetime.fromisoformat(baseline["updated_at"]).astimezone(zone).date()
        today = datetime.now(zone).date()
        result["earliest_observation_date_beijing"] = (previous_day + timedelta(days=1)).isoformat()
        if today <= previous_day:
            result["result"] = "not_due_same_beijing_day"
        else:
            manifest = json.loads((PRIVATE / f"reliability-{baseline['run_id']}.json").read_text(encoding="utf-8"))
            api = restore_session(manifest)
            service = api.reminders
            exists = any(item.id == manifest["list_id"] and not item.deleted for item in service.lists())
            if not exists:
                raise ProbeStop("Test list no longer available; do not infer session failure")
            # Read only the known test list; do not export any titles or identities.
            rows = list(service.reminders(list_id=manifest["list_id"]))
            result["result"] = "next_day_cached_session_and_selected_list_read_pass"
            result["selected_list_read"] = True
            result["item_count"] = len(rows)
            result["limitations"] = "Read-only observation; no next-day write or real expiry coverage"
    except Exception as exc:
        result["result"] = "needs_review_without_password_fallback"
        result["error_type"] = type(exc).__name__
    save_json(OUTPUT / "overnight-status.json", result)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

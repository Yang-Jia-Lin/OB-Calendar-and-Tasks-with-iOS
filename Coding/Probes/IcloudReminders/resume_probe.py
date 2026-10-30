"""Continue the same owned samples after user confirmed hidden completed items."""
from datetime import datetime, timezone
import json
import time

from diagnose_readonly import restore_session
from probe import OUTPUT, PRIVATE, Probe, ProbeStop, ensure_owned, save_json


class ResumeProbe(Probe):
    def __init__(self):
        self.api = self.service = None
        previous = json.loads((OUTPUT / "status.json").read_text(encoding="utf-8"))
        archive = OUTPUT / "status-before-hidden-completed-confirmation.json"
        if not archive.exists():
            save_json(archive, previous)
        self.summary = previous
        self.summary.pop("stop_reason", None)
        self.summary.pop("error_type", None)
        self.summary["continuation"] = "same_owned_samples_no_new_create"
        self.summary["adoption"] = "核心往返继续验证中；不接入插件"
        self.manifest = None
        self.phase("restoring_existing_session")

    def login(self):
        paths = sorted(PRIVATE.glob("run-*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
        if len(paths) != 1:
            raise ProbeStop("需要唯一的原测试清单；停止，未创建任务。")
        self.manifest_path = paths[0]
        self.manifest = json.loads(paths[0].read_text(encoding="utf-8"))
        if len(self.manifest["created"]) != 4 or not all(row.get("id") for row in self.manifest["created"]):
            raise ProbeStop("原测试清单不完整，停止。")
        self.api = restore_session(self.manifest)
        self.service = self.api.reminders
        self.check("新进程复用既有可信会话", True, "cached_session_no_password_login")
        for check in self.summary["checks"]:
            if check["name"] == "电脑完成在 iPad 同步" and check["result"] == "fail":
                check["resolved"] = True
                check["resolution"] = "user_confirmed_completed_item_was_hidden"
        self.check("电脑完成在 iPad 同步（核查更正）", True,
                   "explicit_user_chat_confirmation_checked_circle_after_show_completed")
        print("已沿用原测试清单；不需要重新登录，也不会新建另一批样例。", flush=True)

    def wait_read(self, item_id, predicate, seconds=120):
        deadline = time.monotonic() + seconds
        print("正在等待 iPad 的修改上传并从服务端读回（最多 2 分钟）…", flush=True)
        while True:
            item = self.service.get(item_id)
            if predicate(item) or time.monotonic() >= deadline:
                return item
            time.sleep(5)

    def run_roundtrip(self):
        rows = self.manifest["created"]
        target = next(row for row in rows if row["alias"] == "C 时刻")
        item_id = target["id"]
        before = self.service.get(item_id)
        ensure_owned(self.manifest, item_id, before)
        self.check("重新读取原样例仍为已完成", before.completed)
        self.patch(item_id, completed=False)
        self.observe("电脑恢复在 iPad 同步", "请核对原来的“电脑改名”任务已恢复为未完成。")
        expected_title = f"ICT-iPad改名-{self.manifest['run_id']}"
        self.observe("iPad 执行反向修改",
                     f"请在 iPad 把刚恢复的任务改名为 {expected_title}，并勾选完成。")
        fresh = self.wait_read(item_id, lambda item: item.title == expected_title and item.completed)
        self.check("iPad 改名与完成可读回电脑", fresh.title == expected_title and fresh.completed)
        self.check("反向修改保留时刻与日期", fresh.due_date == before.due_date
                   and fresh.all_day == before.all_day and fresh.time_zone == before.time_zone)
        self.phase("waiting_cleanup")
        print("\n双向恢复／修改已通过。接下来只清理原来四条电脑样例，保留手工验证任务与列表。", flush=True)
        while True:
            choice = input("输入 y 清理四条样例；输入 s 保留：").strip().lower()
            if choice in {"y", "s"}:
                break
            print("请输入 y 或 s。", flush=True)
        if choice == "y":
            for row in rows:
                if row.get("state") == "deleted_confirmed":
                    continue
                item = self.service.get(row["id"])
                ensure_owned(self.manifest, row["id"], item)
                self.write_intent({"action": "delete", "id": row["id"]})
                self.service.delete(item)
                try:
                    deleted = self.service.get(row["id"]).deleted
                except LookupError:
                    deleted = True
                self.check(f"{row['alias']} 删除后服务端核对", deleted)
                row["state"] = "deleted_confirmed"
                self.journal()
            self.observe("电脑删除在 iPad 同步", "核对四条电脑样例已从正常列表消失；手动“设备验证”任务仍在。")
            self.summary["cleanup"] = "four_owned_tasks_deleted_and_observed"
        else:
            self.summary["cleanup"] = "retained_owned_test_tasks"
        self.summary["adoption"] = "核心双向往返初步可行；隔日、异常、复杂字段和交付验收未完成"
        self.phase("core_roundtrip_complete_not_full_acceptance")


if __name__ == "__main__":
    ResumeProbe().run()

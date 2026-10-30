"""Interactive, isolated Apple Reminders probe. No credentials in CLI arguments."""
from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
import getpass
import hashlib
import importlib.metadata
import inspect
import json
import logging
import os
from pathlib import Path
import sys
import uuid
from zoneinfo import ZoneInfo

SHA = "af5246511c729eee4d5a95671135ad75fdd77b22"
ROOT = Path(__file__).resolve().parents[3]
OUTPUT = ROOT / "Results" / "Probes" / "IcloudReminders"
PRIVATE = OUTPUT / ".private"
UPSTREAM = OUTPUT / "upstream" / f"pyicloud-{SHA}"
sys.path.insert(0, str(UPSTREAM))
logging.disable(logging.CRITICAL)  # Upstream errors can contain account/response data.


class ProbeStop(Exception):
    pass


def save_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(".tmp")
    with temp.open("w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temp, path)


def shape(item) -> dict:
    """Only ordinary fields needed by this test; never dump a full native record."""
    return {key: getattr(item, key) for key in (
        "id", "list_id", "title", "desc", "completed", "due_date", "all_day",
        "time_zone", "priority", "flagged", "deleted",
    )}


def ensure_owned(manifest: dict, item_id: str, item) -> None:
    registered = any(row.get("id") == item_id for row in manifest["created"])
    if not registered or item.id != item_id or item.list_id != manifest["list_id"]:
        raise ProbeStop("拒绝写入：对象不在本次创建清单中，或所属列表已变化。")
    if item.deleted or item.parent_reminder_id or item.recurrence_rule_ids:
        raise ProbeStop("拒绝写入：对象已删除，或是子任务／重复任务。")


def verify_due(item, kind: str, value=None) -> bool:
    if kind == "none":
        return item.due_date is None
    if item.due_date is None:
        return False
    if kind == "date":
        return item.all_day and item.due_date.date() == value.date()
    return (not item.all_day and item.due_date.tzinfo is not None
            and item.due_date.astimezone(timezone.utc) == value.astimezone(timezone.utc)
            and item.time_zone == "Asia/Shanghai")


def preflight() -> dict:
    from pyicloud import PyiCloudService
    from pyicloud.services.reminders.service import RemindersService
    from pyicloud.services.reminders.models import Reminder

    args = inspect.signature(RemindersService.create).parameters
    required = {"list_id", "title", "due_date", "all_day", "time_zone"}
    if not required.issubset(args):
        raise ProbeStop("候选版本接口不匹配，停止。")
    init_args = inspect.signature(PyiCloudService).parameters
    if not {"authenticate", "cookie_directory", "china_mainland", "refresh_interval"}.issubset(init_args):
        raise ProbeStop("候选版本认证接口不匹配，停止。")
    if not {"due_date", "all_day", "record_change_tag", "recurrence_rule_ids"}.issubset(Reminder.model_fields):
        raise ProbeStop("候选版本任务模型不匹配，停止。")
    dependencies = {d.metadata["Name"]: d.version for d in importlib.metadata.distributions()}
    result = {"upstream_commit": SHA, "python": sys.version.split()[0],
              "dependencies": dependencies, "imports_and_signatures": "pass",
              "account_access": "not_tested", "cloud_writes": 0}
    save_json(OUTPUT / "preflight.json", result)
    return result


class Probe:
    def __init__(self):
        self.manifest = None
        self.service = None
        self.api = None
        self.summary = {"upstream_commit": SHA, "phase": "waiting_local_login",
                        "checks": [], "cloud_write_attempts": 0,
                        "adoption": "未测；不接入插件"}
        self.publish()

    def publish(self):
        self.summary["updated_at"] = datetime.now(timezone.utc).isoformat()
        save_json(OUTPUT / "status.json", self.summary)

    def phase(self, value):
        self.summary["phase"] = value
        self.publish()

    def check(self, name, passed, evidence="server_readback"):
        self.summary["checks"].append({"name": name, "result": "pass" if passed else "fail",
                                        "evidence": evidence})
        self.publish()
        print(("[通过] " if passed else "[失败] ") + name, flush=True)
        if not passed:
            raise ProbeStop(f"{name} 未通过，停止自动写入。")

    def journal(self):
        save_json(self.manifest_path, self.manifest)

    def write_intent(self, action):
        self.manifest["last_intent"] = action
        self.journal()  # Failure here prevents the remote write.
        self.summary["cloud_write_attempts"] += 1
        self.publish()

    def observe(self, name, instruction):
        self.phase("waiting_ipad_observation")
        print("\n" + instruction, flush=True)
        while True:
            value = input("已核对且正确输入 y；不一致输入 n；尚未核对输入 s：").strip().lower()
            if value in {"y", "n", "s"}:
                break
            print("请输入 y、n 或 s；其他输入不作为测试失败。", flush=True)
        if value == "s":
            self.summary["checks"].append({"name": name, "result": "not_tested", "evidence": "ipad_not_observed"})
            self.publish()
            raise ProbeStop("iPad 尚未核对；保留专用样例，停止后续写入。")
        self.check(name, value == "y", "user_observed_on_ipad")

    def login(self):
        from pyicloud import PyiCloudService
        print("\nApple 提醒事项测试：登录信息仅在此本机终端输入，不发到聊天。")
        print("密码和验证码不回显。这里使用 Apple 账户密码，不是 CalDAV 应用专用密码。")
        username = input("Apple 账户：").strip()
        if not username:
            raise ProbeStop("未输入账户；没有发起认证。")
        china = input("Apple 账户地区是否为中国大陆？y/n：").strip().lower()
        if china not in {"y", "n"}:
            raise ProbeStop("地区未明确；没有发起认证。")
        account_key = hashlib.sha256(username.lower().encode()).hexdigest()[:20]
        cookie_dir = PRIVATE / "Sessions" / account_key
        cookie_dir.mkdir(parents=True, exist_ok=True)
        password = getpass.getpass("Apple 账户密码：")
        if not password:
            raise ProbeStop("未输入密码；没有发起认证。")
        self.phase("authenticating")
        self.api = PyiCloudService(username, password, cookie_directory=str(cookie_dir),
                                  china_mainland=china == "y", refresh_interval=None,
                                  with_family=False, locate=False, authenticate=False)
        password = None
        self.api.authenticate()
        if self.api.requires_2fa:
            if not self.api.request_2fa_code():
                raise ProbeStop("验证码请求未成功，停止；未更改账户安全设置。")
            code = getpass.getpass("在 Apple 设备确认登录后，输入验证码：")
            if not self.api.validate_2fa_code(code):
                raise ProbeStop("验证码未通过，停止。")
            code = None
            if not self.api.is_trusted_session:
                if not self.api.trust_session():
                    raise ProbeStop("会话信任未完成，停止。")
        elif self.api.requires_2sa:
            raise ProbeStop("账户使用旧两步验证；本探针未实现此流程，不能判定接口不可用。")
        self.check("本机账户认证", True, "authenticated_session")
        self.summary["region"] = "china_mainland" if china == "y" else "other"
        self.phase("read_only_discovery")
        self.service = self.api.reminders
        lists = [row for row in self.service.lists() if not row.deleted and not row.is_group]
        self.check("发现真实提醒事项列表", bool(lists))
        print("\n列表名称仅在这个本机窗口显示：")
        for row in lists:
            print("  " + row.title)
        prefix = "ICT-Verify-" + datetime.now(ZoneInfo("Asia/Shanghai")).strftime("%Y%m%d")
        print(f"\n请在 iPad 的 iCloud 提醒事项中新建普通专用列表，例如 {prefix}。")
        print("在里面手动建一条普通任务，标题为 ICT-设备验证；不要放真实任务。")
        name = input("输入该专用列表完整名称（必须以 ICT-Verify- 开头）：").strip()
        if not name.startswith("ICT-Verify-"):
            raise ProbeStop("不是专用测试列表；保持只读并停止。")
        lists = [row for row in self.service.lists() if row.title == name and not row.deleted and not row.is_group]
        if len(lists) != 1:
            raise ProbeStop("没有找到唯一的专用列表；请先确认 iPad 与 iCloud 同步。")
        target = lists[0]
        rows = list(self.service.reminders(list_id=target.id))
        matches = [row for row in rows if row.title == "ICT-设备验证" and not row.deleted]
        self.check("读到 iPad 新建的真实任务", len(matches) == 1)
        self.observe("iPad 确认读到同一任务", "确认刚才手动创建的 ICT-设备验证 位于同名 iCloud 列表中。")
        run_id = uuid.uuid4().hex[:10]
        self.manifest = {"run_id": run_id, "account_key": account_key,
                         "list_id": target.id, "created": [], "last_intent": None}
        self.manifest_path = PRIVATE / f"run-{run_id}.json"
        self.journal()

    def create(self, alias, **fields):
        self.phase("testing_owned_tasks")
        row = {"alias": alias, "id": None, "state": "create_intent"}
        self.manifest["created"].append(row)
        self.write_intent({"action": "create", "alias": alias})
        try:
            item = self.service.create(list_id=self.manifest["list_id"], **fields)
        except Exception:
            row["state"] = "uncertain_creation_no_auto_retry"
            self.journal()
            raise ProbeStop("创建结果不确定：不自动重复创建，不按标题自动清理；请保留测试列表供核对。") from None
        row.update(id=item.id, state="created")
        self.journal()
        fresh = self.service.get(item.id)
        ensure_owned(self.manifest, item.id, fresh)
        self.check(f"{alias} 创建后服务端重读", fresh.title == fields["title"])
        return fresh

    def patch(self, item_id, **fields):
        old = self.service.get(item_id)
        ensure_owned(self.manifest, item_id, old)
        current = self.service.get(item_id)
        if shape(old) != shape(current) or old.record_change_tag != current.record_change_tag:
            raise ProbeStop("对象在读取后变化，停止覆盖；此检查不保证消除提交瞬间的竞争。")
        for key, value in fields.items():
            setattr(current, key, value)
        self.write_intent({"action": "update", "id": item_id, "fields": list(fields)})
        self.service.update(current)
        fresh = self.service.get(item_id)
        ensure_owned(self.manifest, item_id, fresh)
        self.check("任务更新后身份不变", fresh.id == item_id)
        for key, value in fields.items():
            self.check(f"更新字段 {key} 服务端重读", getattr(fresh, key) == value)
        return fresh

    def run_roundtrip(self):
        zone = ZoneInfo("Asia/Shanghai")
        tomorrow = datetime.now(zone).date() + timedelta(days=1)
        all_day = datetime(tomorrow.year, tomorrow.month, tomorrow.day, tzinfo=timezone.utc)
        timed = datetime(tomorrow.year, tomorrow.month, tomorrow.day, 15, 20, tzinfo=zone)
        suffix = self.manifest["run_id"]
        common = {"desc": "仅用于接口验证；请勿添加个人内容。", "priority": 5}
        a = self.create("A 无日期", title=f"ICT-无日期-{suffix}", **common)
        b = self.create("B 日期", title=f"ICT-仅日期-{suffix}", due_date=all_day, all_day=True, **common)
        c = self.create("C 时刻", title=f"ICT-中文🧪-{suffix}", due_date=timed,
                        time_zone="Asia/Shanghai", **common)
        d = self.create("D 同标题不同身份", title=a.title, **common)
        self.check("同标题任务身份独立", a.id != d.id)
        self.check("无日期语义", verify_due(a, "none"))
        self.check("仅日期语义", verify_due(b, "date", all_day))
        self.check("具体时刻与时区语义", verify_due(c, "time", timed))
        self.observe("电脑新建任务在 iPad 可见且日期正确",
                     f"请在 iPad 列表核对四条任务：两条同标题无日期、一条明天仅日期、\n"
                     f"一条明天上海时间 15:20（标题含🧪）。运行标记 {suffix}。")
        updated = self.patch(c.id, title=f"ICT-电脑改名-{suffix}")
        self.check("改标题保留日期、备注和优先级",
                   verify_due(updated, "time", timed) and updated.desc == common["desc"] and updated.priority == 5)
        self.patch(c.id, completed=True)
        self.observe("电脑完成在 iPad 同步", "在 iPad 显示已完成任务，核对 ICT-电脑改名 已完成。")
        self.patch(c.id, completed=False)
        self.observe("电脑恢复在 iPad 同步", "核对同一条任务已恢复为未完成。")
        title = f"ICT-iPad改名-{suffix}"
        self.observe("iPad 执行反向修改", f"请在 iPad 把 ICT-电脑改名 改为 {title}，然后勾选完成。")
        fresh = self.service.get(c.id)
        self.check("iPad 改名与完成可读回电脑", fresh.title == title and fresh.completed)
        self.check("iPad 修改后日期未漂移", verify_due(fresh, "time", timed))
        self.phase("waiting_cleanup")
        print("\n核心往返已完成。后续仅删除本次电脑创建的四条任务，保留设备验证任务及列表。")
        if input("输入 y 清理四条测试任务，其他输入保留供检查：").strip().lower() == "y":
            for row in self.manifest["created"]:
                item = self.service.get(row["id"])
                ensure_owned(self.manifest, row["id"], item)
                self.write_intent({"action": "delete", "id": row["id"]})
                self.service.delete(item)
                try:
                    check = self.service.get(row["id"])
                    deleted = check.deleted
                except LookupError:
                    deleted = True
                self.check("专用任务删除后服务端核对", deleted)
                row["state"] = "deleted_confirmed"
                self.journal()
            self.observe("电脑删除在 iPad 同步", "核对本次四条电脑任务已从正常列表消失；手动设备验证任务仍在。")
        else:
            self.summary["cleanup"] = "retained_owned_test_tasks"
        self.summary["adoption"] = "核心往返初步可行；重启、隔日、异常和交付验收未完成"
        self.phase("core_roundtrip_complete_not_full_acceptance")

    def run(self):
        try:
            self.login()
            self.run_roundtrip()
        except (KeyboardInterrupt, EOFError):
            self.summary["stop_reason"] = "user_cancelled_or_input_closed"
            self.phase("stopped_requires_review")
        except ProbeStop as exc:
            print("\n" + str(exc), flush=True)
            self.summary["stop_reason"] = str(exc)
            self.summary["adoption"] = "尚未验收；按 stop_reason 核查，不接入插件"
            self.phase("stopped_requires_review")
        except Exception as exc:
            # Never print str(exc) or a traceback: upstream may embed raw account data.
            safe_type = type(exc).__name__
            print(f"\n已停止，错误类型：{safe_type}。未输出账户响应；不会自动重发写入。", flush=True)
            self.summary["error_type"] = safe_type
            self.phase("error_requires_review")
        finally:
            self.api = self.service = None
        print("\n脱敏结果已保存。会话和创建对象清单保存在仅当前用户可访问的私有目录。", flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--preflight", action="store_true")
    args = parser.parse_args()
    preflight()
    if args.preflight:
        print("Preflight PASS: imports, API signatures, Due model; no account access.")
    else:
        Probe().run()


if __name__ == "__main__":
    main()

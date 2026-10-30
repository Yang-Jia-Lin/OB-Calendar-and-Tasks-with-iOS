"""Controlled fault injection plus live conflict tests, restricted to probe objects."""
from contextlib import contextmanager
from datetime import datetime, timezone
import json
import time
import uuid

from cleanup_owned import deleted_on_server
from diagnose_readonly import restore_session
from probe import OUTPUT, PRIVATE, ProbeStop, ensure_owned, save_json, shape
from requests import ConnectionError, ReadTimeout, Response


@contextmanager
def transport_fault(session, *, route, mode, capture=None):
    original = session.send
    evidence = {"matches": 0, "forwarded": 0}

    def send(request, **kwargs):
        if route not in request.url:
            return original(request, **kwargs)
        evidence["matches"] += 1
        if mode == "offline":
            raise ConnectionError("Injected offline before transport")
        if mode == "timeout_before":
            raise ReadTimeout("Injected timeout before transport")
        if mode != "response_lost":
            raise ValueError("Unsupported injection mode")
        if capture:
            capture(json.loads(request.body))  # Persist known wire identity before forwarding.
        evidence["forwarded"] += 1
        response = original(request, **kwargs)
        response.raise_for_status()
        raise ReadTimeout("Injected lost response after server acknowledgement")

    session.send = send
    try:
        yield evidence
    finally:
        session.send = original


class Conflict(ProbeStop):
    pass


def guarded_update(service, manifest, snapshot, **patch):
    current = service.get(snapshot.id)
    ensure_owned(manifest, snapshot.id, current)
    if current.record_change_tag != snapshot.record_change_tag or shape(current) != shape(snapshot):
        raise Conflict("Remote version changed; reopen before editing")
    for key, value in patch.items():
        setattr(current, key, value)
    service.update(current)
    return service.get(current.id)


class Reliability:
    def __init__(self):
        originals = list(PRIVATE.glob("run-*.json"))
        if len(originals) != 1:
            raise ProbeStop("Exactly one original account/list scope required")
        original = json.loads(originals[0].read_text(encoding="utf-8"))
        self.key = uuid.uuid4().hex[:6]
        self.manifest_path = PRIVATE / f"reliability-{self.key}.json"
        self.manifest = {"run_id": self.key, "account_key": original["account_key"],
                         "list_id": original["list_id"], "created": [], "last_intent": None}
        self.report = {"run_id": self.key, "phase": "starting", "checks": [],
                       "cloud_write_api_attempts": 0, "manual_tasks": [],
                       "scope": "dedicated_list_only; simulated_faults_labelled; no_system_network_change"}
        self.journal()
        self.publish()
        self.api = restore_session(original)
        self.service = self.api.reminders
        self.original = original
        self.check("复用既有会话", True, "live_session_validation")

    def journal(self):
        save_json(self.manifest_path, self.manifest)

    def publish(self):
        self.report["updated_at"] = datetime.now(timezone.utc).isoformat()
        save_json(OUTPUT / "reliability-status.json", self.report)

    def check(self, name, passed, evidence, **details):
        self.report["checks"].append({"name": name, "result": "pass" if passed else "fail",
                                      "evidence": evidence, **details})
        self.publish()
        print(("PASS " if passed else "FAIL ") + name, flush=True)

    def intent(self, action, **data):
        self.manifest["last_intent"] = {"action": action, **data}
        self.journal()
        self.report["cloud_write_api_attempts"] += 1
        self.publish()

    def create(self, alias, *, loss=False):
        title = f"ICT-可靠性-{alias}-{self.key}"
        row = {"alias": alias, "id": None, "state": "intent", "title": title}
        self.manifest["created"].append(row)
        self.intent("create", alias=alias)
        if not loss:
            created = self.service.create(list_id=self.manifest["list_id"], title=title,
                                          desc="独立接口可靠性测试，请勿添加个人内容。", priority=5)
            row.update(id=created.id, state="created")
            self.journal()
            return self.service.get(created.id)

        def capture(payload):
            ops = payload.get("operations", [])
            if len(ops) != 1 or ops[0].get("operationType") != "create":
                raise ProbeStop("Unexpected write payload; blocked")
            record = ops[0].get("record", {})
            ident = record.get("recordName", "")
            if not ident.startswith("Reminder/"):
                raise ProbeStop("Unexpected identity; blocked")
            row.update(id=ident, state="prepared_before_transport")
            self.journal()

        error = None
        with transport_fault(self.api.session, route="/records/modify", mode="response_lost", capture=capture) as fault:
            try:
                self.service.create(list_id=self.manifest["list_id"], title=title, priority=5)
            except Exception as exc:
                error = type(exc).__name__
        if not row.get("id"):
            raise ProbeStop("Creation did not expose a persisted wire identity; stop, no retry")
        fresh = self.service.get(row["id"])
        row["state"] = "created_confirmed_after_lost_response"
        self.journal()
        self.check("新建响应丢失后按预存原 ID 确认，不重建", bool(error) and fault["matches"] == 1
                   and fault["forwarded"] == 1 and fresh.title == title,
                   "live_commit_plus_simulated_response_loss", error_type=error, **fault)
        return fresh

    def run(self):
        try:
            self.report["phase"] = "automated_fault_tests"
            self.publish()
            sample = self.create("故障样例")
            error = None
            with transport_fault(self.api.session, route="/records/lookup", mode="offline") as fault:
                try:
                    self.service.get(sample.id)
                except Exception as exc:
                    error = type(exc).__name__
            self.check("模拟断网读取明确失败且不自动重试", bool(error) and fault["matches"] == 1,
                       "transport_fault_before_network", error_type=error, **fault)
            self.check("恢复传输后可重新读回原任务", self.service.get(sample.id).id == sample.id,
                       "live_read_after_fault_removed")

            for mode in ("offline", "timeout_before"):
                before = self.service.get(sample.id)
                to_write = before.model_copy(deep=True)
                to_write.completed = True
                self.intent("update", id=sample.id, fault=mode)
                error = None
                with transport_fault(self.api.session, route="/records/modify", mode=mode) as fault:
                    try:
                        self.service.update(to_write)
                    except Exception as exc:
                        error = type(exc).__name__
                after = self.service.get(sample.id)
                self.check(f"模拟 {mode} 写入失败不冒充成功且云端未变",
                           bool(error) and fault["matches"] == 1 and shape(after) == shape(before),
                           "before_send_fault_and_live_readback", error_type=error, **fault)

            current = self.service.get(sample.id)
            current.completed = True
            self.intent("update", id=sample.id, fault="response_lost")
            error = None
            with transport_fault(self.api.session, route="/records/modify", mode="response_lost") as fault:
                try:
                    self.service.update(current)
                except Exception as exc:
                    error = type(exc).__name__
            after = self.service.get(sample.id)
            self.check("修改响应丢失后确认云端已提交，不重复修改", bool(error) and after.completed
                       and fault["matches"] == 1 and fault["forwarded"] == 1,
                       "live_commit_plus_simulated_response_loss", error_type=error, **fault)
            self.create("丢响应新建", loss=True)

            # Feed 401 into the CloudKit transport without changing real cookies/session files.
            original_post = self.api.session.post
            auth_calls = []
            def expired(url, *args, **kwargs):
                if "/records/lookup" not in url:
                    return original_post(url, *args, **kwargs)
                auth_calls.append(1)
                response = Response()
                response.status_code = 401
                response._content = b'{"error":"simulated_session_expired"}'
                response.headers["Content-Type"] = "application/json"
                return response
            self.api.session.post = expired
            error = None
            try:
                self.service.get(sample.id)
            except Exception as exc:
                error = type(exc).__name__
            finally:
                self.api.session.post = original_post
            self.check("模拟 401 被识别为认证错误并停止", error == "RemindersAuthError" and len(auth_calls) == 1,
                       "simulated_cloudkit_401_not_real_session_expiry", error_type=error)
            self.check("模拟失效未破坏真实会话", self.service.get(sample.id).id == sample.id,
                       "live_read_after_simulation")

            # A second independently validated client supplies real cloud version changes.
            other_api = restore_session(self.original)
            other = other_api.reminders
            stale = self.service.get(sample.id)
            external = other.get(sample.id)
            external.priority = 9
            self.intent("external_client_update", id=sample.id)
            other.update(external)
            rejected = False
            try:
                guarded_update(self.service, self.manifest, stale, completed=False)
            except Conflict:
                rejected = True
            self.check("外部版本改变后，探针守卫拒绝覆盖", rejected and self.service.get(sample.id).priority == 9,
                       "two_live_clients_with_precondition_guard")

            stale.completed = False
            self.intent("stale_update_CAS_test", id=sample.id)
            error = None
            try:
                self.service.update(stale)
            except Exception as exc:
                error = type(exc).__name__
            fresh = self.service.get(sample.id)
            self.check("服务端拒绝过期版本写入", bool(error) and fresh.priority == 9 and fresh.completed,
                       "live_stale_record_change_tag", error_type=error)

            stale = self.service.get(sample.id)
            self.intent("external_client_delete", id=sample.id)
            other.delete(other.get(sample.id))
            rejected = False
            try:
                guarded_update(self.service, self.manifest, stale, completed=False)
            except (ProbeStop, LookupError):
                rejected = True
            self.check("外部删除后拒绝编辑且不复活任务", rejected and deleted_on_server(self.service, sample.id),
                       "live_external_client_delete_and_guard")
            next(row for row in self.manifest["created"] if row["id"] == sample.id)["state"] = "deleted_confirmed"
            self.journal()

            for alias in ("iPad修改", "iPad删除"):
                created = self.create(alias)
                self.report["manual_tasks"].append({"alias": alias, "title": created.title})
            self.report["phase"] = "waiting_ipad_external_changes"
            self.report["limitations"] = ["模拟断网/超时/401，不是物理断网或真实会话过期",
                                            "新建幂等依赖探针发送前持久化 wire ID，不能直接套用高层 create API",
                                            "产品离线队列与真实插件仍未实现或验收", "隔日会话需要隔日观察"]
            self.publish()
        except Exception as exc:
            self.report["phase"] = "stopped_requires_review"
            self.report["error_type"] = type(exc).__name__
            self.publish()
        print(json.dumps(self.report, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    Reliability().run()

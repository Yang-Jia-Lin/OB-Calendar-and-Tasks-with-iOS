"""Pinned pyicloud adapter. NDJSON over private stdio; never log account payloads."""
from __future__ import annotations
import contextlib
from datetime import datetime, timezone
import hashlib
import json
import logging
from pathlib import Path
import shutil
import sys
import uuid
import time
from unittest.mock import patch
from zoneinfo import ZoneInfo

logging.disable(logging.CRITICAL)
ROOT = Path(sys.argv[1]).resolve() if len(sys.argv)>1 else Path.cwd()
SDK = ROOT / "sdk" / "pyicloud-af5246511c729eee4d5a95671135ad75fdd77b22"
sys.path.insert(0, str(SDK))

class AdapterError(Exception):
    pass

def atomic(file, value):
    file.parent.mkdir(parents=True, exist_ok=True)
    tmp=file.with_name(file.name+".tmp")
    with tmp.open("w",encoding="utf-8") as stream:
        json.dump(value,stream,ensure_ascii=False);stream.flush()
        import os
        os.fsync(stream.fileno())
    tmp.replace(file)

def is_missing(exc):
    return "NOT_FOUND" in str(exc) or "not found" in str(exc).lower()

def due_fields(task):
    value=task.get("dueInstant")
    if value is not None:
        return {"due_date":datetime.fromtimestamp(value/1000,timezone.utc),"all_day":False,"time_zone":task.get("dueZone") or "UTC"}
    date=task.get("due")
    return {"due_date":datetime.fromisoformat(date).replace(tzinfo=timezone.utc) if date else None,"all_day":bool(date),"time_zone":None}

class Adapter:
    def __init__(self):
        self.api=None;self.account="";self.last_items={};self.children=set()

    def meta(self):
        file=ROOT/"private"/"connection.json"
        return json.loads(file.read_text(encoding="utf-8")) if file.exists() else None

    def connect(self,args):
        from pyicloud import PyiCloudService
        imported=args.get("importDir")
        if imported:
            directory=Path(imported).resolve()
            manifests=sorted(directory.glob("run-*.json"),key=lambda p:p.stat().st_mtime,reverse=True)
            if not manifests:raise AdapterError("没有可导入的已验证会话。")
            manifest=json.loads(manifests[0].read_text(encoding="utf-8"));account=manifest["account_key"]
            if not account.isalnum():raise AdapterError("会话账户标识无效。")
            src=directory/"Sessions"/account;target=ROOT/"private"/"sessions"/account
            sessions=list(src.glob("*.session"))
            if len(sessions)!=1:raise AdapterError("已有会话不完整。")
            target.mkdir(parents=True,exist_ok=True)
            for file in src.iterdir():
                if file.is_file() and file.suffix in {".session",".cookies",".cookiejar",".json"}:
                    shutil.copy2(file,target/file.name)
            meta={"accountId":account,"cacheKey":sessions[0].stem,"china":args.get("china",True)}
        elif args.get("username"):
            account=hashlib.sha256(args["username"].strip().lower().encode()).hexdigest()[:20]
            meta={"accountId":account,"cacheKey":args["username"].strip(),"china":args.get("china",True)}
        else:
            meta=self.meta()
            if not meta:raise AdapterError("请先连接 iCloud 提醒事项。")
        existing=self.meta()
        if existing and existing["accountId"]!=meta["accountId"]:raise AdapterError("当前数据属于另一个账户，本版不能直接切换。")
        directory=ROOT/"private"/"sessions"/meta["accountId"];directory.mkdir(parents=True,exist_ok=True)
        api=PyiCloudService(meta["cacheKey"],password=args.get("password", ""),cookie_directory=str(directory),china_mainland=meta["china"],refresh_interval=None,with_family=False,locate=False,authenticate=False)
        sender=api.session.send
        def bounded_send(request,**kwargs):
            if kwargs.get("timeout") is None:kwargs["timeout"]=(15,40)
            return sender(request,**kwargs)
        api.session.send=bounded_send
        self.api=api;self.account=meta["accountId"]
        if args.get("password"):
            api.authenticate()
            if api.requires_2fa:
                if not api.request_2fa_code():raise AdapterError("验证码请求失败，请重试连接。")
                self.pending_meta=meta
                return {"accountId":self.account,"needsCode":True}
            if api.requires_2sa:raise AdapterError("此账户的旧两步认证暂不支持。")
        else:
            api.authenticate=lambda *a,**k: (_ for _ in ()).throw(AdapterError("登录会话已失效，请重新连接。"))
            api.data=api._validate_token();api._update_state()
        if not args.get("password"): pass
        elif not api.is_trusted_session:api.trust_session()
        sessions=list(directory.glob("*.session"))
        if len(sessions)!=1:raise AdapterError("登录会话未保存，请重新连接。")
        meta["cacheKey"]=sessions[0].stem;atomic(ROOT/"private"/"connection.json",meta)
        return {"accountId":self.account,"needsCode":False}

    def code(self,args):
        if not self.api or not hasattr(self,"pending_meta"):raise AdapterError("没有等待验证的登录。")
        if not self.api.validate_2fa_code(args.get("code","")):raise AdapterError("验证码不正确。")
        if not self.api.is_trusted_session and not self.api.trust_session():raise AdapterError("会话信任失败。")
        meta=self.pending_meta;directory=ROOT/"private"/"sessions"/meta["accountId"]
        sessions=list(directory.glob("*.session"))
        if len(sessions)!=1:raise AdapterError("登录会话未保存。")
        meta["cacheKey"]=sessions[0].stem;atomic(ROOT/"private"/"connection.json",meta);del self.pending_meta
        return {"accountId":self.account,"needsCode":False}

    def service(self,account=None):
        if not self.api:self.connect({})
        if account and account!=self.account:raise AdapterError("提醒事项账户身份不符。")
        if hasattr(self,"pending_meta"):raise AdapterError("请先完成登录验证码。")
        return self.api.reminders

    def item(self,r):
        due=None;instant=None
        if r.due_date:
            if r.all_day:due=r.due_date.date().isoformat()
            else:
                instant=int(r.due_date.timestamp()*1000)
                due=r.due_date.astimezone(ZoneInfo(r.time_zone or "UTC")).date().isoformat()
        reason="周期任务，请在提醒事项中编辑／完成" if r.recurrence_rule_ids else "子任务，请在提醒事项中编辑／完成" if r.parent_reminder_id else "包含子任务，请在提醒事项中编辑／完成" if r.id in self.children else "原生文本无法解码，保留原内容" if r.undecodable_text_fields else ""
        return {"id":r.id,"listId":r.list_id,"title":r.title,"description":r.desc,"completed":r.completed,"deleted":r.deleted,"due":due or "","dueInstant":instant,"dueZone":r.time_zone,"completedAt":int(r.completed_date.timestamp()*1000) if r.completed_date else None,"revision":r.record_change_tag,"kind":"reminder","path":"icloud:"+self.account,"accountId":self.account,"parentId":r.parent_reminder_id,"readonlyReason":reason}

    def snapshot(self,args):
        service=self.service(args.get("accountId"));lists=[l for l in service.lists() if not l.deleted and not l.is_group]
        full=not args.get("cursor");rows=[];deleted=[]
        # Obtain the cursor BEFORE reading. Changes during paging are replayed, never skipped.
        cursor=service.sync_cursor()
        if not full:
            try:
                for change in service.iter_changes(since=args["cursor"]):
                    if change.type=="deleted":deleted.append(change.reminder_id)
                    elif change.reminder:rows.append(change.reminder)
            except Exception as exc:
                if "token" in str(exc).lower() or "zone" in str(exc).lower():full=True
                else:raise
        if full:
            rows=list(service.reminders());deleted=[];self.last_items={r.id:r for r in rows if not r.deleted}
        else:
            for ident in deleted:self.last_items.pop(ident,None)
            for r in rows:
                if r.deleted:self.last_items.pop(r.id,None);deleted.append(r.id)
                else:self.last_items[r.id]=r
        self.children={r.parent_reminder_id for r in self.last_items.values() if r.parent_reminder_id}
        return {"full":full,"lists":[{"id":l.id,"name":l.title,"color":l.color} for l in lists],"items":[self.item(r) for r in rows if not r.deleted],"deleted":deleted,"cursor":cursor}

    def assert_ordinary(self,service,r):
        # Recheck native structure at write time, including parents that acquired children.
        children=any(x.parent_reminder_id==r.id and not x.deleted for x in service.reminders(list_id=r.list_id))
        if r.recurrence_rule_ids or r.parent_reminder_id or children:raise AdapterError("复杂周期／子任务不允许修改或完成。")
        if r.undecodable_text_fields:raise AdapterError("原生文本无法解码，拒绝写入。")

    def create(self,args):
        from pyicloud.common.cloudkit.models import CKModifyOperation
        from pyicloud.services.reminders._writes import _assert_modify_success
        service=self.service(args.get("accountId"));op=args["op"];task=op["task"];ident=task["id"]
        if not ident.startswith("Reminder/"):raise AdapterError("创建身份无效。")
        uuid_value=uuid.UUID(ident.split("/",1)[1]);journal=ROOT/"private"/"creates"/(str(uuid_value)+".json")
        desired={k:task.get(k) for k in ["id","title","listId","description","completed","due","dueInstant","dueZone"]}
        if journal.exists():
            payload=json.loads(journal.read_text(encoding="utf-8"))
            if payload["desired"]!=desired:raise AdapterError("创建意图已变化，拒绝重放。")
        else:
            raw=service._writes._get_raw();original=raw.modify
            class Prepared(Exception): pass
            def capture(*,operations,zone_id,**kwargs):
                if len(operations)!=1 or operations[0].operationType!="create" or operations[0].record.recordName!=ident:raise AdapterError("创建请求身份不符。")
                body=operations[0].model_dump(mode="json",exclude_none=False)
                if task.get("completed") and not task.get("completedAt"):body["record"]["fields"]["CompletionDate"]={"type":"TIMESTAMP","value":None}
                atomic(journal,{"desired":desired,"operation":body,"zone":zone_id.model_dump(mode="json") if hasattr(zone_id,"model_dump") else zone_id});raise Prepared()
            raw.modify=capture
            try:
                with patch("pyicloud.services.reminders._writes.uuid.uuid4",return_value=uuid_value):
                    try:service.create(list_id=task["listId"],title=task["title"],desc=task.get("description") or "",completed=bool(task.get("completed")),**due_fields(task))
                    except Prepared:pass
            finally:raw.modify=original
            if not journal.exists():raise AdapterError("创建请求未能持久化，已停止。")
            payload=json.loads(journal.read_text(encoding="utf-8"))
        try:
            found=service.get(ident)
            if found.deleted:raise AdapterError("此任务已在远端删除，停止后台重建。")
            view=self.item(found)
            if view["title"]!=task["title"] or view["listId"]!=task["listId"] or view["completed"]!=bool(task.get("completed")) or (view.get("description") or "")!=(task.get("description") or "") or (view.get("dueInstant") or None)!=(task.get("dueInstant") or None) or (view.get("due") or "")!=(task.get("due") or ""):raise AdapterError("同一 ID 已存在不同内容，发生冲突。")
            return {"task":view}
        except Exception as exc:
            if not is_missing(exc):raise
        from pyicloud.common.cloudkit.models import CKZoneIDReq
        operation=CKModifyOperation.model_validate(payload["operation"])
        response=service._writes._get_raw().modify(operations=[operation],zone_id=CKZoneIDReq.model_validate(payload["zone"]))
        _assert_modify_success(response,"Create reminder")
        return {"task":self.item(service.get(ident))}

    def mutate(self,args,delete=False):
        service=self.service(args.get("accountId"));op=args["op"];before=op.get("before") or op["task"];ident=op["task"]["id"]
        try:r=service.get(ident)
        except Exception as exc:
            if delete and is_missing(exc):return {"deleted":True}
            raise
        if r.deleted:
            if delete:return {"deleted":True}
            raise AdapterError("提醒事项已在远端删除。")
        self.assert_ordinary(service,r);current=self.item(r);patch_data=op.get("patch") or {}
        def equivalent(k,v):return (current.get(k) or None)==(v or None)
        if not delete and all(equivalent(k,v) for k,v in patch_data.items()):return {"task":current}
        if not current["revision"]:raise AdapterError("提醒事项缺少版本信息，拒绝修改。")
        if current["revision"]!=before.get("revision"):raise AdapterError("提醒事项已被其他设备修改，发生冲突，请刷新核对。")
        if delete:service.delete(r);fresh=service.get(ident);return {"deleted":fresh.deleted} if fresh.deleted else (_ for _ in ()).throw(AdapterError("删除尚未确认。"))
        if "title" in patch_data:r.title=patch_data["title"]
        if "description" in patch_data:r.desc=patch_data["description"] or ""
        if "completed" in patch_data:
            r.completed=bool(patch_data["completed"])
            if not r.completed:r.completed_date=None
        if any(k in patch_data for k in ["due","dueInstant","dueZone"]):
            combined={**current,**patch_data}
            for k,v in due_fields(combined).items():setattr(r,k,v)
        service.update(r);fresh=self.item(service.get(ident))
        if not all((fresh.get(k) or None)==(v or None) for k,v in patch_data.items()):raise AdapterError("提醒事项写入结果未确认，请同步后重试。")
        return {"task":fresh}

    def dispatch(self,method,args):
        if method=="connect":return self.connect(args)
        if method=="code":return self.code(args)
        if method=="snapshot":return self.snapshot(args)
        if method=="lookup":return {"task":self.item(self.service(args.get("accountId")).get(args["id"]))}
        if method=="create":return self.create(args)
        if method=="update":return self.mutate(args)
        if method=="delete":return self.mutate(args,True)
        raise AdapterError("不支持的提醒事项操作。")

def public_error(exc):
    if isinstance(exc,AdapterError):return str(exc)
    text=str(exc).lower();name=type(exc).__name__.lower()
    if "not_found" in text:return "提醒事项已删除或不可访问，请同步核对。"
    if "auth" in name or "unauthor" in text or "session" in text or "cookie" in text or "401" in text:return "登录授权已失效，请重新连接 iCloud 提醒事项。"
    if "conflict" in text or "change tag" in text or "server_record_changed" in text:return "提醒事项版本冲突，请刷新核对。"
    return "提醒事项请求失败，请检查网络后重试。"

@contextlib.contextmanager
def process_lock():
    import msvcrt
    file=ROOT/"private"/"rpc.lock";file.parent.mkdir(parents=True,exist_ok=True)
    with file.open("a+b") as stream:
        stream.seek(0,2)
        if not stream.tell():stream.write(b"0");stream.flush()
        deadline=time.monotonic()+120
        while True:
            try:stream.seek(0);msvcrt.locking(stream.fileno(),msvcrt.LK_NBLCK,1);break
            except OSError:
                if time.monotonic()>deadline:raise AdapterError("上一提醒事项请求尚未结束，请稍后重试。")
                time.sleep(.1)
        try:yield
        finally:stream.seek(0);msvcrt.locking(stream.fileno(),msvcrt.LK_UNLCK,1)

def main():
    adapter=Adapter()
    for line in sys.stdin:
        ident=None
        try:
            request=json.loads(line);ident=request.get("id")
            # Upstream stdout is untrusted and may contain account details.
            with process_lock(),contextlib.redirect_stdout(sys.stderr):result=adapter.dispatch(request["method"],request.get("args") or {})
            output={"id":ident,"result":result}
        except Exception as exc:output={"id":ident,"error":public_error(exc),"errorType":type(exc).__name__}
        sys.stdout.write(json.dumps(output,ensure_ascii=False)+"\n");sys.stdout.flush()

if __name__=="__main__":main()

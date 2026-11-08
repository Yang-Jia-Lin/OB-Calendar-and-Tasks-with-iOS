"""Pinned pyicloud adapter. NDJSON over private stdio; never log account payloads."""
from __future__ import annotations
import contextlib
import base64
from datetime import datetime, timezone
import hashlib
import json
import logging
import os
from pathlib import Path
import shutil
import sys
import uuid
import time
from unittest.mock import patch
from zoneinfo import ZoneInfo

logging.disable(logging.CRITICAL)
ROOT = Path(sys.argv[1]).resolve() if len(sys.argv)>1 else Path.cwd()
SDK = Path(os.environ["CTT_REMINDERS_SDK"]) if os.environ.get("CTT_REMINDERS_SDK") else ROOT / "sdk" / "pyicloud-af5246511c729eee4d5a95671135ad75fdd77b22"
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
        self.api=None;self.account="";self.last_items={};self.children=set();self.rules={}

    def read_rules(self,service,rows):
        from pyicloud.services.reminders._constants import _REMINDERS_ZONE_REQ
        names=list({"RecurrenceRule/"+x.split("/")[-1] for r in rows for x in r.recurrence_rule_ids})
        if not names:return
        for name in names:self.rules.pop(name,None)
        for start in range(0,len(names),100):
            response=service._writes._get_raw().lookup(record_names=names[start:start+100],zone_id=_REMINDERS_ZONE_REQ)
            for rec in response.records:
                if getattr(rec,"recordType",None)=="RecurrenceRule":self.rules[rec.recordName]=rec

    def repeat(self,r):
        if not r.recurrence_rule_ids:return None
        if len(r.recurrence_rule_ids)!=1 or not r.due_date:return None
        ident="RecurrenceRule/"+r.recurrence_rule_ids[0].split("/")[-1];rec=self.rules.get(ident)
        if not rec:return None
        f=rec.fields;known={"Reminder","Frequency","Interval","OccurrenceCount","FirstDayOfTheWeek","Imported","Deleted","EndDate","DaysOfTheWeek"}
        if set(f.keys())-known or f.get_value("EndDate") is not None or f.get_value("OccurrenceCount") or f.get_value("Deleted"):return None
        frequency=f.get_value("Frequency");interval=f.get_value("Interval");interval=1 if interval is None else interval
        owner=f.get_value("Reminder")
        if not owner or (owner.get("recordName") if isinstance(owner,dict) else getattr(owner,"recordName",None))!=r.id:return None
        if frequency==1 and interval!=1 and f.get_value("FirstDayOfTheWeek")!=1:return None
        if type(frequency) is not int or frequency not in (0,1,2) or type(interval) is not int or not 1<=interval<=365:return None
        days=None;encoded=f.get_value("DaysOfTheWeek")
        if encoded:
            try:
                values=json.loads(encoded if isinstance(encoded,bytes) else base64.b64decode(encoded,validate=True));days=[]
                for v in values:
                    if set(v)!={"weekNumber","dayOfTheWeek"} or v["weekNumber"]!=0 or type(v["dayOfTheWeek"]) is not int or not 1<=v["dayOfTheWeek"]<=7:return None
                    days.append((v["dayOfTheWeek"]+5)%7+1)
                if len(days)!=len(set(days)) or days and frequency!=1:return None
            except Exception:return None
        # Native all-day values are floating even if the SDK filled TimeZone=UTC.
        zone=getattr(self,"display_zone","UTC") if r.all_day else r.time_zone or "UTC"
        if frequency==1 and not days:days=[r.due_date.astimezone(ZoneInfo(zone)).isoweekday() if not r.all_day else r.due_date.isoweekday()]
        return {"frequency":["daily","weekly","monthly"][frequency],"interval":interval,"weekdays":sorted(days) if days else [],"zone":zone,"ruleId":ident,"revision":rec.recordChangeTag}

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
        repeat=self.repeat(r)
        reason="复杂周期任务，请在提醒事项中编辑／完成" if r.recurrence_rule_ids and not repeat else "子任务，请在提醒事项中编辑／完成" if r.parent_reminder_id else "包含子任务，请在提醒事项中编辑／完成" if r.id in self.children else "原生文本无法解码，保留原内容" if r.undecodable_text_fields else ""
        return {"id":r.id,"listId":r.list_id,"title":r.title,"description":r.desc,"completed":r.completed,"deleted":r.deleted,"due":due or "","dueInstant":instant,"dueZone":r.time_zone,"completedAt":int(r.completed_date.timestamp()*1000) if r.completed_date else None,"revision":r.record_change_tag,"kind":"reminder","path":"icloud:"+self.account,"accountId":self.account,"parentId":r.parent_reminder_id,"readonlyReason":reason,"repeat":repeat}

    def snapshot(self,args):
        service=self.service(args.get("accountId"));lists=[l for l in service.lists() if not l.deleted and not l.is_group]
        self.display_zone=args.get("zone") or "UTC"
        full=not args.get("cursor") or not self.last_items;rows=[];deleted=[]
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
        self.rules={};self.read_rules(service,list(self.last_items.values()))
        return {"full":full,"lists":[{"id":l.id,"name":l.title,"color":l.color} for l in lists],"items":[self.item(r) for r in self.last_items.values()],"deleted":deleted,"cursor":cursor}

    def assert_ordinary(self,service,r,allow_repeat=False):
        # Recheck native structure at write time, including parents that acquired children.
        children=any(x.parent_reminder_id==r.id and not x.deleted for x in service.reminders(list_id=r.list_id))
        if (r.recurrence_rule_ids and not (allow_repeat and self.repeat(r))) or r.parent_reminder_id or children:raise AdapterError("复杂周期／子任务不允许修改或完成。")
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

    def transaction(self,service,op):
        """Persist a fixed atomic native operation before sending it. Retries never advance twice."""
        from pyicloud.common.cloudkit.models import CKModifyOperation,CKZoneIDReq
        from pyicloud.services.reminders._constants import _REMINDERS_ZONE_REQ
        from pyicloud.services.reminders._writes import _assert_modify_success,_merge_resolution_token_map
        key=hashlib.sha256(op['id'].encode()).hexdigest();journal=ROOT/'private'/'mutations'/(key+'.json')
        desired={k:op.get(k) for k in ('id','task','before','patch','cycle')}
        raw=service._writes._get_raw();original=raw.modify
        if journal.exists():
            payload=json.loads(journal.read_text(encoding='utf8'))
            if payload['desired']!=desired:raise AdapterError('周期操作意图变化，发生冲突。')
        else:
            before=op.get('before') or op['task'];r=service.get(op['task']['id']);self.read_rules(service,[r]);self.assert_ordinary(service,r,True)
            current=self.item(r)
            if current['revision']!=before.get('revision') or current.get('repeat')!=before.get('repeat'):raise AdapterError('提醒事项或重复规则已变化，发生冲突，请刷新核对。')
            if r.deleted or r.completed and (op.get('cycle') or 'repeat' in (op.get('patch') or {})):raise AdapterError('周期任务已删除或已完成，请刷新核对。')
            operations=[];captured=[]
            class Captured(Exception):pass
            def capture(*,operations: list,**kwargs):
                captured.extend(x.model_dump(mode='json',exclude_none=False) for x in operations);raise Captured()
            def prepare(fn):
                nonlocal captured
                captured=[];raw.modify=capture
                try:
                    try:fn()
                    except Captured:pass
                finally:raw.modify=original
                if not captured:raise AdapterError('未生成原生周期操作，已停止。')
                return captured
            patch_data=op.get('patch') or {};cycle=op.get('cycle')
            if cycle:
                if not current.get('repeat') or before.get('due')!=current.get('due') or before.get('dueInstant')!=current.get('dueInstant'):raise AdapterError('本轮周期已变化，拒绝重复完成。')
                history=uuid.UUID(cycle['historyId'].split('/')[-1])
                with patch('pyicloud.services.reminders._writes.uuid.uuid4',return_value=history):
                    operations+=prepare(lambda:service.create(list_id=r.list_id,title=r.title,desc=r.desc or '',completed=True,priority=r.priority,flagged=r.flagged,**due_fields(current)))
                operations[-1]['record']['fields']['CompletionDate']={'type':'TIMESTAMP','value':cycle['completedAt']}
                patch_data=cycle['next']
            if 'title' in patch_data:r.title=patch_data['title']
            if 'description' in patch_data:r.desc=patch_data['description'] or ''
            if any(k in patch_data for k in ('due','dueInstant','dueZone')):
                for k,v in due_fields({**current,**patch_data}).items():setattr(r,k,v)
            main=prepare(lambda:service.update(r))[0]
            if 'listId' in patch_data:
                main['record']['fields']['List']={'type':'REFERENCE','value':{'recordName':patch_data['listId'],'action':'VALIDATE'}}
                main['record']['parent']={'recordName':patch_data['listId']}
                token=main['record']['fields']['ResolutionTokenMap']
                token['value']=_merge_resolution_token_map(token['value'],['list','lastModifiedDate'])
            if 'repeat' in patch_data:
                repeat=patch_data['repeat'];old=current.get('repeat')
                if repeat:
                    if not r.due_date or repeat.get('frequency') not in ('daily','weekly','monthly') or type(repeat.get('interval')) is not int or not 1<=repeat['interval']<=365:raise AdapterError('重复规则或截止日期无效。')
                    ZoneInfo(repeat['zone']);days=repeat.get('weekdays') or []
                    if repeat['frequency']=='weekly' and (not days or any(type(d) is not int or not 1<=d<=7 for d in days) or len(set(days))!=len(days)):raise AdapterError('重复星期无效。')
                    if repeat['frequency']!='weekly' and days:raise AdapterError('重复规则包含不支持的星期条件。')
                    rule_id=old['ruleId'] if old else 'RecurrenceRule/'+str(uuid.uuid5(uuid.NAMESPACE_URL,op['id'])).upper()
                    fields={'FirstDayOfTheWeek':{'type':'INT64','value':1},'Frequency':{'type':'INT64','value':['daily','weekly','monthly'].index(repeat['frequency'])},'Interval':{'type':'INT64','value':repeat['interval']},'DaysOfTheWeek':{'type':'BYTES','value':base64.b64encode(json.dumps([{'weekNumber':0,'dayOfTheWeek':d%7+1} for d in sorted(days)],separators=(',',':')).encode()).decode() if days else "W10="}}
                    if old:
                        rule=CKModifyOperation(operationType='update',record=service._writes._write_record(record_name=rule_id,record_type='RecurrenceRule',record_change_tag=old['revision'],fields=fields)).model_dump(mode='json',exclude_none=False)
                    else:
                        from pyicloud.services.reminders.models import RecurrenceFrequency
                        rule_uuid=uuid.UUID(rule_id.split('/')[-1])
                        with patch('pyicloud.services.reminders._writes.uuid.uuid4',return_value=rule_uuid):
                            result=prepare(lambda:service.create_recurrence_rule(r,frequency=RecurrenceFrequency(fields['Frequency']['value']),interval=repeat['interval']))
                        rule=next(x for x in result if x['record']['recordName']==rule_id);rule['record']['fields'].update(fields)
                    operations.append(rule)
                    main['record']['fields']['RecurrenceRuleIDs']={'type':'STRING_LIST','value':[rule_id.split('/')[-1]]}
                elif old:
                    operations.append(CKModifyOperation(operationType='update',record=service._writes._write_record(record_name=old['ruleId'],record_type='RecurrenceRule',record_change_tag=old['revision'],fields={'Deleted':{'type':'INT64','value':1}})).model_dump(mode='json',exclude_none=False))
                    main['record']['fields']['RecurrenceRuleIDs']={'type':'STRING_LIST','value':[]}
                token=main['record']['fields']['ResolutionTokenMap'];token['value']=_merge_resolution_token_map(token['value'],['recurrenceRuleIDs','lastModifiedDate'])
            operations.insert(0,main)
            payload={'desired':desired,'operations':operations,'done':False};atomic(journal,payload)
        cycle=op.get('cycle')
        if not payload.get('done'):
            # A lost reply is reconciled by exact record fields before replaying old change tags.
            response=raw.lookup(record_names=[x['record']['recordName'] for x in payload['operations']],zone_id=_REMINDERS_ZONE_REQ)
            records={x.recordName:x for x in response.records if getattr(x,'recordType',None)}
            def matches(operation):
                record=records.get(operation['record']['recordName'])
                def equivalent(k,v):
                    actual=record.fields[k].model_dump(mode='json').get('value') if k in record.fields else None;expected=v.get('value')
                    if v.get('type')=='REFERENCE' and actual and expected:return actual.get('recordName')==expected.get('recordName')
                    return actual==expected
                parent=operation['record'].get('parent')
                return record is not None and (not parent or getattr(getattr(record,'parent',None),'recordName',None)==parent['recordName']) and all(equivalent(k,v) for k,v in operation['record']['fields'].items() if k not in ('ResolutionTokenMap',))
            if not all(matches(x) for x in payload['operations']):
                result=raw.modify(operations=[CKModifyOperation.model_validate(x) for x in payload['operations']],zone_id=_REMINDERS_ZONE_REQ,atomic=True)
                _assert_modify_success(result,'Recurring reminder transaction')
            payload['done']=True;atomic(journal,payload)
        fresh=service.get(op['task']['id']);self.read_rules(service,[fresh]);result={'task':self.item(fresh)}
        if cycle:result['history']=self.item(service.get(cycle['historyId']))
        return result

    def mutate(self,args,delete=False):
        service=self.service(args.get("accountId"));op=args["op"];before=op.get("before") or op["task"];ident=op["task"]["id"]
        if not delete and (op.get('cycle') or any(k in (op.get('patch') or {}) for k in ('repeat','listId'))):return self.transaction(service,op)
        try:r=service.get(ident)
        except Exception as exc:
            if delete and is_missing(exc):return {"deleted":True}
            raise
        if r.deleted:
            if delete:return {"deleted":True}
            raise AdapterError("提醒事项已在远端删除。")
        if r.recurrence_rule_ids:self.read_rules(service,[r])
        self.assert_ordinary(service,r,True);current=self.item(r);patch_data=op.get("patch") or {}
        if r.recurrence_rule_ids and not delete:
            if 'completed' in patch_data:raise AdapterError('周期任务必须明确完成当前轮，拒绝直接修改完成状态。')
            return self.transaction(service,op)
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
            elif patch_data.get("completedAt") is not None:r.completed_date=datetime.fromtimestamp(patch_data["completedAt"]/1000,timezone.utc)
        if any(k in patch_data for k in ["due","dueInstant","dueZone"]):
            combined={**current,**patch_data}
            for k,v in due_fields(combined).items():setattr(r,k,v)
        service.update(r);fresh=self.item(service.get(ident))
        if not all((fresh.get(k) or None)==(v or None) for k,v in patch_data.items()):raise AdapterError("提醒事项写入结果未确认，请同步后重试。")
        return {"task":fresh}

    def dispatch(self,method,args):
        self.display_zone=args.get("zone") or getattr(self,"display_zone","UTC")
        if method=="connect":return self.connect(args)
        if method=="code":return self.code(args)
        if method=="snapshot":return self.snapshot(args)
        if method=="lookup":
            service=self.service(args.get("accountId"));r=service.get(args["id"]);self.read_rules(service,[r]);return {"task":self.item(r)}
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

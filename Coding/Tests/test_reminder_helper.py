"""Offline adapter tests; all service reads/writes are fakes."""
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch
from datetime import datetime, timezone
BASE=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(BASE/"Results/Probes/IcloudReminders/upstream/pyicloud-af5246511c729eee4d5a95671135ad75fdd77b22"))
spec=importlib.util.spec_from_file_location("reminder_adapter",BASE/"Coding/Providers/Reminders/helper.py")
helper=importlib.util.module_from_spec(spec);spec.loader.exec_module(helper)

def native(**values):
    default=dict(id="Reminder/11111111-1111-4111-8111-111111111111",list_id="list",title="Title",desc="User notes",completed=False,completed_date=None,due_date=None,time_zone=None,all_day=False,deleted=False,parent_reminder_id=None,recurrence_rule_ids=[],undecodable_text_fields=(),record_change_tag="v1",priority=5,flagged=True,alarm_ids=["original-alarm"],unknown="keep")
    return SimpleNamespace(**{**default,**values})

class AdapterTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix="reminder-helper-",dir=BASE/"Agents/Tests")
        self.old_root=helper.ROOT;helper.ROOT=Path(self.temp.name)
        self.item=native();self.adapter=helper.Adapter();self.adapter.account="account"
        self.service=Mock();self.service.get.return_value=self.item;self.service.reminders.return_value=[self.item]
        self.adapter.service=lambda account=None:self.service
        self.before=self.adapter.item(self.item)
    def tearDown(self):helper.ROOT=self.old_root;self.temp.cleanup()
    def args(self,patch_data):return {"op":{"task":self.before,"before":self.before,"patch":patch_data}}
    def test_unknown_fields_and_alarm_are_preserved_on_title_edit(self):
        result=self.adapter.mutate(self.args({"title":"Changed"}))
        self.assertEqual(result["task"]["title"],"Changed");self.assertEqual(self.item.unknown,"keep");self.assertEqual(self.item.alarm_ids,["original-alarm"]);self.assertEqual(self.item.desc,"User notes")
    def test_stale_change_tag_blocks_before_write(self):
        self.item.record_change_tag="external"
        with self.assertRaisesRegex(helper.AdapterError,"冲突"):self.adapter.mutate(self.args({"title":"Mine"}))
        self.service.update.assert_not_called()
    def test_idempotent_completed_state_is_confirmed_without_writing(self):
        self.item.completed=True;self.item.record_change_tag="external"
        self.adapter.mutate(self.args({"completed":True}));self.service.update.assert_not_called()
    def test_recurring_task_cannot_be_completed(self):
        self.item.recurrence_rule_ids=["rule"]
        with self.assertRaisesRegex(helper.AdapterError,"复杂"):self.adapter.mutate(self.args({"completed":True}))
        self.service.update.assert_not_called()
    def test_child_cannot_be_edited(self):
        self.item.parent_reminder_id="parent"
        with self.assertRaises(helper.AdapterError):self.adapter.mutate(self.args({"title":"Mine"}))
        self.service.update.assert_not_called()
    def test_parent_that_acquired_children_is_rechecked_at_write_time(self):
        self.service.reminders.return_value=[self.item,native(id="child",parent_reminder_id=self.item.id)]
        with self.assertRaises(helper.AdapterError):self.adapter.mutate(self.args({"title":"Mine"}))
        self.service.update.assert_not_called()
    def test_undecodable_native_text_is_not_treated_as_empty(self):
        self.item.undecodable_text_fields=("TitleDocument",)
        with self.assertRaisesRegex(helper.AdapterError,"无法解码"):self.adapter.mutate(self.args({"title":"Mine"}))
        self.service.update.assert_not_called()
    def test_explicit_null_clears_timed_deadline(self):
        self.item.due_date=datetime(2026,11,6,1,0,tzinfo=timezone.utc);self.item.time_zone="Asia/Shanghai";self.before=self.adapter.item(self.item)
        self.adapter.mutate(self.args({"due":"","dueInstant":None,"dueZone":None}))
        self.assertIsNone(self.item.due_date);self.assertIsNone(self.item.time_zone)
    def test_date_deadline_stays_floating(self):
        values=helper.due_fields({"due":"2026-11-06"});self.assertEqual(values["due_date"].date().isoformat(),"2026-11-06");self.assertTrue(values["all_day"]);self.assertIsNone(values["time_zone"])
    def test_instant_deadline_retains_zone(self):
        values=helper.due_fields({"dueInstant":1793926800000,"dueZone":"Asia/Shanghai"});self.assertFalse(values["all_day"]);self.assertEqual(values["time_zone"],"Asia/Shanghai")
    def test_auth_failure_is_not_mistaken_for_remote_deletion(self):
        self.service.get.side_effect=RuntimeError("401 session expired")
        with self.assertRaises(RuntimeError):self.adapter.mutate(self.args({}),True)
        self.service.delete.assert_not_called()
    def test_deleted_task_cannot_be_modified(self):
        self.item.deleted=True
        with self.assertRaisesRegex(helper.AdapterError,"已在远端删除"):self.adapter.mutate(self.args({"title":"Mine"}))
        self.service.update.assert_not_called()
    def test_error_redaction_does_not_include_server_response(self):
        error=RuntimeError("private title and account@example.test in server response")
        self.assertNotIn("account",helper.public_error(error));self.assertNotIn("private",helper.public_error(error))
    def test_cloudkit_request_roundtrip_keeps_required_null_values(self):
        from pyicloud.common.cloudkit.models import CKModifyOperation
        op=CKModifyOperation(operationType="create",record={"recordName":self.item.id,"recordType":"Reminder","fields":{"DueDate":{"type":"TIMESTAMP","value":None}}})
        encoded=op.model_dump(mode="json",exclude_none=False)
        decoded=CKModifyOperation.model_validate(json.loads(json.dumps(encoded)))
        self.assertEqual(decoded.record.recordName,self.item.id)
    def test_creation_journal_failure_never_reaches_cloud_modify(self):
        from pyicloud.common.cloudkit.models import CKModifyOperation
        from pyicloud.services.reminders._constants import _REMINDERS_ZONE_REQ
        raw=SimpleNamespace(modify=Mock());self.service._writes._get_raw.return_value=raw
        def create(**kwargs):
            import uuid
            ident="Reminder/"+str(uuid.uuid4()).upper()
            raw.modify(operations=[CKModifyOperation(operationType="create",record={"recordName":ident,"recordType":"Reminder","fields":{}})],zone_id=_REMINDERS_ZONE_REQ)
        self.service.create=create
        with patch.object(helper,"atomic",side_effect=OSError("disk full")):
            with self.assertRaises(OSError):self.adapter.create({"op":{"task":{**self.before,"listId":"list"}}})
        raw.modify.assert_not_called()

if __name__=="__main__":unittest.main()

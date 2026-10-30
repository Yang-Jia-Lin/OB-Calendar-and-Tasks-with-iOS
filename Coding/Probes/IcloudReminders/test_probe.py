"""Safety and failure tests for the live probe; these never contact Apple."""
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
from zoneinfo import ZoneInfo

from probe import Probe, ProbeStop, ensure_owned, verify_due


def item(**changes):
    values = dict(id="owned", list_id="test-list", title="test", desc="note", completed=False,
                  due_date=None, all_day=False, time_zone=None, priority=5, flagged=False,
                  deleted=False, parent_reminder_id=None, recurrence_rule_ids=[], record_change_tag="v1")
    values.update(changes)
    return SimpleNamespace(**values)


def harness():
    p = object.__new__(Probe)
    p.manifest = {"list_id": "test-list", "created": [{"id": "owned"}]}
    p.manifest_path = Path("unused")
    p.summary = {"cloud_write_attempts": 0, "checks": []}
    p.service = Mock()
    p.journal = Mock()
    p.publish = Mock()
    return p


class ProbeSafetyTests(unittest.TestCase):
    def test_unregistered_task_cannot_be_written(self):
        with self.assertRaises(ProbeStop):
            ensure_owned({"list_id": "test-list", "created": []}, "owned", item())

    def test_task_moved_to_other_list_cannot_be_written(self):
        with self.assertRaises(ProbeStop):
            ensure_owned(harness().manifest, "owned", item(list_id="personal"))

    def test_recurring_subtask_deleted_or_wrong_id_is_rejected(self):
        for changes in ({"recurrence_rule_ids": ["rule"]}, {"parent_reminder_id": "parent"},
                        {"deleted": True}, {"id": "other"}):
            with self.subTest(changes=changes), self.assertRaises(ProbeStop):
                ensure_owned(harness().manifest, "owned", item(**changes))

    def test_journal_failure_prevents_remote_create(self):
        p = harness()
        p.journal.side_effect = OSError("disk full")
        with self.assertRaises(OSError):
            p.create("sample", title="test")
        p.service.create.assert_not_called()

    def test_uncertain_creation_has_no_retry_or_title_cleanup(self):
        p = harness()
        p.service.create.side_effect = TimeoutError("sensitive upstream payload")
        with self.assertRaises(ProbeStop) as caught:
            p.create("sample", title="test")
        self.assertNotIn("sensitive", str(caught.exception))
        self.assertEqual(p.service.create.call_count, 1)
        p.service.delete.assert_not_called()
        self.assertEqual(p.manifest["created"][-1]["state"], "uncertain_creation_no_auto_retry")

    def test_external_edit_stops_update(self):
        p = harness()
        p.service.get.side_effect = [item(), item(title="edited on ipad", record_change_tag="v2")]
        with self.assertRaises(ProbeStop):
            p.patch("owned", completed=True)
        p.service.update.assert_not_called()

    def test_journal_failure_prevents_remote_update(self):
        p = harness()
        p.service.get.side_effect = [item(), item()]
        p.journal.side_effect = OSError("disk full")
        with self.assertRaises(OSError):
            p.patch("owned", completed=True)
        p.service.update.assert_not_called()

    def test_due_none_date_and_instant_remain_distinct(self):
        midnight = datetime(2026, 10, 30, tzinfo=timezone.utc)
        timed = datetime(2026, 10, 30, 15, 20, tzinfo=ZoneInfo("Asia/Shanghai"))
        self.assertTrue(verify_due(item(), "none"))
        self.assertFalse(verify_due(item(due_date=midnight), "none"))
        self.assertFalse(verify_due(item(due_date=midnight), "date", midnight))
        self.assertTrue(verify_due(item(due_date=midnight, all_day=True), "date", midnight))
        self.assertTrue(verify_due(item(due_date=timed.astimezone(timezone.utc),
                                        time_zone="Asia/Shanghai"), "time", timed))
        self.assertFalse(verify_due(item(due_date=timed.replace(tzinfo=None)), "time", timed))

    def test_invalid_observation_input_does_not_become_failure(self):
        p = harness()
        with patch("builtins.input", side_effect=["invalid", "y"]):
            p.observe("device check", "check on device")
        self.assertEqual(len(p.summary["checks"]), 1)
        self.assertEqual(p.summary["checks"][0]["result"], "pass")
        p.service.update.assert_not_called()


if __name__ == "__main__":
    unittest.main()

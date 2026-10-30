"""Deletion confirmation never treats generic errors as success."""
from types import SimpleNamespace
import unittest
from unittest.mock import Mock

from cleanup_owned import deleted_on_server
from pyicloud.services.reminders.client import RemindersApiError


class DeleteConfirmationTests(unittest.TestCase):
    def test_soft_deleted_record_is_confirmed(self):
        service = Mock()
        service.get.return_value = SimpleNamespace(deleted=True)
        self.assertTrue(deleted_on_server(service, "owned"))

    def test_existing_record_is_not_confirmed(self):
        service = Mock()
        service.get.return_value = SimpleNamespace(deleted=False)
        self.assertFalse(deleted_on_server(service, "owned"))

    def test_exact_record_missing_is_confirmed(self):
        service = Mock()
        service.get.side_effect = RemindersApiError("redacted", payload=[
            {"recordName": "owned", "serverErrorCode": "UNKNOWN_ITEM"}])
        self.assertTrue(deleted_on_server(service, "owned"))

    def test_other_record_or_permission_or_network_error_is_not_success(self):
        for error in (
            RemindersApiError("redacted", payload=[{"recordName": "other", "serverErrorCode": "UNKNOWN_ITEM"}]),
            RemindersApiError("redacted", payload=[{"recordName": "owned", "serverErrorCode": "PERMISSION_FAILURE"}]),
            TimeoutError("synthetic"),
        ):
            with self.subTest(error=type(error).__name__):
                service = Mock()
                service.get.side_effect = error
                with self.assertRaises(type(error)):
                    deleted_on_server(service, "owned")


if __name__ == "__main__":
    unittest.main()

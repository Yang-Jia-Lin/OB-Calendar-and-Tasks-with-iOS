"""Fault injector and remote edit guard tests; never contact Apple."""
import json
from types import SimpleNamespace
import unittest
from unittest.mock import Mock

from requests import ConnectionError, ReadTimeout, Request, Response
from reliability import Conflict, guarded_update, transport_fault
from probe import ProbeStop
from test_probe import item


class FaultTests(unittest.TestCase):
    def request(self):
        return Request("POST", "https://example.invalid/records/modify", json={"operations": []}).prepare()

    def test_offline_never_forwards_and_restores_sender(self):
        original = Mock()
        session = SimpleNamespace(send=original)
        with transport_fault(session, route="/records/modify", mode="offline") as evidence:
            with self.assertRaises(ConnectionError):
                session.send(self.request())
        self.assertIs(session.send, original)
        original.assert_not_called()
        self.assertEqual(evidence, {"matches": 1, "forwarded": 0})

    def test_timeout_before_send_never_commits(self):
        original = Mock()
        session = SimpleNamespace(send=original)
        with transport_fault(session, route="/records/modify", mode="timeout_before"):
            with self.assertRaises(ReadTimeout):
                session.send(self.request())
        original.assert_not_called()

    def test_response_loss_captures_before_forwarding_exactly_once(self):
        events = []
        response = Response()
        response.status_code = 200
        def original(request, **kwargs):
            events.append("sent")
            return response
        session = SimpleNamespace(send=original)
        with transport_fault(session, route="/records/modify", mode="response_lost",
                             capture=lambda payload: events.append("persisted")) as evidence:
            with self.assertRaises(ReadTimeout):
                session.send(self.request())
        self.assertEqual(events, ["persisted", "sent"])
        self.assertEqual(evidence, {"matches": 1, "forwarded": 1})

    def test_capture_persistence_failure_prevents_send(self):
        original = Mock()
        session = SimpleNamespace(send=original)
        with transport_fault(session, route="/records/modify", mode="response_lost",
                             capture=Mock(side_effect=OSError("disk full"))):
            with self.assertRaises(OSError):
                session.send(self.request())
        original.assert_not_called()

    def test_unrelated_route_is_unchanged(self):
        original = Mock(return_value="unchanged")
        session = SimpleNamespace(send=original)
        request = Request("GET", "https://example.invalid/other").prepare()
        with transport_fault(session, route="/records/modify", mode="offline") as evidence:
            self.assertEqual(session.send(request), "unchanged")
        self.assertEqual(evidence["matches"], 0)


class GuardTests(unittest.TestCase):
    def manifest(self):
        return {"list_id": "test-list", "created": [{"id": "owned"}]}

    def test_external_title_change_stops_update(self):
        service = Mock()
        service.get.return_value = item(title="device changed", record_change_tag="v2")
        with self.assertRaises(Conflict):
            guarded_update(service, self.manifest(), item(), completed=True)
        service.update.assert_not_called()

    def test_external_delete_stops_update(self):
        service = Mock()
        service.get.return_value = item(deleted=True)
        with self.assertRaises(ProbeStop):
            guarded_update(service, self.manifest(), item(), completed=True)
        service.update.assert_not_called()


if __name__ == "__main__":
    unittest.main()

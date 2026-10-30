"""HTTP boundary tests; no real probe worker and no Apple requests."""
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
import json
import threading
import unittest

import local_ui as ui


class LocalUiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), ui.Handler)
        cls.port = cls.server.server_port
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=2)

    def request(self, method, path, headers=None, data=None):
        conn = HTTPConnection("127.0.0.1", self.port, timeout=3)
        conn.request(method, path, json.dumps(data) if data is not None else None, headers or {})
        response = conn.getresponse()
        body = response.read()
        result = (response.status, dict(response.getheaders()), body)
        conn.close()
        return result

    def test_page_forbids_cache_and_framing(self):
        status, headers, _ = self.request("GET", "/")
        self.assertEqual(status, 200)
        self.assertEqual(headers["Cache-Control"], "no-store")
        self.assertEqual(headers["X-Frame-Options"], "DENY")

    def test_state_requires_token(self):
        self.assertNotEqual(self.request("GET", "/state")[0], 200)

    def test_foreign_origin_denied_even_with_token(self):
        status, _, _ = self.request("POST", "/answer", {
            "X-Probe-Token": ui.TOKEN, "Content-Type": "application/json",
            "Origin": "https://example.com",
        }, {"id": 1, "value": "synthetic"})
        self.assertEqual(status, 403)

    def test_unexpected_host_denied(self):
        self.assertEqual(self.request("GET", "/", {"Host": "example.com"})[0], 403)

    def test_prompt_id_and_one_time_delivery(self):
        headers = {"X-Probe-Token": ui.TOKEN, "Content-Type": "application/json",
                   "Origin": f"http://127.0.0.1:{self.port}"}
        with ui.LOCK:
            ui.STATE["prompt"] = {"id": 77, "text": "test", "secret": True}
            ui.ANSWER = None
        self.assertEqual(self.request("POST", "/answer", headers, {"id": 76, "value": "synthetic"})[0], 409)
        self.assertEqual(self.request("POST", "/answer", headers, {"id": 77, "value": "synthetic"})[0], 200)
        self.assertEqual(self.request("POST", "/answer", headers, {"id": 77, "value": "synthetic"})[0], 409)
        with ui.LOCK:
            ui.ANSWER = None
            ui.STATE["prompt"] = None


if __name__ == "__main__":
    unittest.main()

"""Bounded staging AI bridge on oracleOld.

The app on 84 reaches this over an SSH reverse tunnel. The real OmniRoute
client key stays on oracleOld and is never sent across the public HTTP port.
Only the verified free tool-calling route is allowed.
"""

import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


HOST = "127.0.0.1"
PORT = int(os.environ.get("PYXIS_OMNI_PROXY_PORT", "20130"))
UPSTREAM = "http://127.0.0.1:20128/v1/chat/completions"
MODEL = "openrouter/openrouter/free"
TOOL = "search_similar_open_compounds"
MAX_BODY = 128 * 1024


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        # No prompts, model responses, credentials, or request bodies in logs.
        print("[pyxis-ai-proxy] " + fmt % args, flush=True)

    def send_json(self, status, body):
        data = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/health":
            return self.send_json(200, {"status": "OK", "model": MODEL})
        return self.send_json(404, {"error": "Not found"})

    def do_POST(self):
        if self.path != "/v1/chat/completions":
            return self.send_json(404, {"error": "Not found"})
        try:
            size = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            size = 0
        if size < 1 or size > MAX_BODY:
            return self.send_json(413, {"error": "Request size invalid"})
        try:
            body = json.loads(self.rfile.read(size))
        except (ValueError, UnicodeDecodeError):
            return self.send_json(400, {"error": "Invalid JSON"})
        if not isinstance(body, dict) or body.get("model") != MODEL:
            return self.send_json(403, {"error": "Only the verified free model is allowed"})
        tools = body.get("tools")
        if (not isinstance(tools, list) or len(tools) != 1
                or not isinstance(tools[0], dict)
                or not isinstance(tools[0].get("function"), dict)
                or tools[0]["function"].get("name") != TOOL
                or body.get("tool_choice") not in ("required", "auto", "none")):
            return self.send_json(400, {"error": "Only the chemical-search tool is allowed"})
        key = os.environ.get("OMNIROUTE_ORACLE_AUTH_TOKEN", "")
        if not key:
            return self.send_json(503, {"error": "Gateway credential unavailable"})
        # Ignore caller Authorization. This process injects the gateway key.
        req = Request(UPSTREAM, data=json.dumps(body).encode("utf-8"), headers={
            "Authorization": "Bearer " + key,
            "Content-Type": "application/json",
            "Accept": "application/json",
        })
        try:
            with urlopen(req, timeout=90) as response:
                payload = response.read(MAX_BODY * 8)
                status = response.status
        except HTTPError as error:
            # Avoid reflecting arbitrary provider output that might include a key.
            return self.send_json(502 if error.code in (401, 403) else error.code, {
                "error": {"message": "Free AI provider returned HTTP %s" % error.code}
            })
        except (URLError, TimeoutError) as error:
            self.log_message("upstream connection failed: %s", type(error).__name__)
            return self.send_json(502, {"error": {"message": "Free AI provider unavailable"}})
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


if __name__ == "__main__":
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()

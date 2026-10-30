"""Loopback-only UI for the interactive probe. Never log form fields."""
import builtins
import argparse
import contextlib
import getpass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import secrets
import threading
import sys

from probe import Probe, preflight

TOKEN = secrets.token_urlsafe(32)
LOCK = threading.Condition()
STATE = {"lines": [], "prompt": None, "done": False}
ANSWER = None
SEQUENCE = 0


class Screen:
    def write(self, value):
        if value:
            with LOCK:
                STATE["lines"].append(value)
                STATE["lines"] = STATE["lines"][-120:]
        return len(value)

    def flush(self):
        pass


def ask(prompt="", *, secret=False):
    global ANSWER, SEQUENCE
    with LOCK:
        SEQUENCE += 1
        ident = SEQUENCE
        ANSWER = None
        STATE["prompt"] = {"id": ident, "text": prompt, "secret": secret}
        LOCK.wait_for(lambda: ANSWER is not None)
        value = ANSWER
        ANSWER = None
        STATE["prompt"] = None
        return value


HTML = """<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer"><title>iCloud 提醒事项接口测试</title>
<style>body{font:16px/1.65 system-ui,'Microsoft YaHei',sans-serif;background:#f4f6f8;color:#1e293b;margin:0}
main{max-width:820px;margin:32px auto;padding:24px;background:white;border-radius:16px}
h1{font-size:24px;margin:0 0 12px}p{color:#586779}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:14px/1.65 inherit;max-height:46vh;overflow:auto;background:#f7f8fa;padding:16px;border-radius:8px}
label{display:block;font-weight:600;margin-bottom:8px}input{box-sizing:border-box;width:100%;font:inherit;padding:12px;border:1px solid #b9c3cf;border-radius:8px}
button{font:inherit;margin-top:12px;padding:10px 24px;border:0;border-radius:8px;background:#285ba8;color:white;cursor:pointer}
small{color:#64748b}#error{color:#b42318}</style><main><h1>iCloud 提醒事项接口测试</h1>
<p>此页仅连接本机 127.0.0.1。密码和验证码不显示在聊天，也不写入测试报告。测试仅修改专用列表中由本次探针创建的样例。</p>
<pre id="log">正在准备独立探针…</pre><form id="form" autocomplete="off" hidden><label id="question" for="answer"></label>
<input id="answer" autocomplete="off" spellcheck="false" required><button id="send">继续</button></form>
<p id="message">正在等待本机测试程序…</p><p id="error"></p><small>完成本机认证后，页面会引导你在 iPad 建立专用列表并核对同步。此页不使用任何外部脚本。</small></main>
<script>const token=__TOKEN__;let promptId=null,busy=false;const $=id=>document.getElementById(id);
async function refresh(){try{const r=await fetch('/state',{headers:{'X-Probe-Token':token},cache:'no-store'});if(!r.ok)throw Error();const s=await r.json();
const log=s.lines.join('');if($('log').textContent!==log){$('log').textContent=log;$('log').scrollTop=$('log').scrollHeight;}
const p=s.prompt;$('form').hidden=!p;$('message').textContent=s.done?'本轮探针已结束，结果已保存。':p?'请完成下面的本机输入。':'正在请求 Apple 服务，请稍候…';
if(p&&p.id!==promptId){promptId=p.id;$('question').textContent=p.text;$('answer').value='';$('answer').type=p.secret?'password':'text';$('answer').focus();}
if(!p)promptId=null;}catch(e){$('message').textContent='本机程序未连接；请保留此页，勿重复登录。';}}
$('form').addEventListener('submit',async e=>{e.preventDefault();if(busy||promptId===null)return;busy=true;$('send').disabled=true;let value=$('answer').value;$('answer').value='';
try{const r=await fetch('/answer',{method:'POST',headers:{'Content-Type':'application/json','X-Probe-Token':token},body:JSON.stringify({id:promptId,value})});if(!r.ok)throw Error();$('error').textContent='';promptId=null;await refresh();}catch(e){$('error').textContent='输入未被接受，请等待当前提示刷新后重试。';}finally{value='';busy=false;$('send').disabled=false;}});
refresh();setInterval(refresh,1000);</script></html>"""


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def respond(self, status, data, mime="application/json; charset=utf-8"):
        body = data.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'")
        self.end_headers()
        self.wfile.write(body)

    def host_ok(self):
        return self.headers.get("Host") == f"127.0.0.1:{self.server.server_port}"

    def authorized(self):
        origin = self.headers.get("Origin")
        expected = f"http://127.0.0.1:{self.server.server_port}"
        return (self.host_ok() and origin in (None, expected)
                and secrets.compare_digest(self.headers.get("X-Probe-Token", ""), TOKEN))

    def do_GET(self):
        if not self.host_ok():
            return self.respond(403, '{}')
        if self.path == "/":
            return self.respond(200, HTML.replace("__TOKEN__", json.dumps(TOKEN)), "text/html; charset=utf-8")
        if self.path == "/state" and self.authorized():
            with LOCK:
                return self.respond(200, json.dumps(STATE, ensure_ascii=False))
        self.respond(404, '{}')

    def do_POST(self):
        global ANSWER
        if self.path != "/answer" or not self.authorized():
            return self.respond(403, '{}')
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 8192 or self.headers.get("Content-Type") != "application/json":
                return self.respond(400, '{}')
            payload = json.loads(self.rfile.read(length))
            with LOCK:
                prompt = STATE["prompt"]
                if (not prompt or ANSWER is not None or payload.get("id") != prompt["id"]
                        or not isinstance(payload.get("value"), str)):
                    return self.respond(409, '{}')
                ANSWER = payload.pop("value")
                # Consume prompt atomically so a repeated request cannot enqueue twice.
                STATE["prompt"] = None
                LOCK.notify_all()
            return self.respond(200, '{}')
        except (ValueError, TypeError):
            return self.respond(400, '{}')


def worker(resume=False):
    builtins.input = ask
    getpass.getpass = lambda prompt="", **kwargs: ask(prompt, secret=True)
    with contextlib.redirect_stdout(Screen()):
        try:
            if resume:
                from resume_probe import ResumeProbe
                ResumeProbe().run()
            else:
                Probe().run()
        finally:
            with LOCK:
                STATE["done"] = True
                STATE["prompt"] = None


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--resume", action="store_true")
    args = parser.parse_args()
    preflight()
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    print(f"Local login page: http://127.0.0.1:{server.server_port}/", flush=True)
    threading.Thread(target=worker, args=(args.resume,), daemon=True).start()
    server.serve_forever()

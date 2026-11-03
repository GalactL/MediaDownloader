# Lite mode: yt-dlp inside Pyodide, in the extension's module worker (worker.mjs).
# - Network: RequestHandler on synchronous XHR (allowed in a worker). Forbidden headers are sent as
#   x-mdl-h-<name> and renamed by the background's webRequest listener; Set-Cookie comes back in
#   x-mdl-set-cookie (see engine.js).
# - YouTube JS challenges: EJS solver run in quickjs-ng compiled to WASI (mdl.runJs), no subprocess.
# - Subprocesses: `ffmpeg ...` runs synchronously in ffmpeg.wasm (mdl.ffmpeg); nothing else exists.
# The worker calls prepare() then download(); each returns a JSON string.
import copy
import email.message
import http.cookiejar
import io
import json
import os
import subprocess
import sys
import urllib.parse
import urllib.request

import js
import mdl  # registered by worker.mjs: runJs(code), ffmpeg(args), warn(text)
from pyodide.ffi import JsException, to_js

import yt_dlp
from yt_dlp.extractor.youtube.jsc._builtin.ejs import EJSBaseJCP
from yt_dlp.extractor.youtube.jsc.provider import JsChallengeProviderError, register_preference, register_provider
from yt_dlp.extractor.youtube.pot._provider import BuiltinIEContentProvider
from yt_dlp.networking.common import _REQUEST_HANDLERS, Request, RequestHandler, Response, register_rh
from yt_dlp.networking.common import register_preference as register_rh_preference
from yt_dlp.networking.exceptions import HTTPError, TransportError
from yt_dlp.utils import download_range_func

_SKIP_HEADERS = {'accept-encoding', 'content-length', 'connection', 'host'}


class _SetCookieResponse:
    def __init__(self, set_cookies):
        self._msg = email.message.Message()
        for value in set_cookies:
            self._msg['Set-Cookie'] = value

    def info(self):
        return self._msg


class XhrRH(RequestHandler):
    _SUPPORTED_URL_SCHEMES = ('http', 'https')
    _SUPPORTED_PROXY_SCHEMES = ()
    _SUPPORTED_FEATURES = ()

    def _check_extensions(self, extensions):
        super()._check_extensions(extensions)
        for key in ('cookiejar', 'timeout', 'legacy_ssl', 'keep_header_casing'):
            extensions.pop(key, None)

    def _send(self, request: Request):
        headers = self._get_headers(request)
        jar = self._get_cookiejar(request)
        if 'cookie' not in {k.lower() for k in headers}:
            cookie = jar.get_cookie_header(request.url)
            if cookie:
                headers['Cookie'] = cookie

        xhr = js.XMLHttpRequest.new()
        xhr.open(request.method, request.url, False)
        xhr.responseType = 'arraybuffer'
        xhr.timeout = int(self._calculate_timeout(request) * 1000)
        xhr.setRequestHeader('x-mdl', '1')
        for name, value in headers.items():
            if name.lower() not in _SKIP_HEADERS:
                xhr.setRequestHeader('x-mdl-h-' + name.lower(), value)
        data = request.data
        if data is not None and not isinstance(data, bytes):
            data = data.read() if hasattr(data, 'read') else b''.join(data)
        try:
            xhr.send(to_js(data) if data else None)
        except JsException as e:
            raise TransportError(cause=e) from e
        if xhr.status == 0:
            raise TransportError(f'network error for {urllib.parse.urlsplit(request.url).netloc}')

        resp_headers, set_cookies = {}, []
        for line in (xhr.getAllResponseHeaders() or '').split('\r\n'):
            name, sep, value = line.partition(': ')
            if not sep:
                continue
            lname = name.lower()
            if lname == 'x-mdl-set-cookie':
                set_cookies.extend(json.loads(urllib.parse.unquote(value)))
            elif lname not in ('content-encoding', 'content-length'):  # the browser already decoded the body
                resp_headers[name] = value
        final_url = xhr.responseURL or request.url
        if set_cookies:
            jar.extract_cookies(_SetCookieResponse(set_cookies), urllib.request.Request(final_url))

        body = xhr.response.to_bytes() if xhr.response else b''
        response = Response(io.BytesIO(body), url=final_url, headers=resp_headers,
                            status=xhr.status, reason=xhr.statusText or None)
        if not 200 <= response.status < 300:
            raise HTTPError(response)
        return response


# Only our handler: urllib/websockets would open raw sockets, which do not exist here.
_REQUEST_HANDLERS.clear()
register_rh(XhrRH)


@register_rh_preference(XhrRH)
def _rh_pref(rh, request):
    return 1000


@register_provider
class WasmQuickJSJCP(EJSBaseJCP, BuiltinIEContentProvider):
    PROVIDER_NAME = 'wasm-quickjs'
    JS_RUNTIME_NAME = 'quickjs-wasi'

    def is_available(self):
        return self._available

    def _run_js_runtime(self, stdin: str, /) -> str:
        result = mdl.runJs(stdin).to_py()
        if result['status'] or result['stderr']:
            raise JsChallengeProviderError(f'quickjs-wasi failed ({result["status"]}): {result["stderr"][:500]}')
        return result['stdout']


@register_preference(WasmQuickJSJCP)
def _jcp_pref(provider, requests):
    return 1000


class WasmPopen:
    """`ffmpeg ...` runs synchronously in ffmpeg.wasm (same worker); any other program is missing."""

    def __init__(self, args, *_, stdin=None, stdout=None, stderr=None, text=False, **kwargs):
        prog = os.path.basename(str(args[0] if isinstance(args, (list, tuple)) else args))
        if prog != 'ffmpeg':
            raise FileNotFoundError(f'{prog}: no such program in the browser')
        self.args, self.pid = args, 0
        self._text = bool(text or kwargs.get('encoding') or kwargs.get('universal_newlines'))
        self._stdout_mode, self._stderr_mode = stdout, stderr
        self.stdin = io.BytesIO() if stdin == subprocess.PIPE else None
        self.stdout = self.stderr = None
        result = mdl.ffmpeg(to_js([str(a) for a in args[1:]])).to_py()
        self.returncode = result['code']
        self._out, self._err = result['stdout'], result['stderr']

    def _wrap(self, value):
        return value if self._text else value.encode()

    def communicate(self, input=None, timeout=None):
        if self._stderr_mode == subprocess.STDOUT:
            return self._wrap(self._out + self._err), None
        out = self._wrap(self._out) if self._stdout_mode == subprocess.PIPE else None
        err = self._wrap(self._err) if self._stderr_mode == subprocess.PIPE else None
        return out, err

    communicate_or_kill = communicate

    def wait(self, timeout=None):
        return self.returncode

    poll = wait

    def kill(self, *, timeout=0):
        pass

    terminate = kill

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    @classmethod
    def run(cls, *args, timeout=None, input=None, **kwargs):
        proc = cls(*args, **kwargs)
        default = '' if proc._text else b''
        stdout, stderr = proc.communicate(input=input)
        return stdout or default, stderr or default, proc.returncode


_RealPopen = yt_dlp.utils.Popen
for _name, _module in list(sys.modules.items()):
    # vars() and not getattr(): getattr would load yt-dlp's lazy optional-dependency modules
    if _name.startswith('yt_dlp') and vars(_module).get('Popen') is _RealPopen:
        _module.Popen = WasmPopen


class _Logger:
    def debug(self, msg):
        pass

    info = debug

    def warning(self, msg):
        mdl.warn(msg)

    error = warning


def _load_cookies(ydl, cookies):
    for c in cookies:
        ydl.cookiejar.set_cookie(http.cookiejar.Cookie(
            0, c['name'], c['value'], None, False, c['domain'], True, c['domain'].startswith('.'),
            c['path'], True, c['secure'], c.get('expirationDate'), False, None, None, {}))


def _selector(max_height):
    # BuildFormatSelector (src/Core.cpp) plus: no AV1 (no decoder in ffmpeg.wasm), direct http(s) only
    # (the ffmpeg bridge serves plain http inputs, not HLS).
    v = f'[height<={max_height}][vcodec!^=?av01][protocol^=http]'
    return f'bestvideo{v}+bestaudio[protocol^=http]/best{v}/best[protocol^=http]'


_JOB = {}


def prepare(url, cookies_json, max_height):
    """Extract and select formats without downloading, so the worker can refuse early."""
    ydl = yt_dlp.YoutubeDL({
        'logger': _Logger(), 'noplaylist': True, 'cachedir': False, 'color': 'no_color',
        'format': _selector(max_height), 'merge_output_format': 'mp4',
        'paths': {'home': '/work', 'temp': '/work'}, 'outtmpl': '%(id)s.%(ext)s', 'overwrites': True,
    })
    _load_cookies(ydl, json.loads(cookies_json))
    try:
        raw = ydl.extract_info(url, download=False, process=False)
        info = ydl.process_ie_result(copy.deepcopy(raw), download=False)
    except Exception as e:
        return json.dumps({'ok': False, 'error': f'{type(e).__name__}: {e}'})
    _JOB.update(ydl=ydl, raw=raw)
    return json.dumps({
        'ok': True, 'title': info.get('title'), 'duration': info.get('duration'),
        'formats': [{'tbr': f.get('tbr')} for f in info.get('requested_formats') or [info]],
    }, ensure_ascii=False)


def download(start, end):
    """Download the selected formats (or [start, end] only) into /work; cut and merge go through WasmPopen."""
    ydl = _JOB['ydl']
    if start is not None:
        ydl.params['download_ranges'] = download_range_func(None, [(start, end)])
        ydl.params['force_keyframes_at_cuts'] = False  # the encode re-encodes everything anyway
    try:
        info = ydl.process_ie_result(_JOB['raw'], download=True)
        path = (info.get('requested_downloads') or [{}])[0].get('filepath')
        error = None if path and os.path.exists(path) else 'no output file'
    except Exception as e:
        path, error = None, f'{type(e).__name__}: {e}'
    return json.dumps({'ok': error is None, 'error': error, 'path': path}, ensure_ascii=False)

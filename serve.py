#!/usr/bin/env python3
"""Alternative dependency-free local server. Run: python3 serve.py [port]."""
import http.server
import pathlib
import sys
from functools import partial
root = pathlib.Path(__file__).resolve().parent
port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
handler = partial(http.server.SimpleHTTPRequestHandler, directory=str(root))
with http.server.ThreadingHTTPServer(('127.0.0.1', port), handler) as server:
    print(f'Nexora Diagram: http://127.0.0.1:{port}')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass

#!/usr/bin/env python3
"""本地开发服务器：禁用一切缓存，改完代码普通刷新即可生效。
用法: python3 serve.py  (默认端口 8642)
"""
import http.server
import sys
import os

# 静态文件已移入 public/（Netlify 标准结构），本地服务器从那里提供
os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'public'))

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8642


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    # 显式 MIME：ES module(.mjs) 和 wasm 加载对 Content-Type 敏感，缺了会加载失败
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        '.js': 'text/javascript',
        '.mjs': 'text/javascript',
        '.wasm': 'application/wasm',
        '.webp': 'image/webp',
        '.task': 'application/octet-stream',
    }

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, *args):
        pass  # 安静模式


if __name__ == '__main__':
    with http.server.ThreadingHTTPServer(('', PORT), NoCacheHandler) as httpd:
        print(f'Serving (no-cache) at http://localhost:{PORT}')
        httpd.serve_forever()

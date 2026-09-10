#!/usr/bin/env python3
"""Embed page.html into net/httpd.c as a C string literal.

Usage: gen.py page.html httpd.c

Replaces everything between the PAGE_BEGIN / PAGE_END marker lines in
httpd.c.  Markers understood inside the HTML:

  <!--#if STOCK-->  ...  <!--#endif-->   compiled in only with
                                          CONFIG_CMD_HTTPD_STOCK_RESTORE
  @@NAME@@                                spliced as the C macro NAME

Every source line becomes one string literal ending in \\n, so the HTML,
CSS and JS stay exactly as written -- no minifier, nothing to get wrong.
"""
import re
import sys

BEGIN = "/* @@PAGE_BEGIN@@ */"
END = "/* @@PAGE_END@@ */"
MAXLEN = 96


def lit(s):
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'


def emit(line):
    out = []
    parts = re.split(r"(@@[A-Z_]+@@)", line)
    for i, p in enumerate(parts):
        if i % 2:
            out.append(p[2:-2])
            continue
        while len(p) > MAXLEN:
            cut = p.rfind(" ", 0, MAXLEN)
            if cut < MAXLEN // 2:
                cut = MAXLEN
            out.append(lit(p[:cut]))
            p = p[cut:]
        if p or not out:
            out.append(lit(p))
    out[-1] = out[-1][:-1] + '\\n"' if out[-1].endswith('"') else out[-1] + ' "\\n"'
    return "\t" + "\n\t\t".join(out)


def convert(html):
    res = []
    for raw in html.splitlines():
        line = raw.strip()
        if not line:
            continue
        if line == "<!--#if STOCK-->":
            res.append("#if IS_ENABLED(CONFIG_CMD_HTTPD_STOCK_RESTORE)")
        elif line == "<!--#endif-->":
            res.append("#endif")
        else:
            res.append(emit(line))
    return "\n".join(res)


def main():
    html = open(sys.argv[1], encoding="utf-8").read()
    src = open(sys.argv[2], encoding="utf-8").read()
    a = src.index(BEGIN) + len(BEGIN)
    b = src.index(END)
    src = src[:a] + "\n" + convert(html) + "\n" + src[b:]
    open(sys.argv[2], "w", encoding="utf-8", newline="").write(src)


if __name__ == "__main__":
    main()

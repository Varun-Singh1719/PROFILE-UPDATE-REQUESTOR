#!/usr/bin/env python3
"""Inject IST timezone option into all frontend toLocale{String,DateString,TimeString} calls.

Approach:
- For each JS/JSX file under src/, find every `.toLocaleXxx(<args>)` invocation.
- Parse the arguments (a very small, tolerant JS-args parser that tracks depth
  of parens / braces / brackets and respects quotes) and:
    - If the arg list already contains a `timeZone:` key, skip.
    - Otherwise, insert `timeZone: "Asia/Kolkata"` as an option key.
      • If second arg is an object literal, add the key.
      • If second arg is missing (or `undefined` / `[]`), replace it with
        `{ timeZone: "Asia/Kolkata" }` (still valid for toLocale* methods).
- Never touches other code, comments preserved by only rewriting matched spans.

Idempotent — running twice is a no-op.
"""
import os
import re
import sys

METHODS = ("toLocaleString", "toLocaleDateString", "toLocaleTimeString")
IST_KEY = 'timeZone: "Asia/Kolkata"'

SRC = "/app/frontend/src"


def find_matching(text, i, open_c, close_c):
    """Given text[i] == open_c, return index of matching close_c (respecting nesting + strings)."""
    depth = 0
    n = len(text)
    while i < n:
        c = text[i]
        if c in ("'", '"', "`"):
            q = c
            i += 1
            while i < n and text[i] != q:
                if text[i] == "\\":
                    i += 2
                else:
                    i += 1
            i += 1
            continue
        if c == open_c:
            depth += 1
        elif c == close_c:
            depth -= 1
            if depth == 0:
                return i
        i += 1
    return -1


def split_top_args(args_str):
    """Split JS argument list by top-level commas."""
    parts = []
    depth = {"(": 0, "[": 0, "{": 0}
    buf = []
    i = 0
    n = len(args_str)
    while i < n:
        c = args_str[i]
        if c in ("'", '"', "`"):
            q = c
            buf.append(c)
            i += 1
            while i < n and args_str[i] != q:
                if args_str[i] == "\\":
                    buf.append(args_str[i])
                    if i + 1 < n:
                        buf.append(args_str[i + 1])
                    i += 2
                else:
                    buf.append(args_str[i])
                    i += 1
            if i < n:
                buf.append(args_str[i])
                i += 1
            continue
        if c in "([{":
            depth[c] += 1
            buf.append(c)
        elif c in ")]}":
            depth[{")": "(", "]": "[", "}": "{"}[c]] -= 1
            buf.append(c)
        elif c == "," and all(v == 0 for v in depth.values()):
            parts.append("".join(buf).strip())
            buf = []
        else:
            buf.append(c)
        i += 1
    if buf or (parts and parts[-1] != ""):
        parts.append("".join(buf).strip())
    return parts


def rewrite_call(args_str):
    """Given the *inside* of the parens of a toLocale* call, return the rewritten inside.

    Returns None if no change needed (already has timeZone or shouldn't touch)."""
    stripped = args_str.strip()
    if "timeZone" in stripped and "Asia/Kolkata" in stripped:
        return None
    if "timeZone" in stripped:
        # Has a timeZone key already (custom) — do not overwrite.
        return None

    args = split_top_args(args_str)
    if len(args) == 0 or (len(args) == 1 and args[0] == ""):
        # toLocaleXxx()   →   toLocaleXxx(undefined, { timeZone: "Asia/Kolkata" })
        return 'undefined, { ' + IST_KEY + ' }'

    locale_arg = args[0]
    if len(args) == 1:
        # Only locale provided; add options object.
        return locale_arg + ', { ' + IST_KEY + ' }'

    opts_arg = args[1]
    opts_stripped = opts_arg.strip()

    if opts_stripped in ("undefined", "null", "{}", "[]", ""):
        args[1] = '{ ' + IST_KEY + ' }'
        return ", ".join(a for a in args if a != "")

    if opts_stripped.startswith("{") and opts_stripped.endswith("}"):
        inner = opts_stripped[1:-1].strip()
        if inner:
            new_inner = inner.rstrip(", \n\t") + ", " + IST_KEY
        else:
            new_inner = IST_KEY
        args[1] = "{ " + new_inner + " }"
        return ", ".join(args)

    # Unknown shape (variable ref, spread, etc.) — leave alone to be safe.
    return None


def process_file(path):
    with open(path, "r", encoding="utf-8") as f:
        text = f.read()
    original = text

    # Iterate — need to walk once with growing output because indices shift.
    out = []
    i = 0
    n = len(text)
    changed = 0
    while i < n:
        # Find next `.toLocale...(`
        m = re.search(r"\.(" + "|".join(METHODS) + r")\s*\(", text[i:])
        if not m:
            out.append(text[i:])
            break
        start = i + m.start()
        paren_open = i + m.end() - 1
        # find matching close paren
        close = find_matching(text, paren_open, "(", ")")
        if close == -1:
            out.append(text[i:])
            break
        args_str = text[paren_open + 1:close]
        new_inner = rewrite_call(args_str)
        # copy text before start
        out.append(text[i:start])
        out.append(text[start:paren_open + 1])
        if new_inner is None:
            out.append(args_str)
        else:
            out.append(new_inner)
            changed += 1
        out.append(")")
        i = close + 1

    new_text = "".join(out)
    if new_text != original:
        with open(path, "w", encoding="utf-8") as f:
            f.write(new_text)
        return changed
    return 0


def main():
    total_files = 0
    total_edits = 0
    for root, _, files in os.walk(SRC):
        for fn in files:
            if not (fn.endswith(".js") or fn.endswith(".jsx")):
                continue
            path = os.path.join(root, fn)
            # Skip the helper file itself
            if path.endswith("/lib/dateIST.js"):
                continue
            edits = process_file(path)
            if edits:
                print(f"  {path}: +{edits}")
                total_files += 1
                total_edits += edits
    print(f"\nDone. Modified {total_files} file(s), {total_edits} call site(s).")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Check that `bun run controller` stops on Ctrl-C.

This needs a pseudo-terminal. A controller started with pipes for stdin, which
is what a normal spawned child gets, takes SIGINT the ordinary way and always
stopped correctly. The failure only appears on a real terminal: reading stdin
through `Terminal` puts the tty in raw mode, and a raw tty delivers Ctrl-C as
the byte 0x03 instead of raising SIGINT. Nothing in the vitest suite allocates
a tty, so this check lives here and is run by hand.

Usage (from the repo root):
  python3 scripts/ctrl-c-check.py
  python3 scripts/ctrl-c-check.py --port 45650

Exits 0 when the controller produced a result on Enter, printed its summary and
terminated. Exits 1 when it is still running after Ctrl-C.
"""
import os
import pty
import select
import signal
import sys
import time

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ARGS = sys.argv[1:] or ["--port", "45650"]
SETTLE = 3.0
GRACE = 10.0


def main() -> int:
    pid, fd = pty.fork()
    if pid == 0:
        os.chdir(REPO)
        os.execvp("bun", ["bun", "run", "packages/cli/src/controller.ts", *ARGS])

    collected = bytearray()

    def drain(seconds: float) -> None:
        end = time.time() + seconds
        while time.time() < end:
            readable, _, _ = select.select([fd], [], [], 0.1)
            if not readable:
                continue
            try:
                chunk = os.read(fd, 65536)
            except OSError:
                return
            if not chunk:
                return
            collected.extend(chunk)

    drain(SETTLE)
    os.write(fd, b"\r")
    drain(1.5)
    os.write(fd, b"\x03")

    # Reap independently of the pty: a closed pty must not be mistaken for a
    # process that exited, and vice versa.
    status = None
    deadline = time.time() + GRACE
    while time.time() < deadline:
        drain(0.2)
        waited, code = os.waitpid(pid, os.WNOHANG)
        if waited:
            status = code
            break

    text = collected.decode("utf-8", "replace")
    produced = text.count("produced a result on request")
    summarised = "controller stopped" in text
    print(f"produced on Enter : {produced}")
    print(f"summary printed   : {summarised}")

    if status is None:
        print("FAIL: still running after Ctrl-C")
        os.kill(pid, signal.SIGKILL)
        os.waitpid(pid, 0)
        return 1

    print(f"PASS: exited with raw status {status}")
    return 0 if produced >= 1 and summarised else 1


if __name__ == "__main__":
    sys.exit(main())

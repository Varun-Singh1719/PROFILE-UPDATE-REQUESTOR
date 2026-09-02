"""Read-only MySQL access layer for the external Infollion CRM database.

The main application stays on MongoDB (auth, workspace, notifications, etc.).
Only the CRM *Clients* and *Client Contacts* read endpoints query this MySQL
database live on every request. All access here is READ-ONLY.

Connection details come from MYSQL_* env vars (see backend/.env).

A small pool of persistent connections is reused across requests so we don't
pay the ~2s remote-connect cost on every query. Connections use
autocommit=True so every SELECT always sees the latest committed data
(i.e. reads stay live/fresh even though connections are reused).
"""
import os
import queue
import asyncio
import threading
from datetime import datetime, date
from decimal import Decimal

import pymysql
from pymysql.cursors import DictCursor

_POOL_SIZE = 5
_pool: "queue.Queue" = None
_pool_lock = threading.Lock()


def _config() -> dict:
    return {
        "host": os.environ.get("MYSQL_HOST"),
        "port": int(os.environ.get("MYSQL_PORT", "3306")),
        "user": os.environ.get("MYSQL_USER"),
        "password": os.environ.get("MYSQL_PASSWORD"),
        "database": os.environ.get("MYSQL_DB"),
        "connect_timeout": 15,
        "read_timeout": 30,
        "charset": "utf8mb4",
        "autocommit": True,          # every SELECT sees fresh committed data
        "cursorclass": DictCursor,
    }


def _get_pool() -> "queue.Queue":
    global _pool
    if _pool is None:
        with _pool_lock:
            if _pool is None:
                p = queue.Queue(maxsize=_POOL_SIZE)
                for _ in range(_POOL_SIZE):
                    p.put(None)  # slots filled lazily on first use
                _pool = p
    return _pool


def _acquire():
    pool = _get_pool()
    conn = pool.get()  # blocks until a slot is free
    if conn is None:
        conn = pymysql.connect(**_config())
    return conn


def _release(conn):
    _get_pool().put(conn)


def _jsonable(v):
    if isinstance(v, (datetime, date)):
        return v.isoformat()
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, bytes):
        return v.decode("utf-8", "ignore")
    return v


def _run(conn, sql, params):
    with conn.cursor() as cur:
        cur.execute(sql, params or ())
        rows = cur.fetchall()
    return [{k: _jsonable(v) for k, v in r.items()} for r in rows]


def _query_sync(sql: str, params=None):
    conn = _acquire()
    try:
        # Reuse the pooled connection directly (no ping — saves a round-trip on
        # the high-latency remote link). If it has gone stale, reconnect once.
        try:
            rows = _run(conn, sql, params)
            _release(conn)
            return rows
        except (pymysql.err.OperationalError, pymysql.err.InterfaceError):
            try:
                conn.close()
            except Exception:
                pass
            conn = pymysql.connect(**_config())
            rows = _run(conn, sql, params)
            _release(conn)
            return rows
    except Exception:
        try:
            conn.close()
        except Exception:
            pass
        _release(None)  # drop broken connection, keep the slot
        raise


async def mysql_query(sql: str, params=None):
    """Run a SELECT and return a list of dict rows (JSON-serialisable)."""
    return await asyncio.to_thread(_query_sync, sql, params)


async def mysql_query_one(sql: str, params=None):
    rows = await mysql_query(sql, params)
    return rows[0] if rows else None


def _warm_pool():
    """Fill the connection pool in the background so the first user requests
    don't pay the remote-connect cost."""
    for _ in range(_POOL_SIZE):
        try:
            _query_sync("SELECT 1")
        except Exception:
            pass


# Kick off a non-blocking warm-up as soon as this module is first imported.
try:
    threading.Thread(target=_warm_pool, daemon=True).start()
except Exception:
    pass

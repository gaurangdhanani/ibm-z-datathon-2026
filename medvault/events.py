"""VLT-9: in-process event bus and Server-Sent Event streams.

Routes run in worker threads and call ``publish`` after they commit; every open stream whose
filter matches gets the event (``loop.call_soon_threadsafe`` crosses the thread boundary). The
browser opens ``GET /api/patient/events`` or ``GET /api/hospital/events`` with EventSource and
simply refetches whatever is on screen when a ``change`` event arrives (``lib/bus.ts``).
Single-process demo: nothing is persisted, nothing crosses processes.
"""

from __future__ import annotations

import asyncio
import json
import threading
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass

from fastapi import Request
from fastapi.responses import StreamingResponse

HEARTBEAT_SECONDS = 15


@dataclass
class Event:
    kind: str  # access | alert | grant | emergency | request | record | reset
    patient_id: int | None = None
    hospital_id: int | None = None


@dataclass(eq=False)  # identity-hashed: each stream is its own subscriber
class _Subscriber:
    queue: asyncio.Queue
    loop: asyncio.AbstractEventLoop
    matches: Callable[[Event], bool]


_subscribers: set[_Subscriber] = set()
_lock = threading.Lock()


def subscribe(matches: Callable[[Event], bool]) -> _Subscriber:
    sub = _Subscriber(asyncio.Queue(), asyncio.get_running_loop(), matches)
    with _lock:
        _subscribers.add(sub)
    return sub


def unsubscribe(sub: _Subscriber) -> None:
    with _lock:
        _subscribers.discard(sub)


def publish(kind: str, *, patient_id: int | None = None, hospital_id: int | None = None) -> int:
    """Fan one event out to every matching stream. Safe from any thread. Returns the fan-out."""
    event = Event(kind, patient_id, hospital_id)
    with _lock:
        targets = [s for s in _subscribers if s.matches(event)]
    for sub in targets:
        sub.loop.call_soon_threadsafe(sub.queue.put_nowait, event)
    return len(targets)


def subscriber_count() -> int:
    with _lock:
        return len(_subscribers)


def sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, separators=(',', ':'))}\n\n"


async def _stream(request: Request, matches: Callable[[Event], bool]) -> AsyncIterator[str]:
    sub = subscribe(matches)
    try:
        yield sse("ready", {})
        while not await request.is_disconnected():
            try:
                ev = await asyncio.wait_for(sub.queue.get(), timeout=HEARTBEAT_SECONDS)
            except asyncio.TimeoutError:
                yield ": ping\n\n"  # keeps proxies and the browser from closing an idle stream
                continue
            yield sse(
                "change",
                {"kind": ev.kind, "patient_id": ev.patient_id, "hospital_id": ev.hospital_id},
            )
    finally:
        unsubscribe(sub)


def stream_response(request: Request, matches: Callable[[Event], bool]) -> StreamingResponse:
    return StreamingResponse(
        _stream(request, matches),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
    )

"""Authenticated account linking and secret-protected provider webhooks."""

import asyncio
import json
import secrets
from typing import Literal

from fastapi import Cookie, HTTPException, Request
from pydantic import BaseModel, Field

from .providers import config, configured


class PairingConfirmation(BaseModel):
    code: str = Field(min_length=6, max_length=6, pattern=r"^[a-fA-F0-9]{6}$")


class NotificationPreference(BaseModel):
    channel: Literal["telegram", "max", "both", "off"]


def install_bot_routes(app, engine):
    desk = engine.desk

    @app.get("/api/bots")
    def bot_settings(desk_session: str | None = Cookie(default=None)):
        user = desk.current_user(desk_session)
        with desk.db() as conn:
            return engine.settings(conn, user)

    @app.post("/api/bots/{provider}/pairing")
    def pair(provider: Literal["telegram", "max"], desk_session: str | None = Cookie(default=None)):
        user = desk.current_user(desk_session)
        with desk.db() as conn:
            conn.execute("BEGIN IMMEDIATE")
            return engine.create_pairing(conn, user, provider)

    @app.post("/api/bots/{provider}/confirm")
    def confirm(provider: Literal["telegram", "max"], data: PairingConfirmation, desk_session: str | None = Cookie(default=None)):
        user = desk.current_user(desk_session)
        with desk.db() as conn:
            conn.execute("BEGIN IMMEDIATE")
            return engine.confirm_pairing(conn, user, provider, data.code)

    @app.delete("/api/bots/{provider}")
    def unlink(provider: Literal["telegram", "max"], desk_session: str | None = Cookie(default=None)):
        user = desk.current_user(desk_session)
        with desk.db() as conn:
            conn.execute("BEGIN IMMEDIATE")
            return engine.unlink(conn, user, provider)

    @app.put("/api/bots/preferences")
    def preferences(data: NotificationPreference, desk_session: str | None = Cookie(default=None)):
        user = desk.current_user(desk_session)
        with desk.db() as conn:
            conn.execute("BEGIN IMMEDIATE")
            engine.preference(conn, user, data.channel)
        return {"ok": True}

    @app.post("/webhooks/{provider}")
    async def webhook(provider: Literal["telegram", "max"], request: Request):
        if not configured(provider):
            raise HTTPException(503, "Bot not configured")
        header = "X-Telegram-Bot-Api-Secret-Token" if provider == "telegram" else "X-Max-Bot-Api-Secret"
        secret = request.headers.get(header, "")
        if not secrets.compare_digest(secret.encode(), config(provider)["secret"].encode()):
            raise HTTPException(403, "Invalid webhook secret")
        raw = bytearray()
        async for chunk in request.stream():
            raw.extend(chunk)
            if len(raw) > 262144:
                raise HTTPException(413, "Update too large")
        try:
            update = json.loads(raw)
            return await asyncio.to_thread(engine.receive, provider, update)
        except (ValueError, TypeError, KeyError, AttributeError):
            raise HTTPException(400, "Malformed update") from None

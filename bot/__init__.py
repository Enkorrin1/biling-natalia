"""Bot integration package.

The bot package owns messenger adapters, pairing/webhook routes, the
conversation engine, persistence schema, and the durable delivery worker.
The web application remains the domain/service boundary used by the engine.
"""

from .service import BotEngine

__all__ = ["BotEngine"]

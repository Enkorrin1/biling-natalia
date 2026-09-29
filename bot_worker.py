"""Backward-compatible launcher; use ``python -m bot.worker`` instead."""

from bot.worker import *  # noqa: F401,F403


if __name__ == "__main__":
    from bot.worker import main

    main()

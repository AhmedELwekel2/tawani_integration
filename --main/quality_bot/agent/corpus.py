"""Scheduled refresh of the news corpus.

This module is the **only** thing in the agent that scrapes. Everything else --
the news endpoints and the report pipeline alike -- reads what it stored.

Why: a scrape hits 7 web sources (several through headless Chromium) and the X
API, where 13 accounts batched 5 per query cost 3 metered calls. Running that on
the request path meant every news-tab view and every report generation paid for
it. Refreshing on a timer instead makes the cost a function of the clock rather
than of traffic.
"""
import asyncio
import logging
import os
from datetime import datetime, timezone

from . import _legacy as L
from . import store

logger = logging.getLogger(__name__)

# Hours between refreshes. Env-configurable so the cadence can change without a
# rebuild; a fractional value is accepted, which is how the interval is tested.
REFRESH_HOURS = float(os.getenv("TAWANI_REFRESH_HOURS", "6") or 6)

# Articles not seen for this long are dropped. Generous because monthly reports
# read back over weeks.
MAX_AGE_DAYS = int(os.getenv("TAWANI_CORPUS_MAX_AGE_DAYS", "60") or 60)

_refreshing = asyncio.Lock()


async def refresh_corpus() -> dict:
    """Fetch every source once and fold the result into the store.

    Serialised by a lock: the scheduled tick and a manual POST /corpus/refresh
    must never scrape concurrently and double the API spend.
    """
    if _refreshing.locked():
        logger.info("corpus refresh already running; skipping this request")
        return {"skipped": True, **store.corpus_status()}

    async with _refreshing:
        started = datetime.now(timezone.utc)
        logger.info("corpus refresh: starting")
        try:
            articles = await asyncio.to_thread(L.fetch_tourism_news) or []
        except Exception as exc:  # noqa: BLE001 - recorded, never raised to the caller
            logger.exception("corpus refresh failed")
            store.record_refresh(0, error=f"{type(exc).__name__}: {exc}")
            return {"ok": False, **store.corpus_status()}

        written = await asyncio.to_thread(store.upsert_articles, articles)
        pruned = await asyncio.to_thread(store.prune_articles, MAX_AGE_DAYS)
        store.record_refresh(written)

        took = (datetime.now(timezone.utc) - started).total_seconds()
        logger.info(
            "corpus refresh: %d fetched, %d stored, %d pruned, %.1fs",
            len(articles), written, pruned, took,
        )
        return {"ok": True, "fetched": len(articles), "stored": written,
                "pruned": pruned, "seconds": round(took, 1), **store.corpus_status()}


def _is_stale() -> bool:
    """True when the corpus is older than one interval, or has never been built."""
    status = store.corpus_status()
    age = status.get("age_minutes")
    if age is None:
        return True
    return age >= REFRESH_HOURS * 60


async def refresh_loop() -> None:
    """Background task: refresh if stale, then every REFRESH_HOURS.

    The staleness check on boot matters. Without it a container that restarts
    repeatedly -- a crash loop, or a few redeploys in a row -- would scrape on
    every start and spend the X quota that the schedule exists to protect.
    """
    try:
        if _is_stale():
            logger.info("corpus is stale on startup; refreshing now")
            await refresh_corpus()
        else:
            status = store.corpus_status()
            logger.info(
                "corpus is fresh (%.1f minutes old, %d articles); next refresh in %.1fh",
                status["age_minutes"], status["article_count"], REFRESH_HOURS,
            )

        while True:
            await asyncio.sleep(REFRESH_HOURS * 3600)
            await refresh_corpus()
    except asyncio.CancelledError:
        logger.info("corpus refresh loop stopped")
        raise

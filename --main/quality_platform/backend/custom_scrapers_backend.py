"""Custom scraper bridge.

The Tourism sources are now aggregated by
``telegram_bot_tourism.fetch_tourism_news`` (Twitter/X + RSS + static HTML + Playwright
JS), which the scheduler calls directly. This module is kept for backward
compatibility and simply returns an empty list so any remaining caller degrades
gracefully.
"""


async def get_custom_scraper_articles(max_articles_per_source=50):
    return []

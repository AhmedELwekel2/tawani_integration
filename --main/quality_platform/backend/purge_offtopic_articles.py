"""Flag stored articles that fall outside the tourism & entertainment scope.

Articles ingested before the scope filter was tightened may still sit in the DB
with ``is_relevant=True`` — sport, politics or war stories that the listing
endpoints and the report builders would happily pick up. This one-off pass
re-checks every stored article with the same rule the scheduler now applies
(``telegram_bot_tourism.blocked_topic_match``) and marks the out-of-scope ones
``is_relevant=False``. Nothing is deleted, so the decision is reversible.

Usage (from ``quality_platform/backend``):

    python purge_offtopic_articles.py            # dry run — report only
    python purge_offtopic_articles.py --apply    # write the flags
"""
import os
import sys

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(os.path.dirname(CURRENT_DIR))
if PROJECT_ROOT not in sys.path:
    sys.path.append(PROJECT_ROOT)

from dotenv import load_dotenv  # noqa: E402

for _env in (
    os.path.join(CURRENT_DIR, ".env"),
    os.path.join(PROJECT_ROOT, "quality_platform", ".env"),
    os.path.join(PROJECT_ROOT, "quality_bot", ".env"),
    os.path.join(PROJECT_ROOT, ".env"),
):
    if os.path.exists(_env):
        load_dotenv(_env)

# Same rationale as scheduler.py: keep the bot from picking up a bearer token.
os.environ.pop("AWS_BEARER_TOKEN_BEDROCK", None)

from telegram_bot_tourism import blocked_topic_match  # type: ignore  # noqa: E402

from database import SessionLocal  # noqa: E402
from models import Article  # noqa: E402


def main(apply_changes: bool):
    db = SessionLocal()
    try:
        articles = db.query(Article).filter(Article.is_relevant.isnot(False)).all()
        offenders = []
        for a in articles:
            term = blocked_topic_match({"title": a.title, "description": a.description})
            if term:
                offenders.append((a, term))

        print("Scanned %d in-scope-flagged articles; %d are out of scope."
              % (len(articles), len(offenders)))
        for a, term in offenders:
            print("  [%s] %s | %s" % (a.id, term, (a.title or "")[:70]))

        if not offenders:
            return
        if not apply_changes:
            print("\nDry run — re-run with --apply to flag them as not relevant.")
            return

        for a, _ in offenders:
            a.is_relevant = False
        db.commit()
        print("\nFlagged %d articles as is_relevant=False." % len(offenders))
    finally:
        db.close()


if __name__ == "__main__":
    main("--apply" in sys.argv)

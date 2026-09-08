"""FastAPI test harness for the Tourism LangGraph agent.

Exposes the four report pipelines (daily / weekly / monthly / magazine) as HTTP
endpoints that drive the compiled graphs directly — bypassing Telegram and the
per-user usage limits — so you can verify the agent end to end.

Run with (from the ``quality_bot`` directory):

    uvicorn agent.api:app --reload --port 8000
    # or:  python -m agent.api

Then open http://127.0.0.1:8000/docs for an interactive UI.

Each endpoint runs the full pipeline (live scraping + LLM generation + PDF
render), so a request can take a few minutes. The ``format`` query param controls
the response:

* ``file`` (default) – save the PDF under ``generated/`` and return JSON with a
  ``download_url`` you can open directly in a browser. Easiest in Postman.
* ``pdf``            – stream the PDF binary as a file download.
* ``json``           – return the raw markdown / magazine JSON (no PDF kept).
"""
import asyncio
import logging
import os
import time
from datetime import datetime
from typing import Any, Dict, Optional

from fastapi import Body, Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from starlette.background import BackgroundTask

from . import _legacy as L
from . import store
from .graphs import daily_graph, magazine_graph, periodic_graph

logging.basicConfig(
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    level=logging.INFO,
)
logger = logging.getLogger(__name__)

# Directory where generated PDFs are saved (for ``format=file``) and served from.
GENERATED_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "generated")
os.makedirs(GENERATED_DIR, exist_ok=True)

app = FastAPI(
    title="Tourism News Agent API",
    description="Test harness for the LangGraph-powered Tourism report agent.",
    version="1.0.0",
)

# Allow browser-based frontends (any origin) to call the API during development.
# Tighten ``allow_origins`` to your real frontend URL(s) before production.
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Saved PDFs are downloadable at /files/<name>.pdf
app.mount("/files", StaticFiles(directory=GENERATED_DIR), name="files")

# The agent keeps its own report database. Consumers (admin panel, portal) read
# it over HTTP and keep their own storage entirely separate.
store.init_db()


# --------------------------------------------------------------------------- #
# Admin guard
# --------------------------------------------------------------------------- #
# Generating a report costs minutes of LLM time, and publishing one decides what
# stockholders see -- neither belongs on an open endpoint. Set TAWANI_ADMIN_KEY
# and those routes require it; leave it unset and the API stays fully open, which
# is convenient locally and must not be how it is deployed.
ADMIN_KEY = os.getenv("TAWANI_ADMIN_KEY", "").strip()


def require_admin(x_tawani_admin_key: Optional[str] = Header(default=None)) -> None:
    if not ADMIN_KEY:
        return
    if x_tawani_admin_key != ADMIN_KEY:
        raise HTTPException(status_code=401, detail="غير مصرّح.")


# --------------------------------------------------------------------------- #
# Request models
# --------------------------------------------------------------------------- #
class DailyRequest(BaseModel):
    category: Optional[str] = None          # e.g. "الطيران والسفر" | "الفنادق والضيافة"
    keywords: Optional[Dict[str, Any]] = None


class PeriodicRequest(BaseModel):
    keywords: Optional[Dict[str, Any]] = None


class MagazineRequest(BaseModel):
    keywords: Optional[Dict[str, Any]] = None


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def _cleanup(path: str):
    try:
        if path and os.path.exists(path):
            os.unlink(path)
    except OSError:
        pass


async def _run(graph, initial: dict):
    """Invoke a compiled graph and return its final state (raising on error)."""
    final_state = await graph.ainvoke(initial)
    if not final_state or final_state.get("error"):
        err = (final_state or {}).get("error") or "حدث خطأ غير متوقع."
        raise HTTPException(status_code=502, detail=err)
    return final_state


def _pdf_response(state: dict, download_name: str) -> FileResponse:
    outputs = state.get("outputs") or []
    if not outputs:
        raise HTTPException(status_code=502, detail="تعذّر إنشاء التقرير (لا توجد مخرجات).")
    path = outputs[0].get("path")
    if not path or not os.path.exists(path):
        raise HTTPException(status_code=502, detail="ملف PDF غير موجود بعد التوليد.")
    return FileResponse(
        path,
        media_type="application/pdf",
        filename=download_name,
        background=BackgroundTask(_cleanup, path),
    )


def _json_response(state: dict) -> JSONResponse:
    """Return generated content + output metadata without streaming the PDF.

    The PDF (if any) is cleaned up since it won't be downloaded here.
    """
    payload = {
        "report_type": state.get("report_type"),
        "time_period": state.get("time_period"),
        "enhanced_count": state.get("enhanced_count"),
        "article_count": len(state.get("articles") or []),
        "blog_content": state.get("blog_content"),
        "combined_blog": state.get("combined_blog"),
        "magazine_data": state.get("magazine_data"),
        "outputs": [{"kind": o.get("kind")} for o in (state.get("outputs") or [])],
    }
    for o in state.get("outputs") or []:
        _cleanup(o.get("path"))
    return JSONResponse(content=payload)


def _file_response(state: dict, request: Request, download_name: str) -> JSONResponse:
    """Persist the PDF under ``generated/`` and return a browser-openable URL."""
    outputs = state.get("outputs") or []
    if not outputs:
        raise HTTPException(status_code=502, detail="تعذّر إنشاء التقرير (لا توجد مخرجات).")
    src = outputs[0].get("path")
    if not src or not os.path.exists(src):
        raise HTTPException(status_code=502, detail="ملف PDF غير موجود بعد التوليد.")

    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    fname = f"{os.path.splitext(download_name)[0]}_{stamp}.pdf"
    dest = os.path.join(GENERATED_DIR, fname)
    os.replace(src, dest)

    download_url = str(request.base_url).rstrip("/") + f"/files/{fname}"

    # Record it. The report is a draft until someone publishes it, so generating
    # never by itself changes what stockholders can see.
    report = store.create_report(
        report_type=state.get("report_type") or "daily",
        pdf_file=fname,
        article_count=len(state.get("articles") or []),
        enhanced_count=state.get("enhanced_count"),
    )

    return JSONResponse(content={
        "status": "ok",
        "id": report["id"],
        "report": report,
        "report_type": state.get("report_type"),
        "time_period": state.get("time_period"),
        "article_count": len(state.get("articles") or []),
        "enhanced_count": state.get("enhanced_count"),
        "kind": outputs[0].get("kind"),
        "pdf_path": dest,
        "download_url": download_url,
    })


def _respond(state: dict, fmt: str, request: Request, download_name: str):
    if fmt == "json":
        return _json_response(state)
    if fmt == "pdf":
        return _pdf_response(state, download_name)
    return _file_response(state, request, download_name)


# --------------------------------------------------------------------------- #
# Endpoints
# --------------------------------------------------------------------------- #
@app.get("/health")
async def health():
    from . import config
    return {
        "status": "ok",
        "llm": {"bedrock": config.HAS_BEDROCK, "azure": config.HAS_AZURE},
        "model": config.BEDROCK_MODEL_ID,
    }


# --------------------------------------------------------------------------- #
# News listing (fast — fetch + filter only, no LLM, no PDF)
# --------------------------------------------------------------------------- #
def _normalize_article(a: dict) -> dict:
    src = a.get("source")
    src_name = src.get("name") if isinstance(src, dict) else (src or "")
    return {
        "title": a.get("title"),
        "source": src_name,
        "url": a.get("url"),
        "published_at": a.get("publishedAt") or a.get("published_at"),
        "description": a.get("description"),
        "image": a.get("urlToImage") or a.get("image_url") or a.get("image"),
    }


# Listings are served to every stockholder who opens the news tab, and each miss
# scrapes ~50 sources. Cache by exact query so a burst of readers costs one
# fetch; the feed does not move faster than this anyway.
_NEWS_TTL_SECONDS = 15 * 60
_news_cache: Dict[tuple, tuple] = {}
_news_locks: Dict[tuple, asyncio.Lock] = {}


async def _news_cached(period: str, days: int, category: Optional[str], limit: int) -> dict:
    key = (period, days, category, limit)
    now = time.monotonic()

    cached = _news_cache.get(key)
    if cached and now - cached[0] < _NEWS_TTL_SECONDS:
        return cached[1]

    # One lock per query, so concurrent readers of the same feed wait for a
    # single fetch instead of each starting their own.
    lock = _news_locks.setdefault(key, asyncio.Lock())
    async with lock:
        cached = _news_cache.get(key)
        if cached and time.monotonic() - cached[0] < _NEWS_TTL_SECONDS:
            return cached[1]

        result = await _news_listing(period, days, category, limit)
        _news_cache[key] = (time.monotonic(), result)
        return result


async def _news_listing(period: str, days: int, category: Optional[str], limit: int) -> dict:
    articles = await asyncio.to_thread(L.fetch_tourism_news) or []

    recent = await asyncio.to_thread(lambda: L.filter_recent_articles(articles, days=days) or [])
    if not recent:
        recent = articles  # fallback: show whatever was fetched

    # Narrow to the tourism & entertainment scope. No fallback here on purpose:
    # if nothing is in scope the honest answer is an empty feed, not a list of
    # sport/politics/war stories the filter just rejected.
    recent = await asyncio.to_thread(lambda: L.filter_relevant_articles(recent) or [])

    if category:
        cats = await asyncio.to_thread(L.categorize_articles, recent)
        recent = cats.get(category, [])

    items = [_normalize_article(a) for a in recent if a]
    items = items[:limit]
    return {
        "period": period,
        "days": days,
        "category": category,
        "count": len(items),
        "articles": items,
    }


@app.get("/news/daily", summary="List today's Tourism news (no AI, no PDF)")
async def news_daily(
    days: int = Query(1, ge=1, le=365),
    category: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
):
    return await _news_cached("daily", days, category, limit)


@app.get("/news/weekly", summary="List this week's Tourism news (no AI, no PDF)")
async def news_weekly(
    days: int = Query(7, ge=1, le=365),
    category: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=200),
):
    return await _news_cached("weekly", days, category, limit)


@app.get("/news/monthly", summary="List this month's Tourism news (no AI, no PDF)")
async def news_monthly(
    days: int = Query(30, ge=1, le=365),
    category: Optional[str] = Query(None),
    limit: int = Query(150, ge=1, le=200),
):
    return await _news_cached("monthly", days, category, limit)


@app.post("/reports/daily", summary="Generate the daily Tourism report")
async def daily(
    request: Request,
    _: None = Depends(require_admin),
    body: Optional[DailyRequest] = Body(default=None),
    format: str = Query("file", pattern="^(file|pdf|json)$"),
):
    body = body or DailyRequest()
    state = await _run(daily_graph, {
        "report_type": "daily",
        "category": body.category,
        "keywords": body.keywords,
    })
    return _respond(state, format, request, "Tourism_Daily_Report.pdf")


@app.post("/reports/weekly", summary="Generate the weekly combined Tourism report")
async def weekly(
    request: Request,
    _: None = Depends(require_admin),
    body: Optional[PeriodicRequest] = Body(default=None),
    format: str = Query("file", pattern="^(file|pdf|json)$"),
):
    body = body or PeriodicRequest()
    state = await _run(periodic_graph, {
        "report_type": "weekly",
        "time_period": "weekly",
        "keywords": body.keywords,
    })
    return _respond(state, format, request, "Tourism_Weekly_Report.pdf")


@app.post("/reports/monthly", summary="Generate the monthly combined Tourism report")
async def monthly(
    request: Request,
    _: None = Depends(require_admin),
    body: Optional[PeriodicRequest] = Body(default=None),
    format: str = Query("file", pattern="^(file|pdf|json)$"),
):
    body = body or PeriodicRequest()
    state = await _run(periodic_graph, {
        "report_type": "monthly",
        "time_period": "monthly",
        "keywords": body.keywords,
    })
    return _respond(state, format, request, "Tourism_Monthly_Report.pdf")


@app.post("/reports/magazine", summary="Generate the monthly Tourism magazine PDF")
async def magazine(
    request: Request,
    _: None = Depends(require_admin),
    body: Optional[MagazineRequest] = Body(default=None),
    format: str = Query("file", pattern="^(file|pdf|json)$"),
):
    body = body or MagazineRequest()
    state = await _run(magazine_graph, {
        "report_type": "magazine",
        "keywords": body.keywords,
    })
    return _respond(state, format, request, "Tourism_Magazine.pdf")


# --------------------------------------------------------------------------- #
# Report library (the agent's own database)
# --------------------------------------------------------------------------- #
class ReportPatch(BaseModel):
    is_published: Optional[bool] = None
    title_ar: Optional[str] = None
    title_en: Optional[str] = None


@app.get("/library", summary="List stored reports")
async def library(
    published_only: bool = Query(False, description="Only reports released to stockholders"),
    report_type: Optional[str] = Query(None, pattern="^(daily|weekly|monthly|magazine)$"),
    limit: int = Query(50, ge=1, le=200),
):
    """Public when ``published_only=true`` -- that is the stockholder portal's feed."""
    items = await asyncio.to_thread(store.list_reports, published_only, report_type, limit)
    return {"count": len(items), "reports": items}


@app.get("/library/{report_id}", summary="Fetch one stored report")
async def library_item(report_id: str):
    report = await asyncio.to_thread(store.get_report, report_id)
    if report is None:
        raise HTTPException(status_code=404, detail="التقرير غير موجود.")
    return report


@app.get("/library/{report_id}/pdf", summary="Download a stored report's PDF")
async def library_pdf(report_id: str):
    report = await asyncio.to_thread(store.get_report, report_id)
    if report is None:
        raise HTTPException(status_code=404, detail="التقرير غير موجود.")

    pdf_file = report.get("pdf_file")
    path = os.path.join(GENERATED_DIR, pdf_file) if pdf_file else None
    if not path or not os.path.exists(path):
        raise HTTPException(status_code=404, detail="ملف PDF غير موجود.")

    # Served inline, not as a background-deleted temp file: this PDF is the
    # stored artefact and may be opened many times.
    return FileResponse(path, media_type="application/pdf", filename=pdf_file)


@app.patch("/library/{report_id}", summary="Publish, unpublish or retitle a report")
async def library_patch(
    report_id: str,
    patch: ReportPatch,
    _: None = Depends(require_admin),
):
    report = await asyncio.to_thread(
        store.update_report, report_id, patch.is_published, patch.title_ar, patch.title_en
    )
    if report is None:
        raise HTTPException(status_code=404, detail="التقرير غير موجود.")
    return report


@app.delete("/library/{report_id}", summary="Delete a stored report and its PDF")
async def library_delete(report_id: str, _: None = Depends(require_admin)):
    removed = await asyncio.to_thread(store.delete_report, report_id, GENERATED_DIR)
    if not removed:
        raise HTTPException(status_code=404, detail="التقرير غير موجود.")
    return {"status": "deleted", "id": report_id}


def main():
    import uvicorn
    uvicorn.run("agent.api:app", host="0.0.0.0", port=8000, reload=False)


if __name__ == "__main__":
    main()

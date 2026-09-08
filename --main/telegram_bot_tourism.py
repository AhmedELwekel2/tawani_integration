import requests
import json
from datetime import datetime, timedelta
import asyncio
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import Application, CommandHandler, MessageHandler, CallbackQueryHandler, filters, ContextTypes
import logging
from reportlab.lib.pagesizes import letter, A4
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak, Table, TableStyle, Image
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_JUSTIFY, TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.lib.units import inch
from reportlab.lib.colors import HexColor
import os
import threading
from concurrent.futures import ThreadPoolExecutor
import tempfile
from bs4 import BeautifulSoup
from urllib.parse import urlparse, urljoin
import re
import time
from newspaper import Article
import nltk
from readability import readability
import feedparser
import arabic_reshaper
from bidi.algorithm import get_display
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from jinja2 import Environment, FileSystemLoader
import boto3
from botocore.config import Config
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()
try:
    from weasyprint import HTML, CSS
    WEASYPRINT_AVAILABLE = True
except OSError:
    WEASYPRINT_AVAILABLE = False
    logging.warning("WeasyPrint (GTK) not found. PDF generation will be disabled.")
except ImportError:
    WEASYPRINT_AVAILABLE = False
    logging.warning("WeasyPrint module not found.")

# Configure logging
logging.basicConfig(
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    level=logging.INFO
)
logger = logging.getLogger(__name__)

# Download required NLTK data (run once)
try:
    nltk.data.find('tokenizers/punkt')
except LookupError:
    nltk.download('punkt')

# Register Arabic font. Resolve relative to THIS file first (works regardless of
# the caller's CWD — e.g. the quality_platform backend), then fall back to CWD.
try:
    _here = os.path.dirname(os.path.abspath(__file__))
    _amiri = next(
        (p for p in (os.path.join(_here, 'Amiri-Regular.ttf'), 'Amiri-Regular.ttf')
         if os.path.exists(p)),
        'Amiri-Regular.ttf',
    )
    pdfmetrics.registerFont(TTFont('Amiri', _amiri))
except Exception as e:
    logger.error(f"Failed to register Arabic font: {e}")

# Usage limits configuration
USAGE_LIMITS = {
    'daily_news': 30,
    'weekly': 4,
    'monthly': 2,
    'magazine': 2
}

# Admin user IDs (add your Telegram user ID here)
ADMIN_USER_IDS = [1029062753]  # Add admin IDs like [123456789, 987654321]

# Usage tracking file
USAGE_FILE = 'user_usage.json'

def load_usage_data():
    """Load usage data from JSON file."""
    if os.path.exists(USAGE_FILE):
        try:
            with open(USAGE_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            logger.error(f"Error loading usage data: {e}")
            return {}
    return {}

def save_usage_data(usage_data):
    """Save usage data to JSON file."""
    try:
        with open(USAGE_FILE, 'w', encoding='utf-8') as f:
            json.dump(usage_data, f, indent=2, ensure_ascii=False)
    except Exception as e:
        logger.error(f"Error saving usage data: {e}")

def get_user_id(update):
    """Get user ID from update."""
    if update.callback_query:
        return update.callback_query.from_user.id
    return update.message.from_user.id

def check_usage_limit(user_id, feature):
    """Check if user has reached usage limit for a feature."""
    usage_data = load_usage_data()
    user_key = str(user_id)
    
    if user_key not in usage_data:
        return True, 0  # New user, has limit
    
    user_usage = usage_data[user_key]
    feature_key = feature
    
    if feature_key not in user_usage:
        return True, 0  # Feature not used yet
    
    current_usage = user_usage[feature_key]
    limit = USAGE_LIMITS.get(feature, 0)
    
    if current_usage >= limit:
        return False, current_usage  # Limit reached
    return True, current_usage  # Still has usage left

def increment_usage(user_id, feature):
    """Increment usage count for a user and feature."""
    usage_data = load_usage_data()
    user_key = str(user_id)
    
    if user_key not in usage_data:
        usage_data[user_key] = {}
    
    if feature not in usage_data[user_key]:
        usage_data[user_key][feature] = 0
    
    usage_data[user_key][feature] += 1
    save_usage_data(usage_data)

def reset_user_usage(user_id=None):
    """Reset usage for a specific user or all users."""
    if user_id:
        usage_data = load_usage_data()
        user_key = str(user_id)
        if user_key in usage_data:
            usage_data[user_key] = {}
            save_usage_data(usage_data)
            return True
        return False
    else:
        # Reset all users
        save_usage_data({})
        return True

def get_usage_status(user_id):
    """Get current usage status for a user."""
    usage_data = load_usage_data()
    user_key = str(user_id)
    
    if user_key not in usage_data:
        return {
            'daily_news': {'used': 0, 'limit': USAGE_LIMITS['daily_news']},
            'weekly': {'used': 0, 'limit': USAGE_LIMITS['weekly']},
            'monthly': {'used': 0, 'limit': USAGE_LIMITS['monthly']},
            'magazine': {'used': 0, 'limit': USAGE_LIMITS['magazine']}
        }
    
    user_usage = usage_data[user_key]
    return {
        'daily_news': {'used': user_usage.get('daily_news', 0), 'limit': USAGE_LIMITS['daily_news']},
        'weekly': {'used': user_usage.get('weekly', 0), 'limit': USAGE_LIMITS['weekly']},
        'monthly': {'used': user_usage.get('monthly', 0), 'limit': USAGE_LIMITS['monthly']},
        'magazine': {'used': user_usage.get('magazine', 0), 'limit': USAGE_LIMITS['magazine']}
    }

# Your Telegram Bot Token (you'll need to get this from @BotFather)
TELEGRAM_TOKEN = os.getenv("TELEGRAM_TOKEN", "")

# AWS Bedrock Configuration
# Support both variable name formats for flexibility
AWS_BEARER_TOKEN_BEDROCK = os.getenv("AWS_BEARER_TOKEN_BEDROCK")
AWS_REGION = os.getenv("AWS_REGION") or os.getenv("AWS_BEDROCK_REGION", "us-east-1")
AWS_BEDROCK_INFERENCE_PROFILE = os.getenv("AWS_BEDROCK_INFERENCE_PROFILE") or os.getenv("AWS_BEDROCK_INFERENCE_PROFILE_ID", "us.anthropic.claude-sonnet-4-5-20250929-v1:0")

# Concurrency gate for model calls. Several users generating reports at the same
# time otherwise fire simultaneous InvokeModel requests, which throttle each
# other. Callers queue here instead — slower, but every report is real.
# Declared at module scope so it exists even if client init below fails.
LLM_MAX_CONCURRENCY = int(os.getenv("LLM_MAX_CONCURRENCY", "2"))
_llm_semaphore = threading.Semaphore(LLM_MAX_CONCURRENCY)

# Initialize AWS Bedrock client
try:
    if not AWS_BEARER_TOKEN_BEDROCK:
        # Not fatal: some hosts (e.g. the quality_platform backend) unset the
        # bearer token and authenticate Bedrock via AWS access keys / the default
        # boto3 credential chain instead. Warn and continue building the client.
        logger.warning("⚠️ AWS_BEARER_TOKEN_BEDROCK not set — using the default boto3 "
                       "credential chain (AWS access keys) for Bedrock instead.")

    # Throttling is the normal failure mode when several reports are generated
    # at once. Without retries a single ThrottlingException drops straight to
    # the fallback summary, so users get a plausible-looking but useless PDF.
    # 'adaptive' backs off and retries instead.
    _RETRY_POLICY = {'max_attempts': 5, 'mode': 'adaptive'}

    # Standard client with default timeout (60 seconds)
    bedrock_config = Config(
        read_timeout=60,
        connect_timeout=10,
        retries=_RETRY_POLICY
    )
    bedrock_client = boto3.client(
        service_name="bedrock-runtime",
        region_name=AWS_REGION,
        config=bedrock_config
    )

    # Long-running client for magazine generation (600 seconds timeout)
    bedrock_config_long = Config(
        read_timeout=600,
        connect_timeout=10,
        retries=_RETRY_POLICY
    )
    bedrock_client_long = boto3.client(
        service_name="bedrock-runtime",
        region_name=AWS_REGION,
        config=bedrock_config_long
    )
    
    logger.info(f"✅ AWS Bedrock client initialized successfully")
    logger.info(f"   Region: {AWS_REGION}")
    logger.info(f"   Inference Profile: {AWS_BEDROCK_INFERENCE_PROFILE}")
    logger.info(f"   Standard timeout: 60s, Long operations timeout: 600s")
except Exception as e:
    logger.error(f"❌ Failed to initialize AWS Bedrock client: {str(e)}")
    raise

# No RSS feeds needed - using haj.gov.sa API and CNN Arabic scraping
RSS_FEEDS = []

KEYWORD_INPUT_INSTRUCTIONS = (
    "✍️ *إعداد الكلمات المفتاحية (بالإنجليزية)*\n"
    "أرسل الكلمات المفتاحية بالصيغة التالية (بالإنجليزية):\n"
    "`Primary Keyword | secondary keyword 1, secondary keyword 2, secondary keyword 3`\n\n"
    "مثال:\n"
    "`Saudi Tourism 2026 | travel, hospitality, aviation, destinations`\n\n"
    "أرسل كلمة *cancel* لإلغاء إدخال الكلمات المفتاحية."
)


def parse_keyword_input(raw_text):
    if not raw_text:
        return None
    parts = raw_text.split('|', 1)
    primary = parts[0].strip()
    if not primary:
        return None
    secondary = []
    if len(parts) > 1:
        secondary = [kw.strip() for kw in parts[1].split(',') if kw.strip()]
    return {"primary": primary, "secondary": secondary}


def format_secondary_keywords(secondary_list):
    if not secondary_list:
        return "لم يتم تحديد كلمات ثانوية"
    return ", ".join(secondary_list)


def build_keyword_instruction_block(keywords):
    if keywords and keywords.get("primary"):
        primary = keywords["primary"]
        secondary_text = format_secondary_keywords(keywords.get("secondary", []))
        keyword_header = (
            f'PRIMARY KEYWORD: "{primary}"\n'
            f"SECONDARY KEYWORDS / LSI: {secondary_text}\n"
        )
    else:
        keyword_header = (
            "PRIMARY KEYWORD: Not specified (infer the best fit from the Tourism coverage)\n"
            "SECONDARY KEYWORDS / LSI: Use related tourism, travel, hospitality terms, synonyms, and supporting subtopics\n"
        )

    return f"""
{keyword_header}
SEO requirements:
- Place the primary keyword in:
  • The SEO Title
  • The H1
  • The first paragraph (within the first 100 words)
  • Naturally 2–3 times every ~300 words throughout the body
- Distribute secondary/LSI keywords across select H2/H3 headings and different paragraphs as thematic synonyms.
- Do NOT repeat the exact same keyword in every heading—use natural variations to avoid keyword stuffing.

Mandatory SEO outputs at the top of the response (before any other sections):
1. SEO Title: < 60 characters, includes the primary keyword and communicates a clear benefit.
2. Meta Description: 120–150 characters summarizing the main value, optionally includes the primary keyword once (only if it reads naturally) plus a light CTA.
3. Recommended Slug: lowercase, hyphen-separated version of the primary keyword (e.g., saudi-tourism-2026).
4. Headings Structure: Proposed H2/H3 outline derived from the primary + secondary keywords using varied phrasing.

After listing these SEO elements, continue with the requested Tourism news blog structure while following the keyword guidance above.
""".strip()


def keywords_summary_text(keywords):
    if not keywords or not keywords.get("primary"):
        return "لم يتم إعداد أي كلمات مفتاحية بعد."
    secondary = format_secondary_keywords(keywords.get("secondary", []))
    return f"الكلمة الأساسية: {keywords['primary']}\nالكلمات الثانوية: {secondary}"


def get_user_keywords(context):
    try:
        return context.user_data.get("blog_keywords")
    except Exception:
        return None

# ===========================================================================
# Tourism news sources (مصادر السياحة)
# ---------------------------------------------------------------------------
# Sources come from three channels:
#   * twitter — Saudi X/Twitter accounts via the Twitter API v2 search endpoint
#   * rss     — sites exposing an RSS/Atom feed (parsed with feedparser)
#   * html    — static pages scraped with requests + BeautifulSoup
#   * js      — JavaScript single-page sites rendered with Playwright (headless
#               Chromium) before the same BeautifulSoup extraction
# Every fetcher returns article dicts in the SAME shape the rest of the pipeline
# expects: title / description / url / publishedAt / source{name} / image_url.
# ===========================================================================

# SPA (Saudi Press Agency) portal API — tourism & entertainment category.
SPA_API_BASE_URL = "https://portalapi.spa.gov.sa/api/v1/news"
SPA_TOURISM_CATEGORY_ID = 7

TWITTER_BEARER_TOKEN = os.getenv("TWITTER_BEARER_TOKEN", "")

# Target number of articles to pull per source (feeds/pages that expose fewer
# simply return fewer — this is a ceiling, not a guarantee).
MAX_PER_SOURCE = 50

# Saudi & international X/Twitter accounts monitored for tourism & travel news.
TWITTER_ACCOUNTS = [
    {"username": "AhmedAlKhateeb",  "name": "وزير السياحة أحمد الخطيب"},
    {"username": "Saudi_MT",        "name": "وزارة السياحة"},
    {"username": "tfrabiah",        "name": "وزير الحج والعمرة د. توفيق الربيعة"},
    {"username": "AbdulazizTF",     "name": "وزير الرياضة الأمير عبدالعزيز بن تركي الفيصل"},
    {"username": "mos_saudi",       "name": "وزارة الرياضة"},
    {"username": "BadrAFarhan",     "name": "وزير الثقافة الأمير بدر بن عبدالله بن فرحان"},
    {"username": "MOCSaudi",        "name": "وزارة الثقافة"},
    {"username": "Turki_alalshikh", "name": "المستشار تركي آل الشيخ - رئيس هيئة الترفيه"},
    {"username": "GEA_SA",          "name": "هيئة الترفيه"},
    {"username": "VisitSaudiAR",    "name": "روح السعودية"},
    {"username": "SaudiProject",    "name": "مشاريع السعودية"},
    {"username": "SaudiNews50",     "name": "أخبار السعودية"},
    {"username": "HashKSA",         "name": "هاشتاق السعودية"},
]

# Saudi source identifiers, used by the Saudi/global mix classifier.
SAUDI_SOURCE_KEYWORDS = [
    'saudi press agency', 'spa', 'arab news', 'twitter', 'تويتر', 'x.com',
    'saudi_mt', 'visitsaudiar', 'saudiproject', 'saudinews50', 'hashksa',
    'gea_sa', 'mocsaudi', 'mos_saudi', 'ahmedalkhateeb', 'tfrabiah',
    'abdulaziztf', 'badrafarhan', 'turki_alalshikh',
    'وزارة السياحة', 'هيئة الترفيه', 'روح السعودية', 'مشاريع السعودية',
]

# Web sources. ``type`` selects the fetcher. For html/js sources, ``link_selector``
# targets the anchor tags for individual articles and ``base`` is prepended to
# relative hrefs.
SOURCES = [
    # --- RSS / Atom feeds ---
    {"name": "Skift Tourism", "type": "rss",
     "url": "https://skift.com/feed/"},
    {"name": "The National News", "type": "rss",
     "url": "https://www.thenationalnews.com/arc/outboundfeeds/rss/?outputType=xml"},
    # --- Arab News sections (static HTML listings) ---
    # href_regex keeps each section to its own articles — Arab News listing pages
    # also carry cross-section links, and the section slug is the URL suffix.
    {"name": "Arab News - Life & Style", "type": "html",
     "url": "https://www.arabnews.com/lifestyle",
     "base": "https://www.arabnews.com",
     "link_selector": "a[href*='/node/']",
     "href_regex": r"/(lifestyle|travel|food|art-culture)"},
    {"name": "Arab News - Sport", "type": "html",
     "url": "https://www.arabnews.com/sport",
     "base": "https://www.arabnews.com",
     "link_selector": "a[href*='/node/']",
     "href_regex": r"/(sport|sports)"},
    # --- SPA (Saudi Press Agency) tourism & entertainment category, via its
    #     portal JSON API rather than the JS site. Handled by fetch_spa_tourism.
    {"name": "واس - وكالة الأنباء السعودية", "type": "spa",
     "url": SPA_API_BASE_URL, "category_id": SPA_TOURISM_CATEGORY_ID},
    # --- JavaScript SPA listing (tourism section) ---
    {"name": "واس - قسم السياحة", "type": "js",
     "url": "https://www.spa.gov.sa/ar/list/tourism",
     "base": "https://www.spa.gov.sa", "link_selector": "a[href]",
     "href_regex": r"^/N?\d{5,}$", "wait_selector": "a[href]"},
]




def fetch_twitter_news(max_tweets_per_account=15):
    """Fetch recent tweets from configured X/Twitter accounts via Twitter API v2.

    Returns a list of article dicts in the standard pipeline format. Skips
    gracefully (returns []) when no bearer token is configured.
    """
    if not TWITTER_BEARER_TOKEN or TWITTER_BEARER_TOKEN.startswith('DUMMY'):
        logger.warning("Twitter Bearer Token not configured. Skipping Twitter fetch.")
        return []

    articles = []
    headers = {
        'Authorization': f'Bearer {TWITTER_BEARER_TOKEN}',
        'User-Agent': 'TourismNewsBot/1.0',
    }

    # Batch accounts to stay within the query length limit.
    account_batches = []
    batch_size = 5
    for i in range(0, len(TWITTER_ACCOUNTS), batch_size):
        account_batches.append(TWITTER_ACCOUNTS[i:i + batch_size])

    for batch in account_batches:
        try:
            from_queries = [f'from:{acc["username"]}' for acc in batch]
            query = f'({" OR ".join(from_queries)}) -is:retweet'

            url = 'https://api.twitter.com/2/tweets/search/recent'
            params = {
                'query': query,
                'max_results': min(max_tweets_per_account * len(batch), 100),
                'tweet.fields': 'created_at,author_id,text,public_metrics,entities',
                'user.fields': 'username,name',
                'expansions': 'author_id,attachments.media_keys',
                'media.fields': 'url,preview_image_url,type',
            }

            response = requests.get(url, headers=headers, params=params, timeout=15)

            if response.status_code == 401:
                logger.error("Twitter API authentication failed (401). Check bearer token.")
                return articles
            elif response.status_code == 429:
                logger.warning("Twitter API rate limited (429). Skipping remaining batches.")
                break
            elif response.status_code != 200:
                logger.warning(f"Twitter API returned {response.status_code}: {response.text[:200]}")
                continue

            data = response.json()
            tweets = data.get('data', [])

            users_map = {}
            includes = data.get('includes', {})
            for user in includes.get('users', []):
                users_map[user['id']] = {
                    'username': user.get('username', ''),
                    'name': user.get('name', '')
                }

            media_map = {}
            for media in includes.get('media', []):
                media_key = media.get('media_key', '')
                media_map[media_key] = media.get('url') or media.get('preview_image_url', '')

            for tweet in tweets:
                try:
                    tweet_id = tweet.get('id', '')
                    text = tweet.get('text', '')
                    created_at = tweet.get('created_at', '')
                    author_id = tweet.get('author_id', '')

                    author = users_map.get(author_id, {})
                    username = author.get('username', '')
                    display_name = author.get('name', '')

                    for acc in TWITTER_ACCOUNTS:
                        if acc['username'].lower() == username.lower():
                            display_name = acc['name']
                            break

                    image_url = ''
                    tweet_entities = tweet.get('entities', {})
                    if tweet_entities.get('urls'):
                        for url_entity in tweet_entities['urls']:
                            expanded_url = url_entity.get('expanded_url', '')
                            if any(ext in expanded_url.lower() for ext in ['.jpg', '.jpeg', '.png', '.webp']):
                                image_url = expanded_url
                                break

                    tweet_url = f'https://x.com/{username}/status/{tweet_id}' if username else ''

                    article = {
                        'title': text[:120] + ('...' if len(text) > 120 else ''),
                        'description': text,
                        'full_content': text,
                        'url': tweet_url,
                        'publishedAt': created_at,
                        'source': {'name': f'{display_name} (@{username})'},
                        'image_url': image_url,
                        'urlToImage': image_url,
                        'is_saudi_source': True,
                    }
                    articles.append(article)
                except Exception as tweet_error:
                    logger.warning(f"Error parsing tweet: {tweet_error}")
                    continue

            time.sleep(0.5)
        except requests.RequestException as req_error:
            logger.error(f"Request error fetching Twitter batch: {req_error}")
            continue
        except Exception as batch_error:
            logger.error(f"Error processing Twitter batch: {batch_error}")
            continue

    logger.info(f"Successfully fetched {len(articles)} tweets from Twitter")
    return articles


def _parse_feed_date(entry):
    """Return an ISO date string from a feedparser entry, or ''."""
    for attr in ('published_parsed', 'updated_parsed'):
        tm = entry.get(attr)
        if tm:
            try:
                return datetime(*tm[:6]).isoformat()
            except Exception:
                pass
    return entry.get('published', '') or entry.get('updated', '')


def _parse_feed_entries(entries, source_name):
    out = []
    for entry in entries:
        title = (entry.get('title') or '').strip()
        link = entry.get('link') or ''
        if not title or not link:
            continue
        summary = re.sub(r'<[^>]+>', '', entry.get('summary', '') or '').strip()

        image_url = ''
        if entry.get('media_content'):
            image_url = entry['media_content'][0].get('url', '')
        elif entry.get('media_thumbnail'):
            image_url = entry['media_thumbnail'][0].get('url', '')

        out.append({
            'title': title,
            'description': summary[:500],
            'full_content': summary,
            'url': link,
            'publishedAt': _parse_feed_date(entry),
            'source': {'name': source_name},
            'image_url': image_url,
            'urlToImage': image_url,
        })
    return out


def fetch_rss_source(feed_url, source_name, max_items=MAX_PER_SOURCE):
    """Fetch and normalize an RSS/Atom feed into standard article dicts.

    Tries to reach ``max_items`` by paginating WordPress-style feeds
    (``?paged=N``). Stops when the target is met, a page repeats the previous
    page's first link, or a page is empty — so non-paginating feeds harmlessly
    return only their single page.
    """
    articles = []
    seen_links = set()
    try:
        sep = '&' if '?' in feed_url else '?'
        prev_first = None
        for page in range(1, 7):  # up to 6 pages
            page_url = feed_url if page == 1 else f"{feed_url}{sep}paged={page}"
            feed = feedparser.parse(page_url)
            entries = feed.entries or []
            if not entries:
                break
            first_link = entries[0].get('link')
            if page > 1 and first_link == prev_first:
                break  # feed ignored ?paged= — same page again
            prev_first = first_link

            new = [a for a in _parse_feed_entries(entries, source_name)
                   if a['url'] not in seen_links]
            if not new:
                break
            for a in new:
                seen_links.add(a['url'])
            articles.extend(new)
            if len(articles) >= max_items:
                articles = articles[:max_items]
                break
        logger.info(f"Fetched {len(articles)} articles from RSS: {source_name}")
    except Exception as e:
        logger.error(f"Error fetching RSS {source_name} ({feed_url}): {e}")
    return articles


def _extract_listing(html, cfg):
    """Extract article links/titles from a listing page's HTML using cfg selectors.

    Optional ``href_regex`` in the config further restricts matched anchors to
    hrefs matching that pattern (useful when article links are numeric paths).
    """
    articles = []
    base = cfg.get('base', '')
    link_selector = cfg.get('link_selector', 'a')
    href_pat = re.compile(cfg['href_regex']) if cfg.get('href_regex') else None
    source_name = cfg['name']
    try:
        soup = BeautifulSoup(html, 'html.parser')
        seen = set()
        for link_el in soup.select(link_selector):
            href = link_el.get('href', '')
            if not href:
                continue
            if href_pat and not href_pat.search(href):
                continue
            full_url = urljoin(base or cfg['url'], href)
            if full_url in seen:
                continue
            title = link_el.get_text(strip=True)
            if not title:
                img = link_el.select_one('img')
                title = img.get('alt', '').strip() if img else ''
            if not title or len(title) < 12:
                continue
            seen.add(full_url)
            articles.append({
                'title': title,
                'description': '',
                'url': full_url,
                'publishedAt': '',
                'source': {'name': source_name},
            })
    except Exception as e:
        logger.error(f"Error extracting listing for {source_name}: {e}")
    return articles


# cloudscraper is optional; without it, Cloudflare-fronted sites (Arab News)
# fall back to a plain browser-headers request and may return 403.
try:
    import cloudscraper  # type: ignore
    _HAS_CLOUDSCRAPER = True
except ImportError:
    _HAS_CLOUDSCRAPER = False

_BROWSER_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
                  '(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'ar,en-US;q=0.9,en;q=0.8',
}


def _fetch_html(url, timeout=30):
    """Fetch a page as HTML text, working around Cloudflare where possible.

    Tries cloudscraper first (when installed), then a plain requests call with
    browser headers, then urllib. Returns the page text or None.
    """
    if _HAS_CLOUDSCRAPER:
        try:
            scraper = cloudscraper.create_scraper(
                browser={'browser': 'chrome', 'platform': 'windows', 'mobile': False},
                delay=5,
            )
            resp = scraper.get(url, timeout=timeout)
            if resp.status_code == 200:
                return resp.text
            logger.warning(f"cloudscraper returned {resp.status_code} for {url}")
        except Exception as e:
            logger.warning(f"cloudscraper failed for {url}: {e}")

    try:
        resp = requests.get(url, headers=_BROWSER_HEADERS, timeout=timeout)
        resp.raise_for_status()
        return resp.text
    except Exception as e:
        logger.warning(f"requests fetch failed for {url}: {e}")

    try:
        import urllib.request
        req = urllib.request.Request(url, headers=_BROWSER_HEADERS)
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read().decode('utf-8', errors='ignore')
    except Exception as e:
        logger.warning(f"urllib fallback failed for {url}: {e}")

    return None


def fetch_html_source(cfg):
    """Scrape a static (non-JS) HTML listing page with requests + BeautifulSoup."""
    articles = []
    try:
        html = _fetch_html(cfg['url'])
        if not html:
            logger.error(f"No HTML returned for {cfg['name']} ({cfg['url']})")
            return []
        articles = _extract_listing(html, cfg)
        logger.info(f"Fetched {len(articles)} articles from HTML: {cfg['name']}")
    except Exception as e:
        logger.error(f"Error fetching HTML {cfg['name']} ({cfg['url']}): {e}")
    return articles


def fetch_js_source(cfg):
    """Render a JavaScript SPA with headless Chromium (Playwright), then extract.

    Degrades gracefully: if Playwright/Chromium is unavailable, logs and returns
    [] so the rest of the pipeline keeps working.
    """
    try:
        from playwright.sync_api import sync_playwright
    except Exception as e:
        logger.warning(f"Playwright not available, skipping JS source {cfg['name']}: {e}")
        return []

    articles = []
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            try:
                page = browser.new_page(
                    user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
                               '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                )
                page.goto(cfg['url'], timeout=45000, wait_until='domcontentloaded')
                wait_selector = cfg.get('wait_selector')
                if wait_selector:
                    try:
                        page.wait_for_selector(wait_selector, timeout=15000)
                    except Exception:
                        pass
                page.wait_for_timeout(2000)
                html = page.content()
            finally:
                browser.close()
        articles = _extract_listing(html, cfg)
        logger.info(f"Fetched {len(articles)} articles from JS: {cfg['name']}")
    except Exception as e:
        logger.error(f"Error rendering JS {cfg['name']} ({cfg['url']}): {e}")
    return articles


def fetch_spa_source(cfg, max_articles=MAX_PER_SOURCE, language='ar'):
    """Fetch a category feed from the Saudi Press Agency portal JSON API.

    SPA's public site is a JS app, but its portal API serves the same items as
    JSON — cheaper and more reliable than rendering the page. Returns articles
    in the same shape as the RSS/HTML fetchers.
    """
    articles = []
    base_url = cfg.get('url') or SPA_API_BASE_URL
    category_id = cfg.get('category_id', SPA_TOURISM_CATEGORY_ID)
    source_name = cfg.get('name') or 'واس - وكالة الأنباء السعودية'
    per_page = 10
    num_pages = (max_articles + per_page - 1) // per_page

    for page in range(1, num_pages + 1):
        params = {
            'w_content': 1, 'w_tag': 1, 'per_page': per_page,
            'category_id': category_id, 'page': page, 'l': language,
        }
        try:
            response = requests.get(base_url, params=params, timeout=15)
            response.raise_for_status()
            data = response.json()
        except Exception as e:
            logger.error(f"SPA API page {page} failed: {e}")
            break

        items = data.get('data') or []
        if not items:
            break

        for item in items:
            try:
                uuid = item.get('uuid', '')
                title = (item.get('title') or '').strip()
                content = item.get('content') or ''
                if not title or not uuid:
                    continue

                ts = item.get('published_at') or 0
                try:
                    published_iso = datetime.fromtimestamp(ts).isoformat() if ts else datetime.now().isoformat()
                except Exception:
                    published_iso = datetime.now().isoformat()

                image = item.get('image')
                if isinstance(image, dict):
                    image_url = image.get('original', '') or image.get('thumbnail', '')
                elif isinstance(image, str):
                    image_url = image
                else:
                    image_url = ''

                articles.append({
                    'title': title,
                    'description': content[:500],
                    'full_content': content,
                    'url': f"https://www.spa.gov.sa/{'ar' if language == 'ar' else 'en'}/{uuid}",
                    'publishedAt': published_iso,
                    'source': {'name': source_name},
                    'image_url': image_url,
                    'urlToImage': image_url,
                })
            except Exception as e:
                logger.warning(f"Skipping malformed SPA item: {e}")

        if len(articles) >= max_articles:
            break

    logger.info(f"fetch_spa_source: {len(articles)} articles from {source_name}")
    return articles[:max_articles]


def _fetch_one_source(cfg):
    """Dispatch a single source config to the right fetcher."""
    stype = cfg.get('type')
    try:
        if stype == 'rss':
            return fetch_rss_source(cfg['url'], cfg['name'])
        if stype == 'html':
            return fetch_html_source(cfg)
        if stype == 'js':
            return fetch_js_source(cfg)
        if stype == 'spa':
            return fetch_spa_source(cfg)
    except Exception as e:
        logger.error(f"Source {cfg.get('name')} failed: {e}")
    return []


def fetch_tourism_news(max_tweets_per_account=15):
    """Aggregate all Tourism sources (Twitter + RSS + HTML + JS).

    Runs the web sources concurrently, adds Twitter, merges, and de-duplicates.
    Per-source failures are isolated so one dead source never fails the batch.
    """
    from concurrent.futures import ThreadPoolExecutor

    all_articles = []

    # Twitter first (its own batching/rate limits).
    try:
        all_articles.extend(fetch_twitter_news(max_tweets_per_account) or [])
    except Exception as e:
        logger.error(f"Twitter fetch failed: {e}")

    # Web sources in parallel.
    with ThreadPoolExecutor(max_workers=min(8, len(SOURCES) or 1)) as executor:
        for result in executor.map(_fetch_one_source, SOURCES):
            all_articles.extend(result or [])

    logger.info(f"fetch_tourism_news: {len(all_articles)} articles before dedup")
    try:
        all_articles = clean_deduplicate_articles(all_articles)
    except Exception as e:
        logger.warning(f"Dedup failed, returning raw list: {e}")
    logger.info(f"fetch_tourism_news: {len(all_articles)} articles after dedup")
    return all_articles

def filter_recent_articles(articles, days=7):
    """Filter articles to those published within the past ``days`` days.

    Articles with no parseable date are kept (many sources omit dates); only
    articles with a date clearly older than the cutoff are dropped.
    """
    if not articles:
        return []

    cutoff_date = datetime.now() - timedelta(days=days)
    recent_articles = []

    for article in articles:
        if not article:
            continue
        published_at = article.get('publishedAt') or article.get('published_at')

        if published_at:
            try:
                # Handle different date formats
                if 'T' in published_at:
                    pub_date = datetime.fromisoformat(published_at.replace('Z', '+00:00'))
                else:
                    # Truncate to first 10 chars for robust date parsing (YYYY-MM-DD)
                    pub_date = datetime.strptime(published_at[:10], '%Y-%m-%d')

                if pub_date.replace(tzinfo=None) >= cutoff_date:
                    recent_articles.append(article)
            except Exception:
                # Unparseable date — keep the article rather than guess.
                recent_articles.append(article)
        else:
            # No date available — include the article.
            recent_articles.append(article)

    return recent_articles


# ===========================================================================
# ---------------------------------------------------------------------------
# Relevance filter — قطاع السياحة والسفر
# ---------------------------------------------------------------------------
# Precision-focused: tourism, travel, hospitality, aviation and entertainment
# terms in Arabic and English. Bare geography words are deliberately excluded —
# they pulled in unrelated political/economic coverage.
TOURISM_KEYWORDS = [
    # ---- Arabic: tourism core ----
    'سياحة', 'السياحة', 'سياحي', 'سياحية', 'السياحي', 'السياحية', 'وزارة السياحة',
    'هيئة السياحة', 'الوجهات السياحية', 'وجهة سياحية', 'المقصد السياحي', 'الموسم السياحي',
    'السياحة الداخلية', 'السياحة الخارجية', 'السياحة الوافدة', 'السياحة البيئية',
    'السياحة الثقافية', 'السياحة العلاجية', 'سياحة المغامرات', 'الاستثمار السياحي',
    'صندوق التنمية السياحية', 'روح السعودية', 'زوار', 'الزوار', 'السائحين', 'السياح',
    # ---- Arabic: travel & aviation ----
    'سفر', 'السفر', 'رحلات', 'الرحلات', 'رحلة', 'طيران', 'الطيران', 'شركة طيران',
    'الخطوط السعودية', 'طيران ناس', 'طيران الرياض', 'مطار', 'المطار', 'المطارات',
    'الطيران المدني', 'وجهة جديدة', 'حجوزات', 'الحجوزات', 'تأشيرة', 'التأشيرات',
    'تأشيرة سياحية', 'الترانزيت',
    # ---- Arabic: hospitality ----
    'فندق', 'الفنادق', 'فنادق', 'ضيافة', 'الضيافة', 'منتجع', 'المنتجعات', 'إشغال',
    'الإشغال الفندقي', 'الإيواء السياحي', 'الشقق المفروشة', 'نزل', 'المطاعم',
    # ---- Arabic: destinations & entertainment ----
    'ترفيه', 'الترفيه', 'هيئة الترفيه', 'فعاليات', 'الفعاليات', 'مهرجان', 'المهرجانات',
    'موسم الرياض', 'موسم جدة', 'العلا', 'الدرعية', 'نيوم', 'البحر الأحمر', 'القدية',
    'مواسم السعودية', 'التراث', 'المعالم', 'المتاحف', 'الآثار', 'المواقع الأثرية',
    'إكسبو 2030', 'المعارض والمؤتمرات', 'سياحة الأعمال',
    'حفل موسيقي', 'حفلات', 'مسرح', 'عرض مسرحي', 'سينما', 'ملاهي', 'مدينة ألعاب',
    'مدينة ترفيهية', 'وجهة ترفيهية', 'عرض ترفيهي', 'كرنفال', 'تذاكر الفعاليات',
    'الترفيه العائلي', 'حديقة ترفيهية',
    # ---- English: tourism & travel ----
    'tourism', 'tourist', 'tourists', 'travel', 'traveler', 'traveller', 'trip',
    'destination', 'destinations', 'attraction', 'attractions', 'sightseeing',
    'landmark', 'heritage site', 'museum', 'theme park', 'itinerary', 'visitor',
    'visitors', 'inbound travel', 'outbound travel', 'ecotourism', 'staycation',
    'visa', 'e-visa', 'tourism ministry', 'tourism authority', 'tourism investment',
    # ---- English: aviation ----
    'airline', 'airlines', 'aviation', 'flight', 'flights', 'airport', 'aircraft',
    'carrier', 'airfare', 'air travel', 'route launch', 'low-cost carrier',
    # Cabin and network vocabulary. Airline strategy stories are sector news but
    # often name no keyword above -- "Premium Economy and Long-Haul Network"
    # scored zero before these were added.
    'premium economy', 'business class', 'economy class', 'first class',
    'long-haul', 'long haul', 'short-haul', 'cabin', 'fleet', 'route network',
    'airport lounge', 'codeshare', 'load factor', 'seat capacity',
    # ---- English: hospitality ----
    'hotel', 'hotels', 'hospitality', 'resort', 'accommodation', 'lodging',
    'booking', 'airbnb', 'occupancy', 'guest experience', 'restaurant',
    # ---- English: sector & tech ----
    'cruise', 'travel tech', 'online booking', 'ota', 'tour operator',
    'travel agency', 'entertainment sector', 'events sector', 'mice',
    # ---- English: entertainment & leisure ----
    'entertainment', 'leisure', 'festival', 'concert', 'live show', 'cinema',
    'amusement park', 'water park', 'nightlife', 'event tickets',
]


# Topics that are not tourism even when a tourism word appears somewhere in the
# body — crime, conflict, defence and politics stories routinely mention
# "traveller", "airport" or "طيران" in passing.
OFF_TOPIC_KEYWORDS = [
    # ---- Arabic ----
    'تهريب', 'مخدرات', 'جريمة', 'قتل', 'اغتيال', 'سرقة', 'محكمة', 'قضية جنائية',
    'حرب', 'قصف', 'صاروخ', 'غارة', 'اشتباك', 'عسكري', 'دفاعية', 'صفقة أسلحة',
    'انتخابات', 'برلمان', 'عقوبات', 'احتجاج', 'إضراب',
    # ---- English ----
    'smuggle', 'smuggling', 'narcotic', 'drug bust', 'crime', 'murder', 'killed',
    'assassination', 'court', 'lawsuit', 'war', 'missile', 'airstrike', 'clash',
    'military', 'defence deal', 'defense deal', 'arms deal', 'sanctions',
    'election', 'parliament', 'protest', 'strike action',
]


# ---------------------------------------------------------------------------
# Hard exclusions — نطاق التغطية: السياحة والترفيه فقط
# ---------------------------------------------------------------------------
# Subjects that are never tourism/entertainment coverage, however many tourism
# words the story happens to carry: football & sport, politics, and war. Unlike
# OFF_TOPIC_KEYWORDS these are an outright veto — a tourism-led headline does
# NOT rescue them. Matched against the headline and description only (they carry
# the subject of the piece), never the body, so a passing mention inside a
# genuine tourism article does not drop it.
BLOCKED_SPORTS_KEYWORDS = [
    # ---- Arabic ----
    'كرة القدم', 'كرة السلة', 'كرة اليد', 'الكرة الطائرة', 'رياضة', 'رياضي', 'رياضية',
    'الدوري', 'دوري روشن', 'دوري أبطال', 'مباراة', 'المباراة', 'مباريات',
    'لاعب', 'اللاعب', 'لاعبي', 'المنتخب', 'منتخب', 'النادي الأهلي', 'نادي الهلال',
    'الاتحاد الرياضي', 'الاتحاد السعودي لكرة', 'هدف في مرمى', 'التشكيلة',
    'المدرب', 'انتقالات اللاعبين', 'الميركاتو', 'بطولة الدوري', 'ملعب كرة',
    'أولمبياد', 'الأولمبية', 'سباق الفورمولا', 'الفورمولا 1', 'الملاكمة', 'المصارعة',
    # ---- English ----
    'football', 'soccer', 'basketball', 'volleyball', 'handball', 'sport', 'sports',
    'league', 'premier league', 'champions league', 'match', 'matches', 'fixture',
    'squad', 'striker', 'midfielder', 'goalkeeper', 'transfer window',
    'olympics', 'olympic', 'formula 1', 'f1 race', 'boxing', 'wrestling', 'nba',
    'fifa', 'uefa', 'kickoff', 'kick-off',
]

BLOCKED_POLITICS_KEYWORDS = [
    # ---- Arabic ----
    'سياسة', 'سياسي', 'سياسية', 'انتخابات', 'الانتخابات', 'استفتاء', 'برلمان', 'البرلمان',
    'مجلس النواب', 'مجلس الشيوخ', 'حزب سياسي', 'المعارضة', 'رئيس الوزراء', 'الرئاسة',
    'وزير الخارجية', 'دبلوماسي', 'دبلوماسية', 'مفاوضات سياسية', 'قمة سياسية',
    'عقوبات', 'مظاهرة', 'مظاهرات', 'احتجاج', 'احتجاجات', 'انقلاب', 'استقالة الحكومة',
    'مجلس الأمن', 'الأمم المتحدة',
    # ---- English ----
    'politics', 'political', 'election', 'elections', 'referendum', 'parliament',
    'senate', 'congress', 'prime minister', 'diplomat',
    'diplomacy', 'foreign minister', 'sanctions', 'protest', 'protests', 'coup',
    'security council', 'united nations',
]

BLOCKED_CONFLICT_KEYWORDS = [
    # ---- Arabic ----
    'حرب', 'الحرب', 'حروب', 'نزاع مسلح', 'صراع مسلح', 'قصف', 'غارة', 'غارات', 'صاروخ',
    'صواريخ', 'طائرة مسيرة', 'اشتباك', 'اشتباكات', 'جبهة القتال', 'قتلى',
    'جرحى', 'هدنة', 'وقف إطلاق النار', 'احتلال', 'مقاومة مسلحة',
    'إرهاب', 'إرهابي', 'تفجير', 'عسكري', 'عسكرية', 'الجيش', 'قوات مسلحة', 'صفقة أسلحة',
    # Attacks and the parties to a conflict. Without these a headline like
    # "Houthi attacks disrupt UAE flights" reads as aviation news and survives.
    'هجوم', 'هجمات', 'استهداف', 'مسيّرة', 'رهائن', 'حصار', 'مقتل', 'ضحايا',
    'الحوثي', 'الحوثيين', 'حزب الله', 'حماس', 'غزة', 'فلسطين', 'الفلسطينية',
    'إسرائيل', 'إسرائيلي', 'الاحتلال الإسرائيلي', 'أوكرانيا', 'الجولان',
    # ---- English ----
    'war', 'warfare', 'conflict zone', 'shelling', 'airstrike', 'air strike',
    'missile', 'drone strike', 'clashes', 'ceasefire', 'truce', 'troops', 'army',
    'military', 'militant', 'militants', 'terrorism', 'terrorist', 'bombing',
    'casualties', 'invasion', 'arms deal',
    'attack', 'attacks', 'attacked', 'rocket', 'rockets', 'hostage', 'hostages',
    'siege', 'militia', 'insurgent', 'insurgents', 'death toll', 'wounded',
    'houthi', 'houthis', 'hamas', 'hezbollah', 'gaza', 'palestine', 'palestinian',
    'israel', 'israeli', 'ukraine', 'west bank',
]

# Crime reporting is not sector coverage either, and it reliably name-drops the
# venue it happened at -- "stolen from a museum", "robbery at a hotel" -- so the
# tourism scorer would otherwise wave it straight through.
BLOCKED_CRIME_KEYWORDS = [
    # ---- Arabic ----
    'سطو', 'نهب', 'سرقة', 'اختلاس', 'احتيال مالي', 'تزوير', 'اعتقال', 'توقيف',
    # ---- English ----
    'stolen', 'theft', 'heist', 'robbery', 'burglary', 'looted', 'looting',
    'arrested', 'arrest', 'kidnap', 'kidnapped', 'trafficking',
]

BLOCKED_TOPIC_KEYWORDS = (
    BLOCKED_SPORTS_KEYWORDS
    + BLOCKED_POLITICS_KEYWORDS
    + BLOCKED_CONFLICT_KEYWORDS
    + BLOCKED_CRIME_KEYWORDS
)

# Arabic terms match as plain substrings (Arabic has no case, and the list is
# written to absorb the definite article); Latin terms need word boundaries so
# "sport" does not fire on "transport"/"passport", nor "match" on "matchmaking".
_BLOCKED_ARABIC = [k for k in BLOCKED_TOPIC_KEYWORDS if not k[0].isascii()]
_BLOCKED_LATIN_RE = re.compile(
    r'\b(?:' + '|'.join(
        re.escape(k) for k in BLOCKED_TOPIC_KEYWORDS if k[0].isascii()
    ) + r')\b',
    re.IGNORECASE,
)


def blocked_topic_match(article):
    """Return the out-of-scope term that disqualifies *article*, or ``None``.

    Coverage is limited to tourism & entertainment: sport, politics and war are
    out of scope regardless of how the piece is worded. Only the headline and
    description are inspected — they carry the subject of the story.
    """
    if not article:
        return None
    subject = ' '.join(
        str(article.get(f) or '') for f in ('title', 'description')
    ).lower()
    if not subject.strip():
        return None
    for term in _BLOCKED_ARABIC:
        if term in subject:
            return term
    m = _BLOCKED_LATIN_RE.search(subject)
    return m.group(0) if m else None


# Editorial scope rule injected into every generation prompt. The article set is
# already filtered by ``blocked_topic_match``; this keeps the model from
# widening the topic on its own.
SCOPE_RULE = (
    "EDITORIAL SCOPE — STRICT: cover ONLY tourism, travel, hospitality, aviation, "
    "destinations, heritage, events and entertainment/leisure. "
    "NEVER write about football or any sport, politics or government/diplomatic affairs, "
    "wars or armed conflict, or general news unrelated to tourism and entertainment. "
    "If a source article is about any of those, ignore it completely — do not summarise it, "
    "do not mention it, and do not use it to fill space. "
    "If too few in-scope articles are supplied, write a shorter report instead of "
    "padding it with out-of-scope material."
)


def is_blocked_topic(article):
    """True when the article falls outside the tourism & entertainment scope."""
    return blocked_topic_match(article) is not None


# Terms that make an article tourism news on their own. Distinguished from
# incidental words like "traveller" or "airport", which appear in crime and
# conflict stories just as often as in sector coverage.
CORE_TOURISM_KEYWORDS = [
    'سياحة', 'السياحة', 'سياحي', 'سياحية', 'وزارة السياحة', 'هيئة السياحة',
    'وجهة', 'وجهات', 'فندق', 'فنادق', 'ضيافة', 'منتجع', 'الإشغال', 'ترفيه',
    'مهرجان', 'فعاليات', 'زوار', 'الزوار', 'التراث', 'متحف', 'إيواء',
    'tourism', 'tourist', 'tourists', 'hospitality', 'hotel', 'hotels',
    'resort', 'destination', 'destinations', 'attraction', 'heritage site',
    'museum', 'festival', 'occupancy', 'visitor', 'visitors', 'travel agency',
    'tour operator', 'cruise',
]

# Score needed to keep an article. A title hit alone clears it; body-only
# matches need several before the article counts as tourism news.
_RELEVANCE_THRESHOLD = 3
_W_TITLE, _W_DESC, _W_BODY = 3, 2, 1


def filter_relevant_articles(articles, keywords=None):
    """Keep articles that are genuinely about tourism, travel & entertainment.

    Anything outside that scope — sport, politics, war — is rejected up front by
    ``blocked_topic_match`` and can never reach a report.

    Matches are weighted by where they occur: the title is a strong signal, the
    body a weak one — so a story that merely mentions "traveller" in passing no
    longer qualifies. Articles whose title is clearly off-topic (crime,
    conflict, defence) are rejected unless the title itself is tourism-led.
    Matching is case-insensitive; Arabic is unaffected by lowercasing.
    """
    kws = [k.lower() for k in (keywords or TOURISM_KEYWORDS)]
    matched = []
    rejected_offtopic = 0
    rejected_blocked = 0

    for a in articles or []:
        if not a:
            continue

        # Out-of-scope subjects (sport, politics, war) are dropped outright.
        blocked = blocked_topic_match(a)
        if blocked:
            rejected_blocked += 1
            logger.debug("blocked out-of-scope article (%s): %s", blocked,
                         (a.get('title') or '')[:80])
            continue

        title = (a.get('title') or '').lower()
        desc = (a.get('description') or '').lower()
        body = (a.get('full_content') or '').lower()

        title_hits = sum(1 for k in kws if k in title)
        desc_hits = sum(1 for k in kws if k in desc)
        body_hits = sum(1 for k in kws if k in body)
        score = (title_hits * _W_TITLE) + (desc_hits * _W_DESC) + min(body_hits, 3) * _W_BODY

        if score < _RELEVANCE_THRESHOLD:
            continue

        # An off-topic headline vetoes the article unless the headline carries a
        # CORE tourism term. A passing mention of "traveller" or "airport" in a
        # crime or conflict headline is not enough to save it.
        if any(bad in title for bad in OFF_TOPIC_KEYWORDS):
            if not any(core in title for core in CORE_TOURISM_KEYWORDS):
                rejected_offtopic += 1
                continue

        matched.append(a)

    logger.info(
        f"filter_relevant_articles: {len(matched)}/{len(articles or [])} match tourism focus "
        f"({rejected_blocked} out of scope: sport/politics/war, "
        f"{rejected_offtopic} rejected as off-topic headlines)"
    )
    return matched


# Tourism category taxonomy (shared across the module).
TOURISM_CATEGORIES = (
    'الطيران والسفر',
    'الفنادق والضيافة',
    'سياسات وتنمية السياحة',
    'الوجهات والمعالم',
    'تقنية السفر',
    'أخبار عامة',
)


def categorize_articles(articles):
    """Categorize articles by Tourism topics."""
    if not articles:
        logger.warning("No articles provided to categorize_articles")
        return {cat: [] for cat in TOURISM_CATEGORIES}

    categories = {cat: [] for cat in TOURISM_CATEGORIES}

    aviation_keywords = ['طيران', 'مطار', 'المطارات', 'رحلة', 'رحلات', 'الخطوط',
                         'تأشيرة', 'airline', 'aviation', 'flight', 'airport',
                         'aircraft', 'carrier', 'airfare', 'air travel', 'visa']
    hotel_keywords = ['فندق', 'فنادق', 'الفنادق', 'ضيافة', 'منتجع', 'إشغال', 'إيواء',
                      'hotel', 'hospitality', 'resort', 'accommodation', 'lodging',
                      'booking', 'airbnb', 'occupancy', 'stay']
    policy_keywords = ['وزارة السياحة', 'هيئة السياحة', 'سياسة', 'تنظيم', 'استراتيجية',
                       'استثمار', 'تنمية', 'اتفاقية', 'شراكة', 'policy', 'regulation',
                       'ministry of tourism', 'tourism authority', 'government', 'law',
                       'tourism development', 'investment', 'strategy']
    tech_keywords = ['تقنية', 'رقمي', 'منصة', 'تطبيق', 'ذكاء اصطناعي', 'ابتكار',
                     'technology', 'digital', 'online booking', 'app', 'platform',
                     'innovation', 'startup', 'travel tech']
    destination_keywords = ['وجهة', 'وجهات', 'معلم', 'معالم', 'متحف', 'متاحف', 'تراث',
                            'آثار', 'مهرجان', 'فعالية', 'ترفيه', 'شاطئ', 'العلا',
                            'الدرعية', 'نيوم', 'القدية', 'موسم', 'destination',
                            'attraction', 'sightseeing', 'landmark', 'museum',
                            'theme park', 'beach', 'city break', 'festival']

    for article in articles:
        if not article:
            continue
        title = (article.get('title', '') or '').lower()
        description = (article.get('description', '') or '').lower()
        full_content = (article.get('full_content', '') or '').lower()
        content = f"{title} {description} {full_content[:500]}"

        if any(k in content for k in aviation_keywords):
            categories['الطيران والسفر'].append(article)
        elif any(k in content for k in hotel_keywords):
            categories['الفنادق والضيافة'].append(article)
        elif any(k in content for k in policy_keywords):
            categories['سياسات وتنمية السياحة'].append(article)
        elif any(k in content for k in tech_keywords):
            categories['تقنية السفر'].append(article)
        elif any(k in content for k in destination_keywords):
            categories['الوجهات والمعالم'].append(article)
        else:
            categories['أخبار عامة'].append(article)

    for cat, items in categories.items():
        logger.info(f"categorize_articles: {cat} -> {len(items)}")
    return categories



def extract_article_content(url, max_retries=3):
    """Extract full article content from URL using multiple methods"""
    if not url or url.strip() == '':
        return None
    
    content = None

    # Special handling for NIST (National Institute of Standards and Technology)
    if 'nist.gov' in url:
        try:
            headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            }
            response = requests.get(url, headers=headers, timeout=15)
            response.raise_for_status()
            soup = BeautifulSoup(response.content, 'html.parser')
            
            # Selector for NIST full text
            content_div = soup.select_one('.text-with-summary')
            if content_div:
                # Cleanup
                for element in content_div(['script', 'style']):
                    element.decompose()
                
                text = content_div.get_text(strip=True, separator=' ')
                if len(text) > 200:
                    return {
                        'text': text,
                        'title': soup.find('title').get_text(strip=True) if soup.find('title') else '',
                        'method': 'nist_custom',
                        'publish_date': None
                    }
        except Exception as e:
            logger.warning(f"NIST custom extraction failed for {url}: {e}")
            # Fallthrough to standard methods

    # Special handling for EOS (Egyptian Organization for Standardization)
    if 'eos.org.eg' in url:
        try:
            headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            }
            response = requests.get(url, headers=headers, timeout=15)
            response.raise_for_status()
            soup = BeautifulSoup(response.content, 'html.parser')
            
            # EOS specific selector for body
            content_div = soup.select_one('div.text-custom-text-1')
            if content_div:
                # Remove scripts/styles if any
                for element in content_div(['script', 'style']):
                    element.decompose()
                
                text = content_div.get_text(strip=True, separator=' ')
                if len(text) > 100:
                     return {
                        'text': text,
                        'title': soup.find('title').get_text(strip=True) if soup.find('title') else '',
                        'method': 'eos_custom',
                        'publish_date': None
                    }
        except Exception as e:
            logger.warning(f"EOS custom extraction failed for {url}: {e}")
            # Fallthrough to standard methods

    # Special handling for EGAC
    if 'egac.gov.eg' in url:
        try:
            headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            }
            response = requests.get(url, headers=headers, timeout=15)
            response.raise_for_status()
            soup = BeautifulSoup(response.content, 'html.parser')
            
            # Selector for EGAC full text
            content_div = soup.select_one('.new-details-container .text')
            if content_div:
                for element in content_div(['script', 'style']):
                    element.decompose()
                text = content_div.get_text(strip=True, separator=' ')
                if len(text) > 100:
                    return {
                        'text': text,
                        'title': soup.find('title').get_text(strip=True) if soup.find('title') else '',
                        'method': 'egac_custom',
                        'publish_date': None
                    }
        except Exception as e:
            logger.warning(f"EGAC custom extraction failed for {url}: {e}")

    # Method 1: Try newspaper3k first (most reliable for news articles)
    try:
        article = Article(url)
        article.download()
        article.parse()
        
        if article.text and len(article.text.strip()) > 200:
            content = {
                'text': article.text.strip(),
                'title': article.title or '',
                'authors': article.authors or [],
                'publish_date': article.publish_date,
                'method': 'newspaper3k'
            }
            logger.info(f"Successfully extracted content using newspaper3k for {url}")
            return content
    except Exception as e:
        logger.warning(f"Newspaper3k failed for {url}: {str(e)}")
    
    # Method 2: Manual web scraping with BeautifulSoup
    for attempt in range(max_retries):
        try:
            headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Accept-Encoding': 'gzip, deflate',
                'Connection': 'keep-alive',
            }
            
            response = requests.get(url, headers=headers, timeout=15)
            response.raise_for_status()
            
            soup = BeautifulSoup(response.content, 'html.parser')
            
            # Remove unwanted elements
            for element in soup(['script', 'style', 'nav', 'header', 'footer', 'aside', 'ads']):
                element.decompose()
            
            # Try multiple content selectors
            content_selectors = [
                'article',
                '[role="main"]',
                '.article-content',
                '.post-content',
                '.entry-content',
                '.content',
                'main',
                '.story-body',
                '.article-body',
                '.post-body'
            ]
            
            article_text = ""
            for selector in content_selectors:
                elements = soup.select(selector)
                if elements:
                    for element in elements:
                        text = element.get_text(strip=True, separator=' ')
                        if len(text) > len(article_text):
                            article_text = text
                    break
            
            # Fallback: extract all paragraphs
            if not article_text or len(article_text) < 200:
                paragraphs = soup.find_all('p')
                article_text = ' '.join([p.get_text(strip=True) for p in paragraphs])
            
            # Clean up the text
            article_text = re.sub(r'\s+', ' ', article_text)
            article_text = article_text.strip()
            
            if article_text and len(article_text) > 200:
                content = {
                    'text': article_text,
                    'title': soup.find('title').get_text(strip=True) if soup.find('title') else '',
                    'method': 'beautifulsoup'
                }
                logger.info(f"Successfully extracted content using BeautifulSoup for {url}")
                return content
                
        except requests.RequestException as e:
            # A 403/401 is a deliberate block (Cloudflare, paywall). Retrying
            # it within the same run never succeeds and just burns backoff time,
            # so give up on this URL immediately. Timeouts and 5xx still retry.
            status = getattr(getattr(e, "response", None), "status_code", None)
            if status in (401, 403):
                logger.warning(f"Blocked ({status}) for {url} — not retrying")
                break
            logger.warning(f"Request failed (attempt {attempt + 1}/{max_retries}) for {url}: {str(e)}")
            if attempt < max_retries - 1:
                time.sleep(2 ** attempt)  # Exponential backoff
        except Exception as e:
            logger.error(f"Unexpected error extracting content from {url}: {str(e)}")
            break
    
    logger.error(f"Failed to extract content from {url} after all attempts")
    return None

# Minimum body length (characters) an article must have to be worth sending to
# the model. Below this it produces truncated, meaningless report lines.
MIN_CONTENT_CHARS = 200

# How many articles to fetch at once. Sequential extraction made a cold monthly
# report spend over four minutes just fetching. Bounded so sources still see a
# reasonable request rate from us.
EXTRACTION_WORKERS = int(os.getenv("EXTRACTION_WORKERS", "8"))


def enhance_articles_with_content(articles, max_articles=15, weekly_mode=False, monthly_mode=False):
    """Enhance articles with full content extraction.

    Articles that end up without a usable body are dropped rather than passed
    on with a placeholder — the model quotes whatever it is given.
    """
    if not articles:
        logger.warning("No articles provided to enhance_articles_with_content")
        return []
    
    enhanced_articles = []
    
    # Adjust for weekly vs daily processing
    if weekly_mode:
        max_articles = min(max_articles, 50)
    elif monthly_mode:
        max_articles = min(max_articles, 100)
    else:
        max_articles = min(max_articles, 20)
    
    batch = articles[:max_articles]
    total = len(batch)
    logger.info(f"Starting content extraction for {total} articles "
                f"({EXTRACTION_WORKERS} at a time)")

    def _extract_one(indexed):
        """Fetch one article. Returns (index, article, content_data|None)."""
        i, article = indexed
        url = article.get('url', '') if article else ''
        if not url:
            return i, article, None
        logger.info(f"Extracting content {i+1}/{total}: {url}")
        try:
            return i, article, extract_article_content(url)
        except Exception as e:
            logger.error(f"Error extracting article {i+1}: {e}")
            return i, article, None

    # Fetch concurrently, then process results in the original order so the
    # report keeps its source ordering.
    with ThreadPoolExecutor(max_workers=EXTRACTION_WORKERS) as pool:
        results = list(pool.map(_extract_one, enumerate(batch)))

    for i, article, content_data in results:
        try:
            url = article.get('url', '') if article else ''
            if not url:
                continue

            # Enhance article with extracted content
            enhanced_article = article.copy()
            if content_data and len((content_data.get('text') or '').strip()) >= MIN_CONTENT_CHARS:
                enhanced_article['full_content'] = content_data['text']
                enhanced_article['extraction_method'] = content_data['method']
                enhanced_article['content_length'] = len(content_data['text'])
                
                # Use extracted title if original is missing/short
                extracted_title = content_data.get('title', '')
                original_title = article.get('title', '')
                if extracted_title and original_title and len(extracted_title) > len(original_title):
                    enhanced_article['enhanced_title'] = extracted_title
            else:
                # Extraction failed — fall back to the description, but only if
                # it carries enough text to summarise. A placeholder string
                # here ends up quoted verbatim in the generated report.
                description = (article.get('description') or '').strip()
                if len(description) < MIN_CONTENT_CHARS:
                    logger.info(
                        f"Skipping article with no usable content ({len(description)} chars): {url}"
                    )
                    continue
                enhanced_article['full_content'] = description
                enhanced_article['extraction_method'] = 'fallback'
                enhanced_article['content_length'] = len(description)
            
            enhanced_articles.append(enhanced_article)

        except Exception as e:
            logger.error(f"Error processing article {i+1}: {str(e)}")
            # Keep the original only if it already carries usable text.
            fallback_text = (article.get('full_content') or article.get('description') or '').strip()
            if len(fallback_text) >= MIN_CONTENT_CHARS:
                article = dict(article, full_content=fallback_text)
                enhanced_articles.append(article)
            continue
    
    logger.info(
        f"Content extraction completed: {len(enhanced_articles)} usable of "
        f"{min(len(articles), max_articles)} attempted "
        f"({len(articles[:max_articles]) - len(enhanced_articles)} dropped for thin content)"
    )
    return enhanced_articles

async def get_news(update: Update, context: ContextTypes.DEFAULT_TYPE, page=1, category=None):
    """Get today's enhanced Tourism news with presenter-style summary."""
    user_id = get_user_id(update)
    
    # Check usage limit
    has_limit, current_usage = check_usage_limit(user_id, 'daily_news')
    if not has_limit:
        limit_message = (
            f"❌ *تم الوصول إلى الحد الأقصى*\n\n"
            f"لقد استخدمت جميع المحاولات المتاحة للأخبار اليومية ({USAGE_LIMITS['daily_news']}/{USAGE_LIMITS['daily_news']}).\n\n"
        )
        if update.callback_query:
            await update.callback_query.answer("تم الوصول إلى الحد الأقصى", show_alert=True)
            await update.callback_query.message.reply_text(limit_message, parse_mode='Markdown')
        else:
            await update.message.reply_text(limit_message, parse_mode='Markdown')
        return
    
    # Increment usage
    increment_usage(user_id, 'daily_news')
    
    # Send initial message
    if update.callback_query:
        await update.callback_query.answer()
        message = await update.callback_query.message.reply_text(
            "🕋 جارٍ تجهيز موجز أخبار السياحة...\n📖 يتم الآن جمع الأخبار من المصادر الرسمية والدولية...\n⏳ يرجى الانتظار للحظات.",
            parse_mode='Markdown'
        )
    else:
        message = await update.message.reply_text(
            "🕋 جارٍ تجهيز موجز أخبار السياحة...\n📖 يتم الآن جمع الأخبار من المصادر الرسمية والدولية...\n⏳ يرجى الانتظار للحظات.",
            parse_mode='Markdown'
        )
    
    try:
        # Update progress message
        await message.edit_text(
            "🌍 *الخطوة 1/3:* جلب الأخبار من المصادر...",
            parse_mode='Markdown'
        )
        
        # Fetch news from Tourism sources
        hajgov_articles = fetch_tourism_news() or []
        cnn_articles = []
        logger.info(f"Fetched {len(hajgov_articles)} haj.gov.sa, {len(cnn_articles)} CNN Arabic")
        
        # Daily scope: restrict to past 7 days
        recent_hajgov = filter_recent_articles(hajgov_articles, days=7) or []
        recent_cnn = filter_recent_articles(cnn_articles, days=7) or []
        
        await message.edit_text(
            "🌍 *الخطوة 2/3:* استخراج المحتوى الكامل للمقالات...\n📖 قد يستغرق هذا من 30 إلى 60 ثانية...",
            parse_mode='Markdown'
        )
        
        # Enhance articles with full content (daily)
        enhanced_hajgov = enhance_articles_with_content(recent_hajgov, max_articles=30) or []
        enhanced_cnn = enhance_articles_with_content(recent_cnn, max_articles=20) or []
        all_enhanced_articles = enhanced_hajgov + enhanced_cnn
        
        with open("all_enhanced_tourism_articles.txt", "w", encoding="utf-8") as f:
            json.dump(all_enhanced_articles, f, ensure_ascii=False, indent=2)
        
        await message.edit_text(
            "🌍 *الخطوة 3/3:* إنهاء إعداد موجز الأخبار...",
            parse_mode='Markdown'
        )
        
        # Format the message - pass hajgov as newsapi, cnn as gnews, empty for rest
        news_message, total_pages, current_category, relevant_articles = format_news_message(
            enhanced_hajgov, enhanced_cnn, [], [], [], page, category
        )
        
        # Update message header for presenter style
        if category:
            news_message = f"🕋 *موجز أخبار السياحة - {category}*\n" + news_message[news_message.find('\n')+1:]
        else:
            news_message = f"🕋 *موجز أخبار السياحة اليومي*\n" + news_message[news_message.find('\n')+1:]
        
        # Create keyboard based on context
        keyboard = []
        
        if category:
            # Category view with pagination
            if total_pages > 1:
                nav_row = []
                if page > 1:
                    nav_row.append(InlineKeyboardButton("⬅️ السابق", callback_data=f'category_{category}_{page-1}'))
                if page < total_pages:
                    nav_row.append(InlineKeyboardButton("التالي ➡️", callback_data=f'category_{category}_{page+1}'))
                if nav_row:
                    keyboard.append(nav_row)
            
            # Add PDF download button for category
            keyboard.append([InlineKeyboardButton("📄 تحميل تقرير الأخبار", callback_data=f'pdf_{category}')])
            keyboard.extend([
                [InlineKeyboardButton("🔄 تحديث جديد", callback_data=f'category_{category}_1')],
                [InlineKeyboardButton("🏠 القائمة الرئيسية", callback_data='main_menu')]
            ])
        else:
            # Main view
            keyboard = [
                [InlineKeyboardButton("📄 تحميل التقرير الكامل", callback_data='pdf_all')],
                [InlineKeyboardButton("🔄 تحديث جديد", callback_data='get_news')],
                [InlineKeyboardButton("📝 توليد تقارير أسبوعية", callback_data='generate_weekly')],
                [InlineKeyboardButton("🏠 القائمة الرئيسية", callback_data='main_menu')]
            ]
        
        reply_markup = InlineKeyboardMarkup(keyboard)
        
        # Update the message with final results
        await message.edit_text(
            news_message,
            parse_mode='Markdown',
            reply_markup=reply_markup,
            disable_web_page_preview=True
        )
            
    except Exception as e:
        error_message = f"❌ حدث خطأ أثناء إعداد موجز الأخبار: {str(e)}"
        logger.error(f"News briefing error: {str(e)}")
        await message.edit_text(error_message)

async def show_categories(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Show category selection menu."""
    categories_message = """
🧭 *تصنيفات أخبار السياحة*

اختر تصنيفًا لاستكشاف الأخبار مع استخراج المحتوى الكامل:

• ✈️ **الطيران والسفر** - شركات الطيران، المطارات، الوجهات الجديدة، التأشيرات
• 🏨 **الفنادق والضيافة** - الفنادق والمنتجعات، الإشغال، تجربة الضيف، الإيواء السياحي
• 🏛️ **سياسات وتنمية السياحة** - الأنظمة والاستراتيجيات، الاستثمار السياحي، الشراكات
• 🗺️ **الوجهات والمعالم** - الوجهات السياحية، التراث والمتاحف، المهرجانات والفعاليات
• 💻 **تقنية السفر** - منصات الحجز، الرقمنة، الابتكار والشركات الناشئة
• 📰 **أخبار عامة** - أخبار السياحة المتنوعة

*🆕 مزايا محسّنة لكل تصنيف:*
📖 استخراج المحتوى الكامل للمقالات
🧠 ملخصات ذكية مخصصة لكل تصنيف
📄 تقارير PDF مفصلة مع محتوى كامل
    """

    keyboard = [
        [InlineKeyboardButton("✈️ الطيران والسفر", callback_data='category_الطيران والسفر_1')],
        [InlineKeyboardButton("🏨 الفنادق والضيافة", callback_data='category_الفنادق والضيافة_1')],
        [InlineKeyboardButton("🏛️ سياسات وتنمية السياحة", callback_data='category_سياسات وتنمية السياحة_1')],
        [InlineKeyboardButton("🗺️ الوجهات والمعالم", callback_data='category_الوجهات والمعالم_1')],
        [InlineKeyboardButton("💻 تقنية السفر", callback_data='category_تقنية السفر_1')],
        [InlineKeyboardButton("📰 أخبار عامة", callback_data='category_أخبار عامة_1')],
        [InlineKeyboardButton("🏠 القائمة الرئيسية", callback_data='main_menu')]
    ]
    reply_markup = InlineKeyboardMarkup(keyboard)
    
    # Always send a new message instead of editing
    if update.callback_query:
        await update.callback_query.message.reply_text(
            categories_message,
            parse_mode='Markdown',
            reply_markup=reply_markup
        )
    else:
        await update.message.reply_text(
            categories_message,
            parse_mode='Markdown',
            reply_markup=reply_markup
        )

def format_news_message(hajgov_articles, cnn_articles, extra_articles=None, extra2=None, extra3=None, page=1, category=None):
    """Format news for Telegram message with pagination and categories"""
    articles_per_page = 6
    all_articles = (hajgov_articles or []) + (cnn_articles or []) + (extra_articles or []) + (extra2 or []) + (extra3 or [])

    
    if category and category in ['الوجهات والمعالم', 'الفنادق والضيافة', 'الطيران والسفر', 'سياسات وتنمية السياحة', 'أخبار عامة']:
        # Show articles from specific category
        categorized = categorize_articles(all_articles)
        category_articles = categorized.get(category, [])
        total_pages = (len(category_articles) + articles_per_page - 1) // articles_per_page if category_articles else 1
        start_idx = (page - 1) * articles_per_page
        end_idx = start_idx + articles_per_page
        page_articles = category_articles[start_idx:end_idx]
        
        category_label = category

        message = f"🕋 *أخبار السياحة - {category_label}* (محسّنة)\n"
        message += f"📅 {datetime.now().strftime('%Y-%m-%d %H:%M')}\n"
        message += f"📄 الصفحة {page} من {total_pages} | عدد المقالات: {len(category_articles)}\n"
        
        # Show content extraction stats
        enhanced_count = len([a for a in category_articles if a and a.get('full_content')])
        message += f"📚 مقالات تم استخراج محتواها بالكامل: {enhanced_count}/{len(category_articles)}\n\n"
        
        message += f"📰 *المقالات (الصفحة {page}):*\n"
        for i, article in enumerate(page_articles, start_idx + 1):
            if not article:
                continue
            title = article.get('title', 'No title')
            source = article.get('source', {}).get('name', 'Unknown') if article.get('source') else 'Unknown'
            url = article.get('url', '')
            extraction_method = article.get('extraction_method', 'N/A')
            content_length = article.get('content_length', 0)
            
            if len(title) > 65:
                title = title[:62] + "..."
            
            message += f"{i}. {title}\n"
            message += f"   🏢 المصدر: {source} | 🔧 طريقة الاستخراج: {extraction_method}\n"
            message += f"   📊 طول المحتوى: {content_length} حرفًا\n"
            if url:
                message += f"   🔗 [قراءة التفاصيل]({url})\n"
            message += "\n"
        
        return message, total_pages, category, category_articles
    
    else:
        # Show main summary with top articles
        message = f"⭐ *تحديث أخبار السياحة* (محسّن مع المحتوى الكامل)\n"
        message += f"📅 {datetime.now().strftime('%Y-%m-%d %H:%M')}\n\n"
        
        # Summary Statistics
        total_articles = len(all_articles)
        enhanced_count = len([a for a in all_articles if a and a.get('full_content')])       
        # Top Articles Preview
        message += f"📰 *أفضل المقالات المحسّنة اليوم:*\n"
        
        # Show top 10 articles total
        top_articles = all_articles[:10]
        for i, article in enumerate(top_articles, 1):
            if not article:
                continue
            title = article.get('title', 'No title')
            source = article.get('source', {}).get('name', 'Unknown') if article.get('source') else 'Unknown'
            url = article.get('url', '')
            extraction_method = article.get('extraction_method', 'N/A')
            content_length = article.get('content_length', 0)
            
            if len(title) > 65:
                title = title[:62] + "..."
            
            message += f"{i}. {title}\n"
            if url:
                message += f"   🔗 [قراءة التفاصيل]({url})\n"
            message += "\n"
        
        return message, 1, None, all_articles

async def button_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle button callbacks."""
    query = update.callback_query
    
    if query.data == 'get_news':
        await get_news(update, context)
    elif query.data == 'generate_weekly':
        await generate_weekly_blogs(update, context)
    elif query.data == 'generate_monthly':
        await generate_monthly_blogs(update, context)
    elif query.data == 'generate_magazine':
        await generate_magazine(update, context)
    elif query.data == 'show_categories':
        await show_categories(update, context)
    elif query.data == 'help':
        await help_command(update, context)
    elif query.data == 'main_menu':
        await start(update, context)
    elif query.data.startswith('pdf_'):
        # Handle PDF generation
        category = query.data.replace('pdf_', '')
        if category == 'all':
            await generate_pdf_report(update, context, None)
        else:
            await generate_pdf_report(update, context, category)
    elif query.data.startswith('category_'):
        # Handle category navigation
        parts = query.data.split('_')
        if len(parts) >= 3:
            category = '_'.join(parts[1:-1])  # Reconstruct category name
            page = int(parts[-1])
            await get_news(update, context, page, category)

async def keywords_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Allow the user to set or clear Tourism-specific keywords."""
    message = update.message or update.effective_message
    if not message:
        return
    
    user_input = ''
    if context.args:
        user_input = ' '.join(context.args).strip()
    
    if user_input:
        lowered = user_input.lower()
        if lowered in ('clear', 'reset', 'remove', 'none'):
            context.user_data.pop('blog_keywords', None)
            context.user_data.pop('awaiting_keywords_input', None)
            await message.reply_text("🧹 تم مسح الكلمات المفتاحية المحفوظة. استخدم الأمر /keywords لإضافة كلمات جديدة في أي وقت.")
            return
        
        parsed_kw = parse_keyword_input(user_input)
        if parsed_kw:
            context.user_data['blog_keywords'] = parsed_kw
            context.user_data.pop('awaiting_keywords_input', None)
            await message.reply_text(f"✅ تم حفظ الكلمات المفتاحية!\n{keywords_summary_text(parsed_kw)}")
        else:
            await message.reply_text(
                "⚠️ يرجى استخدام الصيغة التالية (بالإنجليزية):\n"
                "`Primary Keyword | secondary keyword 1, secondary keyword 2`\n"
                "مثال:\n"
                "`Saudi Tourism 2026 | travel, hospitality, aviation, destinations`",
                parse_mode='Markdown'
            )
        return
    
    context.user_data['awaiting_keywords_input'] = True
    await message.reply_text(KEYWORD_INPUT_INSTRUCTIONS, parse_mode='Markdown')

async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle text messages."""
    raw_text = (update.message.text or '').strip()
    if not raw_text:
        return
    
    if context.user_data.get('awaiting_keywords_input'):
        lowered = raw_text.lower()
        if lowered in ('cancel', 'stop', 'skip', 'exit'):
            context.user_data.pop('awaiting_keywords_input', None)
            await update.message.reply_text("تم إلغاء إدخال الكلمات المفتاحية. استخدم الأمر /keywords عندما تكون جاهزًا.")
            return
        parsed_kw = parse_keyword_input(raw_text)
        if parsed_kw:
            context.user_data['blog_keywords'] = parsed_kw
            context.user_data.pop('awaiting_keywords_input', None)
            await update.message.reply_text(f"✅ تم حفظ الكلمات المفتاحية!\n{keywords_summary_text(parsed_kw)}")
        else:
            await update.message.reply_text(
                "⚠️ لم أتمكن من فهم الصيغة.\n"
                "يرجى الإرسال بالشكل التالي (بالإنجليزية):\n"
                "`Primary Keyword | secondary keyword 1, secondary keyword 2`\n"
                "مثال: `Saudi Tourism 2026 | travel, hospitality, aviation, destinations`",
                parse_mode='Markdown'
            )
        return
    
    if '|' in raw_text and not raw_text.startswith('/'):
        parsed_kw = parse_keyword_input(raw_text)
        if parsed_kw:
            context.user_data['blog_keywords'] = parsed_kw
            context.user_data.pop('awaiting_keywords_input', None)
            await update.message.reply_text(f"✅ تم حفظ الكلمات المفتاحية!\n{keywords_summary_text(parsed_kw)}")
            return
        else:
            await update.message.reply_text(
                "⚠️ يبدو أن هذه صيغة كلمات مفتاحية، لكن لم أتمكن من تحليلها.\n"
                "يرجى الإرسال بهذه الصيغة (بالإنجليزية): `Primary Keyword | secondary keyword 1, secondary keyword 2` "
                "أو استخدم الأمر /keywords.",
                parse_mode='Markdown'
            )
            return
    
    text = raw_text.lower()
    
    if any(word in text for word in ['news', 'أخبار', 'سياحة', 'سفر', 'طيران', 'فنادق', 'update', 'enhanced', 'مقال']):
        await get_news(update, context)
    elif any(word in text for word in ['weekly', 'week', 'أسبوع', 'أسبوعي']):
        await generate_weekly_blogs(update, context)
    elif any(word in text for word in ['monthly', 'month', 'شهر', 'شهري']):
        await generate_monthly_blogs(update, context)
    elif any(word in text for word in ['magazine', 'مجلة', 'مجلات']):
        await generate_magazine(update, context)
    elif any(word in text for word in ['categories', 'category', 'topics', 'تصنيفات', 'تصنيف']):
        await show_categories(update, context)
    elif any(word in text for word in ['help', 'start', 'menu', 'مساعدة', 'بداية', 'قائمة']):
        await start(update, context)
    else:
        keyboard = [
        [InlineKeyboardButton("📰 الملخص اليومي", callback_data='get_news')],
        [InlineKeyboardButton("📊 الملخص الأسبوعي", callback_data='generate_weekly'),
         InlineKeyboardButton("📅 الملخص الشهري", callback_data='generate_monthly')],
        [InlineKeyboardButton("📰 المجلة", callback_data='generate_magazine')],
        ]
        reply_markup = InlineKeyboardMarkup(keyboard)
        
        await update.message.reply_text(
            "⭐ أهلاً بك! أنا بوت أخبار السياحة المحسّنة مع استخراج كامل لمحتوى المقالات.\n\n"
            "اختر أحد الخيارات في الأسفل أو استخدم هذه الأوامر:\n"
            "• /news - الحصول على أخبار السياحة المحسّنة\n"
            "• /weekly - توليد تقارير/مدونات أسبوعية\n"
            "• /monthly - توليد تقارير/مدونات شهرية\n"
            "• /magazine - توليد مجلة السياحة الشهرية (PDF)\n"
            "• /keywords - إعداد الكلمات المفتاحية (بالإنجليزية) لتحسين محركات البحث\n"
            "• /categories - تصفح الأخبار حسب التصنيف\n"
            "• /help - المزيد من المعلومات",
            parse_mode='Markdown',
            reply_markup=reply_markup
        )

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Send a message when the command /start is issued."""
    welcome_message = """
⭐ 👋 مرحباً بك! أنا مساعدك الإخباري الذكي لقطاع السياحة
تم تصميمي خصيصاً لأكون رفيقك اليومي في متابعة كل ما يخص أخبار وخدمات السياحة.
أقوم بجمع أحدث المستجدات، تحليلها، وتلخيصها لك بدقة واحترافية عالية،
لتكون دائماً في قلب الحدث دون إهدار وقتك في البحث بين المصادر المتعددة.

🤖 ملاحظة هامة:
أعتمد على خوارزميات الذكاء الاصطناعي المتقدمة لمعالجة وتلخيص الأخبار.
(هذه الخدمة تهدف لتسهيل المتابعة ولا تعتبر بديلاً عن التصريحات والقرارات الرسمية).

✨ أبرز ما أوفره لك:
📰 ملخصات يومية لأهم وأحدث أخبار القطاع.
📊 تقارير تحليلية شاملة ومفصلة (أسبوعية وشهرية).
📘 إصدارات شهرية متكاملة بصيغة PDF جاهزة للمشاركة.
⏱️ توفير الجهد والوقت لتبقَ مطلعاً على مدار الساعة.

🎯 لماذا تحتاجني؟
• لتكون على دراية تامة بمتغيرات السوق بشكل فوري.
• لتزويد فريق عملك وعملائك بتقارير دورية احترافية وموثوقة.
• لدعم اجتماعاتك الإدارية بملخصات دقيقة جاهزة للاستخدام.

🚀 جاهز للبدء؟
استخدم الخيارات والأزرار بالأسفل لاستكشاف الأخبار والتقارير.
    """
    
    keyboard = [
        [InlineKeyboardButton("⭐ الملخص اليومي", callback_data='get_news')],
        [InlineKeyboardButton("📊 التصنيفات", callback_data='show_categories')],
    ]
    reply_markup = InlineKeyboardMarkup(keyboard)
    
    # Handle both regular messages and callback queries
    if update.callback_query:
        await update.callback_query.message.reply_text(
            welcome_message,
            parse_mode='Markdown',
            reply_markup=reply_markup
        )
    else:
        await update.message.reply_text(
            welcome_message,
            parse_mode='Markdown',
            reply_markup=reply_markup
        )

def call_claude_api(system_message, user_message, api_key=None, model=None, max_tokens=16384, temperature=0.7, use_cache=True, use_long_timeout=False):
    """
    Helper function to call AWS Bedrock Claude API.
    Maintains the same signature as the old API function for compatibility.
    
    Args:
        system_message: The system prompt
        user_message: The user prompt
        api_key: Not used (kept for compatibility), uses global client
        model: Not used (kept for compatibility), uses global inference profile
        max_tokens: Maximum tokens in response (default: 16384)
        temperature: Temperature setting (0.0-1.0)
        use_cache: Not used (kept for compatibility)
        use_long_timeout: If True, use 600s timeout (for long operations like magazine generation)
    
    Returns:
        tuple: (response_text, error_message) - error_message is None if successful
    """
    # Queue behind the concurrency gate so parallel report jobs do not throttle
    # one another. Acquired for the whole call, released in the finally below.
    _llm_semaphore.acquire()
    try:
        # Build messages array for AWS Bedrock Claude
        # Combine system and user message since Bedrock Claude uses a simple format
        # We'll prepend the system message to the user message for compatibility
        combined_content = user_message
        if system_message:
            combined_content = f"{system_message}\n\n{user_message}"
        
        messages = [
            {
                "role": "user",
                "content": combined_content
            }
        ]
        
        # Build request body for Bedrock Claude
        # Claude Sonnet 4.5 supports up to 64K output tokens
        body = {
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": min(max_tokens, 64000),  # Claude Sonnet 4.5 supports up to 64K output
            "temperature": temperature,
            "messages": messages
        }
        
        # Select client based on timeout requirement
        client_to_use = bedrock_client_long if use_long_timeout else bedrock_client
        timeout_info = "600s (long operation)" if use_long_timeout else "60s (standard)"
        
        logger.info(f"Making AWS Bedrock API call - Inference Profile: {AWS_BEDROCK_INFERENCE_PROFILE}, Timeout: {timeout_info}")
        
        # Call AWS Bedrock API
        response = client_to_use.invoke_model(
            modelId=AWS_BEDROCK_INFERENCE_PROFILE,
            body=json.dumps(body)
        )
        
        logger.info(f"AWS Bedrock API call successful")
        
        # Parse response
        response_body = json.loads(response["body"].read())
        
        # Log stop reason for debugging
        stop_reason = response_body.get("stop_reason", "unknown")
        logger.info(f"AWS Bedrock response stop_reason: {stop_reason}")
        
        # Extract content from response
        if response_body.get("content") and len(response_body["content"]) > 0:
            content_text = response_body["content"][0].get("text", "")
            
            if not content_text:
                return None, "AWS Bedrock returned empty content"
            
            # Warn if response was truncated due to max_tokens
            if stop_reason == "max_tokens":
                logger.warning("⚠️ Response was truncated due to max_tokens limit!")
                logger.warning("   The model hit the output token limit before completing the response.")
                logger.warning("   Consider reducing the complexity of the request or splitting into multiple calls.")
            
            return content_text, None
        else:
            return None, "AWS Bedrock returned no content in response"
    
    except Exception as e:
        # Log the full exception for debugging
        error_type = type(e).__name__
        error_str = str(e)
        logger.error(f"AWS Bedrock API error: {error_type}: {error_str}")
        
        error_msg = error_str
        
        # Try to extract more specific error information from AWS Bedrock exceptions
        if hasattr(e, 'response'):
            try:
                if hasattr(e.response, 'get'):
                    error_data = e.response.get('Error', {})
                    if error_data:
                        error_msg = error_data.get('Message', error_msg)
                        error_code = error_data.get('Code', '')
                        logger.error(f"AWS Bedrock error code: {error_code}")
            except:
                pass
        
        # Check for specific error types
        if "ThrottlingException" in error_str or "Too many tokens" in error_str or "throttling" in error_str.lower():
            logger.error("⚠️ Rate limit exceeded - you've hit your daily token limit")
            logger.error("   Solutions:")
            logger.error("   1. Wait until your quota resets (usually daily)")
            logger.error("   2. Check your AWS Bedrock quotas: https://console.aws.amazon.com/servicequotas/")
            logger.error("   3. Request a quota increase if needed")
            logger.error("   4. Try a different model that has available quota")
            error_msg = f"Rate limit exceeded: {error_msg}"
        elif "ValidationException" in error_str or "validation" in error_str.lower():
            logger.error("⚠️ Validation error - check inference profile configuration")
            logger.error(f"   Inference Profile: {AWS_BEDROCK_INFERENCE_PROFILE}")
            logger.error(f"   Region: {AWS_REGION}")
            error_msg = f"Validation error: {error_msg}"
        elif "401" in error_str or "authentication" in error_str.lower() or "unauthorized" in error_str.lower():
            logger.error("⚠️ Authentication error - check AWS_BEARER_TOKEN_BEDROCK environment variable")
            error_msg = f"Authentication error: {error_msg}"
        
        return None, f"AWS Bedrock Error: {error_msg}"

    finally:
        _llm_semaphore.release()


def categorize_articles_for_blogs(articles):
    """Categorize Tourism articles into two main blog themes"""

    if not articles:
        logger.warning("No articles provided to categorize_articles_for_blogs")
        return {
            'management': [],
            'improvement': []
        }

    # Blog 1: Tourism policy, aviation & sector management
    management_keywords = [
        'سياحة', 'سياحي', 'وزارة السياحة', 'هيئة السياحة', 'استثمار', 'تنمية',
        'استراتيجية', 'تنظيم', 'تأشيرة', 'طيران', 'مطار', 'رحلات', 'اتفاقية',
        'شراكة', 'مشروع', 'زوار'
    ]

    # Blog 2: Destinations, hospitality, experiences & travel technology
    improvement_keywords = [
        'فندق', 'فنادق', 'ضيافة', 'منتجع', 'إشغال', 'وجهة', 'معالم', 'تراث',
        'متحف', 'مهرجان', 'فعالية', 'ترفيه', 'تجربة', 'تقنية', 'رقمي', 'منصة',
        'حجوزات', 'ابتكار'
    ]
    
    management_articles = []
    improvement_articles = []
    general_articles = []
    
    for article in articles:
        if not article:
            continue
        title = article.get('title', '') or ''
        description = article.get('description', '') or ''
        full_content = article.get('full_content', '') or ''
        content = f"{title.lower()} {description.lower()} {full_content.lower()[:1000]}"
        
        management_score = sum(1 for keyword in management_keywords if keyword in content)
        improvement_score = sum(1 for keyword in improvement_keywords if keyword in content)
        
        if management_score > improvement_score and management_score > 0:
            management_articles.append(article)
        elif improvement_score > 0:
            improvement_articles.append(article)
        else:
            general_articles.append(article)
    
    # Distribute general articles
    half_general = len(general_articles) // 2
    management_articles.extend(general_articles[:half_general])
    improvement_articles.extend(general_articles[half_general:])
    
    return {
        'management': management_articles,
        'improvement': improvement_articles
    }

def parse_blog_sections(blog_content):
    """Parse blog content and return structured sections"""
    if not blog_content:
        logger.warning("No blog content provided to parse_blog_sections")
        return []
    
    sections = []
    current_section = {"title": "", "content": "", "level": 0}
    
    lines = blog_content.split('\n')
    
    for line in lines:
        line = line.strip()
        if not line:
            continue
            
        # Check for headers
        if line.startswith('#'):
            # Save previous section if it has content
            if current_section["content"].strip():
                sections.append(current_section.copy())
            
            # Start new section
            level = len(line) - len(line.lstrip('#'))
            title = line.lstrip('#').strip()
            
            current_section = {
                "title": title,
                "content": "",
                "level": level
            }
        else:
            # Add to current section content
            current_section["content"] += line + " "
    
    # Don't forget the last section
    if current_section["content"].strip():
        sections.append(current_section)
    
    return sections

def process_arabic_text(text):
    """Reshape and reorder Arabic text for correct display in PDF"""
    if not text:
        return ""
    reshaped_text = arabic_reshaper.reshape(text)
    bidi_text = get_display(reshaped_text)
    return bidi_text

def create_tourism_blog_pdf(blog_content, blog_title, is_temp_file=True):
    """Create a beautifully formatted Tourism blog-style PDF"""
    
    if not blog_content or not blog_title:
        logger.warning("No blog content or title provided to create_tourism_blog_pdf")
        return None
    
    if is_temp_file:
        # Create a temporary file for Telegram bot
        temp_file = tempfile.NamedTemporaryFile(delete=False, suffix='.pdf')
        filename = temp_file.name
        temp_file.close()
    else:
        # Create with specific filename for standalone use
        filename = f"{blog_title.replace(' ', '_')}_{datetime.now().strftime('%Y%m%d')}.pdf"
    
    doc = SimpleDocTemplate(filename, pagesize=A4, 
                          topMargin=0.75*inch, bottomMargin=0.75*inch,
                          leftMargin=0.75*inch, rightMargin=0.75*inch)
    
    # Define comprehensive blog styles
    styles = getSampleStyleSheet()
    
    # Blog title style (main headline)
    blog_title_style = ParagraphStyle(
        'BlogTitle',
        parent=styles['Heading1'],
        fontSize=28,
        spaceAfter=15,
        spaceBefore=0,
        alignment=TA_CENTER,
        textColor=HexColor('#1a1a1a'),
        fontName='Amiri',
        leading=32
    )
    
    # Blog metadata style (date, info)
    blog_meta_style = ParagraphStyle(
        'BlogMeta',
        parent=styles['Normal'],
        fontSize=11,
        spaceAfter=30,
        alignment=TA_CENTER,
        textColor=HexColor('#666666'),
        fontName='Amiri'
    )
    
    # Section header style (H2)
    section_header_style = ParagraphStyle(
        'SectionHeader',
        parent=styles['Heading2'],
        fontSize=18,
        spaceAfter=12,
        spaceBefore=24,
        textColor=HexColor('#2c3e50'),
        fontName='Amiri',
        alignment=TA_RIGHT
    )
    
    # Subsection header style (H3)
    subsection_header_style = ParagraphStyle(
        'SubsectionHeader',
        parent=styles['Heading3'],
        fontSize=14,
        spaceAfter=8,
        spaceBefore=16,
        textColor=HexColor('#34495e'),
        fontName='Amiri',
        alignment=TA_RIGHT
    )
    
    # Blog paragraph style
    blog_paragraph_style = ParagraphStyle(
        'BlogParagraph',
        parent=styles['Normal'],
        fontSize=12,
        spaceAfter=12,
        spaceBefore=0,
        alignment=TA_RIGHT,
        leading=18,
        textColor=HexColor('#333333'),
        fontName='Amiri'
    )
    
    # Build the document content
    content = []
    
    # Add logo at the top right corner if available
    template_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'templates')
    logo_path = os.path.join(template_dir, 'images', 'taawuniya-logo.png')
    if os.path.exists(logo_path):
        try:
            # Calculate available width (A4 width - left margin - right margin)
            available_width = A4[0] - (0.75*inch * 2)  # A4 width minus margins
            # Add logo with bigger size (5 inches wide, maintain aspect ratio) in top right corner
            logo = Image(logo_path, width=5*inch, height=1.25*inch, kind='proportional')
            # Use Table to position logo in top right corner
            logo_table = Table([[logo]], colWidths=[available_width])
            logo_table.setStyle(TableStyle([
                ('ALIGN', (0, 0), (-1, -1), 'RIGHT'),
                ('VALIGN', (0, 0), (-1, -1), 'TOP'),
            ]))
            content.append(logo_table)
            content.append(Spacer(1, 10))
        except Exception as e:
            logger.warning(f"Could not add logo to PDF: {str(e)}")
    
    # Add blog title
    content.append(Paragraph(process_arabic_text(blog_title), blog_title_style))
    
    content.append(Spacer(1, 10))
    
    # Parse the blog content into sections
    sections = parse_blog_sections(blog_content)
    
    for section in sections:
        title = section['title']
        section_content = section['content'].strip()
        level = section['level']
        
        # Skip empty sections
        if not section_content:
            continue
        
        # Add section header based on level
        if level == 1:
            continue  # Main title already added
        elif level == 2:
            if title:
                content.append(Paragraph(process_arabic_text(title), section_header_style))
        elif level == 3:
            if title:
                content.append(Paragraph(process_arabic_text(title), subsection_header_style))
        
        # Add section content
        if section_content:
            # Split into paragraphs
            paragraphs = section_content.split('. ')
            for para in paragraphs:
                para = para.strip()
                if para and len(para) > 20:
                    # Close the sentence if not ending with punctuation
                    if not para.endswith('.'):
                        para += '.'
                    content.append(Paragraph(process_arabic_text(para), blog_paragraph_style))
    
    # Build the PDF
    try:
        doc.build(content)
        logger.info(f"Successfully created Tourism news blog PDF: {filename}")
        return filename
    except Exception as e:
        logger.error(f"Error creating Tourism news blog PDF: {str(e)}")
        return None

async def generate_pdf_report(update: Update, context: ContextTypes.DEFAULT_TYPE, category=None):
    """Generate and send enhanced PDF report with full content in daily blog style."""
    query = update.callback_query
    await query.answer()
    
    # Send status message
    status_message = await query.message.reply_text(
        "📄 جارٍ توليد تقرير PDF محسّن...\n📖 يتم الآن استخراج المحتوى الكامل لتحليل أكثر تفصيلاً...\n⏳ يرجى الانتظار من 1 إلى 2 دقيقة.",
        parse_mode='Markdown'
    )
    
    try:
        await status_message.edit_text(
            "📄 *الخطوة 1/2:* توليد محتوى تقريري بأسلوب مدونة متخصصة...",
            parse_mode='Markdown'
        )
        
        # Load articles from saved file
        if not os.path.exists("all_enhanced_tourism_articles.txt"):
            await status_message.edit_text(
                "❌ لا توجد مقالات متاحة حاليًا. يرجى تشغيل الأمر /news أولاً لجلب المقالات.",
                parse_mode='Markdown'
            )
            return
        
        with open("all_enhanced_tourism_articles.txt", "r", encoding="utf-8") as f:
            all_articles = json.load(f)
        
        # Prepare articles according to scope
        user_keywords = get_user_keywords(context)
        if category and category != 'all':
            categorized = categorize_articles(all_articles)
            articles_for_report = categorized.get(category, [])
            blog_title = f"تقرير السياحة اليومي – {category}"
            blog_content = generate_daily_tourism_blog_with_ai(articles_for_report, category, keywords=user_keywords)
        else:
            articles_for_report = all_articles
            blog_title = "تقرير السياحة اليومي"
            blog_content = generate_daily_tourism_blog_with_ai(articles_for_report, None, keywords=user_keywords)

        # Fallback if model returned too-short, empty content, or error message
        if not blog_content or len(blog_content.strip()) < 100 or (blog_content.startswith("# التقرير اليومي للسياحة") and "Error" in blog_content):
            logger.warning("Model returned empty/short content or error. Using fallback blog content.")
            blog_content = build_fallback_tourism_blog_content(articles_for_report, category)
        
        # Build PDF using blog formatter for consistent look
        pdf_filename = create_tourism_blog_pdf(blog_content, blog_title, is_temp_file=True)
        report_title = blog_title
        
        await status_message.edit_text(
            "📄 *الخطوة 2/2:* إنشاء ملف PDF...",
            parse_mode='Markdown'
        )
        
        # Send the PDF file
        if pdf_filename and os.path.exists(pdf_filename):
            with open(pdf_filename, 'rb') as pdf_file:
                await query.message.reply_document(
                    document=pdf_file,
                    filename=f"{report_title.replace(' ', '_')}_{datetime.now().strftime('%Y%m%d')}.pdf",
                    caption=f"📄 *{report_title}*\n📅 تاريخ الإنشاء: {datetime.now().strftime('%Y-%m-%d %H:%M')}\n📖 تقرير محسّن مع استخراج كامل لمحتوى المقالات",
                    parse_mode='Markdown'
                )
            
            # Clean up the temporary file
            os.unlink(pdf_filename)
            
            # Update status message
            await status_message.edit_text(
                "✅ تم توليد تقرير PDF محسّن وإرساله بنجاح!\n📖 يشمل محتوى كاملًا للمقالات وتحليلًا تفصيليًا.",
                parse_mode='Markdown'
            )
        else:
            await status_message.edit_text(
                "❌ خطأ: تعذر إنشاء ملف PDF.",
                parse_mode='Markdown'
            )
        
    except Exception as e:
        try:
            await status_message.edit_text(
                f"❌ حدث خطأ أثناء توليد تقرير PDF المحسّن: {str(e)}",
                parse_mode='Markdown'
            )
        except Exception as edit_error:
            # Try to send a new message instead
            try:
                await status_message.reply_text(
                    f"❌ حدث خطأ أثناء توليد تقرير PDF المحسّن: {str(e)}"
                )
            except Exception as reply_error:
                logger.error(f"Error sending reply: {reply_error}")

def generate_daily_tourism_blog_with_ai(articles, category=None, keywords=None):
    """Generate a daily Tourism blog-style summary so PDFs match weekly blog formatting."""
    if not articles:
        logger.warning("No articles provided to generate_daily_tourism_blog_with_ai")
        return "# التقرير اليومي للسياحة\n\nلا توجد مقالات متاحة اليوم."
    
    # Prepare content from articles (shorter excerpts for daily)
    max_daily_articles = min(len(articles), 40)
    news_content = ""
    for i, article in enumerate(articles[:max_daily_articles], 1):
        if not article:
            continue
        title = article.get('title', 'No title')
        source = article.get('source', {}).get('name', 'Unknown source') if article.get('source') else 'Unknown source'
        full_content = (article.get('full_content') or article.get('description') or '').strip()
        if len(full_content) < MIN_CONTENT_CHARS:
            continue  # nothing worth summarising — never send a placeholder
        published_date = article.get('publishedAt', 'Unknown date')
        url = article.get('url', '')
        if full_content and len(full_content) > 450:
            full_content = full_content[:450] + "..."
        news_content += f"""
ARTICLE {i}:
Title: {title}
Source: {source}
Date: {published_date}
URL: {url}
Content: {full_content}
---
"""
    
    # Choose focus
    if category in [
        "الوجهات والمعالم",
        "الفنادق والضيافة",
        "الطيران والسفر",
        "سياسات وتنمية السياحة",
        "أخبار عامة"
    ]:
        title_suffix = f" – {category}"
        intro_target = f"أهم تطورات {category} اليوم"
    else:
        title_suffix = ""
        intro_target = "أهم تطورات السياحة اليوم"
    
    # System message (static, will be cached)
    system_message = (
        "You are a professional Arabic writer. "
        "You write concise, structured daily blog reports about Tourism and travel news in MODERN STANDARD ARABIC. "
        "All visible content, headings, and paragraphs must be in Arabic, but you may read/analyze English source text. "
        "Keep the style صحفي احترافي وسهل القراءة، واستخدم عناوين Markdown. "
        + SCOPE_RULE
    )
    
    keyword_guidance = build_keyword_instruction_block(keywords)
    
    user_prompt = f"""
    {keyword_guidance}

    اكتب تقريرًا يوميًا موجزًا بأسلوب مدونة عن {intro_target} باللغة العربية الفصحى،
    مستخدمًا البنية التالية **بالضبط** باستخدام Markdown. اجعل النص مركزًا وغنيًا بالمعلومات.

# [اكتب عنوانًا عربيًا جذابًا لليوم]

## نظرة سريعة
[فقرة من 80–120 كلمة تلخص أهم محاور اليوم والعناوين الرئيسية في أخبار السياحة]

## أبرز الأخبار
[2-3 فقرات قصيرة، كل منها 80–120 كلمة، تربط بين أهم التحديثات في مجال السياحة]

## تطورات لافتة
[قائمة نقطية من 6–8 عناصر مختصرة، كل عنصر 1–2 جملة، تشير إلى شركات أو معايير أو نتائج محددة]

## السوق والتأثير
[1–2 فقرة عن تأثير الأخبار على قطاع السياحة والصناعة]

## ما الذي نترقبه لاحقًا
[3–5 نقاط حول الإعلانات المتوقعة أو الاتجاهات في مجال السياحة الصاعدة]

متطلبات أساسية:
- استخدم عناوين الأقسام العربية أعلاه كما هي مع تنسيق Markdown (##).
- امزج المعلومات من عدة مقالات، ولا تكتفِ بسردها واحدة تلو الأخرى.
- اذكر الأسماء والأرقام والمعايير والمنظمات كلما أمكن ذلك.
- اجعل الأسلوب صحفيًا احترافيًا وواضحًا، مناسبًا لتقرير يومي عن السياحة.
- ركّز دائمًا على صلة المحتوى بمجال السياحة، وتجاهل أي خبر خارج نطاق السياحة والسفر والضيافة.
- اكتب بالعربية الفصحى فقط. يُمنع منعًا باتًا نسخ أي جملة أو فقرة بالإنجليزية من المصادر؛ ترجم المعنى إلى العربية.
- لا تنسخ نص المقال كما هو. أعد صياغته بأسلوبك، واربط بين المصادر.
- تجاهل تمامًا أي مقال يبدو نصه ناقصًا أو مبتورًا أو غير مفهوم، ولا تقتبس منه.
- لا تكتب جملة غير مكتملة أبدًا. كل جملة يجب أن تنتهي نهاية صحيحة، وممنوع إنهاء أي سطر بعلامات مثل «...» أو «..».
- لا تذكر عبارات نظام مثل No content available أو Unknown source أو Intelligence Score، ولا تكتب وسوم هاشتاق منقولة من التغريدات.
- إذا لم تتوفر معلومات كافية عن محور ما، احذف المحور بدل تعبئته بنص ناقص.

مقالات للتحليل ({max_daily_articles} مقالاً):
{news_content}
"""
    
    # Call AWS Bedrock Claude API
    content, error = call_claude_api(
        system_message=system_message,
        user_message=user_prompt,
        max_tokens=2200,
        temperature=0.45,
        use_cache=True
    )
    
    if error:
        return f"# التقرير اليومي للسياحة{title_suffix}\n\nحدث خطأ أثناء توليد المحتوى: {error}"
    
    if not content:
        return f"# التقرير اليومي للسياحة{title_suffix}\n\nتعذّر توليد المحتوى اليوم."
    
    if not content.lstrip().startswith('#'):
        prefix_title = f"# التقرير اليومي للسياحة{title_suffix}\n\n"
        return prefix_title + content
    
    logger.info(f"Model content length: {len(content)}")
    return content

def build_fallback_tourism_blog_content(articles, category=None):
    """Build a minimal, readable daily report from available articles when the model response is empty."""
    heading = f"# التقرير اليومي للسياحة – {category}" if category else "# التقرير اليومي للسياحة"
    if not articles:
        return f"{heading}\n\nلا توجد مقالات متاحة اليوم."
    lines = [heading, "", "## أهم العناوين", ""]
    count = 0
    for art in articles:
        if not art:
            continue
        title = art.get('title') or art.get('headline') or art.get('name')
        desc = art.get('description') or art.get('summary') or art.get('excerpt') or art.get('full_content', '')[:200]
        if not title and not desc:
            continue
        bullet = f"- {title.strip()}" if title else "- (بدون عنوان)"
        if desc:
            bullet += f" — {desc.strip()[:240]}"
        lines.append(bullet)
        count += 1
        if count >= 20:
            break
    if count == 0:
        lines.append("- لا توجد عناصر قابلة للعرض.")
    lines += ["", "## ملاحظات", "تم إنشاء هذا الملخص الاحتياطي بسبب عدم توفر استجابة من نموذج الذكاء الاصطناعي."]
    return "\n".join(lines)

def generate_tourism_blog_with_ai(articles, blog_theme, time_period="weekly", keywords=None):
    """Generate a Tourism blog post using Claude AI"""
    
    if not articles:
        logger.warning(f"No articles provided to generate_tourism_blog_with_ai for {blog_theme}")
        return "تعذّر إنشاء مدونة السياحة: لا توجد مقالات كافية للتحليل."
    
    # Prepare content from articles
    news_content = ""
    article_count = min(len(articles), 30)
    
    for i, article in enumerate(articles[:article_count], 1):
        if not article:
            continue
        title = article.get('title', 'No title')
        source = article.get('source', {}).get('name', 'Unknown source') if article.get('source') else 'Unknown source'
        full_content = (article.get('full_content') or article.get('description') or '').strip()
        if len(full_content) < MIN_CONTENT_CHARS:
            continue  # nothing worth summarising — never send a placeholder
        published_date = article.get('publishedAt', 'Unknown date')
        url = article.get('url', '')
        
        if full_content and len(full_content) > 600:
            full_content = full_content[:600] + "..."
        
        news_content += f"""
ARTICLE {i}:
Title: {title}
Source: {source}
Date: {published_date}
URL: {url}
Content: {full_content}
---
"""
    
    # Determine period-specific language (Arabic labels)
    period_adj = {"daily": "يومية", "weekly": "أسبوعية", "monthly": "شهرية"}.get(time_period, "أسبوعية")
    period_cap = {"daily": "اليوم", "weekly": "هذا الأسبوع", "monthly": "هذا الشهر"}.get(time_period, "هذا الأسبوع")
    period_next = {"daily": "غدًا", "weekly": "الأسبوع القادم", "monthly": "الشهر القادم"}.get(time_period, "الأسبوع القادم")
    
    # Create theme-specific prompts
    if blog_theme == "management":
        blog_focus = "سياسات السياحة وتنظيم القطاع"
        blog_angle = (
            "ركّز على السياسات والأنظمة السياحية، والاستثمارات والمشاريع الكبرى، "
            "وحركة الطيران والمطارات والتأشيرات، وأداء القطاع ومؤشراته. "
            "الجمهور المستهدف هو الجهات المنظّمة، والمستثمرون، ومشغّلو القطاع السياحي. "
            "أبرز الاستراتيجيات الوطنية، والشراكات، ومستهدفات رؤية السعودية 2030 السياحية."
        )
    elif blog_theme == "combined":
        blog_focus = "أخبار السياحة الشاملة"
        blog_angle = (
            "ركّز على كافة جوانب السياحة: الطيران والسفر، الفنادق والضيافة، "
            "سياسات وتنمية السياحة، الوجهات والمعالم، والفعاليات والترفيه، وتقنية السفر. "
            "الجمهور المستهدف هو المتابعون الشاملون لقطاع السياحة والمهتمون بجميع مستجداته. "
            "أبرز أهم الأخبار والقرارات والصفقات والتطورات التقنية والتنظيمية في القطاع."
        )
    else:  # improvement
        blog_focus = "الوجهات والضيافة وتجربة الزائر"
        blog_angle = (
            "ركّز على الوجهات والمعالم والمهرجانات والفعاليات، وقطاع الفنادق والضيافة، "
            "وتجربة الزائر، والتحول الرقمي ومنصات الحجز وتقنيات السفر. "
            "الجمهور المستهدف هو مشغّلو الوجهات، ومزودو خدمات الضيافة، ووكالات السفر. "
            "أبرز الاتجاهات الصاعدة، والابتكارات، وأفضل الممارسات في تجربة الزائر."
        )
    
    system_message = (
        "You are a professional Arabic Tourism industry blogger. "
        "You always write engaging, insightful blog posts in MODERN STANDARD ARABIC about Tourism and travel developments. "
        "Use clear structure, strong headings in Arabic, and actionable insights. "
        "Always use proper markdown formatting for headers, and keep the tone صحفي احترافي وجذّاب. "
        + SCOPE_RULE
    )
    
    keyword_guidance = build_keyword_instruction_block(keywords)
    
    user_prompt = f"""
    {keyword_guidance}

    اكتب تدوينة {period_adj} عربية شاملة عن {blog_focus} خلال {period_cap}،
    مستخدمًا البنية التالية **بالضبط** باستخدام Markdown:

    # [اكتب عنوانًا عربيًا جذابًا]

    ## مقدمة
    [مقدمة مشوّقة من 150 كلمة تقريبًا تجذب القارئ وتشرح سياق التقرير]

    ## أهم قصة في {period_cap}
    [250–300 كلمة تغطي التطور الأهم في أخبار السياحة لهذا {period_cap}]

    ## تطور رئيسي ثانٍ
    [250–300 كلمة عن ثاني أهم تطور]

    ## اتجاهات بارزة
    [200–250 كلمة عن أبرز الاتجاهات والأنماط الملحوظة]

    ## تركيز على معيار أو قطاع
    [200–250 كلمة تبرز معايير أو شركات أو قطاعات محددة]

    ## ملخصات سريعة
    [200–250 كلمة تغطي 6–8 تطورات إضافية بشكل موجز]

    ## مراقبة السوق
    [150–200 كلمة عن الاستثمارات، الشراكات، وأخبار الأعمال في مجال السياحة]

    ## ما الذي ينتظرنا لاحقًا
    [100–150 كلمة تستشرف ما قد يحدث في {period_next}]

    ## خلاصة
    [فقرة ختامية قصيرة بأهم الرسائل والتوصيات]

    زاوية التغطية:
    {blog_angle}

    متطلبات أساسية:
    - يجب استخدام عناوين الأقسام العربية أعلاه كما هي مع تنسيق Markdown (##).
    - استشهد بما لا يقل عن 15–20 مقالًا مختلفًا داخل التدوينة.
    - اذكر أسماء الشركات، المعايير، الأرقام، التواريخ، والمصادر كلما أمكن.
    - اجعل الأسلوب عربيًا صحفيًا مهنيًا وجذابًا.
    - اجعل كل قسم غنيًا بالمعلومات وقابلًا للاستخدام لخبراء السياحة.
    - أمامك {article_count} مقالًا، فاستخدم هذا التنوع في بناء الصورة الكلية.

    محتوى المقالات للتحليل ({article_count} مقالاً):
    {news_content}

    اكتب التدوينة باللغة العربية الفصحى فقط، بدون أي فقرات تفسيرية باللغة الإنجليزية.
    - اكتب بالعربية الفصحى فقط. يُمنع منعًا باتًا نسخ أي جملة أو فقرة بالإنجليزية من المصادر؛ ترجم المعنى إلى العربية.
    - لا تنسخ نص المقال كما هو. أعد صياغته بأسلوبك، واربط بين المصادر.
    - تجاهل تمامًا أي مقال يبدو نصه ناقصًا أو مبتورًا أو غير مفهوم، ولا تقتبس منه.
    - لا تكتب جملة غير مكتملة أبدًا. كل جملة يجب أن تنتهي نهاية صحيحة، وممنوع إنهاء أي سطر بعلامات مثل «...» أو «..».
    - لا تذكر عبارات نظام مثل No content available أو Unknown source أو Intelligence Score، ولا تكتب وسوم هاشتاق منقولة من التغريدات.
    - إذا لم تتوفر معلومات كافية عن محور ما، احذف المحور بدل تعبئته بنص ناقص.
    """
    
    content, error = call_claude_api(
        system_message=system_message,
        user_message=user_prompt,
        max_tokens=3500,
        temperature=0.5,
        use_cache=True
    )
    
    if error:
        return f"حدث خطأ أثناء توليد التدوينة: {error}"
    else:
        return content


def generate_awareness_campaign_with_ai(articles, keywords=None):
    """Generate an awareness-campaign (حملة توعية) action plan from the month's news.

    Extracts the most important tourism/travel topics from the supplied
    articles (typically the monthly report set) and returns a structured Arabic
    Markdown plan for a tourism promotion campaign. Returns a Markdown string.
    """

    if not articles:
        logger.warning("No articles provided to generate_awareness_campaign_with_ai")
        return "تعذّر إنشاء خطة الحملة التوعوية: لا توجد مقالات كافية للتحليل."

    # Prepare content from articles (use up to 40 for a monthly signal)
    news_content = ""
    article_count = min(len(articles), 40)

    for i, article in enumerate(articles[:article_count], 1):
        if not article:
            continue
        title = article.get('title', 'No title')
        source = article.get('source', {}).get('name', 'Unknown source') if article.get('source') else 'Unknown source'
        full_content = (article.get('full_content') or article.get('description') or '').strip()
        if len(full_content) < MIN_CONTENT_CHARS:
            continue  # nothing worth summarising — never send a placeholder
        published_date = article.get('publishedAt', 'Unknown date')

        if full_content and len(full_content) > 500:
            full_content = full_content[:500] + "..."

        news_content += f"""
ARTICLE {i}:
Title: {title}
Source: {source}
Date: {published_date}
Content: {full_content}
---
"""

    system_message = (
        "You are a senior marketing & communications strategist (Chief Marketing Officer level) "
        "for a national tourism destination-marketing organisation (جهة تسويق سياحي وطنية). "
        "You build complete, professional MARKETING CAMPAIGN STRATEGIES for tourism promotion "
        "campaigns focused on destinations, hospitality, events and visitor experience in the "
        "Saudi/Arab context — covering situation analysis, positioning, creative concept, "
        "messaging architecture, channel & media plan, content calendar, budget allocation, "
        "KPIs, and risk management. You always write in MODERN STANDARD ARABIC, use clear "
        "Markdown headings and tables, and produce concrete, boardroom-ready plans. "
        + SCOPE_RULE
    )

    keyword_guidance = build_keyword_instruction_block(keywords)

    user_prompt = f"""
    {keyword_guidance}

    حلّل مجموعة الأخبار التالية المستخلصة من أخبار الشهر في قطاع السياحة والسفر،
    واستخرج منها أهم الموضوعات والقضايا المتكررة، ثم صمّم بناءً عليها **استراتيجية حملة تسويقية
    سياحية متكاملة واحترافية** جاهزة للعرض على مجلس الإدارة. استخدم البنية التالية **بالضبط**
    باستخدام Markdown (استعمل الجداول حيثما يناسب):

    # الحملة التسويقية السياحية: [اسم إبداعي جذّاب للحملة مستوحى من أبرز موضوع]
    > **الشعار (Slogan):** [شعار قصير مؤثر يُستخدم في كل مواد الحملة]

    ## ١. الملخص التنفيذي
    [120–150 كلمة توجز فكرة الحملة، ومبررها، وجمهورها، والنتيجة المرجوّة]

    ## ٢. تحليل الوضع الراهن (استنادًا إلى أخبار الشهر)
    [أبرز 3–5 موضوعات/اتجاهات سياحية تكررت في الأخبار، مع ربط كل موضوع بما ورد فعليًا في الأخبار]

    ## ٣. تحليل SWOT
    [جدول من أربع خانات: نقاط القوة، نقاط الضعف، الفرص، التهديدات — من منظور الوجهة السياحية والحملة]

    ## ٤. الجمهور المستهدف (Personas)
    [عرّف 2–3 شخصيات مسافر بالتفصيل: العمر، السوق المصدّر، دافع السفر، الميزانية، السلوك الرقمي، الرسالة الملائمة لكل شخصية]

    ## ٥. أهداف الحملة (SMART)
    [3–5 أهداف ذكية قابلة للقياس مع أرقام مستهدفة وإطار زمني]

    ## ٦. التموضع والفكرة الإبداعية الكبرى (Positioning & Big Idea)
    [عبارة التموضع، والفكرة الإبداعية المحورية التي توحّد الحملة، ونبرة الخطاب]

    ## ٧. معمارية الرسائل (Messaging Pillars)
    [3–4 محاور رسائل رئيسية، وتحت كل محور رسائل فرعية قصيرة قابلة للاستخدام في المحتوى]

    ## ٨. الاستراتيجية الإبداعية والمحتوى
    [أنواع المحتوى: فيديوهات قصيرة، جولات افتراضية، إنفوجرافيك، قصص زوار، بثّ مباشر من الوجهات، بودكاست سفر — مع أمثلة عناوين/أفكار محتوى ملموسة]

    ## ٩. خطة القنوات والوسائط (Channel & Media Plan)
    [جدول: القناة | الهدف منها | نوع المحتوى | التكرار | مؤشر الأداء — يشمل السوشيال ميديا، منصات الحجز، وكالات السفر، المعارض السياحية، الإعلام، الشراكات]

    ## ١٠. التقويم الزمني للحملة (Content Calendar)
    [جدول خطة 4–6 أسابيع: الأسبوع | المحور | الأنشطة | القنوات | المخرجات]

    ## ١١. الميزانية التقديرية وتوزيعها
    [جدول بنود الصرف الرئيسية ونِسَب توزيع الميزانية التقديرية (نسب مئوية) بين الإنتاج والإعلانات المدفوعة والفعاليات والمعارض والشراكات]

    ## ١٢. الشراكات والمؤثرون
    [جهات حكومية وقطاع خاص للتعاون (وزارة السياحة، شركات الطيران، الفنادق، منصات الحجز)، ونوع المؤثرين المناسبين (صنّاع محتوى سفر، مصورون) ودورهم]

    ## ١٣. مؤشرات قياس الأداء (KPIs)
    [جدول: المؤشر | القيمة المستهدفة | أداة القياس]

    ## ١٤. إدارة المخاطر والاستدامة
    [أبرز المخاطر المحتملة وسبل معالجتها، وكيف تُستدام آثار الحملة بعد انتهائها]

    متطلبات أساسية:
    - يجب استخدام عناوين الأقسام العربية أعلاه كما هي مع تنسيق Markdown (##)، واستخدم جداول Markdown في الأقسام المطلوبة.
    - يجب أن يكون تحليل الوضع والموضوعات نابعًا فعليًا من الأخبار المرفقة، لا موضوعات عامة.
    - ركّز على الوجهات والتجارب السياحية والضيافة والفعاليات وتجربة الزائر.
    - اجعل الاستراتيجية عملية وواقعية واحترافية وقابلة للتنفيذ من قبل جهة تسويق سياحي.
    - أمامك {article_count} مقالًا، فاستند إليها في التحليل.

    محتوى الأخبار للتحليل ({article_count} مقالاً):
    {news_content}

    اكتب الاستراتيجية باللغة العربية الفصحى فقط، بدون أي فقرات باللغة الإنجليزية (باستثناء المصطلحات التسويقية بين قوسين).
    """

    content, error = call_claude_api(
        system_message=system_message,
        user_message=user_prompt,
        max_tokens=6000,
        temperature=0.6,
        use_cache=True,
        use_long_timeout=True
    )

    if error:
        return f"حدث خطأ أثناء توليد خطة الحملة التوعوية: {error}"
    return content


async def generate_weekly_blogs(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Generate comprehensive weekly Tourism blog posts."""
    user_id = get_user_id(update)
    
    # Check usage limit
    has_limit, current_usage = check_usage_limit(user_id, 'weekly')
    if not has_limit:
        limit_message = (
            f"❌ *تم الوصول إلى الحد الأقصى*\n\n"
            f"لقد استخدمت جميع المحاولات المتاحة للتقارير الأسبوعية ({USAGE_LIMITS['weekly']}/{USAGE_LIMITS['weekly']}).\n\n"
        )
        if update.callback_query:
            await update.callback_query.answer("تم الوصول إلى الحد الأقصى", show_alert=True)
            await update.callback_query.message.reply_text(limit_message, parse_mode='Markdown')
        else:
            await update.message.reply_text(limit_message, parse_mode='Markdown')
        return
    
    # Increment usage
    increment_usage(user_id, 'weekly')
    
    if update.callback_query:
        await update.callback_query.answer()
        message = await update.callback_query.message.reply_text(
            "📝 *مولّد المدونات الأسبوعية للسياحة*\n\n⏳ جارٍ إعداد تحليل أسبوعي شامل...\n📊 سيتم تحليل أخبار السياحة لآخر 7 أيام\n⏰ الزمن المتوقع: 3–5 دقائق\n\nيرجى الانتظار...",
            parse_mode='Markdown'
        )
    else:
        message = await update.message.reply_text(
            "📝 *مولّد المدونات الأسبوعية للسياحة*\n\n⏳ جارٍ إعداد تحليل أسبوعي شامل...\n📊 سيتم تحليل أخبار السياحة لآخر 7 أيام\n⏰ الزمن المتوقع: 3–5 دقائق\n\nيرجى الانتظار...",
            parse_mode='Markdown'
        )
    
    try:
        await message.edit_text(
            "📝 *الخطوة 1/4:* جلب أخبار السياحة الأسبوعية...\n📡 يتم الآن جمع المقالات من آخر 7 أيام...",
            parse_mode='Markdown'
        )
        
        hajgov_articles = fetch_tourism_news() or []
        cnn_articles = []

        logger.info(f"Fetched {len(hajgov_articles)} haj.gov.sa, {len(cnn_articles)} CNN Arabic")
        
        await message.edit_text(
            "📝 *الخطوة 2/4:* تصفية المقالات...\n🔍 تصفية أخبار السياحة...",
            parse_mode='Markdown'
        )
        
        # No filtering needed - sources are already Tourism-specific

        recent_hajgov = filter_recent_articles(hajgov_articles, days=7) or []
        recent_cnn = filter_recent_articles(cnn_articles, days=7) or []

        all_articles = recent_hajgov + recent_cnn
        logger.info(f"Total relevant articles: {len(all_articles)}")
        
        if not all_articles:
            await message.edit_text(
                "❌ لم يتم العثور على أخبار سياحية كافية. يرجى المحاولة لاحقًا.",
                parse_mode='Markdown'
            )
            return
        
        await message.edit_text(
            f"📝 *الخطوة 3/4:* استخراج المحتوى الكامل...\n📖 جاري معالجة {min(len(all_articles), 50)} مقالات تقريبًا\n⏱️ قد يستغرق هذا من 2–3 دقائق...",
            parse_mode='Markdown'
        )
        
        enhanced_articles = enhance_articles_with_content(all_articles, max_articles=50, weekly_mode=True) or []
        enhanced_count = len([a for a in enhanced_articles if a.get('full_content')])
        logger.info(f"Enhanced articles: {enhanced_count}/{len(enhanced_articles)}")
        
        await message.edit_text(
            "📝 *الخطوة 4/6:* توليد تقرير أسبوعي باستخدام الذكاء الاصطناعي...\n✍️ يتم الآن إنشاء تحليل أسبوعي شامل...",
            parse_mode='Markdown'
        )
        
        user_keywords = get_user_keywords(context)
        
        logger.info(f"Total blog articles for combined report: {len(enhanced_articles)}")
        
        # Generate Combined Blog
        combined_blog = None
        if enhanced_articles:
            combined_blog = generate_tourism_blog_with_ai(
                enhanced_articles, "combined", "weekly", keywords=user_keywords
            )
        
        # Step 5: Create PDFs
        await message.edit_text(
            "📝 *الخطوة 5/6:* إنشاء ملفات PDF احترافية...\n📄 يتم الآن تنسيق التقرير...",
            parse_mode='Markdown'
        )
        
        combined_filename = None
        
        if combined_blog:
            combined_filename = create_tourism_blog_pdf(
                combined_blog,
                "التقرير الأسبوعي الشامل للسياحة",
                is_temp_file=True
            )
        
        # Step 6: Send the blog PDFs
        await message.edit_text(
            "📝 *الخطوة 6/6:* إرسال ملفات PDF...\n📤 يتم الآن إرسال الرؤى والتحليلات الأسبوعية للسياحة...",
            parse_mode='Markdown'
        )
        
        if combined_filename:
            try:
                with open(combined_filename, 'rb') as pdf_file:
                    await message.reply_document(
                        document=pdf_file,
                        filename=f"Tourism_Weekly_Report_{datetime.now().strftime('%Y%m%d')}.pdf",
                        caption="📝 **التقرير الأسبوعي الشامل للسياحة**\n💼 تحليل شامل لكافة التطورات والأخبار في قطاع السياحة",
                        parse_mode='Markdown'
                    )
                os.unlink(combined_filename)
            except Exception as e:
                logger.error(f"Error sending combined PDF: {e}")
        
        # Success message with statistics
        combined_status = "Generated" if combined_blog else "Skipped (insufficient data)"
        
        success_message = f"""
 ✅ **تم الانتهاء من توليد التقرير الأسبوعي الشامل للسياحة بنجاح!**

 📊 **إحصائيات المعالجة:**
 • إجمالي المقالات التي تم تحليلها: {len(enhanced_articles)}
 • نجاح استخراج المحتوى الكامل: {enhanced_count}/{len(enhanced_articles)} ({(enhanced_count/len(enhanced_articles)*100) if enhanced_articles else 0:.1f}%)
 • نطاق التغطية الأسبوعية: {(datetime.now() - timedelta(days=7)).strftime('%B %d')} - {datetime.now().strftime('%B %d, %Y')}

 📝 **التقارير التي تم توليدها:**
 • التقرير الأسبوعي الشامل للسياحة - {combined_status}

 التقرير يحتوي على أقسام منظمة وتحليل متعمق وتنسيق احترافي!
        """
        
        keyboard = [
            [InlineKeyboardButton("🔄 توليد تقارير أسبوعية جديدة", callback_data='generate_weekly')],
            [InlineKeyboardButton("📰 الأخبار اليومية", callback_data='get_news')],
            [InlineKeyboardButton("🏠 القائمة الرئيسية", callback_data='main_menu')]
        ]
        reply_markup = InlineKeyboardMarkup(keyboard)
        
        await message.edit_text(
            success_message,
            parse_mode='Markdown',
            reply_markup=reply_markup
        )
        
    except Exception as e:
        error_message = f"❌ حدث خطأ أثناء توليد المدونات الأسبوعية: {str(e)}"
        logger.error(f"Weekly blog generation error: {str(e)}")
        await message.edit_text(error_message)

async def weekly_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle /weekly command directly."""
    await generate_weekly_blogs(update, context)

async def generate_monthly_blogs(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Generate comprehensive monthly Tourism blog posts."""
    user_id = get_user_id(update)
    
    # Check usage limit
    has_limit, current_usage = check_usage_limit(user_id, 'monthly')
    if not has_limit:
        limit_message = (
            f"❌ *تم الوصول إلى الحد الأقصى*\n\n"
            f"لقد استخدمت جميع المحاولات المتاحة للتقارير الشهرية ({USAGE_LIMITS['monthly']}/{USAGE_LIMITS['monthly']}).\n\n"
        )
        if update.callback_query:
            await update.callback_query.answer("تم الوصول إلى الحد الأقصى", show_alert=True)
            await update.callback_query.message.reply_text(limit_message, parse_mode='Markdown')
        else:
            await update.message.reply_text(limit_message, parse_mode='Markdown')
        return
    
    # Increment usage
    increment_usage(user_id, 'monthly')
    
    if update.callback_query:
        await update.callback_query.answer()
        message = await update.callback_query.message.reply_text(
            "📝 *مولّد المدونات الشهرية للسياحة*\n\n⏳ جارٍ إعداد تحليل شهري شامل...\n📊 سيتم تحليل أخبار السياحة لآخر 30 يومًا\n⏰ الزمن المتوقع: 5–10 دقائق\n\nيرجى الانتظار...",
            parse_mode='Markdown'
        )
    else:
        message = await update.message.reply_text(
            "📝 *مولّد المدونات الشهرية للسياحة*\n\n⏳ جارٍ إعداد تحليل شهري شامل...\n📊 سيتم تحليل أخبار السياحة لآخر سنة\n⏰ الزمن المتوقع: 5–10 دقائق\n\nيرجى الانتظار...",
            parse_mode='Markdown'
        )
    
    try:
        await message.edit_text(
            "📝 *الخطوة 1/4:* جلب أخبار السياحة الشهرية...\n📡 يتم الآن جمع المقالات من آخر سنة...",
            parse_mode='Markdown'
        )
        
        hajgov_articles = fetch_tourism_news() or []
        cnn_articles = []

        logger.info(f"Fetched {len(hajgov_articles)} haj.gov.sa, {len(cnn_articles)} CNN Arabic")
        
        await message.edit_text(
            "📝 *الخطوة 2/4:* تصفية المقالات...\n🔍 تصفية أخبار السياحة...",
            parse_mode='Markdown'
        )
        
        # No filtering needed - sources are already Tourism-specific

        recent_hajgov = filter_recent_articles(hajgov_articles, days=365) or []
        recent_cnn = filter_recent_articles(cnn_articles, days=365) or []

        all_articles = recent_hajgov + recent_cnn
        logger.info(f"Total relevant articles: {len(all_articles)}")
        
        if not all_articles:
            await message.edit_text(
                "❌ لم يتم العثور على أخبار سياحية كافية. يرجى المحاولة لاحقًا.",
                parse_mode='Markdown'
            )
            return
        
        await message.edit_text(
            f"📝 *الخطوة 3/4:* استخراج المحتوى الكامل...\n📖 جاري معالجة {min(len(all_articles), 100)} مقالات تقريبًا\n⏱️ قد يستغرق هذا من 5–8 دقائق...",
            parse_mode='Markdown'
        )
        
        enhanced_articles = enhance_articles_with_content(all_articles, max_articles=100, monthly_mode=True) or []
        enhanced_count = len([a for a in enhanced_articles if a.get('full_content')])
        logger.info(f"Enhanced articles: {enhanced_count}/{len(enhanced_articles)}")
        
        await message.edit_text(
            "📝 *الخطوة 4/6:* توليد تدوينات شهرية باستخدام الذكاء الاصطناعي...\\n✍️ يتم الآن إنشاء تحليلات شهرية شاملة...",
            parse_mode='Markdown'
        )
        
        user_keywords = get_user_keywords(context)
        categorized = categorize_articles_for_blogs(enhanced_articles)
        management_articles = categorized.get('management', []) or []
        improvement_articles = categorized.get('improvement', []) or []
        
        logger.info(f"Management blog articles: {len(management_articles)}, Improvement blog articles: {len(improvement_articles)}")
        
        # Generate Management Blog
        management_blog = None
        if management_articles:
            management_blog = generate_tourism_blog_with_ai(
                management_articles, "management", "monthly", keywords=user_keywords
            )
        
        # Generate Improvement Blog
        improvement_blog = None
        if improvement_articles:
            improvement_blog = generate_tourism_blog_with_ai(
                improvement_articles, "improvement", "monthly", keywords=user_keywords
            )
        
        # Step 5: Create PDFs
        await message.edit_text(
            "📝 *الخطوة 5/6:* إنشاء ملفات PDF احترافية...\\n📄 يتم الآن تنسيق التدوينات...",
            parse_mode='Markdown'
        )
        
        management_filename = None
        improvement_filename = None
        
        if management_blog:
            management_filename = create_tourism_blog_pdf(
                management_blog,
                "التقرير الشهري للسياحة",
                is_temp_file=True
            )
        
        if improvement_blog:
            improvement_filename = create_tourism_blog_pdf(
                improvement_blog,
                "التقرير الشهري للتقنية والصحة والابتكار في السياحة",
                is_temp_file=True
            )
        
        #  Step 6: Send the blog PDFs
        await message.edit_text(
            "📝 *الخطوة 6/6:* إرسال ملفات PDF...\\n📤 يتم الآن إرسال الرؤى والتحليلات الشهرية للسياحة...",
            parse_mode='Markdown'
        )
        
        if management_filename:
            try:
                with open(management_filename, 'rb') as pdf_file:
                    await message.reply_document(
                        document=pdf_file,
                        filename=f"Tourism_Monthly_Report_{datetime.now().strftime('%Y%m%d')}.pdf",
                        caption="📝 **التقرير الشهري للسياحة**\\n💼 تحليل شهري شامل لسياسات السياحة وتطورات الطيران والسفر",
                        parse_mode='Markdown'
                    )
                os.unlink(management_filename)
            except Exception as e:
                logger.error(f"Error sending management PDF: {e}")
        
        if improvement_filename:
            try:
                with open(improvement_filename, 'rb') as pdf_file:
                    await message.reply_document(
                        document=pdf_file,
                        filename=f"Tourism_Tech_Monthly_{datetime.now().strftime('%Y%m%d')}.pdf",
                        caption="📝 **التقرير الشهري للصحة والرفاهية**\\n⭐ تحليل شهري شامل لتطورات الفنادق والضيافة وجودة الحياة",
                        parse_mode='Markdown'
                    )
                os.unlink(improvement_filename)
            except Exception as e:
                logger.error(f"Error sending improvement PDF: {e}")
        
        # Success message with statistics
        management_status = "Generated" if management_blog else "Skipped (insufficient data)"
        improvement_status = "Generated" if improvement_blog else "Skipped (insufficient data)"
        
        success_message = f"""
 ✅ **تم الانتهاء من توليد المدونات الشهرية للسياحة بنجاح!**

 📊 **إحصائيات المعالجة:**
 • إجمالي المقالات التي تم تحليلها: {len(enhanced_articles)}
 • نجاح استخراج المحتوى الكامل: {enhanced_count}/{len(enhanced_articles)} ({(enhanced_count/len(enhanced_articles)*100) if enhanced_articles else 0:.1f}%)
 • عدد المقالات في مدونة سياسات السياحة: {len(management_articles)}
 • عدد المقالات في مدونة التحسين والتميز: {len(improvement_articles)}
 • نطاق التغطية الشهرية: {(datetime.now() - timedelta(days=30)).strftime('%B %d')} - {datetime.now().strftime('%B %d, %Y')}

 📝 **التقارير التي تم توليدها:**
 • التقرير الشهري للسياحة - {management_status}
 • التقرير الشهري للتقنية والصحة والابتكار في السياحة - {improvement_status}

 كلا التقريرين يحتويان على أقسام منظمة وتحليل متعمق وتنسيق احترافي!
        """
        
        keyboard = [
            [InlineKeyboardButton("🔄 توليد تقارير شهرية جديدة", callback_data='generate_monthly')],
            [InlineKeyboardButton("📰 الأخبار اليومية", callback_data='get_news')],
            [InlineKeyboardButton("🏠 القائمة الرئيسية", callback_data='main_menu')]
        ]
        reply_markup = InlineKeyboardMarkup(keyboard)
        
        await message.edit_text(
            success_message,
            parse_mode='Markdown',
            reply_markup=reply_markup
        )
        
    except Exception as e:
        error_message = f"❌ حدث خطأ أثناء توليد المدونات الشهرية: {str(e)}"
        logger.error(f"Monthly blog generation error: {str(e)}")
        await message.edit_text(error_message)

async def monthly_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle /monthly command directly."""
    await generate_monthly_blogs(update, context)

# ============================================================================
# AI MAGAZINE FEATURE
# ============================================================================

def fetch_images_for_articles(articles, max_articles: int = 20, timeout: int = 4):
    """Return a list of source images for the first ``max_articles`` articles.

    Uses each article's own image field when present, else scrapes its og:image.
    Consumed by the quality_platform magazine endpoint, which assigns the returned
    URLs round-robin to magazine articles. Skips X/Twitter URLs (no useful og:image).
    """
    images = []
    for article in (articles or [])[:max_articles]:
        if not article:
            continue
        img = (article.get('urlToImage') or article.get('image_url')
               or article.get('image') or '')
        if not img:
            url = article.get('url', '') or ''
            if url and 'x.com' not in url and 'twitter.com' not in url:
                try:
                    img = scrape_og_image(url, timeout_s=timeout)
                except Exception:
                    img = ''
        if img:
            images.append(img)
    logger.info(f"fetch_images_for_articles: {len(images)} images for {min(len(articles or []), max_articles)} articles")
    return images


def scrape_og_image(article_url: str, timeout_s: int = 10) -> str:
    """
    Extract the og:image / twitter:image from an article page.
    Returns an absolute image URL or '' on failure.
    Used to get article-specific images from their source URLs before falling back to generics.
    """
    if not article_url or not isinstance(article_url, str):
        return ""
    url = article_url.strip()
    if not (url.startswith("http://") or url.startswith("https://")):
        return ""
    # Skip Twitter/X.com URLs - they don't return useful OG images to bots
    if "x.com" in url or "twitter.com" in url:
        return ""
    try:
        resp = requests.get(
            url,
            timeout=timeout_s,
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "ar,en-US;q=0.9,en;q=0.8",
            },
        )
        if resp.status_code != 200 or not resp.text:
            return ""
        soup = BeautifulSoup(resp.text, "html.parser")
        candidates = []
        for key in ("og:image", "twitter:image", "twitter:image:src"):
            tag = soup.find("meta", attrs={"property": key}) or soup.find("meta", attrs={"name": key})
            if tag and tag.get("content"):
                candidates.append(tag["content"].strip())
        link = soup.find("link", attrs={"rel": "image_src"})
        if link and link.get("href"):
            candidates.append(link["href"].strip())
        for img in candidates:
            if not img:
                continue
            if img.startswith("//"):
                return "https:" + img
            if img.startswith("http://") or img.startswith("https://"):
                return img
    except Exception:
        pass
    return ""


def generate_magazine_content_with_ai(articles):
    """
    Generate structured JSON content for the monthly Tourism report using Claude.
    Returns (magazine_data, article_map) where article_map maps 1-based index -> article metadata.
    """
    if not articles:
        return None, {}

    # Prepare article context with image URLs - store mapping for later matching
    articles_context = ""
    article_map = {}  # Map article index to image URL and source for direct lookup
    for i, article in enumerate(articles[:40]):  # Limit to 40 articles for context
        title = article.get('title', 'No title')
        content = article.get('full_content', '')[:1000]  # Truncate for token limits
        # Get image URL from various possible fields
        image_url = (
            article.get('urlToImage') or
            article.get('image_url') or
            article.get('image') or
            ''
        )
        source = article.get('source', {}).get('name', '') if isinstance(article.get('source'), dict) else str(article.get('source', ''))
        articles_context += f"Article {i+1}: {title}\nSource: {source}\nImage: {image_url}\nContent: {content}\n\n"
        # Store for direct lookup by article_index
        article_map[i + 1] = {
            'image_url': image_url,
            'source': source,
            'title': title,
            'url': article.get('url', ''),
            'raw_article': article,
        }

    system_message = (
        "You are the Editor-in-Chief of a professional monthly Tourism report. "
        "Your goal is to maintain a professional, insightful, and visionary tone. "
        "Critical page layout rule: Each article (including the first one) must fit exactly on one A4 page. "
        "NO EXCEPTIONS - All 8 articles must be between 300-350 words TOTAL (Lead + Main Content). "
        "Strict Enforcement: Count words for each article. If any article exceeds 350 words, it will overflow the page. "
        "If any article is under 270 words, it will have excessive whitespace. "
        "Target 310-330 words per article for optimal page fill without overflow. "
        "The first article is NOT special - it must follow the same word count rules as all other articles. "
        "Balance depth with brevity - provide comprehensive coverage but adhere to the strict 300-350 word limit. "
        "Output ONLY valid JSON matching the specified structure. "
        "CRITICAL: ALL text content (titles, subtitles, leads, articles, editors_note, highlights, locations) MUST be written in MODERN STANDARD ARABIC (العربية الفصحى). "
        "You may read English source articles but ALL output MUST be in Arabic. "
        + SCOPE_RULE
    )

    user_prompt = f"""
    أنشئ محتوى مجلة السياحة الشهرية بناءً على هذه المقالات:
    {articles_context}

    أعد كائن JSON بهذه البنية بالضبط (بدون markdown، فقط JSON):
    {{
        "title": "تقرير السياحة: [عنوان جذاب بالعربية]",
        "subtitle": "[عنوان فرعي جذاب بالعربية]",
        "date": "[الشهر والسنة الحاليين بالعربية]",
        "highlights": [
            {{"title": "[عنوان 1 بالعربية]", "description": "[وصف قصير بالعربية]"}},
            {{"title": "[عنوان 2 بالعربية]", "description": "[وصف قصير بالعربية]"}},
            {{"title": "[عنوان 3 بالعربية]", "description": "[وصف قصير بالعربية]"}}
        ],
        "editors_note": "[حد أقصى 150 كلمة بالعربية. تعليق تحريري مهني وبصيرة حول أخبار السياحة.]",
        "articles": [
            {{
                "category": "[واحدة من: الوجهات والمعالم, الفنادق والضيافة, الطيران والسفر, سياسات وتنمية السياحة]",
                "title": "[عنوان مجلة جذاب بالعربية]",
                "location": "[الموقع/المنطقة بالعربية، مثال: السعودية / السعودية]",
                "lead": "[فقرة افتتاحية جذابة بالعربية، 2-3 جمل (حوالي 40-50 كلمة). عدد الكلمات هذا مشمول في إجمالي 300-350.]",
                "content": "[المحتوى الرئيسي بتنسيق HTML بالعربية مع عناوين فرعية <h3> وفقرات <p>. عدد الكلمات الإجمالي (الافتتاحية + المحتوى) يجب أن يكون 300-350 كلمة بالضبط. المحتوى الرئيسي 250-300 كلمة. أنشئ 3-4 فقرات (حوالي 80 كلمة لكل منها) مع عنوانين فرعيين.]",
                "article_index": "[رقم المقال الأصلي من القائمة أعلاه، مثلاً 3 أو 7]",
                "source": "[اسم المصدر الأصلي]",
                "score": "[درجة الأهمية 1-10]"
            }},
            ... (أنشئ بالضبط 8 مقالات مميزة. لا تتجاوز 8.)
        ]
    }}

    مهم جداً:
    1. تأكد من أن جميع علامات الاقتباس المزدوجة داخل قيم النصوص مهرّبة بشكل صحيح بعلامة backslash (\\").
    2. لا تستخدم فواصل أسطر markdown أو فواصل زائدة تجعل JSON غير صالح.
    3. يجب أن يكون الإخراج سلسلة JSON واحدة صالحة.
    4. حقل article_index إلزامي لكل مقال - يجب أن يطابق رقم المقال في القائمة أعلاه (1-40). هذا يُستخدم لربط الصورة الصحيحة بشكل مباشر.
    5. تطبيق صارم لعدد الكلمات لجميع المقالات (بدون استثناءات):
       - إجمالي عدد الكلمات لكل مقالة (الافتتاحية + المحتوى) يجب أن يكون بين 300-350 كلمة.
       - الحد الأدنى: 300 كلمة.
       - الحد الأقصى: 350 كلمة.
       - النطاق المثالي: 310-330 كلمة لكل مقالة.
    6. جميع النصوص يجب أن تكون باللغة العربية الفصحى.
    """

    logger.info("Calling AWS Bedrock Claude API for magazine content generation...")
    content_text, error = call_claude_api(
        system_message=system_message, 
        user_message=user_prompt, 
        max_tokens=50000,
        temperature=0.7,
        use_long_timeout=True  # Use 600 second timeout for magazine generation
    )

    if error:
        logger.error(f"Magazine generation error (AWS Bedrock): {error}")
        logger.error(f"Error type: {type(error)}")
        return None, {}

    if not content_text:
        logger.error("Magazine generation returned empty content")
        return None, {}

    try:
        # Clean potential markdown fences
        json_str = content_text.strip()
        if json_str.startswith("```json"):
            json_str = json_str[7:]
        if json_str.startswith("```"):
            json_str = json_str[3:]
        if json_str.endswith("```"):
            json_str = json_str[:-3]
        json_str = json_str.strip()
        
        # Log the length of the response for debugging
        logger.info(f"Magazine JSON response length: {len(json_str)} characters")
        
        # Check if the JSON appears to be truncated (unterminated string or brace)
        if not json_str.endswith('}'):
            logger.warning("JSON response appears to be truncated (doesn't end with })")
            logger.error(f"JSON string ending: ...{json_str[-200:]}")
            return None, {}
        
        magazine_data = json.loads(json_str)
        return magazine_data, article_map
    except json.JSONDecodeError as e:
        logger.error(f"Failed to decode magazine JSON: {e}")
        logger.error(f"JSON decode error at line {e.lineno}, column {e.colno}")
        logger.error(f"JSON string preview (first 500 chars):\n{json_str[:500]}")
        logger.error(f"JSON string ending (last 500 chars):\n...{json_str[-500:]}")
        logger.error(f"Full JSON length: {len(json_str)} characters")
        
        # Try to identify if this is a truncation issue
        if "Unterminated string" in str(e) or "Expecting" in str(e):
            logger.error("⚠️ This appears to be a truncated response. The model may have hit the max_tokens limit.")
            logger.error("   Possible solutions:")
            logger.error("   1. Reduce the number of articles in the magazine (currently 8)")
            logger.error("   2. Simplify the article content requirements")
            logger.error("   3. Split magazine generation into multiple API calls")
        
        return None, {}

def render_newspaper_pdf(content_data, output_filename="newspaper.pdf"):
    """
    Render newspaper-style PDF using Jinja2 and WeasyPrint.
    """
    if not WEASYPRINT_AVAILABLE:
        logger.error("WeasyPrint not available (missing GTK or module). Cannot generate PDF.")
        return None

    try:
        # Setup Jinja2
        template_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'templates')
        env = Environment(loader=FileSystemLoader(template_dir))
        template = env.get_template('newspaper.html')
        
        # Inject default images if available
        import glob
        import random
        import pathlib
        
        images_dir = os.path.join(template_dir, 'images')
        available_images = []
        if os.path.exists(images_dir):
            all_images = (
                glob.glob(os.path.join(images_dir, '*.jpg')) +
                glob.glob(os.path.join(images_dir, '*.png')) +
                glob.glob(os.path.join(images_dir, '*.jpeg')) +
                glob.glob(os.path.join(images_dir, '*.webp'))
            )
            # Filter out cover images
            exclude_files = ['Cover.png', 'cover.png', 'cover_generated.png', 'back_cover_generated.png', 'Back Cover.png', 'Back Cover.jpg', 'back cover.png', '1767655448098.jpg','Logo.jpg', 'logo.png', 'taawuniya-logo.png', 'taawuniya-logo-white.png', 'mawadda-logo.png']
            available_images = [
                img for img in all_images 
                if os.path.basename(img) not in exclude_files
            ]
        
        # Assign images to articles (round-robin or random)
        articles = content_data.get('articles', [])
        for article in articles:
            if available_images and not article.get('local_image_path') and not article.get('image_url'):
                # Convert to file URI safely handling spaces/OS specifics
                img_path = random.choice(available_images)
                article['local_image_path'] = pathlib.Path(img_path).as_uri()
        
        # Batch articles into pages (2 articles per page)
        pages = []
        page_num = 1
        for i in range(0, len(articles), 2):
            page_articles = articles[i:i+2]
            pages.append({
                'page_num': page_num,
                'articles': page_articles
            })
            page_num += 1
        
        # Prepare template data
        template_data = {
            'title': content_data.get('title', 'التعاونية'),
            'publication_name': content_data.get('publication_name', 'التعاونية'),
            'tagline': content_data.get('tagline', 'مجلة إلكترونية وتعنى بكل ما هو في عالم السياحة'),
            'issue_number': content_data.get('issue_number', '190'),
            'pages': pages,
            'footer_text': content_data.get('footer_text', 'taawuniyanews'),
            'contact_phone': content_data.get('contact_phone', '00973 3701 4477'),
            'editors_note': content_data.get('editors_note', ''),
            'cover_image_path': content_data.get('cover_image_path')
        }

        # Optional cover image (look in templates/images)
        # Try Cover.png first, then fallback to other cover images
        cover_path = os.path.join(template_dir, 'images', 'Cover.png')
        if not os.path.exists(cover_path):
            cover_path = os.path.join(template_dir, 'images', '1767655448098.jpg')
        if not os.path.exists(cover_path):
            cover_path = os.path.join(template_dir, 'images', 'cover.png')
        
        if os.path.exists(cover_path):
            template_data['cover_image_path'] = pathlib.Path(cover_path).as_uri()
            logger.info(f"Using cover image: {cover_path}")
        elif content_data.get('cover_image_path'):
            template_data['cover_image_path'] = content_data.get('cover_image_path')
            logger.info(f"Using cover image from content_data")
        else:
            logger.warning("No cover image found")
        
        # Optional back cover image
        back_cover_path = os.path.join(template_dir, 'images', 'Back Cover.png')
        if not os.path.exists(back_cover_path):
            back_cover_path = os.path.join(template_dir, 'images', 'back_cover_generated.png')
        if not os.path.exists(back_cover_path):
            back_cover_path = os.path.join(template_dir, 'images', 'Back Cover.jpg')
        
        if os.path.exists(back_cover_path):
            template_data['back_cover_image_path'] = pathlib.Path(back_cover_path).as_uri()
            logger.info(f"Using back cover image: {back_cover_path}")
        elif content_data.get('back_cover_path'):
            template_data['back_cover_image_path'] = content_data.get('back_cover_path')
            logger.info(f"Using back cover image from content_data")
        
        # Render HTML
        html_out = template.render(**template_data)
        
        # Convert to PDF
        css_path = os.path.join(template_dir, 'newspaper.css')
        HTML(string=html_out, base_url=template_dir).write_pdf(
            output_filename, 
            stylesheets=[CSS(css_path)]
        )
        return output_filename
    except Exception as e:
        logger.error(f"Newspaper PDF rendering error: {e}")
        import traceback
        logger.error(traceback.format_exc())
        return None

def render_magazine_pdf(content_data, output_filename="magazine.pdf"):
    """
    Render PDF using Jinja2 and WeasyPrint.
    """
    if not WEASYPRINT_AVAILABLE:
        logger.error("WeasyPrint not available (missing GTK or module). Cannot generate PDF.")
        return None

    try:
        # Setup Jinja2
        template_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'templates')
        env = Environment(loader=FileSystemLoader(template_dir))
        template = env.get_template('magazine.html')
        
        # Inject default images if available
        import glob
        import random
        import pathlib
        
        images_dir = os.path.join(template_dir, 'images')
        available_images = []
        if os.path.exists(images_dir):
            all_images = (
                glob.glob(os.path.join(images_dir, '*.jpg')) +
                glob.glob(os.path.join(images_dir, '*.png')) +
                glob.glob(os.path.join(images_dir, '*.jpeg')) +
                glob.glob(os.path.join(images_dir, '*.webp'))
            )
            # Filter out cover images and logo
            exclude_files = ['Cover.png', 'cover.png', 'cover_generated.png', 'back_cover_generated.png', 'Back Cover.png', 'Back Cover.jpg', 'back cover.png', '1767655448098.jpg', 'TransformiX logo .png', 'Logo.jpg', 'logo.png', 'taawuniya-logo.png', 'taawuniya-logo-white.png', 'mawadda-logo.png']
            available_images = [
                img for img in all_images 
                if os.path.basename(img) not in exclude_files
            ]
        
        # Assign fallback local images to articles that have no real image_url
        if 'articles' in content_data:
            for article in content_data['articles']:
                if available_images and not article.get('image_url') and not article.get('local_image_path'):
                    # Only use a local fallback when no real article image is available
                    img_path = random.choice(available_images)
                    article['local_image_path'] = pathlib.Path(img_path).as_uri()
        
        # Inject Cover Image and Logo
        # Priority: cover.png (User requested)
        cover_path = os.path.join(images_dir, 'cover.png')
        if not os.path.exists(cover_path):
             cover_path = os.path.join(images_dir, 'Cover.png')
        if not os.path.exists(cover_path):
             cover_path = os.path.join(images_dir, 'cover_generated.png')
            
        if os.path.exists(cover_path):
            content_data['cover_image_path'] = pathlib.Path(cover_path).as_uri()
            
        # Two logo variants: the full-colour mark for light pages, and a white
        # knockout for the dark cover/back-cover. Passing only one makes it
        # invisible on half the pages.
        logo_path = os.path.join(images_dir, 'taawuniya-logo.png')
        if os.path.exists(logo_path):
            content_data['logo_path'] = pathlib.Path(logo_path).as_uri()
        logo_white_path = os.path.join(images_dir, 'taawuniya-logo-white.png')
        if os.path.exists(logo_white_path):
            content_data['logo_white_path'] = pathlib.Path(logo_white_path).as_uri()

        # Inject Back Cover Image
        # Priority: Back Cover.png (User requested)
        back_cover_path = os.path.join(images_dir, 'Back Cover.png')
        if not os.path.exists(back_cover_path):
             back_cover_path = os.path.join(images_dir, 'back_cover_generated.png')
             
        if os.path.exists(back_cover_path):
            content_data['back_cover_path'] = pathlib.Path(back_cover_path).as_uri()

        # Render HTML
        html_out = template.render(**content_data)
        
        # Convert to PDF
        css_path = os.path.join(template_dir, 'magazine.css')
        HTML(string=html_out, base_url=template_dir).write_pdf(
            output_filename, 
            stylesheets=[CSS(css_path)]
        )
        return output_filename
    except Exception as e:
        logger.error(f"PDF rendering error: {e}")
        return None

def clean_deduplicate_articles(articles):
     # Simple helper if not already present
     seen = set()
     clean = []
     for a in articles:
         t = a.get('title')
         if t and t not in seen:
             seen.add(t)
             clean.append(a)
     return clean

async def generate_magazine(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle /magazine command."""
    user_id = get_user_id(update)
    
    # Check usage limit
    has_limit, current_usage = check_usage_limit(user_id, 'magazine')
    if not has_limit:
        limit_message = (
            f"❌ *تم الوصول إلى الحد الأقصى*\n\n"
            f"لقد استخدمت جميع المحاولات المتاحة للمجلة ({USAGE_LIMITS['magazine']}/{USAGE_LIMITS['magazine']}).\n\n"
        )
        if update.callback_query:
            await update.callback_query.answer("تم الوصول إلى الحد الأقصى", show_alert=True)
            await update.callback_query.message.reply_text(limit_message, parse_mode='Markdown')
        else:
            await update.message.reply_text(limit_message, parse_mode='Markdown')
        return
    
    # Increment usage
    increment_usage(user_id, 'magazine')
    
    # Send initial status
    if update.callback_query:
        await update.callback_query.answer()
        message = await update.callback_query.message.reply_text(
            "🎨 *مولد مجلة السياحة*\n\n⏳ جارٍ إعداد الإصدار الموسمي...\n🔍 تحليل أخبار السياحة للسنة الماضية...",
            parse_mode='Markdown'
        )
    else:
        message = await update.message.reply_text(
            "🎨 *مولد مجلة السياحة*\n\n⏳ جارٍ إعداد الإصدار الموسمي...\n🔍 تحليل أخبار السياحة للسنة الماضية...",
            parse_mode='Markdown'
        )

    try:
        # 1. Fetch Monthly News
        await message.edit_text("🎨 *المرحلة 1/3:* جمع المعلومات...", parse_mode='Markdown')
        
        hajgov_articles = fetch_tourism_news() or []
        cnn_articles = []

        all_articles = clean_deduplicate_articles(hajgov_articles + cnn_articles)
        
        if not all_articles:
             await message.edit_text("❌ لم يتم العثور على بيانات كافية للمجلة.")
             return

        # Enhance top articles
        await message.edit_text("🎨 *المرحلة 2/3:* تنقية وتحسين المحتوى...", parse_mode='Markdown')
        enhanced_articles = enhance_articles_with_content(all_articles, max_articles=30, monthly_mode=True)

        # 2. Generate Content with AI - also returns article_map for direct image lookup
        await message.edit_text("🎨 *المرحلة 3/3:* تصميم التخطيط وإنشاء PDF...", parse_mode='Markdown')
        magazine_data, article_map = generate_magazine_content_with_ai(enhanced_articles)
        
        if not magazine_data:
             await message.edit_text("❌ فشل في توليد محتوى المجلة عبر الذكاء الاصطناعي.")
             return

        # --- Direct image/source back-fill using article_index from AI ---
        mag_articles = magazine_data.get('articles', [])
        for mag_article in mag_articles:
            # Use article_index for direct lookup (most reliable)
            idx_raw = mag_article.get('article_index')
            try:
                idx = int(idx_raw)
            except (TypeError, ValueError):
                idx = None

            orig = article_map.get(idx) if idx else None

            # Back-fill image_url from direct index lookup
            if orig and not mag_article.get('image_url'):
                img = orig.get('image_url', '')
                if img:
                    mag_article['image_url'] = img
                    logger.info(f"Direct image match for '{mag_article.get('title','')[:50]}' via article_index={idx}")
                else:
                    # No image in fields — try to scrape og:image from the article URL
                    article_url = orig.get('url', '')
                    if article_url:
                        og_img = scrape_og_image(article_url)
                        if og_img:
                            mag_article['image_url'] = og_img
                            logger.info(f"OG image scraped for '{mag_article.get('title','')[:50]}': {og_img[:60]}")
                        else:
                            logger.debug(f"No OG image found for '{mag_article.get('title','')[:50]}' - will use render fallback")

        # Add magazine metadata
        current_date = datetime.now()
        magazine_data['date'] = current_date.strftime("%B %Y")
        
        # Ensure all articles have location field (default if missing)
        for article in mag_articles:
            if 'location' not in article or not article['location']:
                article['location'] = 'السعودية'

        # 3. Render PDF using NEW MAGAZINE template
        filename = f"Tourism_{datetime.now().strftime('%B_%Y')}.pdf"
        # SWITCHED from render_newspaper_pdf to render_magazine_pdf
        pdf_path = render_magazine_pdf(magazine_data, filename)
        
        if pdf_path and os.path.exists(pdf_path):
             await message.reply_document(
                document=open(pdf_path, 'rb'),
                filename=filename,
                caption=f"🎨 **مجلة السياحة - {datetime.now().strftime('%B %Y')}**\n\nاستمتع بتقريرك الموسمي!",
                parse_mode='Markdown'
            )
             # Optional: os.unlink(pdf_path) if running long term
        else:
             await message.edit_text("❌ فشل في إنشاء ملف PDF.")

    except Exception as e:
        logger.error(f"Magazine error: {e}")
        await message.edit_text(f"❌ خطأ: {str(e)}")

async def reset_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Reset usage limits for users (admin only)."""
    user_id = get_user_id(update)
    
    # Check if user is admin
    if ADMIN_USER_IDS and user_id not in ADMIN_USER_IDS:
        await update.message.reply_text(
            "❌ *غير مصرح*\n\nهذا الأمر متاح للمسؤولين فقط.",
            parse_mode='Markdown'
        )
        return
    
    # Check if specific user ID provided
    if context.args and len(context.args) > 0:
        try:
            target_user_id = int(context.args[0])
            if reset_user_usage(target_user_id):
                await update.message.reply_text(
                    f"✅ تم إعادة تعيين المحاولات للمستخدم: {target_user_id}",
                    parse_mode='Markdown'
                )
            else:
                await update.message.reply_text(
                    f"❌ لم يتم العثور على المستخدم: {target_user_id}",
                    parse_mode='Markdown'
                )
        except ValueError:
            await update.message.reply_text(
                "❌ معرّف المستخدم غير صحيح. استخدم: `/reset [user_id]` أو `/reset all`",
                parse_mode='Markdown'
            )
    elif context.args and context.args[0].lower() == 'all':
        reset_user_usage()
        await update.message.reply_text(
            "✅ تم إعادة تعيين جميع المحاولات لجميع المستخدمين.",
            parse_mode='Markdown'
        )
    else:
        # Reset current user
        reset_user_usage(user_id)
        await update.message.reply_text(
            "✅ تم إعادة تعيين محاولاتك.",
            parse_mode='Markdown'
        )

async def usage_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Show current usage status."""
    user_id = get_user_id(update)
    status = get_usage_status(user_id)
    
    status_message = (
        "📊 *حالة الاستخدام الحالية*\n\n"
        f"📰 الأخبار اليومية: {status['daily_news']['used']}/{status['daily_news']['limit']}\n"
        f"📝 التقارير الأسبوعية: {status['weekly']['used']}/{status['weekly']['limit']}\n"
        f"📅 التقارير الشهرية: {status['monthly']['used']}/{status['monthly']['limit']}\n"
        f"🎨 المجلة: {status['magazine']['used']}/{status['magazine']['limit']}\n\n"
        f"استخدم `/reset` لإعادة تعيين المحاولات (للمسؤولين فقط)."
    )
    
    await update.message.reply_text(status_message, parse_mode='Markdown')

async def help_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Send a message when the command /help is issued."""
    help_text = """
⭐ *مساعدة بوت أخبار السياحة المحسّنة*

*🆕 المزايا المحسّنة:*
• 📖 **استخراج كامل للمقالات** – قراءة النص الكامل للمقالات وليس الوصف فقط  
• 🧠 **ملخصات أذكى** – تحليل يعتمد على المحتوى الكامل  
• 📝 **توليد مدونات أسبوعية وشهرية** – تقارير معمّقة عن خدمات السياحة  
• 🎨 **توليد مجلة السياحة الشهرية** – مجلة PDF احترافية بتصميم جميل
• 🔍 **استخراج متعدد الأساليب** – استخدام newspaper3k و BeautifulSoup  
• 📊 **إحصائيات المحتوى** – عرض نسبة نجاح استخراج النصوص  
• 🎯 **فلترة موجهة للسياحة** – استبعاد الأخبار الرياضية والجرائم وغير ذات الصلة

*الأوامر المتاحة:*
• `/start` – رسالة الترحيب والقائمة الرئيسية  
• `/news` – الحصول على أخبار السياحة المحسّنة مع المحتوى الكامل  
• `/categories` – تصفح الأخبار حسب التصنيف  
• `/weekly` – توليد تقارير/مدونات أسبوعية شاملة  
• `/monthly` – توليد تقارير/مدونات شهرية شاملة  
• `/magazine` – توليد مجلة السياحة الشهرية احترافية (PDF)
• `/keywords` – إعداد الكلمات المفتاحية الأساسية والثانوية (بالإنجليزية) لتحسين محركات البحث  
• `/help` – عرض رسالة المساعدة هذه

*كيف يعمل الاستخراج المحسّن للمحتوى:*
1. 📡 جلب الأخبار من المصادر الرسمية والدولية ومنصات X وتغذيات RSS
2. 🔍 استخراج المحتوى الكامل من الروابط
3. 📖 استخدام طريقتَي newspaper3k و BeautifulSoup
4. 🧠 تطبيق فلترة موجهة للسياحة لإزالة الضجيج
5. 📄 إنشاء تقارير تفصيلية وملفات PDF

*التصنيفات المتاحة:*
• 👶 الوجهات والمعالم
• 💚 الفنادق والضيافة
• 🤝 الطيران والسفر
• 📊 سياسات وتنمية السياحة
• 📰 أخبار عامة

*فوائد استخدام المحتوى الكامل:*
• ملخصات أكثر دقة  
• تصنيف أفضل للمقالات  
• رؤى وتحليلات أعمق  
• فهم كامل للسياق  
• تقارير احترافية قابلة للمشاركة  
• دعم توليد مدونات أسبوعية وشهرية

استخدم `/news` للتحديثات اليومية، و`/weekly` للتقارير الأسبوعية، و`/monthly` للتقارير الشهرية، و`/magazine` للمجلة الشهرية الاحترافية.
    """
    
    # Handle both regular commands and callback queries
    if update.callback_query:
        await update.callback_query.message.reply_text(help_text, parse_mode='Markdown')
    else:
        await update.message.reply_text(help_text, parse_mode='Markdown')

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Send a message when the command /start is issued."""
    welcome_message = """
⭐ 👋 مرحباً بك! أنا مساعدك الإخباري الذكي لقطاع السياحة
تم تصميمي خصيصاً لأكون رفيقك اليومي في متابعة كل ما يخص أخبار وخدمات السياحة.
أقوم بجمع أحدث المستجدات، تحليلها، وتلخيصها لك بدقة واحترافية عالية،
لتكون دائماً في قلب الحدث دون إهدار وقتك في البحث بين المصادر المتعددة.

🤖 ملاحظة هامة:
أعتمد على خوارزميات الذكاء الاصطناعي المتقدمة لمعالجة وتلخيص الأخبار.
(هذه الخدمة تهدف لتسهيل المتابعة ولا تعتبر بديلاً عن التصريحات والقرارات الرسمية).

✨ أبرز ما أوفره لك:
📰 ملخصات يومية لأهم وأحدث أخبار القطاع.
📊 تقارير تحليلية شاملة ومفصلة (أسبوعية وشهرية).
📘 إصدارات شهرية متكاملة بصيغة PDF جاهزة للمشاركة.
⏱️ توفير الجهد والوقت لتبقَ مطلعاً على مدار الساعة.

🎯 لماذا تحتاجني؟
• لتكون على دراية تامة بمتغيرات السوق بشكل فوري.
• لتزويد فريق عملك وعملائك بتقارير دورية احترافية وموثوقة.
• لدعم اجتماعاتك الإدارية بملخصات دقيقة جاهزة للاستخدام.

🚀 جاهز للبدء؟
استخدم الخيارات والأزرار بالأسفل لاستكشاف الأخبار والتقارير.
    """

    
    keyboard = [
        [InlineKeyboardButton("📰 الملخص اليومي", callback_data='get_news')],
        [InlineKeyboardButton("📊 الملخص الأسبوعي", callback_data='generate_weekly'),
         InlineKeyboardButton("📅 الملخص الشهري", callback_data='generate_monthly')],
        [InlineKeyboardButton("📰 المجلة", callback_data='generate_magazine')],
    ]
    reply_markup = InlineKeyboardMarkup(keyboard)
    
    # Handle both regular messages and callback queries
    if update.callback_query:
        await update.callback_query.message.reply_text(
            welcome_message,
            parse_mode='Markdown',
            reply_markup=reply_markup
        )
    else:
        await update.message.reply_text(
            welcome_message,
            parse_mode='Markdown',
            reply_markup=reply_markup
        )

def main():
    """Start the Tourism news bot."""
    # Create the Application
    application = Application.builder().token(TELEGRAM_TOKEN).build()
    
    # Add handlers
    application.add_handler(CommandHandler("start", start))
    application.add_handler(CommandHandler("help", help_command))
    application.add_handler(CommandHandler("news", get_news))
    application.add_handler(CommandHandler("categories", show_categories))
    application.add_handler(CommandHandler("weekly", weekly_command))  # Weekly blog command
    application.add_handler(CommandHandler("monthly", monthly_command))  # Monthly blog command
    application.add_handler(CommandHandler("magazine", generate_magazine))  # Magazine command
    application.add_handler(CommandHandler("keywords", keywords_command))
    application.add_handler(CommandHandler("setkeywords", keywords_command))
    application.add_handler(CommandHandler("reset", reset_command))  # Reset usage command
    application.add_handler(CommandHandler("usage", usage_command))  # Show usage status
    application.add_handler(CallbackQueryHandler(button_handler))
    application.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))
    
    # Start the bot
    print("⭐ Starting Enhanced Tourism News Bot...")
    print("📱 Bot is ready! Send /start to begin.")
    print("✨ Enhanced features:")
    print("   • 📖 Full article content extraction")
    print("   • 🧠 Tourism-specific filtering")
    print("   • 📝 Weekly & monthly blog generation")
    print("   • 📄 Enhanced reports with full content")
    print("   • 🔍 Multi-method content extraction")
    print("   • 📊 Content extraction statistics")
    print("   • ⚡ Smart categorization using full text")
    
    application.run_polling(allowed_updates=Update.ALL_TYPES)

if __name__ == '__main__':
    main()

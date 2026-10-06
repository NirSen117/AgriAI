"""Data.gov.in AGMARKNET daily mandi price integration."""

from datetime import date, datetime, timezone
import json
import logging
from threading import Lock
from time import monotonic
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from .schemas import MarketPriceRecord, MarketPricesResponse

logger = logging.getLogger(__name__)
RESOURCE_ID = "9ef84268-d588-465a-a308-a864a43d0070"
API_URL = f"https://api.data.gov.in/resource/{RESOURCE_ID}"
CACHE_TTL_SECONDS = 15 * 60


def _text(record: dict, key: str) -> str:
    value = record.get(key)
    return " ".join(str(value).split()) if value is not None else ""


def _price(record: dict, key: str) -> float | None:
    value = record.get(key)
    if value in (None, "", "NA", "N/A", "-", "--"):
        return None
    try:
        parsed = float(str(value).replace(",", "").strip())
        return parsed if parsed >= 0 else None
    except (TypeError, ValueError):
        return None


def _arrival_date(value: str) -> date | None:
    if not value:
        return None
    for pattern in ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y"):
        try:
            return datetime.strptime(value, pattern).date()
        except ValueError:
            continue
    return None


class DataGovMarketPriceProvider:
    """Fetch and briefly cache state/crop filtered AGMARKNET observations."""

    def __init__(self, api_key: str | None, timeout_seconds: float) -> None:
        self.api_key = api_key.strip() if api_key else ""
        self.timeout_seconds = timeout_seconds
        self._cache: dict[tuple[str, str], tuple[float, MarketPricesResponse]] = {}
        self._lock = Lock()

    @property
    def available(self) -> bool:
        return bool(self.api_key)

    def get_prices(self, state: str, crop: str | None = None) -> MarketPricesResponse:
        if not self.api_key:
            raise RuntimeError("Data.gov.in API key is not configured")
        state = " ".join(state.split())
        crop = " ".join(crop.split()) if crop else ""
        cache_key = (state.casefold(), crop.casefold())
        now = monotonic()
        with self._lock:
            cached = self._cache.get(cache_key)
            if cached and now - cached[0] < CACHE_TTL_SECONDS:
                return cached[1]

        def stale_or_raise(message: str) -> MarketPricesResponse:
            if cached:
                logger.info("Serving cached Data.gov.in mandi observations after an upstream failure")
                return cached[1]
            raise RuntimeError(message)

        params: list[tuple[str, str | int]] = [
            ("api-key", self.api_key),
            ("format", "json"),
            ("limit", 100),
            ("offset", 0),
            ("filters[state]", state),
            ("sort[arrival_date]", "desc"),
        ]
        if crop:
            params.append(("filters[commodity]", crop))
        request = Request(f"{API_URL}?{urlencode(params)}", headers={"Accept": "application/json"})
        try:
            with urlopen(request, timeout=self.timeout_seconds) as response:
                payload = json.load(response)
        except HTTPError as exc:
            logger.warning("Data.gov.in mandi request failed (http_status=%s)", exc.code)
            return stale_or_raise(f"Data.gov.in market feed returned HTTP {exc.code}")
        except (URLError, TimeoutError, ValueError) as exc:
            logger.warning("Data.gov.in mandi request failed (exception=%s)", type(exc).__name__)
            return stale_or_raise("Data.gov.in market feed is temporarily unavailable")

        if not isinstance(payload, dict) or not isinstance(payload.get("records"), list):
            logger.warning("Data.gov.in mandi response did not contain a records list")
            raise RuntimeError("Data.gov.in returned an unexpected market-data response")

        records: list[MarketPriceRecord] = []
        for item in payload["records"]:
            if not isinstance(item, dict):
                continue
            record_state = _text(item, "state")
            if record_state.casefold() != state.casefold():
                continue
            commodity = _text(item, "commodity")
            if crop and commodity.casefold() != crop.casefold():
                continue
            market = _text(item, "market")
            district = _text(item, "district")
            if not market or not commodity:
                continue
            records.append(MarketPriceRecord(
                state=record_state, district=district, market=market,
                commodity=commodity, variety=_text(item, "variety") or None,
                grade=_text(item, "grade") or None,
                arrival_date=_arrival_date(_text(item, "arrival_date")),
                min_price=_price(item, "min_price"), max_price=_price(item, "max_price"),
                modal_price=_price(item, "modal_price"),
            ))

        records.sort(key=lambda item: item.arrival_date or date.min, reverse=True)
        result = MarketPricesResponse(
            state=state, crop=crop or None, fetched_at=datetime.now(timezone.utc),
            record_count=len(records), records=records[:100],
            limitation=("Daily wholesale mandi observations from AGMARKNET via data.gov.in. "
                        "Reports can be delayed or missing; these are not guaranteed live quotes "
                        "or the price a farmer will receive."),
        )
        with self._lock:
            self._cache[cache_key] = (now, result)
        return result

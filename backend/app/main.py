from quart import Quart, g, jsonify, request
from quart.helpers import make_response

from app.db import SessionLocal
from app.models import Basin
from app.repositories import BasinRepo, QuotaExhausted, UserRepo
from app.security import make_token, parse_token, verify_password
from app.services import RuleError, assert_can_set_status, latest_temp

app = Quart(__name__)


def _bearer() -> str | None:
    header = request.headers.get("Authorization", "")
    if header.startswith("Bearer "):
        return header[7:]
    return None


@app.before_request
async def load_user():
    g.user = None
    token = _bearer()
    if not token:
        return
    username = parse_token(token)
    if not username:
        return
    async with SessionLocal() as session:
        g.user = await UserRepo(session).by_username(username)


def require_user():
    if g.user is None:
        return jsonify({"detail": "未登录"}), 401
    return None


def require_admin():
    denied = require_user()
    if denied:
        return denied
    if g.user.role != "admin":
        return jsonify({"detail": "仅管理员可补圈"}), 403
    return None


@app.route("/api/health")
async def health():
    return {"status": "ok", "service": "SilkReel"}


@app.route("/api/auth/login", methods=["POST"])
async def login():
    body = await request.get_json(force=True)
    username = (body or {}).get("username", "")
    password = (body or {}).get("password", "")
    async with SessionLocal() as session:
        user = await UserRepo(session).by_username(username)
        if user is None or not verify_password(password, user.password_hash):
            return jsonify({"detail": "用户名或密码错误"}), 401
        return {
            "access_token": make_token(user.username),
            "user": {"username": user.username, "role": user.role},
        }


@app.route("/api/auth/me")
async def me():
    denied = require_user()
    if denied:
        return denied
    return {"username": g.user.username, "role": g.user.role}


def _basin_json(basin: Basin) -> dict:
    return {
        "id": basin.id,
        "code": basin.code,
        "status": basin.status,
        "ringIndex": basin.ring_index,
        "latestTempC": latest_temp(basin),
        "readingCount": len(basin.readings or []),
        "remainingTurns": basin.quota.remaining_turns if basin.quota is not None else None,
        "quotaUpdatedAt": (
            basin.quota.updated_at.isoformat()
            if basin.quota is not None and basin.quota.updated_at is not None
            else None
        ),
    }


@app.route("/api/board")
async def board():
    denied = require_user()
    if denied:
        return denied
    async with SessionLocal() as session:
        mill = await BasinRepo(session).board()
        if mill is None:
            return jsonify({"detail": "尚无缫丝坞"}), 404
        basins = sorted(mill.basins, key=lambda b: b.ring_index)
        return {
            "filature": mill.name,
            "riverside": mill.riverside,
            "basins": [_basin_json(b) for b in basins],
        }


@app.route("/api/quotas")
async def list_quotas():
    denied = require_user()
    if denied:
        return denied
    code = (request.args.get("q") or "").strip() or None
    async with SessionLocal() as session:
        pairs = await BasinRepo(session).quotas(code)
        return {
            "items": [
                {
                    "basinId": basin.id,
                    "code": basin.code,
                    "status": basin.status,
                    "remainingTurns": quota.remaining_turns,
                    "updatedAt": quota.updated_at.isoformat() if quota.updated_at else None,
                }
                for basin, quota in pairs
            ]
        }


@app.route("/api/basins/<int:basin_id>/quotas/refill", methods=["POST"])
async def refill_quota(basin_id: int):
    denied = require_admin()
    if denied:
        return denied
    body = await request.get_json(force=True)
    try:
        add_turns = int((body or {}).get("addTurns"))
    except (TypeError, ValueError):
        return jsonify({"detail": "补圈数必须是整数"}), 400
    if add_turns <= 0:
        return jsonify({"detail": "补圈数必须大于 0"}), 400
    async with SessionLocal() as session:
        try:
            remaining, updated_at = await BasinRepo(session).refill_quota(
                basin_id, add_turns
            )
        except LookupError:
            return jsonify({"detail": "盆不存在"}), 404
        return {
            "basinId": basin_id,
            "remainingTurns": remaining,
            "updatedAt": updated_at.isoformat() if updated_at else None,
        }


@app.route("/api/basins/<int:basin_id>/readings", methods=["POST"])
async def add_reading(basin_id: int):
    denied = require_user()
    if denied:
        return denied
    body = await request.get_json(force=True)
    try:
        temp = float((body or {}).get("waterTempC"))
    except (TypeError, ValueError):
        return jsonify({"detail": "汤温必须是数字"}), 400
    async with SessionLocal() as session:
        repo = BasinRepo(session)
        try:
            await repo.consume_and_add_reading(basin_id, temp, g.user.username)
        except LookupError:
            return jsonify({"detail": "盆不存在"}), 404
        except QuotaExhausted:
            return jsonify({"detail": "该盆小箴配额已用完，剩余 0 圈，不能再登记汤温"}), 400
        basin = await repo.get(basin_id)
        return _basin_json(basin)


@app.route("/api/basins/<int:basin_id>/status", methods=["POST"])
async def set_status(basin_id: int):
    denied = require_user()
    if denied:
        return denied
    body = await request.get_json(force=True)
    status = (body or {}).get("status", "")
    async with SessionLocal() as session:
        repo = BasinRepo(session)
        basin = await repo.get(basin_id)
        if basin is None:
            return jsonify({"detail": "盆不存在"}), 404
        try:
            assert_can_set_status(basin, status)
        except RuleError as exc:
            return jsonify({"detail": str(exc)}), 400
        await repo.save_status(basin, status)
        basin = await repo.get(basin_id)
        return _basin_json(basin)

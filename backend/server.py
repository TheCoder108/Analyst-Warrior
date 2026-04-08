"""
Analyst Warrior — Free Fire Dashboard
Backend: Python Flask + SQLite
==========================================
Run:  python3 server.py
URL:  http://localhost:5000
"""
import os
import sqlite3
import hashlib
import uuid
import time
import re
import base64
import random
from pathlib import Path
from functools import wraps
from datetime import datetime
from flask import Flask, jsonify, request, send_from_directory, g, make_response

# ── Paths ──────────────────────────────────────────────────────────────────────
BASE_DIR = Path(__file__).parent
PROJECT_DIR = BASE_DIR.parent
FRONTEND_DIR = PROJECT_DIR / "frontend"
STATIC_DIR = BASE_DIR / "static"
MAPS_DIR = STATIC_DIR / "maps"
UPLOADS_DIR = STATIC_DIR / "uploads"
DB_PATH = BASE_DIR / "analyst_warrior.db"

UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
MAPS_DIR.mkdir(parents=True, exist_ok=True)

# ── Config ─────────────────────────────────────────────────────────────────────
ALLOWED_EXT = {".jpg", ".jpeg", ".png", ".webp"}
ADMIN_PHONES = {"6396276848", "9777868607"}
ADMIN_PASSWORD = "warrior@123"
MAP_ADMIN_PASSWORD = "warrior_is_op"

app = Flask(__name__, static_folder=str(STATIC_DIR), static_url_path="/static")
app.config["MAX_CONTENT_LENGTH"] = int(os.getenv("MAX_CONTENT_LENGTH_MB", "50")) * 1024 * 1024

otp_store = {}

# ── Helpers ────────────────────────────────────────────────────────────────────
def gen_id() -> str:
    return uuid.uuid4().hex

def hash_pw(p: str) -> str:
    return hashlib.sha256(p.encode()).hexdigest()

def now_ts() -> int:
    return int(time.time())

def gen_otp() -> str:
    return str(random.randint(100000, 999999))

def gen_token(uid) -> str:
    return base64.urlsafe_b64encode(f"{uid}:{time.time()}:{uuid.uuid4().hex}".encode()).decode()

def ok(data=None, status=200):
    return jsonify(data or {}), status

def err(msg, status=400):
    return jsonify({"error": msg}), status

# ── CORS ───────────────────────────────────────────────────────────────────────
@app.before_request
def handle_preflight():
    if request.method == "OPTIONS":
        r = make_response("", 204)
        r.headers["Access-Control-Allow-Origin"] = "*"
        r.headers["Access-Control-Allow-Headers"] = "Content-Type, X-Auth-Token"
        r.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
        return r

@app.after_request
def add_cors(resp):
    resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type, X-Auth-Token"
    resp.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
    return resp

# ── Database ───────────────────────────────────────────────────────────────────
def get_db():
    if "db" not in g:
        c = sqlite3.connect(str(DB_PATH))
        c.row_factory = sqlite3.Row
        c.execute("PRAGMA journal_mode=WAL")
        c.execute("PRAGMA foreign_keys=ON")
        g.db = c
    return g.db

@app.teardown_appcontext
def close_db(_exc):
    db = g.pop("db", None)
    if db:
        db.close()

def init_db():
    with sqlite3.connect(str(DB_PATH)) as c:
        c.execute("PRAGMA foreign_keys=ON")
        c.executescript("""
            CREATE TABLE IF NOT EXISTS users (
                id         TEXT PRIMARY KEY,
                username   TEXT NOT NULL UNIQUE COLLATE NOCASE,
                password   TEXT NOT NULL,
                is_admin   INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS sessions (
                token      TEXT PRIMARY KEY,
                user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                created_at INTEGER NOT NULL,
                expires_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_sess_user ON sessions(user_id);

            CREATE TABLE IF NOT EXISTS maps (
                id         TEXT PRIMARY KEY,
                name       TEXT NOT NULL,
                map_type   TEXT NOT NULL DEFAULT 'Battle Map',
                size       TEXT NOT NULL DEFAULT '—',
                theme      TEXT NOT NULL DEFAULT 'CUSTOM',
                image_file TEXT NOT NULL,
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS matches (
                id            TEXT PRIMARY KEY,
                user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                team_name     TEXT NOT NULL,
                map_name      TEXT NOT NULL DEFAULT '',
                position      INTEGER NOT NULL DEFAULT 1,
                match_date    TEXT NOT NULL,
                total_kills   INTEGER NOT NULL DEFAULT 0,
                total_deaths  INTEGER NOT NULL DEFAULT 0,
                total_assists INTEGER NOT NULL DEFAULT 0,
                total_damage  INTEGER NOT NULL DEFAULT 0,
                created_at    INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_match_user ON matches(user_id);

            CREATE TABLE IF NOT EXISTS players (
                id          TEXT PRIMARY KEY,
                match_id    TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
                player_name TEXT NOT NULL,
                kills       INTEGER NOT NULL DEFAULT 0,
                deaths      INTEGER NOT NULL DEFAULT 0,
                assists     INTEGER NOT NULL DEFAULT 0,
                damage      INTEGER NOT NULL DEFAULT 0,
                role        TEXT NOT NULL DEFAULT 'Fragger',
                sort_order  INTEGER NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_player_match ON players(match_id);
        """)

        # Add missing columns for existing DBs
        for tbl, col in [("matches", "total_deaths"), ("players", "deaths")]:
            try:
                c.execute(f"ALTER TABLE {tbl} ADD COLUMN {col} INTEGER NOT NULL DEFAULT 0")
            except Exception:
                pass

        # Seed admin accounts
        for phone in ADMIN_PHONES:
            if not c.execute("SELECT id FROM users WHERE username=?", (phone,)).fetchone():
                c.execute(
                    "INSERT INTO users(id,username,password,is_admin,created_at) VALUES(?,?,?,1,?)",
                    (gen_id(), phone, hash_pw(ADMIN_PASSWORD), now_ts())
                )
            else:
                c.execute("UPDATE users SET is_admin=1, password=? WHERE username=?",
                          (hash_pw(ADMIN_PASSWORD), phone))

        # Seed default maps with placeholder images
        if c.execute("SELECT COUNT(*) FROM maps").fetchone()[0] == 0:
            default_maps = [
                ("kalahari", "Kalahari", "Desert Warfare", "8×8 km", "DESERT", "kalahari.jpg", 0),
                ("nexterra", "Nexterra", "Island Urban", "Island Map", "ISLAND", "nexterra.jpg", 1),
                ("purgatory", "Purgatory", "Tropical Island", "Island Map", "TROPICAL", "purgatory.jpg", 2),
                ("solara", "Solara", "Lush Green Island", "Island Map", "GREEN", "solara.jpg", 3),
                ("bermuda", "Bermuda", "Classic Battleground", "8×8 km", "CLASSIC", "bermuda.jpg", 4),
            ]
            for mid, name, mtype, size, theme, img, so in default_maps:
                c.execute(
                    "INSERT INTO maps(id,name,map_type,size,theme,image_file,sort_order,created_at) "
                    "VALUES(?,?,?,?,?,?,?,?)",
                    (mid, name, mtype, size, theme, img, so, now_ts())
                )
        c.commit()

init_db()

# ── Auth middleware ────────────────────────────────────────────────────────────
def current_user():
    tok = request.headers.get("X-Auth-Token", "").strip()
    if not tok:
        return None
    return get_db().execute(
        "SELECT u.id, u.username, u.is_admin "
        "FROM sessions s JOIN users u ON u.id = s.user_id "
        "WHERE s.token=? AND s.expires_at>?",
        (tok, now_ts())
    ).fetchone()

def login_required(f):
    @wraps(f)
    def d(*a, **k):
        u = current_user()
        if not u:
            return err("Unauthorized", 401)
        g.user = u
        return f(*a, **k)
    return d

def admin_required(f):
    @wraps(f)
    def d(*a, **k):
        u = current_user()
        if not u:
            return err("Unauthorized", 401)
        if not u["is_admin"]:
            return err("Admin only", 403)
        g.user = u
        return f(*a, **k)
    return d

def _check_map_auth():
    pw_form = (request.form.get("admin_password") or "").strip()
    if pw_form == MAP_ADMIN_PASSWORD:
        return True
    try:
        data = request.get_json(force=True, silent=True) or {}
        if (data.get("admin_password") or "") == MAP_ADMIN_PASSWORD:
            return True
    except Exception:
        pass
    u = current_user()
    return bool(u and u["is_admin"])

# ══════════════════════════════════════════════════════════════════════════════
# AUTH ROUTES
# ══════════════════════════════════════════════════════════════════════════════
@app.route("/api/auth/send-otp", methods=["POST"])
def send_otp():
    data = request.get_json(force=True, silent=True) or {}
    phone = (data.get("phone") or "").strip()
    purpose = (data.get("purpose") or "register").strip()
    if not re.match(r"^\d{10}$", phone):
        return err("Enter a valid 10-digit phone number")
    db = get_db()
    exists = db.execute("SELECT id FROM users WHERE username=?", (phone,)).fetchone()
    if purpose == "register" and exists:
        return err("Number already registered — please Sign In", 409)
    if purpose == "reset" and not exists:
        return err("No account found with this number", 404)
    otp = gen_otp()
    otp_store[phone] = {
        "otp": otp, "expires_at": now_ts() + 300,
        "purpose": purpose, "verified": False, "attempts": 0
    }
    print(f"\n{'='*46}\n  📲  OTP → {phone}  :  {otp}  [{purpose}]\n{'='*46}\n")
    return jsonify({"message": f"OTP sent to +91 {phone[:4]}****{phone[-2:]}", "dev_otp": otp})

@app.route("/api/auth/verify-otp", methods=["POST"])
def verify_otp():
    data = request.get_json(force=True, silent=True) or {}
    phone = (data.get("phone") or "").strip()
    code = (data.get("otp") or "").strip()
    entry = otp_store.get(phone)
    if not entry:
        return err("No OTP requested — send OTP first")
    if now_ts() > entry["expires_at"]:
        otp_store.pop(phone, None)
        return err("OTP expired — request a new one")
    entry["attempts"] += 1
    if entry["attempts"] > 5:
        otp_store.pop(phone, None)
        return err("Too many attempts — request a new OTP", 429)
    if entry["otp"] != code:
        left = 5 - entry["attempts"]
        return err(f"Wrong OTP — {left} attempt{'s' if left != 1 else ''} left")
    entry["verified"] = True
    return jsonify({"message": "OTP verified ✓", "purpose": entry["purpose"]})

@app.route("/api/auth/register", methods=["POST"])
def register():
    data = request.get_json(force=True, silent=True) or {}
    phone = (data.get("username") or data.get("phone") or "").strip()
    pw = (data.get("password") or "").strip()
    if not re.match(r"^\d{10}$", phone):
        return err("Enter a valid 10-digit phone number")
    if len(pw) < 6:
        return err("Password must be at least 6 characters")
    entry = otp_store.get(phone)
    if not entry or not entry.get("verified") or entry.get("purpose") != "register":
        return err("Phone not verified — complete OTP verification first")
    db = get_db()
    if db.execute("SELECT id FROM users WHERE username=? COLLATE NOCASE", (phone,)).fetchone():
        return err("Number already registered", 409)
    uid = gen_id()
    is_admin = 1 if phone in ADMIN_PHONES else 0
    db.execute("INSERT INTO users(id,username,password,is_admin,created_at) VALUES(?,?,?,?,?)",
               (uid, phone, hash_pw(pw), is_admin, now_ts()))
    tok = gen_token(uid)
    db.execute("INSERT INTO sessions(token,user_id,created_at,expires_at) VALUES(?,?,?,?)",
               (tok, uid, now_ts(), now_ts() + 86400 * 30))
    db.commit()
    otp_store.pop(phone, None)
    return jsonify({"token": tok, "username": phone, "is_admin": bool(is_admin), "message": "Account created"}), 201

@app.route("/api/auth/login", methods=["POST"])
def login():
    data = request.get_json(force=True, silent=True) or {}
    phone = (data.get("username") or data.get("phone") or "").strip()
    pw = (data.get("password") or "").strip()
    if not phone or not pw:
        return err("Phone number and password are required")
    db = get_db()
    user = db.execute("SELECT * FROM users WHERE username=? COLLATE NOCASE", (phone,)).fetchone()
    if not user or user["password"] != hash_pw(pw):
        time.sleep(0.5)
        return err("Invalid phone number or password", 401)
    tok = gen_token(user["id"])
    db.execute("INSERT INTO sessions(token,user_id,created_at,expires_at) VALUES(?,?,?,?)",
               (tok, user["id"], now_ts(), now_ts() + 86400 * 30))
    db.commit()
    return jsonify({"token": tok, "username": user["username"], "is_admin": bool(user["is_admin"]), "message": "Login successful"})

@app.route("/api/auth/logout", methods=["POST"])
@login_required
def logout():
    tok = request.headers.get("X-Auth-Token", "")
    get_db().execute("DELETE FROM sessions WHERE token=?", (tok,))
    get_db().commit()
    return jsonify({"message": "Logged out"})

@app.route("/api/auth/me", methods=["GET"])
@login_required
def me():
    u = g.user
    return jsonify({"id": u["id"], "username": u["username"], "is_admin": bool(u["is_admin"])})

# ══════════════════════════════════════════════════════════════════════════════
# MAPS API
# ══════════════════════════════════════════════════════════════════════════════
@app.route("/api/maps", methods=["GET"])
def list_maps():
    rows = get_db().execute("SELECT * FROM maps ORDER BY sort_order, created_at").fetchall()
    return jsonify([dict(r) for r in rows])

@app.route("/api/maps/upload", methods=["POST"])
def create_map_password():
    if not _check_map_auth():
        return err("Wrong password or insufficient permissions", 403)
    name = (request.form.get("name") or "").strip()
    map_type = (request.form.get("map_type") or "Custom Map").strip()
    size = (request.form.get("size") or "—").strip()
    theme = (request.form.get("theme") or "CUSTOM").upper().strip()
    if not name:
        return err("Map name is required")
    
    image_file = "placeholder.jpg"
    f = request.files.get("image")
    if f and f.filename:
        ext = Path(f.filename).suffix.lower()
        if ext not in ALLOWED_EXT:
            return err("Image must be jpg/jpeg/png/webp")
        safe = gen_id() + ext
        f.save(str(UPLOADS_DIR / safe))
        image_file = "uploads/" + safe
    
    db = get_db()
    mid = gen_id()
    max_so = db.execute("SELECT COALESCE(MAX(sort_order),0) FROM maps").fetchone()[0]
    db.execute(
        "INSERT INTO maps(id,name,map_type,size,theme,image_file,sort_order,created_at) "
        "VALUES(?,?,?,?,?,?,?,?)",
        (mid, name, map_type, size, theme, image_file, max_so + 1, now_ts())
    )
    db.commit()
    return jsonify({"id": mid, "message": f'Map "{name}" added successfully'}), 201

@app.route("/api/maps/<mid>", methods=["DELETE"])
def delete_map(mid):
    if not _check_map_auth():
        return err("Unauthorized", 403)
    db = get_db()
    row = db.execute("SELECT image_file FROM maps WHERE id=?", (mid,)).fetchone()
    if not row:
        return err("Map not found", 404)
    img = row["image_file"]
    if img.startswith("uploads/"):
        try:
            (STATIC_DIR / img).unlink(missing_ok=True)
        except Exception:
            pass
    db.execute("DELETE FROM maps WHERE id=?", (mid,))
    db.commit()
    return jsonify({"message": "Map deleted"})

# ══════════════════════════════════════════════════════════════════════════════
# MATCHES API
# ══════════════════════════════════════════════════════════════════════════════
@app.route("/api/matches", methods=["GET"])
@login_required
def list_matches():
    db = get_db()
    uid = g.user["id"]
    if g.user["is_admin"]:
        rows = db.execute(
            "SELECT m.*, u.username FROM matches m "
            "JOIN users u ON u.id = m.user_id ORDER BY m.created_at DESC"
        ).fetchall()
    else:
        rows = db.execute(
            "SELECT * FROM matches WHERE user_id=? ORDER BY created_at DESC", (uid,)
        ).fetchall()
    result = []
    for row in rows:
        md = dict(row)
        md["players"] = [
            dict(p) for p in db.execute(
                "SELECT * FROM players WHERE match_id=? ORDER BY sort_order",
                (row["id"],)
            ).fetchall()
        ]
        result.append(md)
    return jsonify(result)

@app.route("/api/matches", methods=["POST"])
@login_required
def create_match():
    data = request.get_json(force=True, silent=True) or {}
    team_name = (data.get("team_name") or "").strip()
    map_name = (data.get("map_name") or "").strip()
    position = max(1, int(data.get("position") or 1))
    date = (data.get("match_date") or datetime.today().strftime("%Y-%m-%d")).strip()
    players = [p for p in (data.get("players") or []) if (p.get("player_name") or "").strip()]
    if not team_name:
        return err("Team name is required")
    if not players:
        return err("Add at least one player with a name")

    total_kills = sum(int(p.get("kills", 0)) for p in players)
    total_deaths = sum(int(p.get("deaths", 0)) for p in players)
    total_assists = sum(int(p.get("assists", 0)) for p in players)
    total_damage = sum(int(p.get("damage", 0)) for p in players)

    db = get_db()
    mid = gen_id()
    db.execute(
        "INSERT INTO matches(id,user_id,team_name,map_name,position,match_date,"
        "total_kills,total_deaths,total_assists,total_damage,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        (mid, g.user["id"], team_name, map_name, position, date,
         total_kills, total_deaths, total_assists, total_damage, now_ts())
    )
    for i, p in enumerate(players):
        db.execute(
            "INSERT INTO players(id,match_id,player_name,kills,deaths,assists,damage,role,sort_order) "
            "VALUES(?,?,?,?,?,?,?,?,?)",
            (gen_id(), mid,
             p.get("player_name", "").strip(),
             int(p.get("kills", 0)),
             int(p.get("deaths", 0)),
             int(p.get("assists", 0)),
             int(p.get("damage", 0)),
             p.get("role", "Fragger"), i)
        )
    db.commit()
    return jsonify({"id": mid, "message": "Match saved"}), 201

@app.route("/api/matches/<mid>", methods=["DELETE"])
@login_required
def delete_match(mid):
    db = get_db()
    row = db.execute("SELECT user_id FROM matches WHERE id=?", (mid,)).fetchone()
    if not row:
        return err("Match not found", 404)
    if not g.user["is_admin"] and row["user_id"] != g.user["id"]:
        return err("Forbidden", 403)
    db.execute("DELETE FROM players WHERE match_id=?", (mid,))
    db.execute("DELETE FROM matches WHERE id=?", (mid,))
    db.commit()
    return jsonify({"message": "Deleted"})

# ══════════════════════════════════════════════════════════════════════════════
# STATIC FILES (must be last)
# ══════════════════════════════════════════════════════════════════════════════
@app.route("/static/maps/<path:fn>")
def serve_map(fn):
    return send_from_directory(str(MAPS_DIR), fn)

@app.route("/static/uploads/<path:fn>")
def serve_upload(fn):
    return send_from_directory(str(UPLOADS_DIR), fn)

@app.route("/healthz")
def healthz():
    return jsonify({"status": "ok"})

def _serve_frontend_file(path: str):
    if not FRONTEND_DIR.exists():
        return None
    root = FRONTEND_DIR.resolve()
    candidate = (FRONTEND_DIR / path).resolve()
    try:
        candidate.relative_to(root)
    except ValueError:
        return None
    if candidate.is_file():
        return send_from_directory(str(FRONTEND_DIR), path)
    return None

@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def serve_frontend(path):
    if path in {"", "/"}:
        page = _serve_frontend_file("index.html")
        if page:
            return page
    if path:
        direct = _serve_frontend_file(path)
        if direct:
            return direct
        if "." not in path:
            html_page = _serve_frontend_file(f"{path}.html")
            if html_page:
                return html_page
    html_path = STATIC_DIR / "index.html"
    if html_path.exists():
        return send_from_directory(str(STATIC_DIR), "index.html")
    return send_from_directory(str(FRONTEND_DIR), "index.html")

# ══════════════════════════════════════════════════════════════════════════════
if __name__ == "__main__":
    init_db()
    print(f"\n{'═'*58}")
    print("  ⚔  ANALYST WARRIOR — Free Fire Dashboard")
    print(f"{'═'*58}")
    print(f"  🌐  http://localhost:5000")
    print(f"  🗄  DB            : {DB_PATH}")
    print(f"  👑  Admin phones  : {', '.join(ADMIN_PHONES)}")
    print(f"  🔑  Admin login pw: {ADMIN_PASSWORD}")
    print(f"  🗺  Map admin pw  : {MAP_ADMIN_PASSWORD}")
    print(f"  📲  OTPs printed in console")
    print(f"{'═'*58}\n")
    app.run(
        debug=os.getenv("FLASK_DEBUG", "").strip().lower() in {"1", "true", "yes", "on"},
        port=int(os.getenv("PORT", "5000")),
        host="0.0.0.0",
    )

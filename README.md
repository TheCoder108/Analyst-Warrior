# Analyst Warrior

Deploy-ready Flask app for the Analyst Warrior frontend and APIs.

## Local Run

```bash
pip install -r requirements.txt
python backend/server.py
```

Open http://localhost:5000

## Production Start

```bash
gunicorn -c gunicorn.conf.py wsgi:app
```

The app reads these environment variables:

- `PORT`: port for `python backend/server.py`
- `FLASK_DEBUG`: set `1` or `true` only for local debugging
- `MAX_CONTENT_LENGTH_MB`: upload cap in MB, defaults to `50`

## What Is Served

- `/` -> match studio
- `/teams` -> team page
- `/performance` -> performance page
- `/export` -> export page
- `/healthz` -> health check
- `/static/...` -> logo, default maps, uploaded map files

## Deploy Files

- `requirements.txt`
- `Procfile`
- `gunicorn.conf.py`
- `wsgi.py`

## Notes

- Frontend pages live in `frontend/` and are served by Flask in production.
- SQLite database is initialized automatically on import, so Gunicorn/WSGI startup works without a manual bootstrap step.
- The current frontend stores working data in the browser, so privacy is local-browser based unless you wire the frontend to backend APIs later.

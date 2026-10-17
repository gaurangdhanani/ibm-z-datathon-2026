# MedVault · IBM Z Datathon 2026

Patient-controlled, encrypted medical records: the patient holds the key, hospitals borrow it, every read is logged in a tamper-evident chain, and fixed access rules freeze suspicious access. Runs on a laptop and on IBM LinuxONE (s390x).

## Quick start

Requires Python 3.10+, Node 20+ and `make`.

```bash
make setup      # .venv + pinned Python deps, npm ci for the frontend
make dev        # FastAPI on http://127.0.0.1:8000, Vite on http://localhost:5173
```

Open http://localhost:5173 and pick a demo account. Every demo account's password is `medvault-demo`.

Single-process demo (what LinuxONE runs):

```bash
make serve      # builds frontend/dist, then FastAPI serves app + API on 0.0.0.0:8000
```

Other targets: `make test`, `make lint`, `make seed` (wipe and reload demo data), `make run` (serve without building), `make smoke` (health + demo login record line), `make help`.

Testing steps, including the LinuxONE (s390x) procedure, are in [TEST.md](TEST.md).

## Layout

| Path | What |
| --- | --- |
| `medvault/` | FastAPI backend: `config.py`, `db.py`, `models.py`, `auth.py`, `seed.py`, `main.py` |
| `tests/` | pytest suite (in-memory SQLite) |
| `scripts/` | `linuxone_setup.sh` (s390x VM setup) and `smoke.sh` (health + login record) |
| `frontend/` | Vite + React + Tailwind SPA; `src/components/ui.tsx` is the shared UI kit |
| `data/` | SQLite database (gitignored) |
| `TICKETS.md` | the build checklist · `DECISIONS.md` the decision log |

## Configuration

Copy `.env.example` to `.env` to override anything. Defaults are dev-safe. Set `MEDVAULT_ENV=prod` and a real `MEDVAULT_SECRET_KEY` for the public demo.

## API

Interactive docs at `/api/docs` (dev only). Health at `/api/health` reports the machine architecture, which is how the s390x smoke test proves where it ran.

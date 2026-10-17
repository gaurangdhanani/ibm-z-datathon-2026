# MedVault developer entrypoints. Works with the macOS default make (3.81) and GNU make 4.
PYTHON ?= python3
VENV   ?= .venv
BIN    := $(VENV)/bin
HOST   ?= 127.0.0.1
PORT   ?= 8000

.PHONY: help setup backend frontend dev build serve run seed test lint smoke clean

help:
	@echo "make setup    create .venv, install pinned Python deps, npm ci the frontend"
	@echo "make dev      run FastAPI on :$(PORT) and the Vite dev server on :5173 together"
	@echo "make build    build the frontend into frontend/dist (FastAPI serves it)"
	@echo "make serve    build, then run FastAPI alone on 0.0.0.0:$(PORT)"
	@echo "make run      run FastAPI alone on 0.0.0.0:$(PORT) without building (LinuxONE: dist copied in)"
	@echo "make seed     wipe and reload the demo data"
	@echo "make test     run pytest"
	@echo "make lint     ruff check + format check"
	@echo "make smoke    health + demo login against a running server; prints the DECISIONS.md line"

$(BIN)/python:
	$(PYTHON) -m venv $(VENV)
	$(BIN)/python -m pip install --upgrade pip

setup: $(BIN)/python
	$(BIN)/python -m pip install -r requirements-dev.txt
	cd frontend && npm ci

backend:
	$(BIN)/uvicorn medvault.main:app --host $(HOST) --port $(PORT) --reload

frontend:
	cd frontend && npm run dev

dev:
	@trap 'kill 0' EXIT INT TERM; \
	$(BIN)/uvicorn medvault.main:app --host $(HOST) --port $(PORT) --reload & \
	(cd frontend && npm run dev) & \
	wait

build:
	cd frontend && npm run build

serve: build run

run:
	$(BIN)/uvicorn medvault.main:app --host 0.0.0.0 --port $(PORT)

seed:
	$(BIN)/python -m medvault.seed

test:
	$(BIN)/python -m pytest -q

lint:
	$(BIN)/ruff check medvault tests
	$(BIN)/ruff format --check medvault tests

smoke:
	scripts/smoke.sh http://$(HOST):$(PORT)

clean:
	rm -rf $(VENV) frontend/node_modules frontend/dist data/*.db* .pytest_cache .ruff_cache

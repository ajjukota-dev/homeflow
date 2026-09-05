# HomeFlow local stack (technical/10 §3).
# `make` is not installed by default on Windows — see README, or use the npm equivalents
# (`npm run stack:dev | stack:down | stack:reset | stack:test`).
.PHONY: dev down reset test lint e2e synth wait

dev:
	docker compose up -d --build
	$(MAKE) wait
	docker compose exec api alembic upgrade head

wait:
	@echo "waiting for /health ..."
	@for i in $$(seq 1 60); do \
		curl -fsS http://localhost:8001/health >/dev/null 2>&1 && echo "api up" && exit 0; \
		sleep 2; \
	done; echo "api did not come up"; docker compose logs --tail 60 api; exit 1

down:
	docker compose down

reset:
	docker compose down -v
	$(MAKE) dev

test:
	docker compose exec api uv run pytest
	npm test

lint:
	docker compose exec api sh -c "uv run ruff check . && uv run mypy ."

e2e:
	npm run test:e2e

synth:
	npm run synth

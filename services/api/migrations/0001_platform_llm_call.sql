-- llm port (03-platform-deploy.md): every call logged with purpose, tokens, cost.
CREATE TABLE llm_call (
  id text PRIMARY KEY,
  purpose text NOT NULL,
  model text NOT NULL,
  tokens int NOT NULL,
  cost_inr numeric(10,4) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

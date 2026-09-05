-- Local mirror of technical/02 §1: the same two roles exist on the laptop, so a missing
-- grant fails here before it fails in RDS. Runs once, as the postgres superuser, on an
-- empty data volume.
CREATE ROLE homeflow_owner LOGIN PASSWORD 'homeflow_owner';
CREATE ROLE homeflow_app   LOGIN PASSWORD 'homeflow_app' NOBYPASSRLS;

CREATE DATABASE homeflow OWNER homeflow_owner;

\connect homeflow

-- public schema belongs to the owner so Alembic (as homeflow_owner) can create in it
ALTER SCHEMA public OWNER TO homeflow_owner;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO homeflow_app;

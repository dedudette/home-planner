#!/bin/sh
# A throwaway local PostgreSQL for the database tests. Nothing here is a production setup.
#
#   scripts/test-db.sh run npm test -- tests/db     start (if needed), run the command with TEST_DATABASE_URL set, stop what it started
#   scripts/test-db.sh start | stop | status | url
#
# Needs the PostgreSQL server binaries (initdb, pg_ctl). Data lives in $CLEANFLOW_TEST_PG_DIR (default /tmp/cleanflow-test-pg), port
# $CLEANFLOW_TEST_PG_PORT (default 54329), trust authentication on 127.0.0.1 only. As root it runs the server as the `postgres` user.
set -eu
DIR="${CLEANFLOW_TEST_PG_DIR:-/tmp/cleanflow-test-pg}"
PORT="${CLEANFLOW_TEST_PG_PORT:-54329}"
BIN=""
for d in $(command -v pg_ctl >/dev/null 2>&1 && dirname "$(command -v pg_ctl)") /usr/lib/postgresql/*/bin /opt/homebrew/opt/postgresql*/bin /usr/local/opt/postgresql*/bin; do
  [ -x "$d/pg_ctl" ] && BIN="$d" && break
done
[ -n "$BIN" ] || { echo "PostgreSQL server binaries not found (install postgresql)." >&2; exit 2; }
AS=""
[ "$(id -u)" = 0 ] && AS="runuser -u postgres --"
url() { echo "postgres://postgres@127.0.0.1:$PORT/postgres"; }
running() { $AS "$BIN/pg_isready" -q -h 127.0.0.1 -p "$PORT"; }
start() {
  running && return 0
  if [ ! -d "$DIR/data" ]; then
    mkdir -p "$DIR"; [ -z "$AS" ] || chown postgres "$DIR"
    $AS "$BIN/initdb" -D "$DIR/data" -A trust -U postgres -E UTF8 --locale=C.UTF-8 >/dev/null
  fi
  $AS "$BIN/pg_ctl" -D "$DIR/data" -l "$DIR/pg.log" -o "-p $PORT -k $DIR -c listen_addresses=127.0.0.1 -c fsync=off" -w start >/dev/null
}
stop() { $AS "$BIN/pg_ctl" -D "$DIR/data" -m fast stop >/dev/null 2>&1 || true; }
case "${1:-}" in
  start) start; url ;;
  stop) stop ;;
  status) running && echo running || { echo stopped; exit 1; } ;;
  url) url ;;
  run)
    shift
    was=0; running && was=1
    start
    set +e
    TEST_DATABASE_URL="$(url)" "$@"
    code=$?
    [ "$was" = 1 ] || stop
    exit $code ;;
  *) echo "usage: $0 run <command…> | start | stop | status | url" >&2; exit 2 ;;
esac

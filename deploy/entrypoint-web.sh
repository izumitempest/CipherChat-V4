#!/bin/sh
# The web container. The schema belongs to the migrations now: the
# migrate service (see Dockerfile.web's "migrate" stage) backs the
# database up, applies the pending migrations and exits before this
# container starts. There is no schema template to copy any more, and
# nothing here may touch the database file.
set -eu
exec "$@"

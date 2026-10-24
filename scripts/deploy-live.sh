#!/bin/sh
set -eu

: "${WILDCARE_SSH_KEY:?Set WILDCARE_SSH_KEY to the SSH private-key path.}"
WILDCARE_SSH_TARGET="${WILDCARE_SSH_TARGET:-root@154.223.66.180}"
WILDCARE_REMOTE_DIR="${WILDCARE_REMOTE_DIR:-/srv/wildcare/app}"

echo "Running the required deployment gate…"
npm test

echo "Tests passed. Deploying the public frontend…"
scp -i "$WILDCARE_SSH_KEY" app.js index.html styles.css "$WILDCARE_SSH_TARGET:$WILDCARE_REMOTE_DIR/"
echo "Live deployment complete."

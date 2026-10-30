#!/bin/sh
set -eu

: "${WILDCARE_SSH_KEY:?Set WILDCARE_SSH_KEY to the SSH private-key path.}"
WILDCARE_SSH_TARGET="${WILDCARE_SSH_TARGET:-root@154.223.66.180}"
WILDCARE_REMOTE_DIR="${WILDCARE_REMOTE_DIR:-/srv/wildcare/app}"

echo "Running the required deployment gate…"
npm test

echo "Tests passed. Backing up the current public frontend…"
ssh -i "$WILDCARE_SSH_KEY" "$WILDCARE_SSH_TARGET" \
  "cp '$WILDCARE_REMOTE_DIR/app.js' '$WILDCARE_REMOTE_DIR/app.js.pre-deploy' && cp '$WILDCARE_REMOTE_DIR/index.html' '$WILDCARE_REMOTE_DIR/index.html.pre-deploy' && cp '$WILDCARE_REMOTE_DIR/styles.css' '$WILDCARE_REMOTE_DIR/styles.css.pre-deploy' && cp '$WILDCARE_REMOTE_DIR/server/src/server.js' '$WILDCARE_REMOTE_DIR/server/src/server.js.pre-deploy' && mkdir -p '$WILDCARE_REMOTE_DIR/dev'"

echo "Deploying the public frontend…"
scp -i "$WILDCARE_SSH_KEY" app.js index.html styles.css "$WILDCARE_SSH_TARGET:$WILDCARE_REMOTE_DIR/"
scp -i "$WILDCARE_SSH_KEY" dev/index.html dev/dev.css dev/dev.js "$WILDCARE_SSH_TARGET:$WILDCARE_REMOTE_DIR/dev/"
scp -i "$WILDCARE_SSH_KEY" server/src/server.js "$WILDCARE_SSH_TARGET:$WILDCARE_REMOTE_DIR/server/src/"
ssh -i "$WILDCARE_SSH_KEY" "$WILDCARE_SSH_TARGET" \
  "cd '$WILDCARE_REMOTE_DIR' && docker compose up -d --build api"

echo "Testing the deployed server…"
api_ready=false
for attempt in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
  if curl --fail --silent "https://wildcare.liuzimo.cn/api/health" >/dev/null; then
    api_ready=true
    break
  fi
  sleep 1
done
if [ "$api_ready" = true ] \
  && PLAYWRIGHT_BASE_URL="https://wildcare.liuzimo.cn" npm run test:live; then
  echo "Live deployment verified."
else
  echo "Post-deployment tests failed. Restoring the previous frontend…" >&2
  ssh -i "$WILDCARE_SSH_KEY" "$WILDCARE_SSH_TARGET" \
    "cp '$WILDCARE_REMOTE_DIR/app.js.pre-deploy' '$WILDCARE_REMOTE_DIR/app.js' && cp '$WILDCARE_REMOTE_DIR/index.html.pre-deploy' '$WILDCARE_REMOTE_DIR/index.html' && cp '$WILDCARE_REMOTE_DIR/styles.css.pre-deploy' '$WILDCARE_REMOTE_DIR/styles.css' && cp '$WILDCARE_REMOTE_DIR/server/src/server.js.pre-deploy' '$WILDCARE_REMOTE_DIR/server/src/server.js' && cd '$WILDCARE_REMOTE_DIR' && docker compose up -d --build api"
  echo "Previous frontend restored. Deployment failed." >&2
  exit 1
fi

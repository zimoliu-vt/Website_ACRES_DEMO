# WildCare SG demo

A front-end demonstration of a Singapore wildlife reporting and rescue-coordination experience.

## What the demo includes

- A clickable Singapore map powered by Leaflet and OpenStreetMap
- Friendly street or landmark labels from an on-demand OpenStreetMap reverse lookup
- Submit-based Singapore-only location search with cached results
- A public wildlife report form
- A Rescue Team Portal with filters and report details
- A separate rescue team login screen using demo PIN `0000`
- Case status updates from New through Resolved
- Shared PostgreSQL storage and resettable sample reports
- Volunteer sign-up and sign-in with salted scrypt password hashes and expiring account tokens
- A containerized Node.js API with server-side demo worker authentication
- Responsive layouts for desktop and mobile

Reports are stored in the project's private demo database so multiple browsers can share the same simulated case queue. There is no real rescue-team connection, dispatch process, or emergency monitoring in this version.

Volunteer passwords are sent only over HTTPS and are never stored as plaintext. The API stores a unique salt and scrypt hash for each password; browser storage contains an expiring sign-in token rather than the password.

The public OpenStreetMap Nominatim service is queried only after a user selects a location or explicitly submits a search, with browser caching and no autocomplete. Searches and selectable map points are limited to Singapore. This demo must remain low-volume and follow the [Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/). A production deployment should use a dedicated geocoding provider or proxy.

## Run locally

Serve the folder with any static web server. For example:

```sh
python3 -m http.server 4173
```

Then open `http://localhost:4173`.

## Run the backend

Copy `.env.example` to `.env`, replace both generated-secret placeholders, then run:

```sh
docker compose up --build
```

The API listens on `127.0.0.1:3000`. In deployment, Nginx serves the frontend and forwards `/api/` to that private port. PostgreSQL is available only inside the Docker network.

## Publish with GitHub Pages

1. Create an empty GitHub repository.
2. Push this folder to the repository's `main` branch.
3. In the repository, open **Settings → Pages**.
4. Under **Build and deployment**, choose **GitHub Actions**.

The included workflow will deploy the site whenever `main` is updated.

## Deployment tests

Every push to `main` runs the Playwright browser tests before the GitHub Pages deployment. The deploy job depends on the test job, so any failed required test stops deployment. Failure artifacts include the Playwright HTML report, screenshots, and traces when available.

Run the same required gate locally with:

```sh
npm ci
npx playwright install chromium
npm test
```

The live JEV image check is separate because it uses API credits. Supply a local animal image when you intentionally want to run it:

```sh
JEV_TEST_IMAGE=/absolute/path/to/animal.jpg npm run test:jev
```

For the VPS-hosted demo, use the guarded deployment script. It tests before upload, backs up the current frontend, tests the deployed server and live API, and restores the backup if a post-deployment check fails:

```sh
WILDCARE_SSH_KEY=~/.ssh/id_ed25519 ./scripts/deploy-live.sh
```

## Future production path

This remains a demo. Before accepting real reports, add verified user accounts, role-based access controls, dedicated object storage, retention policies, abuse prevention, monitoring, notifications, and an operational rescue-team workflow.

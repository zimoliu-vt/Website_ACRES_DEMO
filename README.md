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
- Browser-local storage and resettable sample reports
- Responsive layouts for desktop and mobile

No report leaves the browser. There is no production database, user account system, or real rescue-team connection in this version.

The public OpenStreetMap Nominatim service is queried only after a user selects a location or explicitly submits a search, with browser caching and no autocomplete. Searches and selectable map points are limited to Singapore. This demo must remain low-volume and follow the [Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/). A production deployment should use a dedicated geocoding provider or proxy.

## Run locally

Serve the folder with any static web server. For example:

```sh
python3 -m http.server 4173
```

Then open `http://localhost:4173`.

## Publish with GitHub Pages

1. Create an empty GitHub repository.
2. Push this folder to the repository's `main` branch.
3. In the repository, open **Settings → Pages**.
4. Under **Build and deployment**, choose **GitHub Actions**.

The included workflow will deploy the site whenever `main` is updated.

## Future production path

For a real deployment, replace browser storage with a backend such as Supabase. That would provide a shared reports database, image storage, worker authentication, access rules, and real-time dashboard updates.

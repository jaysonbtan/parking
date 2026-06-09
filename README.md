# Vancouver Parking Finder

Mobile-first web app to find the cheapest metered street parking near you in Vancouver, BC.

## Features

- Search by address or intersection
- Share your device's GPS location
- Lists all in-service parking meters within 1 km, sorted by current rate
- Shows PayByPhone code, day/evening rates, meter ID, and distance

## Data

Uses the [City of Vancouver parking-meters dataset](https://opendata.vancouver.ca/explore/dataset/parking-meters/) via the [Explore API v2.1](https://help.opendatasoft.com/apis/ods-explore-v2/explore_v2.1.html).

## Development

```bash
npm install
npm run dev
```

Open http://localhost:5173

## Build

```bash
npm run build
npm run preview
```

Open http://localhost:4173/parking/ to preview the production build locally.

## Street names

Street names use [Nominatim](https://nominatim.org/) with [Photon](https://photon.komoot.io/) as fallback (OpenStreetMap data). They load automatically, top results first (~1 lookup/sec).

## Deploy

Hosted at **https://jaysonbtan.github.io/parking/** via GitHub Pages. Pushes to `main` trigger the deploy workflow automatically.

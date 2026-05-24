# Dean's MSFS Route Finder

A Windows desktop app for Microsoft Flight Simulator 2024.

Scans your 3rd-party scenery folder, detects installed airports, and finds real scheduled airline routes between them using AirLabs live data.

## Aircraft
- Fenix A319 / A320 / A321
- PMDG 737-800

## Features
- Scans your scenery library to detect installed airports
- Live route data via AirLabs API (free, no credit card)
- Real airline, flight number, operating days, block time
- Live METAR + wind-based runway recommendation on expanded routes
- Challenging Approaches tab with 20 famous approaches, departure selector, flight time filter
- SimBrief, FlightAware, SkyVector integration

## Setup
1. Download and extract to a folder on your PC
2. Run `npm install` once in the folder
3. Run `start.bat` to launch
4. Sign up at [airlabs.co](https://airlabs.co) (free, email only) and paste your API key in the Routes tab

## Updating
Double-click `update.bat` to download the latest version automatically.

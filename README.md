bmd-scanner Demo
===================

# Overview

This is a node application that scans for the Kontakt.io, Ruuvi, BLE, standard BT beacons and pushes the reports to an HTTP/S POST endpoint.

# Requirements

- nodejs 7.x+
- npm
- BlueZ
- cascade 500

# snap-bmd-scanner/snapcraft.yaml file

- The user will need to rename the name in line 1 to their preferred name ex.`xyz-bmd-scanner`
- On line 2, the user can declare their preferred version ex.`0.1`
- On line 12 `command`, the URL is fictitious `https://xyz.com/feed`. The user will need to replace the fictitious URL with their own API POST HTTP/S URL "Endpoint" before they build their Snap.


# Installation

## `install.sh` for Cascade

`install.sh` will:
- install dependencies for `scanner.js` with `npm install`
- remove `node-red` from startup (only on Vesta)
- add `scanner.js` to startup in `/usr/rigado/scripts/rig_init.sh` (only on Vesta)



Usage:
- `$ ./install.sh`
- `$ reboot`

# Usage

`$ node scanner.js --publishInterval [seconds] --url https://server.com/path/to/whatever --method ['POST','PUT']`
- `--publishInterval` is optional, default is 15 seconds
- `--url` is optional, default is http://xyz.com:8090, can use http/https
- `--method` is optional, default is 'POST'
- `--dumppublish` is optional, dumps published JSON
- `--dumpgps` is optional, dumps GPS state every 5s if GPS is present
- `--dumpadv` is optional, dumps every relevant advertisement as json as it is rx'd


## HTTP Output

Report data is a JSON object containing an array of seen tags and the current location (if unknown, "n/a"), and time in the body of the HTTP request, for example:

Note that `detectedAt` is epoch time in ms.

```json
{
  "tags": [
    {
      "macAddress": "e20200259f40",
      "rssi": -86,
      "beacon": {
        "mfgId": 76,
        "uuid": "f7826da64fa24e988024bc5b71e0893e",
        "major": 10481,
        "minor": 19562
      }
    },
    {
      "macAddress": "db58da58da66",
      "rssi": -82,
      "beacon": {
        "mfgId": 76,
        "uuid": "f7826da64fa24e988024bc5b71e0893e",
        "major": 34137,
        "minor": 6304
      }
    }
  ],
  "location": "44.89979833333334,-123.010835",
  "detectedAt": 1528934204085,
  "detectedBy": "C029020418-00390.rigadogateway.com"
}

```

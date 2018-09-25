"use strict"

var fs = require('fs')
var os = require('os')
var request = require('request')
var noble = require('noble')
var url = require('url')
var ruuvitag = require('./ruuvitag.js')

var SerialPort = require('serialport');
var Readline = require('@serialport/parser-readline')
var GPS = require('gps');

const argv = require('yargs').argv

//detectedAt
var hostname = os.hostname()

//publish url
var requestMethod = "POST"
var endpointUrl = url.parse("https://localhost/my/endpoint")

//timing
var publishIntervalMs = 30000
var startTick = 0

//filter
var enableKontakt = false
var enableRuuvi = false
var enableGlobalStar = false
var enableIBeacon = false
var enableBasicBLE = false

//debug
var dumpAdv = false
var dumpPublish = false
var dumpGPS = false

//gps
var enableGPS = false
var gps = null
var gpsSerialPath = "/dev/ttyUSB0"
const gpsSerialBaud = 4800

//report queue
var repTableOld = {};
var repTable = {};

//forces a checkin at startup.
var hasPublished = false
var publishAll = false

function timestamp() {
    //ms since start
    return Math.floor(Date.now() - startTick)
}

function showHelp() {
    console.log("\nusage: node scanner.js [options ...]")
    console.log("options:")
    console.log("\n")
    console.log("\t--url=[URL]\t\t\tSet endpoint url (default: %s)", endpointUrl.href)
    console.log("\t--publishInterval=[TIMEOUT]\tSet publish interval in seconds (default: %d), TIMEOUT>0", (publishIntervalMs / 1000))
    console.log("\t--method=[METHOD]\t\tHTTP request method (default: %s), METHOD=[PUT,POST]", requestMethod)
    console.log("\t--publishall\t\t\tPublish every interval")
    console.log("\t--kontakt\t\t\tScan/parse kontakt")
    console.log("\t--globalstar\t\t\tScan/parse globalstar")
    console.log("\t--ruuvi\t\t\t\tScan/parse ruuvi")
    console.log("\t--ibeacon\t\t\tScan/parse iBeacon, optionally specify a full UUID128 or a regex")
    console.log("\t--basicble\t\t\tScan/parse all BLE advertisements (basic)")
    console.log("\t--all\t\t\t\tScan/parse all available types")
    console.log("\t--gps\t\t\t\tEnable GPS tagging in report")
    console.log("\t--dumpadv\t\t\tDump advertisements")
    console.log("\t--dumppublish\t\t\tDump published json")
    console.log("\t--dumpgps\t\t\tDump gps data")
    console.log("\t-h\t\t\t\tShow help")
}

function startPublishTimer(interval_ms) {
    setInterval(publish, interval_ms);
}

function shouldPushTable(a, b) {
    //check that we have reports from the same mac addresses, the key values do not matter
    var aKeys = Object.keys(a).sort();
    var bKeys = Object.keys(b).sort();

    return JSON.stringify(aKeys) !== JSON.stringify(bKeys);
}

function publish() {

    if (publishAll ||
        !hasPublished ||
        repTableOld === null ||
        shouldPushTable(repTable, repTableOld)) {

        let report = {
            tags: Object.values(repTable),
            location: gpsPosition(),
            detectedAt: Date.now(),
            detectedBy: hostname
        };

        console.log("%d: publishing %d reports...", timestamp(), report.tags.length);
        httpPublish(report);

        if (dumpPublish) {
            console.log(JSON.stringify(report, null, 2))
        }

        //save the current state
        repTableOld = repTable;
    } else {
        console.log("%d: no change...", timestamp());
    }

    //empty the table
    repTable = {}
}

function httpPublish(object) {
    try {
        request({
            "method": requestMethod,
            "json": true,
            "url": endpointUrl,
            "body": object
        }, function (error, request, body) {
            if (error) {
                console.log("%d: httpPublish error: %s", timestamp(), error);

                //this will force a republish on the next interval
                repTableOld = null;
            } else {
                console.log("%d: httpPublish success: status %d, msg: '%s'", timestamp(), request.statusCode, JSON.stringify(body));
                hasPublished = true
            }
        });
    } catch (e) {
        console.log("%d: httpPublish error: %s", timestamp(), JSON.stringify(e));
    }
}

function putReport(rep, forceUpdate) {
    if (rep && rep.macAddress) {
        //this is a new report, add it to dictionary
        if (!repTable[rep.macAddress] || forceUpdate) {
            repTable[rep.macAddress] = rep;
        } else {
            //add any keys we are missing, update rssi/tick
            Object.keys(rep).forEach((k) => {
                if (!repTable[rep.macAddress][k] || k == 'detectedAt' || k == 'rssi') {
                    //console.log("%d: device %s, '%s'='%s'", timestamp(), rep.macAddress, k, rep[k])
                    repTable[rep.macAddress][k] = rep[k];
                }
            })
        }
    }
}


function parseGlobalStar(adv) {
    if (enableGlobalStar &&
        adv &&
        adv.uuid &&
        adv.rssi &&
        adv.advertisement &&
        adv.advertisement.manufacturerData &&
        adv.advertisement.localName) {

        let md = adv.advertisement.manufacturerData;

        if (md && md.length == 13) {
            let mfgId = md.readUIntLE(0, 2);

            //globalstar id
            if (mfgId == 0x0576) {
                let r = {
                    name: adv.advertisement.localName,
                    macAddress: adv.uuid,
                    manufacturerData: md,
                    rssi: adv.rssi,
                    detectedAt: Date.now(),
                    detectedBy: hostname,
                }

                return r;
            }
        }
    }

    return null;
}


function parseBeacon(manufacturerData) {
    var ret = undefined;

    // https://os.mbed.com/blog/entry/BLE-Beacons-URIBeacon-AltBeacons-iBeacon/
    if (manufacturerData && manufacturerData.length >= 25) {
        // mfgId is litte-endian, everything else is big-endian
        var mfgId = manufacturerData.readUInt16LE(0);
        //var beaconType = manufacturerData.readUInt8(2);
        var remainingLength = manufacturerData.readUInt8(3);

        //length check (beaconLength is the length of the remaining data)
        if (remainingLength == (manufacturerData.length - 4)) {
            var uuid = manufacturerData.slice(4, 20).toString('hex');
            var major = manufacturerData.readUInt16BE(20);
            var minor = manufacturerData.readUInt16BE(22);

            ret = {
                mfgId: mfgId,
                uuid: uuid,
                major: major,
                minor: minor
            };
        }
    }

    return ret;
}

function parseKontaktIO(adv) {
    if (enableKontakt &&
        adv &&
        adv.uuid &&
        adv.advertisement.manufacturerData) {

        let ib = parseBeacon(adv.advertisement.manufacturerData);

        //ibeacon with uuid "f7826da64fa24e988024bc5b71e0893e"
        if (ib &&
            ib.mfgId == 0x4c &&
            ib.uuid == "f7826da64fa24e988024bc5b71e0893e") {

            let o = {
                macAddress: adv.uuid,
                rssi: adv.rssi,
                beacon: ib
            };

            return o;
        }
    }
    return null;
}

function parseIBeacon(adv) {
    if (enableIBeacon &&
        adv &&
        adv.uuid &&
        adv.advertisement.manufacturerData) {

        let ib = parseBeacon(adv.advertisement.manufacturerData);

        if (ib &&
            (enableIBeacon === true ||
                ib.uuid.match(enableIBeacon))) {
            let o = {
                macAddress: adv.uuid,
                rssi: adv.rssi,
                beacon: ib
            };

            return o;
        }
    }
    return null;
}


function parseRuuvi(adv) {
    if (enableRuuvi &&
        adv &&
        adv.uuid) {
        let r = ruuvitag.parse(adv);

        if (r) {
            let o = {
                macAddress: adv.uuid,
                rssi: adv.rssi,
                ruuvi: r,
                detectedAt: Date.now(),
                detectedBy: hostname,
            };

            return o;
        }
    }

    return null;
}

function parseBasicBLE(adv) {
    if (enableBasicBLE &&
        adv &&
        adv.uuid &&
        adv.rssi) {

        let r = {
            macAddress: adv.uuid,
            rssi: adv.rssi,
            detectedAt: Date.now(),
            detectedBy: hostname,
        }

        //attach additional fields, if present
        if (adv.advertisement) {
            if (adv.advertisement.localName) {
                r.name = adv.advertisement.localName;
            }

            if (adv.advertisement.manufacturerData) {
                r.manufacturerData = adv.advertisement.manufacturerData
            }
        }

        return r;
    }

    return null;
}

function parseAdv(peripheral) {

    let o = null;

    //specific ibeacon
    o = parseKontaktIO(peripheral)
    if (o) {
        return o
    }

    //general ibeacon
    o = parseIBeacon(peripheral)
    if (o) {
        return o
    }

    //adv with mfgdata w/mfgid
    o = parseGlobalStar(peripheral)
    if (o) {
        return o
    }

    //adv with mfgdata w/mfgid
    o = parseRuuvi(peripheral)
    if (o) {
        return o
    }

    //last chance to parse here
    o = parseBasicBLE(peripheral)
    if (o) {
        return o
    }

    //nothing worked
    return null
}


function nobleInit() {
    noble.on('stateChange', function (state) {
        if (state === 'poweredOn') {
            //allow duplicates
            noble.startScanning([], true);
        } else {
            noble.stopScanning();
            console.log("nobleState => '%s', exiting", state)
            process.exit(1)
        }
    });

    noble.on('discover', function (peripheral) {

        let o = parseAdv(peripheral)

        //queue the report
        if (o) {

            //force the update for ruuvi tags since it is sensor data
            let forceUpdate = !!o.ruuvi;
            putReport(o, forceUpdate)

            //dump the json?
            if (dumpAdv) {
                console.log(JSON.stringify(o, null, 2));
            }
        }
    });
}

function parseArgs() {
    //help
    if (argv.help || argv.h) {
        showHelp();
        process.exit(0)
    }

    //publish timeout
    if (argv.publishInterval) {
        if (argv.publishInterval > 0) {
            publishIntervalMs = argv.publishInterval * 1000
        } else {
            console.log("publishInterval must be > 0");
            process.exit(1)
        }
    }
    console.log("publishIntervalMs: %d", publishIntervalMs);

    //url
    try {
        if (argv.url) {
            endpointUrl = url.parse(argv.url)
        }
    } catch (e) {
        console.log("url error: " + e)
        process.exit(1)
    }
    console.log("publishUrl: " + endpointUrl.href)

    if (argv.method) {
        if (argv.method == "PUT" || argv.method == "POST") {
            requestMethod = argv.method;
        } else {
            console.log("invalid method '%s'", argv.method)
        }
    }

    console.log("httpRequestMethod: %s", requestMethod)

    if (argv.dumpadv === true) {
        dumpAdv = true;
        console.log("dump beacon json: %s", dumpAdv);
    }

    if (argv.dumppublish === true) {
        dumpPublish = true;
        console.log("dump published json: %s", dumpPublish);
    }

    if (argv.gps) {
        enableGPS = true

        if (typeof argv.gps == "string") {
            gpsSerialPath = argv.gps
        }
    }

    if (argv.dumpgps === true) {
        dumpGPS = true;
        console.log("dump GPS data: %s", dumpGPS);
    }

    if (argv.publishall === true) {
        publishAll = true;
        console.log("publish every interval: %s", publishAll);
    }

    if (argv.all === true) {
        enableKontakt = true;
        enableGlobalStar = true;
        enableRuuvi = true;
        enableIBeacon = true;
        enableBasicBLE = true
    } else {

        if (argv.kontakt === true) {
            enableKontakt = true;
        }

        if (argv.globalstar === true) {
            enableGlobalStar = true;
        }

        if (argv.ruuvi === true) {
            enableRuuvi = true;
        }

        if (argv.ibeacon === true) {
            enableIBeacon = true
        } else {
            var type = typeof argv.ibeacon
            if (type == "number" || type == "string") {
                var str = argv.ibeacon.toString()

                //match a whole uuid
                if (str.match(/[0-9A-Fa-f]{32}/g)) {
                    enableIBeacon = str
                } else {
                    //assume it is a regex, cant seem to ctach the error in the constructor here
                    enableIBeacon = new RegExp(str, "g")
                }
            }
        }

        if (argv.basicble === true) {
            enableBasicBLE = true
        }
    }

    if (!enableKontakt && !enableGlobalStar && !enableRuuvi && !enableIBeacon && !enableBasicBLE) {
        console.log("error: no tags enabled!")
        process.exit(1)
    } else {
        console.log("BLE Types:")
        console.log("\tkontakt: " + enableKontakt)
        console.log("\tglobalstar: " + enableGlobalStar)
        console.log("\truuvi: " + enableRuuvi)
        console.log("\tibeacon: " + enableIBeacon)
        console.log("\tbasicble: " + enableBasicBLE)
    }
}


function gpsInit() {

    if (enableGPS) {
        if (fs.existsSync(gpsSerialPath)) {
            var port = new SerialPort(gpsSerialPath, {
                baudRate: gpsSerialBaud,
            }, function (err) {
                if (err) {
                    console.log("GPS init error: %s", err);
                } else {
                    console.log("GPS connected: %s, %s", gpsSerialPath, gpsSerialBaud);

                    //gps object
                    gps = new GPS;

                    //attach event handlers
                    gps.on('data', function (data) {
                        //posn filtering?
                    });

                    const parser = port.pipe(new Readline({ delimiter: '\r\n' }))
                    parser.on('data', function (data) {
                        gps.update(data);
                    });

                    if (dumpGPS) {
                        setInterval(() => {
                            console.log("gps_state: " + JSON.stringify(gps.state, null, 2))
                        }, 5000)
                    }
                }
            });
        } else {
            console.log("GPS disabled, %s not found", gpsSerialPath)
        }
    }
}

function gpsPosition() {
    let posnString = undefined

    if (enableGPS) {
        if (gps) {
            if (gps.state && gps.state.fix) {
                posnString = gps.state.lat + "," + gps.state.lon
            } else {
                posnString = "searching"
            }
        } else {
            posnString = "n/a"
        }
    }

    return posnString
}

//save the start time
startTick = Date.now();

parseArgs();

//start gps
gpsInit();

//remove this when done debugging, this allows self-signed certs for https
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
if (process.env.NODE_TLS_REJECT_UNAUTHORIZED == 0) {
    console.log("\nWARNING: allowing self-signed certificates, 'process.env.NODE_TLS_REJECT_UNAUTHORIZED = 0'")
}

nobleInit();
startPublishTimer(publishIntervalMs);
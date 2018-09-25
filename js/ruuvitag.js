"use strict";

module.exports.parse = function(msg) {
    //eddystone?
    let ruuvi = parseRuuviEddystone(msg.advertisement);

    //ruuvi high-precision?
    if (!ruuvi) {
        ruuvi = parseRuuviHighPrecision(msg.advertisement)
    }

    return ruuvi;
}

function parseRuuviHighPrecision(adv) {
    let obj = null;

    //look in manufacturer data
    if (adv &&
        adv.manufacturerData) {

        let manufacturerDataString = adv.manufacturerData.toString('hex');
        let formatStart = 4;
        let formatEnd = 6;
        let formatRAW = "03";
        let dataFormat = manufacturerDataString.substring(formatStart, formatEnd);

        if (dataFormat == formatRAW) {
            obj = parseRawRuuvi(manufacturerDataString);
        }
    }

    return obj;
}

//https://github.com/ruuvi/ruuvi-sensor-protocols
function parseRawRuuvi(manufacturerDataString) {
    let humidityStart = 6;
    let humidityEnd = 8;
    let temperatureStart = 8;
    let temperatureEnd = 12;
    let pressureStart = 12;
    let pressureEnd = 16;
    let accelerationXStart = 16;
    let accelerationXEnd = 20;
    let accelerationYStart = 20;
    let accelerationYEnd = 24;
    let accelerationZStart = 24;
    let accelerationZEnd = 28;
    let batteryStart = 28;
    let batteryEnd = 32;

    let robject = {};

    let humidity = manufacturerDataString.substring(humidityStart, humidityEnd);
    //console.log(humidity);
    humidity = parseInt(humidity, 16);
    humidity /= 2; //scale
    robject.humidity = humidity;

    let temperatureString = manufacturerDataString.substring(temperatureStart, temperatureEnd);
    let temperature = parseInt(temperatureString.substring(0, 2), 16); //Full degrees
    temperature += parseInt(temperatureString.substring(2, 4), 16) / 100; //Decimals
    if (temperature > 128) { // Ruuvi format, sign bit + value
        temperature = temperature - 128;
        temperature = 0 - temperature;
    }
    robject.temperature = +temperature.toFixed(2); // Round to 2 decimals, format as a number

    let pressure = parseInt(manufacturerDataString.substring(pressureStart, pressureEnd), 16); // uint16_t pascals
    pressure += 50000; //Ruuvi format
    robject.pressure = pressure;

    let accelerationX = parseInt(manufacturerDataString.substring(accelerationXStart, accelerationXEnd), 16); // milli-g
    if (accelerationX > 32767) {
        accelerationX -= 65536;
    } //two's complement

    let accelerationY = parseInt(manufacturerDataString.substring(accelerationYStart, accelerationYEnd), 16); // milli-g
    if (accelerationY > 32767) {
        accelerationY -= 65536;
    } //two's complement

    let accelerationZ = parseInt(manufacturerDataString.substring(accelerationZStart, accelerationZEnd), 16); // milli-g
    if (accelerationZ > 32767) {
        accelerationZ -= 65536;
    } //two's complement

    robject.accelerationX = accelerationX;
    robject.accelerationY = accelerationY;
    robject.accelerationZ = accelerationZ;

    let battery = parseInt(manufacturerDataString.substring(batteryStart, batteryEnd), 16); // milli-g
    robject.battery = battery;

    robject.dataFormat = 3

    return robject;
}

//
// eddystone constants 
// see https://github.com/google/eddystone/tree/master/eddystone-url

const eddystone_svc_uuid = "feaa"
const eddystone_frame_url = 0x10

//url schemes
const eddystone_frame_url_schemes =
    [
        "http://www.", //0x00
        "https://www.", //0x01
        "http://", //0x02
        "https://", //0x03
    ];

//character substitutions (0x0-0x0d, 0xe-0x20, 0x7f-0x20 )
const eddystone_frame_url_encoding =
    [
        ".com/", //0x00
        ".org/", //0x01
        ".edu/",
        ".net/",
        ".info/",
        ".biz/",
        ".gov/",
        ".com",
        ".org",
        ".edu",
        ".net",
        ".info",
        ".biz",
        ".gov", //0x0d
    ];

function parseEddystoneURLFrame(frame) {
    let obj = null;

    if (frame &&
        frame.length >= 4 &&
        frame[0] == eddystone_frame_url &&
        frame[2] < eddystone_frame_url_schemes.length) {

        obj = {}

        let url = eddystone_frame_url_schemes[frame[2]];

        frame.slice(3).forEach((char) => {
            //reserved, perform susbtitution
            if (char < eddystone_frame_url_encoding.length) {
                url += eddystone_frame_url_encoding[char];
            }
            // reserved but unimplemented
            else if (char <= 0x20 || char >= 0x7f) {
                //do nothing
            } else {
                url += String.fromCharCode(char);
            }
        })

        obj.txPower = frame[1];
        obj.url = url
    }

    return obj
}


const ruuvi_eddystone_base = "https://ruu.vi/#"
const ruuvi_format_eddystone = 0x04

function parseRuuviEddystone(adv) {
    let obj = null;

    //eddystone advertisement?
    if (adv &&
        adv.serviceUuids &&
        adv.serviceUuids.includes(eddystone_svc_uuid) &&
        adv.serviceData &&
        adv.serviceData[0].uuid &&
        adv.serviceData[0].uuid == eddystone_svc_uuid &&
        adv.serviceData[0].data) {

        let url = parseEddystoneURLFrame(adv.serviceData[0].data);

        //eddystone url?
        if (url && url.url) {

            //ruuvi url?
            if (url.url.startsWith(ruuvi_eddystone_base)) {

                //trim
                let base64str = url.url.replace(ruuvi_eddystone_base, "")

                //parse b64
                let bytes = Buffer.from(base64str, "base64")

                //parse fields
                if (bytes.length == 6 &&
                    bytes[0] == ruuvi_format_eddystone) {

                    let humidity = bytes[1] * 0.5
                    let temperature = bytes[2] + (bytes[3] / 100)
                    let pressure = bytes.readUInt16BE(4) + 50000

                    //temp sign check
                    if (temperature > 128) {
                        temperature -= 128
                        temperature *= -1
                    }

                    //assign
                    obj = {
                        humidity: humidity,
                        temperature: temperature,
                        pressure: pressure,
                        dataFormat: ruuvi_format_eddystone
                    };
                }
            }
        }
    }

    return obj
}

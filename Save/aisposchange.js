// ais_type1_generate.js
// Generiert einen gültigen AIS Type 1 NMEA Satz mit Lat/Lon

const MMSI = 477553000;
const LAT = 51.73784;
const LON = 3.85013;

const navStatus = 5;   // Moored
const rot = 128;       // Not turning
const sog = 0;         // Speed over ground (0.1 knots)
const posAcc = 0;      // Position Accuracy
const cog = 51;        // Course over ground
const heading = 181;   // True heading
const timestamp = 15;  // Seconds UTC
const maneuver = 0;
const raim = 0;

// Hilfsfunktionen
function toTwosComplement(value, bits) {
    if (value < 0) value = (1 << bits) + value;
    return value;
}

function encode6bit(val) {
    if (val < 0 || val > 63) throw new Error("6-bit out of range");
    if (val <= 39) return String.fromCharCode(val + 48);
    return String.fromCharCode(val + 56);
}

function bitsToPayload(bits) {
    let payload = '';
    for (let i = 0; i < bits.length; i += 6) {
        let chunk = bits.substr(i, 6).padEnd(6, '0');
        let val = parseInt(chunk, 2);
        payload += encode6bit(val);
    }
    return payload;
}

function calculateChecksum(nmea) {
    let cs = 0;
    for (let i = 1; i < nmea.length; i++) cs ^= nmea.charCodeAt(i);
    return cs.toString(16).toUpperCase().padStart(2, '0');
}

// Berechne Lat/Lon in 1/10000 Minuten
const lon = Math.round(LON * 600000);
const lat = Math.round(LAT * 600000);

// === Type 1 Message Aufbau ===
let bits = '';
bits += (1).toString(2).padStart(6, '0');        // Message Type
bits += (0).toString(2).padStart(2, '0');        // Repeat Indicator
bits += MMSI.toString(2).padStart(30, '0');      // MMSI
bits += navStatus.toString(2).padStart(4, '0');  // Navigation Status
bits += rot.toString(2).padStart(8, '0');        // ROT
bits += sog.toString(2).padStart(10, '0');       // SOG
bits += posAcc.toString(2);                      // Position Accuracy
bits += toTwosComplement(lon, 28).toString(2).padStart(28, '0'); // Longitude
bits += toTwosComplement(lat, 27).toString(2).padStart(27, '0'); // Latitude
bits += cog.toString(2).padStart(12, '0');       // Course Over Ground
bits += heading.toString(2).padStart(9, '0');    // True Heading
bits += timestamp.toString(2).padStart(6, '0');  // Timestamp
bits += maneuver.toString(2).padStart(2, '0');   // Maneuver Indicator
bits += '000';                                   // Spare
bits += raim.toString();                         // RAIM
bits += '0000000000000000000';                  // Radio Status 19 bits

// Konvertiere Bitstring in Payload
const payload = bitsToPayload(bits);

// NMEA Satz erstellen
const nmeaBody = `!AIVDM,1,1,,B,${payload},0`;
const checksum = calculateChecksum(nmeaBody);
const nmeaSentence = `${nmeaBody}*${checksum}`;

console.log("AIS Type 1 NMEA Sentence:");
console.log(nmeaSentence);

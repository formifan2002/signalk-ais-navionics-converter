class AISEncoder {
  static stateMap = {
        'motoring': 0, 'anchored': 1, 'not under command': 2, 'restricted maneuverability': 3,
        'constrained by draft': 4, 'moored': 5, 'aground': 6, 'fishing': 7,
        'sailing': 8, 'hazardous material high speed': 9, 'hazardous material wing in ground': 10,
        'power-driven vessel towing astern': 11, 'power-driven vessel pushing ahead': 12,
        'reserved': 13, 'ais-sart': 14, 'undefined': 15
  };

  static encode6bit(val) {
    if (val < 0 || val > 63) throw new Error("6-bit out of range: " + val);
    return val <= 39 ? String.fromCharCode(val + 48) : String.fromCharCode(val + 56);
  }

  static toTwosComplement(value, bits) {
    if (value < 0) value = (1 << bits) + value;
    return value;
  }

  static textToSixBit(str, length) {
    const table = '@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_ !"#$%&\'()*+,-./0123456789:;<=>?';
    let bits = '';
    str = str || '';
    for (let i = 0; i < length; i++) {
      let c = i < str.length ? str[i].toUpperCase() : '@';
      let idx = table.indexOf(c);
      if (idx < 0) idx = 0;
      bits += idx.toString(2).padStart(6, '0');
    }
    return bits;
  }

  static callsignToSixBit(callsign) {
    callsign = (callsign || '').trim().toUpperCase();
    const padded = callsign.padEnd(7, '@').substring(0, 7);
    return this.textToSixBit(padded, 7);
  }

  static bitsToPayload(bits) {
    let payload = '';
    while (bits.length % 6 !== 0) {
      bits += '0';
    }
    
    for (let i = 0; i < bits.length; i += 6) {
      let chunk = bits.substring(i, i + 6);
      let val = parseInt(chunk, 2);
      payload += this.encode6bit(val);
    }
    return payload;
  }

  static calculateChecksum(nmea) {
    let cs = 0;
    for (let i = 1; i < nmea.length; i++) cs ^= nmea.charCodeAt(i);
    return cs.toString(16).toUpperCase().padStart(2, '0');
  }

   static parseETAToUTC(etaString) {
    if (!etaString) return null;

    // Ungültige Platzhalter abfangen
    if (
      etaString.startsWith("00-00") ||
      etaString.startsWith("0000-00-00")
    ) {
      return null;
    }

    // 1️⃣ Vollständiges ISO-8601
    if (/^\d{4}-\d{2}-\d{2}T/.test(etaString)) {
      const d = new Date(etaString);
      return isNaN(d) ? null : d;
    }

    // 2️⃣ AIS-Kurzformat: MM-DDTHH:mmZ
    const m = etaString.match(/^(\d{2})-(\d{2})T(\d{2}):(\d{2})Z$/);
    if (m) {
      const [, month, day, hour, minute] = m.map(Number);

      const now = new Date();
      let year = now.getUTCFullYear();

      let candidate = new Date(Date.UTC(year, month - 1, day, hour, minute));

      // ETA ist immer zukünftig → ggf. nächstes Jahr
      if (candidate < now) {
        candidate = new Date(Date.UTC(year + 1, month - 1, day, hour, minute));
      }

      return candidate;
    }

    return null;
  }

static encodeNameTo6bit(name) {
  // Offizielle AIS 6-Bit Tabelle nach ITU-R M.1371:
  // 0=@, 1=A, ... 26=Z, 27=[, 28=\, 29=], 30=^, 31=_,
  // 32=Space, 33=!, 34=", ..., 48-57=0-9, 63=?
  const AIS_CHARS = "@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_ !\"#$%&'()*+,-./0123456789:;<=>?";

  let n = (name || "").toUpperCase().slice(0, 20).padEnd(20, " ");

  let bits = "";
  for (let i = 0; i < n.length; i++) {
    const ch = n[i];
    let idx = AIS_CHARS.indexOf(ch);
    if (idx < 0) idx = 32; // unbekannt → Space (nicht '@')
    bits += idx.toString(2).padStart(6, "0");
  }
  return bits; // 20 * 6 = 120 Bit
}


  
  static createPositionReportType1(vessel, config) {
    // Type 1 - Position Report Class A
    try {
      const mmsi = parseInt(vessel.mmsi);
      if (!mmsi || mmsi === 0) return null;

      const nav = vessel.navigation || {};
      const pos = nav.position?.value || nav.position || {};
      const latitude = pos.latitude;
      const longitude = pos.longitude;
      if (latitude === undefined || longitude === undefined) return null;

      const state = nav.state?.value || '';
      let navStatus = 15;
      if (state && AISEncoder.stateMap[state] !== undefined) navStatus = AISEncoder.stateMap[state];

      // const timestamp = 60;
      const isoTime = pos.timestamp;
      let timestamp = 60; // default "not available"
      if (isoTime) {
        const date = new Date(isoTime);
        const ageMs = Date.now() - date.getTime();
        if (ageMs <= 60000) {
          // nur wenn die Meldung jünger als 60 Sekunden ist
          timestamp = date.getUTCSeconds(); // 0–59
        }
      }
      const raim = 0;
      const maneuver = 0;
      
      const rateOfTurn = nav.rateOfTurn?.value || 0;
      let rot = -128;
      if (rateOfTurn !== 0) {
        rot = Math.round(rateOfTurn * 4.733 * Math.sqrt(Math.abs(rateOfTurn)));
        rot = Math.max(-126, Math.min(126, rot));
      }
      
      const sog = nav.speedOverGround?.value || nav.speedOverGround || 0;
      const cog = nav.courseOverGroundTrue?.value || nav.courseOverGroundTrue || 0;
      const heading = nav.headingTrue?.value || nav.headingTrue || 0;

      let sogValue = typeof sog === 'number' ? sog : 0;
      if (sogValue < config.minAlarmSOG) sogValue = 0;

      const cogValue = typeof cog === 'object' ? 0 : (typeof cog === 'number' ? cog : 0);
      const headingValue = typeof heading === 'object' ? 0 : (typeof heading === 'number' ? heading : 0);

      const lon = Math.round(longitude * 600000);
      const lat = Math.round(latitude * 600000);
      
      const sogKnots = sogValue * 1.94384;
      const sog10 = Math.round(sogKnots * 10);
      
      const cogDegrees = cogValue * 180 / Math.PI;
      let cog10;
      if (sogKnots < config.minAlarmSOG) {
        cog10 = 0; // or 3600 to indicate not available
      } else {
        cog10 = Math.round(cogDegrees * 10);
      }
      
      const headingDegrees = headingValue * 180 / Math.PI;
      const headingInt = Math.round(headingDegrees);

      let bits = '';
      bits += (1).toString(2).padStart(6, '0');
      bits += (0).toString(2).padStart(2, '0');
      bits += mmsi.toString(2).padStart(30, '0');
      bits += navStatus.toString(2).padStart(4, '0');
      bits += this.toTwosComplement(rot, 8).toString(2).padStart(8, '0');
      bits += sog10.toString(2).padStart(10, '0');
      bits += '0';
      bits += this.toTwosComplement(lon, 28).toString(2).padStart(28, '0');
      bits += this.toTwosComplement(lat, 27).toString(2).padStart(27, '0');
      bits += cog10.toString(2).padStart(12, '0');
      bits += headingInt.toString(2).padStart(9, '0');
      bits += timestamp.toString(2).padStart(6, '0');
      bits += maneuver.toString(2).padStart(2, '0');
      bits += '000';
      bits += raim.toString();
      bits += '0000000000000000000';

      return this.bitsToPayload(bits);
    } catch (error) {
      console.error('Error creating position report:', error);
      return null;
    }
  }

  static createPositionReportType19(vessel, config) {
    // Type 19 - Extended Class B Equipment Position Report
    try {
      const mmsi = parseInt(vessel.mmsi, 10);
      if (!mmsi || mmsi === 0) return null;

      const nav = vessel.navigation || {};
      const posObj = nav.position || {};
      const pos = posObj.value || posObj || {};
      const latitude = pos.latitude;
      const longitude = pos.longitude;
      if (typeof latitude !== "number" || typeof longitude !== "number") return null;

      // Zeitstempel (UTC-Sekunden, nur wenn Position <= 60s alt)
      const isoTime = posObj.timestamp || pos.timestamp;
      let timestamp = 60; // 60 = not available
      if (isoTime) {
        const date = new Date(isoTime);
        const ageMs = Date.now() - date.getTime();
        if (ageMs <= 60000) {
          timestamp = date.getUTCSeconds(); // 0–59
        }
      }

      // RAIM
      const raimFlag = 0; // 0 = RAIM not in use

      // --- ROT: Type 19 hat KEIN Rate-of-Turn-Feld ---
      // also: ROT wird NICHT kodiert

      // --- SOG ---
      let sogValue = 0;
      const sogField = nav.speedOverGround;
      if (sogField && typeof sogField.value === "number") {
        sogValue = sogField.value; // bei dir: m/s
        const units = sogField.meta?.units;
        if (units && units.toLowerCase().includes("kn")) {
          // falls du irgendwann knoten bekommst
          // sogValue bleibt dann in kn
        } else {
          // aktuell: m/s -> kn
          sogValue = sogValue * 1.94384;
        }
      }

      // Filter, wie du ihn verwendest
      if (sogValue < (config?.minAlarmSOG || 0)) {
        sogValue = 0;
      }

      let sog10; // 0.1 kn
      if (!Number.isFinite(sogValue) || sogValue < 0) {
        sog10 = 1023; // not available
      } else {
        sog10 = Math.round(sogValue * 10);
        if (sog10 > 1022) sog10 = 1022;
      }

      // --- COG ---
      let cogValue = 0;
      const cogField = nav.courseOverGroundTrue;
      if (typeof cogField === "number") {
        cogValue = cogField;
      } else if (cogField && typeof cogField.value === "number") {
        cogValue = cogField.value; // rad
      }

      let cog10 = 3600; // default: not available
      if (Number.isFinite(cogValue) && sog10 !== 1023 && sog10 > 0) {
        let cogDeg = cogValue * 180 / Math.PI;
        cogDeg = ((cogDeg % 360) + 360) % 360; // 0-<360
        cog10 = Math.round(cogDeg * 10);
        if (cog10 < 0) cog10 += 3600;
        if (cog10 > 3599) cog10 = 3599;
      }

      // --- Heading ---
      let headingValue = 0;
      const hdgField = nav.headingTrue;
      if (typeof hdgField === "number") {
        headingValue = hdgField;
      } else if (hdgField && typeof hdgField.value === "number") {
        headingValue = hdgField.value; // rad
      }

      let headingInt = 511; // 511 = not available
      if (Number.isFinite(headingValue)) {
        let hdgDeg = headingValue * 180 / Math.PI;
        hdgDeg = ((hdgDeg % 360) + 360) % 360;
        let h = Math.round(hdgDeg);
        if (h >= 0 && h <= 359) headingInt = h;
      }

      // --- Position in 1/10000 Minuten ---
      let lon = Math.round(longitude * 600000); // deg → 1/10000'
      let lat = Math.round(latitude * 600000);

      // Gültigkeitsbereiche (AIS spezifiziert):
      // Lon: -180..180 → -108000000..108000000
      // Lat: -90..90   → -54000000..54000000
      const lonUnavailable = (lon < -108000000 || lon > 108000000);
      const latUnavailable = (lat < -54000000 || lat > 54000000);
      if (lonUnavailable) lon = 0x6791AC0; // 181° * 600000 → not available (eigentlich: 0x6791AC0)
      if (latUnavailable) lat = 0x3412140; // 91° * 600000 → not available

      // --- Design / Dimensionen ---
      const design = vessel.design || {};
      const length = design.length?.value?.overall || 0;
      const beam = design.beam?.value || 0;

      const ais = vessel.sensors?.ais || {};
      const fromBow = ais.fromBow?.value || 0;
      const fromCenter = ais.fromCenter?.value || 0;

      const toBow = Math.max(0, Math.round(fromBow));
      const toStern = Math.max(0, Math.round(Math.max(0, length - fromBow)));
      const toPort = Math.max(0, Math.round(Math.max(0, beam / 2 - fromCenter)));
      const toStarboard = Math.max(0, Math.round(Math.max(0, beam / 2 + fromCenter)));

      // --- Ship type ---
      const shipType = design.aisShipType?.value?.id || 0;

      // --- EPFD ---
      let epfd = 0; // 0 = undefined
      const positionSource = posObj.$source || "";
      const srcLower = positionSource.toLowerCase();
      if (srcLower.includes("gps")) epfd = 1;
      else if (srcLower.includes("glonass")) epfd = 2;
      else if (srcLower.includes("galileo")) epfd = 3;

      // --- Name ---
      const name = vessel.name || "";
      const nameBits = this.encodeNameTo6bit(name); // 120 Bit

      // --- DTE & Assigned Mode ---
      const dte = 0;          // 0 = available
      const assignedMode = 0; // 0 = autonomous/continuous

      // --- Jetzt Bitstring exakt nach Type-19-Spezifikation aufbauen ---

      let bits = "";

      bits += (19).toString(2).padStart(6, "0");     // 01 Message ID
      bits += (0).toString(2).padStart(2, "0");      // 02 Repeat
      bits += mmsi.toString(2).padStart(30, "0");    // 03 MMSI

      bits += (0).toString(2).padStart(8, "0");      // 04 Reserved (8 Bit)

      bits += sog10.toString(2).padStart(10, "0");   // 05 SOG
      bits += "0";                                   // 06 Position Accuracy (0 = low)

      bits += this.toTwosComplement(lon, 28).toString(2).padStart(28, "0"); // 07 Longitude
      bits += this.toTwosComplement(lat, 27).toString(2).padStart(27, "0"); // 08 Latitude

      bits += cog10.toString(2).padStart(12, "0");  // 09 COG
      bits += headingInt.toString(2).padStart(9, "0"); // 10 True Heading
      bits += timestamp.toString(2).padStart(6, "0");  // 11 Timestamp

      bits += (0).toString(2).padStart(4, "0");     // 12 Reserved (Regional)

      bits += nameBits;                             // 13 Name (120 Bit)

      bits += shipType.toString(2).padStart(8, "0");  // 14 Ship Type

      bits += toBow.toString(2).padStart(9, "0");      // 15 A
      bits += toStern.toString(2).padStart(9, "0");    // 15 B
      bits += toPort.toString(2).padStart(6, "0");     // 15 C
      bits += toStarboard.toString(2).padStart(6, "0");// 15 D

      bits += epfd.toString(2).padStart(4, "0");    // 16 EPFD

      bits += (raimFlag ? "1" : "0");               // 17 RAIM
      bits += dte.toString(2).padStart(1, "0");     // 18 DTE
      bits += assignedMode.toString(2).padStart(1, "0"); // 18 Mode flag

      bits += (0).toString(2).padStart(4, "0");     // 19 Spare

      if (bits.length !== 312) {
        console.warn("AIS Type 19 bit length is not 312:", bits.length);
        return null;
      }

      return this.bitsToPayload(bits);
    } catch (err) {
      console.error("Error creating type 19:", err);
      return null;
    }
  }

  static createStaticVoyage(vessel) {
    try {
      const mmsi = parseInt(vessel.mmsi);
      if (!mmsi || mmsi === 0) return null;

      const design = vessel.design || {};
      const length = design.length?.value?.overall || 0;
      const beam = design.beam?.value || 0;
      const draft = design.draft?.value?.maximum || 0;
      const shipType = design.aisShipType?.value?.id || 0;
      
      // IMO-Nummer extrahieren - verschiedene mögliche Quellen
      let imo = 0;
      if (vessel.registrations?.imo) {
        // IMO aus registrations
        const imoStr = vessel.registrations.imo.toString().replace(/[^\d]/g, '');
        imo = parseInt(imoStr) || 0;
      } else if (vessel.imo) {
        // Direkt als vessel.imo
        const imoStr = vessel.imo.toString().replace(/[^\d]/g, '');
        imo = parseInt(imoStr) || 0;
      }
      
      const aisVersion = 0;
      
      const ais = vessel.sensors?.ais || {};
      const fromBow = ais.fromBow?.value || 0;
      const fromCenter = ais.fromCenter?.value || 0;
      
      const toBow = Math.round(fromBow);
      const toStern = Math.round(Math.max(0, length - fromBow));
      const toPort = Math.round(Math.max(0, beam / 2 - fromCenter));
      const toStarboard = Math.round(Math.max(0, beam / 2 + fromCenter));

      let epfd = 1;
      const positionSource = vessel.navigation?.position?.$source || '';
      if (positionSource.includes('gps')) epfd = 1;
      else if (positionSource.includes('gnss')) epfd = 1;
      else if (positionSource.includes('glonass')) epfd = 2;
      else if (positionSource.includes('galileo')) epfd = 3;

      const destination = vessel.navigation?.destination?.commonName?.value || '';
      const etaString =
        vessel.navigation?.courseGreatCircle?.activeRoute?.estimatedTimeOfArrival?.value ??
        vessel.navigation?.destination?.eta?.value ??
        '';

      let etaMonth = 0, etaDay = 0, etaHour = 24, etaMinute = 60;

      const etaDate = this.parseETAToUTC(etaString);

      if (etaDate) {
        etaMonth  = etaDate.getUTCMonth() + 1;
        etaDay    = etaDate.getUTCDate();
        etaHour   = etaDate.getUTCHours();
        etaMinute = etaDate.getUTCMinutes();
      }
      
      const draughtDecimeters = Math.round(draft * 10);
      const dte = 0;

      let bits = '';
      bits += (5).toString(2).padStart(6,'0');
      bits += (0).toString(2).padStart(2,'0');
      bits += mmsi.toString(2).padStart(30,'0');
      bits += aisVersion.toString(2).padStart(2,'0');
      bits += imo.toString(2).padStart(30,'0');
      bits += this.callsignToSixBit(vessel.callsign ?? '');
      bits += this.textToSixBit(vessel.name ?? '', 20);
      bits += shipType.toString(2).padStart(8,'0');
      bits += toBow.toString(2).padStart(9,'0');
      bits += toStern.toString(2).padStart(9,'0');
      bits += toPort.toString(2).padStart(6,'0');
      bits += toStarboard.toString(2).padStart(6,'0');
      bits += epfd.toString(2).padStart(4,'0');
      bits += etaMonth.toString(2).padStart(4,'0');
      bits += etaDay.toString(2).padStart(5,'0');
      bits += etaHour.toString(2).padStart(5,'0');
      bits += etaMinute.toString(2).padStart(6,'0');
      bits += draughtDecimeters.toString(2).padStart(8,'0');
      bits += this.textToSixBit(destination, 20);
      bits += dte.toString(2);
      bits += '0';
      return this.bitsToPayload(bits);
    } catch(err) {
      console.error('Error creating type5:', err);
      return null;
    }
  }

  static createStaticVoyageType24(vessel) {
  try {
    const mmsi = parseInt(vessel.mmsi);
    if (!mmsi || mmsi === 0) return null;

    const design = vessel.design || {};
    const length = design.length?.value?.overall || 0;
    const beam = design.beam?.value || 0;

    const ais = vessel.sensors?.ais || {};
    const fromBow = ais.fromBow?.value || 0;
    const fromCenter = ais.fromCenter?.value || 0;

    const toBow = Math.round(fromBow);
    const toStern = Math.round(Math.max(0, length - fromBow));
    const toPort = Math.round(Math.max(0, beam / 2 - fromCenter));
    const toStarboard = Math.round(Math.max(0, beam / 2 + fromCenter));

    const shipType = design.aisShipType?.value?.id || 0;

    //
    // -------------------------
    // PART A (Name)
    // -------------------------
    //
    let bitsA = "";
    bitsA += (24).toString(2).padStart(6, "0");  // type
    bitsA += (0).toString(2).padStart(2, "0");   // repeat
    bitsA += mmsi.toString(2).padStart(30, "0"); // mmsi
    bitsA += (0).toString(2).padStart(2, "0");   // part A

    // 20 six-bit chars = 120 bits
    bitsA += this.textToSixBit(vessel.name ?? "", 20);

    // Spare (optional, many devices omit it)
    bitsA = bitsA.padEnd(168, "0"); // valid length for Part A

    //
    // -------------------------
    // PART B (ShipType, Vendor, Callsign, Dimensions)
    // -------------------------
    //
    let bitsB = "";
    bitsB += (24).toString(2).padStart(6, "0");
    bitsB += (0).toString(2).padStart(2, "0");
    bitsB += mmsi.toString(2).padStart(30, "0");
    bitsB += (1).toString(2).padStart(2, "0"); // part B

    // 40–47: Ship Type
    bitsB += shipType.toString(2).padStart(8, "0");

    // 48–65: Vendor ID (3 × 6-bit chars)
    bitsB += this.textToSixBit("", 3); // leave empty

    // 66–69: Unit Model Code (4 bits)
    bitsB += "0000";

    // 70–89: Serial Number (20 bits)
    bitsB += "00000000000000000000";

    // 90–131: Callsign (7 × 6-bit chars = 42 bits)
    bitsB += this.textToSixBit(vessel.callsign ?? "", 7);

    // 132–140: To Bow (9 bits)
    bitsB += toBow.toString(2).padStart(9, "0");

    // 141–149: To Stern (9 bits)
    bitsB += toStern.toString(2).padStart(9, "0");

    // 150–155: To Port (6 bits)
    bitsB += toPort.toString(2).padStart(6, "0");

    // 156–161: To Starboard (6 bits)
    bitsB += toStarboard.toString(2).padStart(6, "0");

    // 162–167: Spare (6 bits)
    bitsB += "000000";

    // Ensure correct length
    bitsB = bitsB.padEnd(168, "0");

    return {
      partA: this.bitsToPayload(bitsA),
      partB: this.bitsToPayload(bitsB)
    };

  } catch (err) {
    console.error("Error creating type24:", err);
    return null;
  }
}


  static createNMEASentence(payload, fragmentCount=1, fragmentNum=1, messageId=null, channel='B') {
    const msgId = messageId !== null ? messageId.toString() : '';
    const fillBits = (6 - (payload.length*6)%6)%6;
    const sentence = `AIVDM,${fragmentCount},${fragmentNum},${msgId},${channel},${payload},${fillBits}`;
    const checksum = this.calculateChecksum('!' + sentence);
    return `!${sentence}*${checksum}`;
  }
}

module.exports = AISEncoder;
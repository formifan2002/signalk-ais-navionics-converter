class AISEncoder {
  constructor(app) { 
    this.app = app; 
    this.fastPacketSeqBySrc = {}; // Pro Source Address
    this.addressClaimed = false;
    this.canChannel = null;
    this.useFallback = false;
    this.fallbackInterface = null;
    this.filterMmsi = null; // Für Tests: int MMSI wie 236683000 oder null
  }

  // Channel setzen (wird von index.js aufgerufen)
  setCanChannel(channel) {
    this.canChannel = channel;
  }

  // Fallback Mode aktivieren
  setFallbackMode(useFallback, interfaceName) {
    this.useFallback = useFallback;
    this.fallbackInterface = interfaceName;
  }

  stateMap = {
    'motoring': 0, 'anchored': 1, 'not under command': 2, 'restricted manouverability': 3,
    'constrained by draft': 4, 'moored': 5, 'aground': 6, 'fishing': 7,
    'sailing': 8, 'hazardous material high speed': 9, 'hazardous material wing in ground': 10,
    'power-driven vessel towing astern': 11, 'power-driven vessel pushing ahead': 12,
    'power-driven vessel pushing ahead or towing alongside': 12, 'pushing ahead': 12, 'towing alongside': 12,
    'reserved': 13, 'ais-sart': 14, 'undefined': 15, 'default':15
  };

  encode6bit(val) {
    if (val < 0 || val > 63) throw new Error("6-bit out of range: " + val);
    return val <= 39 ? String.fromCharCode(val + 48) : String.fromCharCode(val + 56);
  }

  toTwosComplement(value, bits) {
    let max = 1 << bits;
    if (value < 0) value = max + value;
    return value.toString(2).padStart(bits, "0");
  }

  textToSixBit(str, length) {
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

  callsignToSixBit(callsign) {
    callsign = (callsign || '').trim().toUpperCase();
    const padded = callsign.padEnd(7, '@').substring(0, 7);
    return this.textToSixBit(padded, 7);
  }

  bitsToPayload(bits) {
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

  calculateChecksum(nmea) {
    let cs = 0;
    for (let i = 1; i < nmea.length; i++) cs ^= nmea.charCodeAt(i);
    return cs.toString(16).toUpperCase().padStart(2, '0');
  }

  parseETAToUTC(etaString) {
    if (!etaString) return null;
    if (etaString.startsWith("00-00") || etaString.startsWith("0000-00-00")) {
      return null;
    }

    // Vollständiges ISO-8601
    if (/^\d{4}-\d{2}-\d{2}T/.test(etaString)) {
      const d = new Date(etaString);
      return isNaN(d) ? null : d;
    }

    // AIS-Kurzformat: MM-DDTHH:mmZ
    const m = etaString.match(/^(\d{2})-(\d{2})T(\d{2}):(\d{2})Z$/);
    if (m) {
      const [, month, day, hour, minute] = m.map(Number);
      const now = new Date();
      let year = now.getUTCFullYear();
      let candidate = new Date(Date.UTC(year, month - 1, day, hour, minute));
      if (candidate < now) {
        candidate = new Date(Date.UTC(year + 1, month - 1, day, hour, minute));
      }
      return candidate;
    }

    return null;
  }

  encodeNameTo6bit(name) {
    const AIS_CHARS = "@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_ !\"#$%&'()*+,-./0123456789:;<=>?";
    let n = (name || "").toUpperCase().slice(0, 20).padEnd(20, " ");
    let bits = "";
    for (let i = 0; i < n.length; i++) {
      const ch = n[i];
      let idx = AIS_CHARS.indexOf(ch);
      if (idx < 0) idx = 32; // Space
      bits += idx.toString(2).padStart(6, "0");
    }
    return bits; // 120 Bit
  }

  computeAisSogCog(sogValue, sogUnits, cogValue, cogUnits, headingValue, headingUnits, minAlarmSOG = 0.2) {
    // SOG
    let sogKn = Number(sogValue) || 0;
    if (!(sogUnits && sogUnits.toLowerCase().includes("kn"))) {
      sogKn = sogKn * 1.94384;
    }
    if (sogKn < minAlarmSOG) {
      sogKn = 0;
    }

    let sog10;
    if (!Number.isFinite(sogKn) || sogKn <= 0) {
      sog10 = 1023;
    } else {
      sog10 = Math.round(sogKn * 10);
      if (sog10 > 1022) sog10 = 1022;
    }

    // COG
    let cog10 = 3600;
    if (sogKn >= minAlarmSOG && Number.isFinite(cogValue)) {
      let cogDeg;
      if (cogUnits) {
        const u = cogUnits.toLowerCase();
        if (u.includes("rad")) {
          cogDeg = cogValue * 180 / Math.PI;
        } else if (u.includes("deg")) {
          cogDeg = cogValue;
        } else {
          cogDeg = Math.abs(cogValue) <= 2 * Math.PI ? cogValue * 180 / Math.PI : cogValue;
        }
      } else {
        cogDeg = Math.abs(cogValue) <= 2 * Math.PI ? cogValue * 180 / Math.PI : cogValue;
      }
      cogDeg = ((cogDeg % 360) + 360) % 360;
      cog10 = Math.round(cogDeg * 10);
      if (cog10 > 3599) cog10 = 3599;
    }

    // HEADING
    const HEADING_UNAVALABLE = 511;
    let headingInt = HEADING_UNAVALABLE;

    if (sogKn >= minAlarmSOG && cog10 !== 3600 && Number.isFinite(headingValue)) {
      let headingDeg;
      if (headingUnits) {
        const u = headingUnits.toLowerCase();
        if (u.includes("rad")) {
          if (headingValue > 2 * Math.PI) { 
            headingInt = HEADING_UNAVALABLE;
          } else {
            headingDeg = headingValue * 180 / Math.PI;
          }
        } else if (u.includes("deg")) {
          headingDeg = headingValue;
        } else {
          headingDeg = Math.abs(headingValue) <= 2 * Math.PI ? headingValue * 180 / Math.PI : headingValue;
        }
      } else {
        headingDeg = Math.abs(headingValue) <= 2 * Math.PI ? headingValue * 180 / Math.PI : headingValue;
      }
      
      if (headingDeg >= 360 && headingDeg <= HEADING_UNAVALABLE) {
        headingInt = HEADING_UNAVALABLE;
      } else {
        headingDeg = ((headingDeg % 360) + 360) % 360;
        headingInt = Math.round(headingDeg);
        if (headingInt > 359) headingInt = 359;
      }
    }

    return { sog10, cog10, headingInt };
  }

  computeAisTransceiverInfo(vessel){
    const aisClass = vessel?.sensors?.ais?.class?.value; 
    let aisTransceiverInfo = 0;
    if (aisClass === "A") { 
      aisTransceiverInfo = 1;
    } else if (aisClass === "B") { 
      aisTransceiverInfo = 3;
    } else { 
      aisTransceiverInfo = 0;
    }
    return aisTransceiverInfo;
  }

  computeAisRot(rateValue, rateUnits, sog10, cog10, headingInt) {
    const ROT_UNAVAILABLE = -2.23402144306284;
    let rot = -128;
    if (sog10 === 1023 || cog10 === 3600 || headingInt === 511) {
      return rot;
    }

    if (typeof rateValue !== "number" || !Number.isFinite(rateValue)) {
      return rot;
    }

    let rate = rateValue;

    if (rateUnits) {
      const u = rateUnits.toLowerCase();
      if (u.includes("rad/s")) {
        if (Math.abs(rate - ROT_UNAVAILABLE) < 1e-6) { 
          return rot;
        }
        rate = rate * (180 / Math.PI) * 60;
      } else if (u.includes("deg/s")) {
        rate = rate * 60;
      } else if (u.includes("deg/min")) {
        // OK
      } else {
        if (Math.abs(rate) < 10) {
          rate = rate * (180 / Math.PI) * 60;
        }
      }
    } else {
      if (Math.abs(rate) < 10) {
        rate = rate * (180 / Math.PI) * 60;
      }
    }

    if (rate > 708) rate = 708;
    if (rate < -708) rate = -708;

    if (rate !== 0) {
      const sign = rate < 0 ? -1 : 1;
      rot = Math.round(sign * 4.733 * Math.sqrt(Math.abs(rate)));
      if (rot > 126) rot = 126;
      if (rot < -126) rot = -126;
    }

    return rot;
  }

  createPositionReportType1(vessel, config) {
    try {
      const mmsi = parseInt(vessel.mmsi);
      if (!mmsi || mmsi === 0) return null;

      const nav = vessel.navigation || {};
      const pos = nav.position?.value || nav.position || {};
      const latitude = pos.latitude;
      const longitude = pos.longitude;
      if (latitude === undefined || longitude === undefined) return null;

      const rawState = nav.state?.value;
      let navStatus = 15;
      if (typeof rawState === "number" && Number.isFinite(rawState)) {
        navStatus = rawState;
      } else if (typeof rawState === "string") {
        const key = rawState.toLowerCase();
        if (this.stateMap[key] !== undefined) {
          navStatus = this.stateMap[key];
        }
      }

      const isoTime = pos.timestamp;
      let timestamp = 60;
      if (isoTime && nav?.speedOverGround) {
        const date = new Date(isoTime);
        const ageMs = Date.now() - date.getTime();
        if (ageMs <= 60000) {
          timestamp = date.getUTCSeconds();
        }
      }
      
      const raim = 0;
      const maneuver = 0;
      const lon = Math.round(longitude * 600000);
      const lat = Math.round(latitude * 600000);
      
      const sogField = nav?.speedOverGround;
      const cogField = nav?.courseOverGroundTrue;
      const headingField = nav?.headingTrue;

      const { sog10, cog10, headingInt } = this.computeAisSogCog(
        sogField?.value ?? 0,
        sogField?.meta?.units ?? null,
        cogField?.value ?? null,
        cogField?.meta?.units ?? null,
        headingField?.value ?? null,
        headingField?.meta?.units ?? null,
        config.minAlarmSOG
      );

      const rot = this.computeAisRot(nav?.rateOfTurn?.value, nav?.rateOfTurn?.meta?.units, sog10, cog10, headingInt);

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
      this.app.error(`Error creating type 1: ${error?.message}`);
      return null;
    }
  }

  createPositionReportType19(vessel, config) {
    try {
      const mmsi = parseInt(vessel.mmsi, 10);
      if (!mmsi || mmsi === 0) return null;

      const nav = vessel.navigation || {};
      const posObj = nav.position || {};
      const pos = posObj.value || posObj || {};
      const latitude = pos.latitude;
      const longitude = pos.longitude;
      if (typeof latitude !== "number" || typeof longitude !== "number") return null;

      const isoTime = posObj.timestamp || pos.timestamp;
      let timestamp = 60;
      if (isoTime && nav?.speedOverGround) {
        const date = new Date(isoTime);
        const ageMs = Date.now() - date.getTime();
        if (ageMs <= 60000) {
          timestamp = date.getUTCSeconds();
        }
      }

      const raimFlag = 0;
      const sogField = nav?.speedOverGround;
      const cogField = nav?.courseOverGroundTrue;
      const headingField = nav?.headingTrue;

      const { sog10, cog10, headingInt } = this.computeAisSogCog(
        sogField?.value ?? 0,
        sogField?.meta?.units ?? null,
        cogField?.value ?? null,
        cogField?.meta?.units ?? null,
        headingField?.value ?? null,
        headingField?.meta?.units ?? null,
        config.minAlarmSOG
      );

      let lon = Math.round(longitude * 600000);
      let lat = Math.round(latitude * 600000);

      const lonUnavailable = (lon < -108000000 || lon > 108000000);
      const latUnavailable = (lat < -54000000 || lat > 54000000);
      if (lonUnavailable) lon = 0x6791AC0;
      if (latUnavailable) lat = 0x3412140;

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

      const shipType = design.aisShipType?.value?.id || 0;

      let epfd = 0;
      const positionSource = posObj.$source || "";
      const srcLower = positionSource.toLowerCase();
      if (srcLower.includes("gps")) epfd = 1;
      else if (srcLower.includes("glonass")) epfd = 2;
      else if (srcLower.includes("galileo")) epfd = 3;

      const name = vessel.name || "";
      const nameBits = this.encodeNameTo6bit(name);

      const dte = 0;
      const assignedMode = 0;

      let bits = "";
      bits += (19).toString(2).padStart(6, "0");
      bits += (0).toString(2).padStart(2, "0");
      bits += mmsi.toString(2).padStart(30, "0");
      bits += (0).toString(2).padStart(8, "0");
      bits += sog10.toString(2).padStart(10, "0");
      bits += "0";
      bits += this.toTwosComplement(lon, 28).toString(2).padStart(28, "0");
      bits += this.toTwosComplement(lat, 27).toString(2).padStart(27, "0");
      bits += cog10.toString(2).padStart(12, "0");
      bits += headingInt.toString(2).padStart(9, "0");
      bits += timestamp.toString(2).padStart(6, "0");
      bits += (0).toString(2).padStart(4, "0");
      bits += nameBits;
      bits += shipType.toString(2).padStart(8, "0");
      bits += toBow.toString(2).padStart(9, "0");
      bits += toStern.toString(2).padStart(9, "0");
      bits += toPort.toString(2).padStart(6, "0");
      bits += toStarboard.toString(2).padStart(6, "0");
      bits += epfd.toString(2).padStart(4, "0");
      bits += (raimFlag ? "1" : "0");
      bits += dte.toString(2).padStart(1, "0");
      bits += assignedMode.toString(2).padStart(1, "0");
      bits += (0).toString(2).padStart(4, "0");

      if (bits.length !== 312) {
        this.app.error("Type 19 bit length is not 312:", bits.length);
        return null;
      }

      return this.bitsToPayload(bits);
    } catch (err) {
      this.app.error(`Error creating type 19: ${err?.message}`);
      return null;
    }
  }

  createStaticVoyage(vessel) {
    try {
      const mmsi = parseInt(vessel.mmsi);
      if (!mmsi || mmsi === 0) return null;

      const design = vessel.design || {};
      const length = design.length?.value?.overall || 0;
      const beam = design.beam?.value || 0;
      const draft = design.draft?.value?.maximum || 0;
      const shipType = design.aisShipType?.value?.id || 0;
      
      let imo = 0;
      if (vessel.registrations?.imo) {
        const imoStr = vessel.registrations.imo.toString().replace(/[^\d]/g, '');
        imo = parseInt(imoStr) || 0;
      } else if (vessel.imo) {
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
      const etaString = vessel.navigation?.courseGreatCircle?.activeRoute?.estimatedTimeOfArrival?.value ?? vessel?.navigation?.destination?.eta?.value ?? '';

      let etaMonth = 0, etaDay = 0, etaHour = 24, etaMinute = 60;
      const etaDate = this.parseETAToUTC(etaString);
      if (etaDate) {
        etaMonth = etaDate.getUTCMonth() + 1;
        etaDay = etaDate.getUTCDate();
        etaHour = etaDate.getUTCHours();
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
      this.app.error(`Error creating type 5: ${err?.message}`);
      return null;
    }
  }

  createStaticVoyageType24(vessel) {
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

      // PART A
      let bitsA = "";
      bitsA += (24).toString(2).padStart(6, "0");
      bitsA += (0).toString(2).padStart(2, "0");
      bitsA += mmsi.toString(2).padStart(30, "0");
      bitsA += (0).toString(2).padStart(2, "0");
      bitsA += this.textToSixBit(vessel.name ?? "", 20);
      bitsA = bitsA.padEnd(168, "0");

      // PART B
      let bitsB = "";
      bitsB += (24).toString(2).padStart(6, "0");
      bitsB += (0).toString(2).padStart(2, "0");
      bitsB += mmsi.toString(2).padStart(30, "0");
      bitsB += (1).toString(2).padStart(2, "0");
      bitsB += shipType.toString(2).padStart(8, "0");
      bitsB += this.textToSixBit("", 3);
      bitsB += "0000";
      bitsB += "00000000000000000000";
      bitsB += this.textToSixBit(vessel.callsign ?? "", 7);
      bitsB += toBow.toString(2).padStart(9, "0");
      bitsB += toStern.toString(2).padStart(9, "0");
      bitsB += toPort.toString(2).padStart(6, "0");
      bitsB += toStarboard.toString(2).padStart(6, "0");
      bitsB += "000000";
      bitsB = bitsB.padEnd(168, "0");

      return {
        partA: this.bitsToPayload(bitsA),
        partB: this.bitsToPayload(bitsB)
      };

    } catch (err) {
      this.app.error(`Error creating type 24: ${err?.message}`);
      return null;
    }
  }

  createNMEASentence(payload, fragmentCount=1, fragmentNum=1, messageId=null, channel='B') {
    const msgId = messageId !== null ? messageId.toString() : '';
    const fillBits = (6 - (payload.length*6)%6)%6;
    const sentence = `AIVDM,${fragmentCount},${fragmentNum},${msgId},${channel},${payload},${fillBits}`;
    const checksum = this.calculateChecksum('!' + sentence);
    return `!${sentence}*${checksum}`;
  }

  // PGN 129038 - AIS Class A Position Report
  createPGN129038(vessel, config) {
    try {
      const mmsi = parseInt(vessel.mmsi);
      if (!mmsi || mmsi === 0) return null;
      if (this.filterMmsi && mmsi !== this.filterMmsi) return null;

      const nav = vessel.navigation || {};
      const pos = nav.position?.value || nav.position || {};
      const latitude = pos.latitude;
      const longitude = pos.longitude;
      if (latitude === undefined || longitude === undefined) return null;

      const bw = new BitWriter(28, 0);

      const messageId = 1;
      const repeat = 0;

      const lonN2k = Math.round(longitude * 1e7);
      const latN2k = Math.round(latitude * 1e7);

      const accuracy = 0;
      const raim = 0;

      let seconds = 60;
      if (pos.timestamp) {
        const date = new Date(pos.timestamp);
        if (Date.now() - date.getTime() <= 60000) {
          seconds = date.getUTCSeconds();
        }
      }

      const { sog10, cog10, headingInt } = this.computeAisSogCog(
        nav?.speedOverGround?.value ?? 0,
        nav?.speedOverGround?.meta?.units ?? null,
        nav?.courseOverGroundTrue?.value ?? null,
        nav?.courseOverGroundTrue?.meta?.units ?? null,
        nav?.headingTrue?.value ?? null,
        nav?.headingTrue?.meta?.units ?? null,
        config.minAlarmSOG
      );

      let cogN2k = 0xFFFF;
      if (cog10 !== 3600) {
        const cogDeg = cog10 / 10;
        const cogRad = cogDeg * Math.PI / 180;
        cogN2k = Math.round(cogRad * 1e4);
      }

      let sogN2k = 0xFFFF;
      if (sog10 !== 1023) {
        const sogKn = sog10 / 10;
        const sogMs = sogKn * 0.514444;
        sogN2k = Math.round(sogMs * 100);
      }

      let headingN2k = 0xFFFF;
      if (headingInt !== 511) {
        const headingRad = headingInt * Math.PI / 180;
        headingN2k = Math.round(headingRad * 1e4);
      }

      const rot = this.computeAisRot(nav?.rateOfTurn?.value, nav?.rateOfTurn?.meta?.units, sog10, cog10, headingInt);

      let rotN2k = 0x7FFF; 
      if (rot !== -128 && rot !== 0) {
        const sign = rot < 0 ? -1 : 1;
        const rotDegPerMin = sign * Math.pow(Math.abs(rot) / 4.733, 2);
        const rotRadPerSec = (rotDegPerMin * Math.PI / 180) / 60;
        rotN2k = Math.round(rotRadPerSec / 3.125e-5);
      }

      let navStatus = 15;
      const rawState = nav.state?.value;
      if (typeof rawState === "number") navStatus = rawState;
      if (typeof rawState === "string" && this.stateMap[rawState.toLowerCase()] !== undefined)
        navStatus = this.stateMap[rawState.toLowerCase()];

      const specialManeuver = 0;
      const reserved2 = 0;
      const spare3 = 0;
      const reserved5 = 0;
      const sequenceId = 0;

      const transceiverInfo = this.computeAisTransceiverInfo(vessel);

      bw.writeBits(messageId, 6);
      bw.writeBits(repeat, 2);
      bw.writeBits(mmsi, 32);
      bw.writeBits(lonN2k >>> 0, 32);
      bw.writeBits(latN2k >>> 0, 32);
      bw.writeBits(accuracy, 1);
      bw.writeBits(raim, 1);
      bw.writeBits(seconds, 6);
      bw.writeBits(cogN2k, 16);
      bw.writeBits(sogN2k, 16);
      bw.writeBits(0, 19);
      bw.writeBits(transceiverInfo, 5);
      bw.writeBits(headingN2k, 16);
      bw.writeBits(rotN2k & 0xFFFF, 16);
      bw.writeBits(navStatus, 4);
      bw.writeBits(specialManeuver, 2);
      bw.writeBits(reserved2, 2);
      bw.writeBits(spare3, 3);
      bw.writeBits(reserved5, 5);
      bw.writeBits(sequenceId, 8);

      return {
        pgn: 129038,
        prio: 4,
        src: config?.nmea2000Src ?? 42,
        dst: 255,
        data: bw.getBuffer()
      };

    } catch (err) {
      this.app.error(`Error creating PGN 129038: ${err?.message}`);
      return null;
    }
  }

  // PGN 129039 - AIS Class B Position Report
  createPGN129039(vessel, config) {
    try {
      const mmsi = parseInt(vessel.mmsi);
      if (!mmsi || mmsi === 0) return null;
      if (this.filterMmsi && mmsi !== this.filterMmsi) return null;

      const nav = vessel.navigation || {};
      const pos = nav.position?.value || nav.position || {};
      const latitude = pos.latitude;
      const longitude = pos.longitude;
      if (latitude === undefined || longitude === undefined) return null;

      const bw = new BitWriter(27, 0);
      const messageId = 18; 
      const repeat = 0;

      const lonN2k = Math.round(longitude * 1e7);
      const latN2k = Math.round(latitude * 1e7);

      const accuracy = 0;
      const raim = 0;

      let seconds = 60;
      if (pos.timestamp) {
        const date = new Date(pos.timestamp);
        if (Date.now() - date.getTime() <= 60000) {
          seconds = date.getUTCSeconds();
        }
      }

      const { sog10, cog10, headingInt } = this.computeAisSogCog(
        nav?.speedOverGround?.value ?? 0,
        nav?.speedOverGround?.meta?.units ?? null,
        nav?.courseOverGroundTrue?.value ?? null,
        nav?.courseOverGroundTrue?.meta?.units ?? null,
        nav?.headingTrue?.value ?? null,
        nav?.headingTrue?.meta?.units ?? null,
        config.minAlarmSOG
      );

      let cogN2k = 0xFFFF;
      if (cog10 !== 3600) {
        const cogDeg = cog10 / 10;
        const cogRad = cogDeg * Math.PI / 180;
        cogN2k = Math.round(cogRad * 1e4);
      }

      let sogN2k = 0xFFFF;
      if (sog10 !== 1023) {
        const sogKn = sog10 / 10;
        const sogMs = sogKn * 0.514444;
        sogN2k = Math.round(sogMs * 100);
      }

      let headingN2k = 0xFFFF;
      if (headingInt !== 511) {
        const headingRad = headingInt * Math.PI / 180;
        headingN2k = Math.round(headingRad * 1e4);
      }

      const communicationState = 0;   
      const aisTransceiverInfo = this.computeAisTransceiverInfo(vessel);   

      const regionalA = 0;            
      const regionalB = 0;            

      const unitType = 1;             
      const integratedDisplay = 0;    
      const dsc = 0;                  
      const band = 1;                 
      const canHandleMsg22 = 0;       
      const aisMode = 1;              
      const aisCommStateFlag = 1;     

      const reserved15 = 0;           

      bw.writeBits(messageId, 6);
      bw.writeBits(repeat, 2);
      bw.writeBits(mmsi, 32);
      bw.writeBits(lonN2k >>> 0, 32);
      bw.writeBits(latN2k >>> 0, 32);
      bw.writeBits(accuracy, 1);
      bw.writeBits(raim, 1);
      bw.writeBits(seconds, 6);
      bw.writeBits(cogN2k, 16);
      bw.writeBits(sogN2k, 16);
      bw.writeBits(communicationState, 19);
      bw.writeBits(aisTransceiverInfo, 5);
      bw.writeBits(headingN2k, 16);
      bw.writeBits(regionalA, 8);
      bw.writeBits(regionalB, 2);
      bw.writeBits(unitType, 1);
      bw.writeBits(integratedDisplay, 1);
      bw.writeBits(dsc, 1);
      bw.writeBits(band, 1);
      bw.writeBits(canHandleMsg22, 1);
      bw.writeBits(aisMode, 1);
      bw.writeBits(aisCommStateFlag, 1);
      bw.writeBits(reserved15, 15);

      return {
        pgn: 129039,
        prio: 4,
        src: config?.nmea2000Src ?? 42,
        dst: 255,
        data: bw.getBuffer()
      };

    } catch (err) {
      this.app.error(`Error creating PGN 129039: ${err?.message}`);
      return null;
    }
  }

  // PGN 129794 - AIS Class A Static and Voyage Related Data
  createPGN129794(vessel, config) {
    try {
      const mmsi = parseInt(vessel.mmsi);
      if (!mmsi || mmsi === 0) return null;
      if (this.filterMmsi && mmsi !== this.filterMmsi) return null;

      const bw = new BitWriter(78, 0xFF);
      const messageId = 5;
      const repeat = 0;

      let imo = 0;
      const rawImo = vessel.registrations?.imo ?? vessel.imo ?? null;
      if (rawImo !== null && rawImo !== undefined) {
        imo = parseInt(rawImo.toString().replace(/[^\d]/g, ""), 10) || 0;
      }

      const callsign = vessel.communication?.callsignVhf?.trim() || vessel.callsign?.trim() || "";
      const name = vessel.name || "";

      const design = vessel.design || {};
      const shipType = design.aisShipType?.value?.id || 0;

      const length = design.length?.value?.overall || 0;
      const beam = design.beam?.value || 0;

      const ais = vessel.sensors?.ais || {};
      const fromBow = ais.fromBow?.value || 0;
      const fromCenter = ais.fromCenter?.value || 0;

      const lengthDm = Math.round(length * 10);
      const beamDm = Math.round(beam * 10);
      const posRefStbd = Math.round((beam / 2 + fromCenter) * 10);
      const posRefBow = Math.round(fromBow * 10);

      // ETA Date & Time
      const etaString = vessel?.navigation?.destination?.eta?.value || '';
      let etaDate = 0xFFFF;
      let etaTime = 0xFFFFFFFF;
      
      if (etaString) {
        const eta = new Date(etaString);
        if (!isNaN(eta)) {
          const utcMidnight = Date.UTC(eta.getUTCFullYear(), eta.getUTCMonth(), eta.getUTCDate());
          const daysSince1970 = Math.floor((utcMidnight - Date.UTC(1970, 0, 1)) / (24 * 60 * 60 * 1000));
          etaDate = Math.max(0, Math.min(65532, daysSince1970));

          const hour = eta.getUTCHours();
          const minute = eta.getUTCMinutes();
          const second = eta.getUTCSeconds();
          const secondsSinceMidnight = hour * 3600 + minute * 60 + second;
          etaTime = Math.round(secondsSinceMidnight * 10000);
        }
      }

      // Draft
      const draftObj = design.draft?.value || {};
      const draught = draftObj.current || draftObj.maximum || 0;
      const draughtCm = Math.round(draught * 100);

      // Destination
      const destination = vessel.navigation?.destination?.commonName?.value || "";

      const aisVersion = 0;
      const gnssType = 1;
      const dte = 0;
      const reserved1 = 0;
      const aisTransceiverInfo = this.computeAisTransceiverInfo(vessel);
      const reserved3 = 0;

      bw.writeBits(messageId, 6);
      bw.writeBits(repeat, 2);
      bw.writeBits(mmsi, 32);
      bw.writeBits(imo, 32);
      bw.writeString(callsign, 7);
      bw.writeString(name, 20);
      bw.writeBits(shipType, 8);
      bw.writeBits(lengthDm, 16);
      bw.writeBits(beamDm, 16);
      bw.writeBits(posRefStbd, 16);
      bw.writeBits(posRefBow, 16);
      bw.writeBits(etaDate, 16);
      bw.writeBits(etaTime, 32);
      bw.writeBits(draughtCm, 16);
      bw.writeString(destination, 20);
      bw.writeBits(aisVersion, 2);
      bw.writeBits(gnssType, 4);
      bw.writeBits(dte, 1);
      bw.writeBits(reserved1, 1);
      bw.writeBits(aisTransceiverInfo, 5);
      bw.writeBits(reserved3, 3);

      return {
        pgn: 129794,
        prio: 6,
        src: config?.nmea2000Src ?? 42,
        dst: 255,
        data: bw.getBuffer()
      };

    } catch (err) {
      this.app.error(`Error creating PGN 129794: ${err?.message}`);
      return null;
    }
  }

  // PGN 129809 - AIS Class B Static Data (Msg 24 Part A)
  createPGN129809(vessel, config) {
    try {
      const mmsi = parseInt(vessel.mmsi);
      if (!mmsi || mmsi === 0) return null;
      if (this.filterMmsi && mmsi !== this.filterMmsi) return null;

      const bw = new BitWriter(27, 0);
      const messageId = 24;
      const repeat = 0;

      const name = vessel.name || "";
      const aisTransceiverInfo = this.computeAisTransceiverInfo(vessel);

      const reserved3 = 0;
      const sequenceId = 0;

      bw.writeBits(messageId, 6);
      bw.writeBits(repeat, 2);
      bw.writeBits(mmsi, 32);
      bw.writeString(name, 20);
      bw.writeBits(aisTransceiverInfo, 5);
      bw.writeBits(reserved3, 3);
      bw.writeBits(sequenceId, 8);

      return {
        pgn: 129809,
        prio: 6,
        src: config?.nmea2000Src ?? 42,
        dst: 255,
        data: bw.getBuffer()
      };

    } catch (err) {
      this.app.error(`Error creating PGN 129809: ${err?.message}`);
      return null;
    }
  }

  // PGN 129810 - AIS Class B Static Data (Msg 24 Part B)
  createPGN129810(vessel, config) {
    try {
      const mmsi = parseInt(vessel.mmsi);
      if (!mmsi || mmsi === 0) return null;
      if (this.filterMmsi && mmsi !== this.filterMmsi) return null;

      const staticData = vessel.static || {};

      const bw = new BitWriter(35, 0);
      const messageId = 24;
      const repeat = 0;

      const design = vessel.design || {};
      const shipType = design.aisShipType?.value?.id || 0;

      const vendorId = staticData.vendorId ?? "";
      const callsign = vessel.communication?.callsignVhf?.trim() || vessel.callsign?.trim() || "";

      const length = design.length?.value?.overall || 0;
      const beam = design.beam?.value || 0;

      const ais = vessel.sensors?.ais || {};
      const fromBow = ais.fromBow?.value || 0;
      const fromCenter = ais.fromCenter?.value || 0;

      const posRefBow = Math.round(fromBow * 10);
      const posRefStbd = Math.round((beam / 2 + fromCenter) * 10);

      const mothershipMmsi = staticData.mothershipMmsi ?? 0;

      const reserved2 = 0;
      const spare2 = 0;

      const gnssType = staticData.gnssType ?? 1;
      const aisTransceiverInfo = this.computeAisTransceiverInfo(vessel);
      const reserved3 = 0;

      const sequenceId = 0;

      bw.writeBits(messageId, 6);
      bw.writeBits(repeat, 2);
      bw.writeBits(mmsi, 32);
      bw.writeBits(shipType, 8);
      bw.writeString(vendorId, 7);
      bw.writeString(callsign, 7);
      bw.writeBits(Math.round(length * 10), 16);
      bw.writeBits(Math.round(beam * 10), 16);
      bw.writeBits(posRefStbd, 16);
      bw.writeBits(posRefBow, 16);
      bw.writeBits(mothershipMmsi, 32);
      bw.writeBits(reserved2, 2);
      bw.writeBits(spare2, 2);
      bw.writeBits(gnssType, 4);
      bw.writeBits(aisTransceiverInfo, 5);
      bw.writeBits(reserved3, 3);
      bw.writeBits(sequenceId, 8);

      return {
        pgn: 129810,
        prio: 6,
        src: config?.nmea2000Src ?? 42,
        dst: 255,
        data: bw.getBuffer()
      };

    } catch (err) {
      this.app.error(`Error creating PGN 129810: ${err?.message}`);
      return null;
    }
  }

  simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
    }
    return hash;
  }

  // PGN 60928 - ISO Address Claim
  createPGN60928AddressClaim(pluginId, config) {
    const bw = new BitWriter(8, 0);
    
    // NAME Field (64 bits nach ISO 11783-5)
    const uniqueNumber = this.simpleHash(pluginId) & 0x1FFFFF; // 21 Bit
    const manufacturerCode = 2046; // Experimentell
    const deviceInstance = 0;
    const deviceFunction = 130; // PC Gateway
    const deviceClass = 25; // Network
    const systemInstance = 0;
    const industryGroup = 4; // Marine
    const arbitraryAddressCapable = 1;
    
    let name = BigInt(0);
    name |= BigInt(uniqueNumber & 0x1FFFFF);
    name |= BigInt(manufacturerCode & 0x7FF) << 21n;
    name |= BigInt(deviceInstance & 0x7) << 32n;
    name |= BigInt(deviceFunction & 0xFF) << 35n;
    name |= BigInt(deviceClass & 0x7F) << 43n;
    name |= BigInt(systemInstance & 0xF) << 50n;
    name |= BigInt(industryGroup & 0x7) << 54n;
    name |= BigInt(arbitraryAddressCapable & 0x1) << 57n;
    
    for (let i = 0; i < 8; i++) {
      bw.buf[i] = Number((name >> BigInt(i * 8)) & 0xFFn);
    }
    
    return {
      pgn: 60928,
      prio: 6,
      src: config?.nmea2000Src ?? 42,
      dst: 255,
      data: bw.getBuffer()
    };
  }

// ============================================================================
// ais-encoder.js - TEIL 3/3: sendToCANBus (Native SocketCAN + Fallback) + BitWriter
// ============================================================================

// Diese Methoden gehören in die AISEncoder Klasse

  // Hauptmethode: sendToCANBus mit SocketCAN
  async sendToCANBus(vessel, pgnData, options = {}) {
    // Wenn Fallback-Mode aktiv (ohne socketcan)
    if (this.useFallback) {
      return this.sendToCANBusFallback(vessel, pgnData, options);
    }
    
    // Native SocketCAN
    if (!this.canChannel || !pgnData || !pgnData.data) return;

    const shouldLog = options.logDebugDetails && vessel.mmsi === options.logMMSI;
    const { pgn, prio, src, data } = pgnData;
    
    const canId = (prio << 26) | (pgn << 8) | src;
    let payload = Buffer.from(data);
    let totalLen = payload.length;

    // Single Frame (<= 8 Bytes)
    if (totalLen <= 8) {
      const frame = Buffer.alloc(8, 0xFF);
      payload.copy(frame, 0);
      
      const msg = {
        id: canId,
        ext: true,  // Extended ID (29-bit)
        data: frame
      };
      
      this.canChannel.send(msg); // Synchron - kein await nötig
      
      if (shouldLog) {
        this.app.debug(`CAN [Single] PGN ${pgn} ID:0x${canId.toString(16).toUpperCase()}`);
      }
      return;
    }

    // Fast Packet (> 8 Bytes)
    // Sequenz pro Source Address verwalten
    if (!this.fastPacketSeqBySrc[src]) {
      this.fastPacketSeqBySrc[src] = 0;
    }
    const seqId = this.fastPacketSeqBySrc[src];
    this.fastPacketSeqBySrc[src] = (this.fastPacketSeqBySrc[src] + 1) % 32;

    const frames = [];

    // Frame 0
    const frame0 = Buffer.alloc(8, 0xFF);
    frame0[0] = (seqId << 5) | 0;
    frame0[1] = totalLen;
    payload.copy(frame0, 2, 0, Math.min(6, totalLen));
    frames.push(frame0);

    // Follow-up Frames
    let offset = 6;
    let frameIndex = 1;
    while (offset < totalLen) {
      const frame = Buffer.alloc(8, 0xFF);
      frame[0] = (seqId << 5) | frameIndex;
      const copyLen = Math.min(7, totalLen - offset);
      payload.copy(frame, 1, offset, offset + copyLen);
      frames.push(frame);
      offset += copyLen;
      frameIndex++;
    }

    // Frames sequentiell senden
    for (let i = 0; i < frames.length; i++) {
      const msg = {
        id: canId,
        ext: true,
        data: frames[i]
      };
      
      this.canChannel.send(msg); // Synchron - aber await für Timing
      
      if (shouldLog && i === 0) {
        this.app.debug(`CAN [FastPacket] PGN ${pgn} ${frames.length} frames (seq ${seqId})`);
      }
      
      // Delay nur für Timing zwischen Frames (send() selbst ist sync)
      if (i < frames.length - 1) {
        await new Promise(r => setTimeout(r, 3));
      }
    }
  }

  // Fallback-Methode mit spawn (wenn socketcan nicht verfügbar)
  async sendToCANBusFallback(vessel, pgnData, options) {
    if (!pgnData || !pgnData.data) return;

    const { spawn } = require('child_process');
    const { pgn, prio, src, data } = pgnData;
    const canId = (prio << 26) | (pgn << 8) | src;
    const canIdHex = canId.toString(16).toUpperCase().padStart(8, "0");
    
    const shouldLog = options.logDebugDetails && vessel.mmsi === options.logMMSI;
    let payload = Buffer.from(data);
    let totalLen = payload.length;

    // Single Frame
    if (totalLen <= 8) {
      const frame = Buffer.alloc(8, 0xFF);
      payload.copy(frame, 0);
      const hexData = [...frame].map(b => b.toString(16).toUpperCase().padStart(2, "0")).join("");
      
      return new Promise((resolve) => {
        const proc = spawn('cansend', [this.fallbackInterface, `${canIdHex}#${hexData}`]);
        
        if (shouldLog) {
          this.app.debug(`CAN Fallback [Single] PGN ${pgn}`);
        }
        
        proc.on('close', () => resolve());
        proc.on('error', () => resolve()); // Ignoriere Fehler
        setTimeout(() => { proc.kill(); resolve(); }, 50);
      });
    }

    // Fast Packet
    if (!this.fastPacketSeqBySrc[src]) {
      this.fastPacketSeqBySrc[src] = 0;
    }
    const seqId = this.fastPacketSeqBySrc[src];
    this.fastPacketSeqBySrc[src] = (this.fastPacketSeqBySrc[src] + 1) % 32;

    const frames = [];

    // Frame 0
    const frame0 = Buffer.alloc(8, 0xFF);
    frame0[0] = (seqId << 5) | 0;
    frame0[1] = totalLen;
    payload.copy(frame0, 2, 0, Math.min(6, totalLen));
    frames.push(frame0);

    // Follow-up Frames
    let offset = 6;
    let frameIndex = 1;
    while (offset < totalLen) {
      const frame = Buffer.alloc(8, 0xFF);
      frame[0] = (seqId << 5) | frameIndex;
      const copyLen = Math.min(7, totalLen - offset);
      payload.copy(frame, 1, offset, offset + copyLen);
      frames.push(frame);
      offset += copyLen;
      frameIndex++;
    }

    // Sende alle Frames sequentiell
    for (let i = 0; i < frames.length; i++) {
      const hexData = [...frames[i]].map(b => b.toString(16).toUpperCase().padStart(2, "0")).join("");
      
      await new Promise((resolve) => {
        const proc = spawn('cansend', [this.fallbackInterface, `${canIdHex}#${hexData}`]);
        
        if (shouldLog && i === 0) {
          this.app.debug(`CAN Fallback [FastPacket] PGN ${pgn} ${frames.length} frames`);
        }
        
        proc.on('close', () => resolve());
        proc.on('error', () => resolve());
        setTimeout(() => { proc.kill(); resolve(); }, 50);
      });

      if (i < frames.length - 1) {
        await new Promise(r => setTimeout(r, 3));
      }
    }
  }

} // Ende AISEncoder Klasse

// ============================================================================
// BitWriter Helper Klasse
// ============================================================================

class BitWriter {
  constructor(sizeBytes = 64, fill = 0xFF) {
    this.buf = Buffer.alloc(sizeBytes, fill);
    this.bitpos = 0;
  }

  writeBits(value, bits) {
    for (let i = 0; i < bits; i++) {
      const bit = (value >> i) & 1;
      const byteIndex = Math.floor(this.bitpos / 8);
      const bitIndex = this.bitpos % 8;

      if (bit) {
        this.buf[byteIndex] |= (1 << bitIndex);
      } else {
        this.buf[byteIndex] &= ~(1 << bitIndex);
      }
      this.bitpos++;
    }
  }

  writeString(str, lengthBytes) {
    const s = (str ?? "")
      .toString()
      .padEnd(lengthBytes, " ")
      .slice(0, lengthBytes);

    for (let i = 0; i < lengthBytes; i++) {
      this.writeBits(s.charCodeAt(i), 8);
    }
  }

  getBuffer() {
    return this.buf;
  }
}

module.exports = AISEncoder;

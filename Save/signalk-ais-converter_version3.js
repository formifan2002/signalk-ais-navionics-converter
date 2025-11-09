const net = require('net');
const http = require('http');

// Konfiguration
const CONFIG = {
  signalkHost: '192.168.188.25',
  signalkPort: 4000,
  nmeaPort: 10113,
  updateInterval: 5000, // alle 5 Sekunden
};

// AIS 6-bit ASCII Armoring
class AISEncoder {
  static encode6bit(val) {
    if (val < 0 || val > 63) throw new Error("6-bit out of range: " + val);
    return val <= 39 ? String.fromCharCode(val + 48) : String.fromCharCode(val + 56);
  }

  static toTwosComplement(value, bits) {
    if (value < 0) value = (1 << bits) + value;
    return value;
  }

  static textToSixBit(str, length) {
    // AIS 6-bit ASCII table: @ABCDEFGHIJKLMNOPQRSTUVWXYZ[\]^_ !"#$%&'()*+,-./0123456789:;<=>?
    const table = '@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_ !"#$%&\'()*+,-./0123456789:;<=>?';
    let bits = '';
    str = str || '';
    for (let i = 0; i < length; i++) {
      let c = i < str.length ? str[i].toUpperCase() : '@';
      let idx = table.indexOf(c);
      if (idx < 0) idx = 0; // Falls Zeichen nicht in Tabelle, verwende @
      bits += idx.toString(2).padStart(6, '0');
    }
    return bits;
  }

  static callsignToSixBit(callsign) {
    // Callsign ist EXAKT 7 Zeichen lang (42 bits)
    callsign = (callsign || '').trim().toUpperCase();
    // Auf 7 Zeichen auffüllen mit @
    const padded = callsign.padEnd(7, '@').substring(0, 7);
    return this.textToSixBit(padded, 7);
  }

  static bitsToPayload(bits) {
    let payload = '';
    // Pad zu Vielfachem von 6
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

  static createPositionReport(vessel) {
    try {
      const mmsi = parseInt(vessel.mmsi);
      if (!mmsi || mmsi === 0) return null;

      const nav = vessel.navigation || {};
      const pos = nav.position?.value || nav.position || {};
      const latitude = pos.latitude;
      const longitude = pos.longitude;
      if (latitude === undefined || longitude === undefined) return null;

      // Navigation Status aus SignalK state mapping
      const state = nav.state?.value || '';
      let navStatus = 15; // Default: not defined
      const stateMap = {
        'motoring': 0, 'anchored': 1, 'not under command': 2, 'restricted maneuverability': 3,
        'constrained by draft': 4, 'moored': 5, 'aground': 6, 'fishing': 7,
        'sailing': 8, 'hazardous material high speed': 9, 'hazardous material wing in ground': 10,
        'power-driven vessel towing astern': 11, 'power-driven vessel pushing ahead': 12,
        'reserved': 13, 'ais-sart': 14
      };
      if (state && stateMap[state] !== undefined) navStatus = stateMap[state];

      const timestamp = 60; // UTC second when report was generated (60 = not available)
      const raim = 0; // RAIM flag
      const maneuver = 0; // Special maneuver indicator
      
      // Rate of Turn - könnte aus rateOfTurn kommen
      const rateOfTurn = nav.rateOfTurn?.value || 0;
      let rot = -128; // -128 = not available
      if (rateOfTurn !== 0) {
        // ROT in degrees/minute, AIS braucht es in kodierter Form
        rot = Math.round(rateOfTurn * 4.733 * Math.sqrt(Math.abs(rateOfTurn)));
        rot = Math.max(-126, Math.min(126, rot));
      }
      
      const sog = nav.speedOverGround?.value || nav.speedOverGround || 0;
      const cog = nav.courseOverGroundTrue?.value || nav.courseOverGroundTrue || 0;
      const heading = nav.headingTrue?.value || nav.headingTrue || 0;

      // Konvertiere zu Zahlen falls es Objekte sind
      const sogValue = typeof sog === 'object' ? 0 : (typeof sog === 'number' ? sog : 0);
      const cogValue = typeof cog === 'object' ? 0 : (typeof cog === 'number' ? cog : 0);
      const headingValue = typeof heading === 'object' ? 0 : (typeof heading === 'number' ? heading : 0);

      const lon = Math.round(longitude * 600000);
      const lat = Math.round(latitude * 600000);
      const sog10 = Math.round(sogValue * 10);
      const cog10 = Math.round(cogValue * 10);
      const headingInt = Math.round(headingValue);

      let bits = '';
      bits += (1).toString(2).padStart(6, '0');              // Message Type
      bits += (0).toString(2).padStart(2, '0');              // Repeat Indicator (always 0)
      bits += mmsi.toString(2).padStart(30, '0');            // MMSI
      bits += navStatus.toString(2).padStart(4, '0');        // Navigation Status
      bits += this.toTwosComplement(rot, 8).toString(2).padStart(8, '0'); // ROT
      bits += sog10.toString(2).padStart(10, '0');           // SOG
      bits += '0';                                           // Position Accuracy
      bits += this.toTwosComplement(lon, 28).toString(2).padStart(28, '0'); // Longitude
      bits += this.toTwosComplement(lat, 27).toString(2).padStart(27, '0'); // Latitude
      bits += cog10.toString(2).padStart(12, '0');           // COG
      bits += headingInt.toString(2).padStart(9, '0');       // True Heading
      bits += timestamp.toString(2).padStart(6, '0');        // Timestamp
      bits += maneuver.toString(2).padStart(2, '0');         // Maneuver Indicator
      bits += '000';                                         // Spare
      bits += raim.toString();                               // RAIM flag
      bits += '0000000000000000000';                         // Radio Status

      return this.bitsToPayload(bits);
    } catch (error) {
      console.error('Error creating position report:', error);
      return null;
    }
  }

  static createStaticVoyage(vessel) {
    try {
      const mmsi = parseInt(vessel.mmsi);
      if (!mmsi || mmsi === 0) return null;

      // Hole Design-Daten
      const design = vessel.design || {};
      const length = design.length?.value?.overall || 0;
      const beam = design.beam?.value || 0;
      const draft = design.draft?.value?.maximum || 0;
      const shipType = design.aisShipType?.value?.id || 0;
      
      // IMO Number
      const imo = parseInt(vessel.imo) || 0;
      
      // AIS Version - SignalK speichert dies nicht, verwende Standard
      const aisVersion = 0; // 0 = ITU-R M.1371-1 (Standard)
      
      // Hole Dimensions aus sensors.ais falls vorhanden
      const ais = vessel.sensors?.ais || {};
      const fromBow = ais.fromBow?.value || 0;
      const fromCenter = ais.fromCenter?.value || 0;
      
      // Berechne Dimensionen für AIS
      const toBow = Math.round(fromBow);
      const toStern = Math.round(Math.max(0, length - fromBow));
      const toPort = Math.round(Math.max(0, beam / 2 - fromCenter));
      const toStarboard = Math.round(Math.max(0, beam / 2 + fromCenter));

      // EPFD Type - könnte aus navigation.gnss.methodQuality kommen, sonst GPS (1)
      let epfd = 1; // 1 = GPS (Standard)
      const positionSource = vessel.navigation?.position?.$source || '';
      if (positionSource.includes('gps')) epfd = 1;
      else if (positionSource.includes('gnss')) epfd = 1;
      else if (positionSource.includes('glonass')) epfd = 2;
      else if (positionSource.includes('galileo')) epfd = 3;

      // Hole destination und ETA falls vorhanden
      const destination = vessel.navigation?.destination?.commonName?.value || '';
      const etaString = vessel.navigation?.courseGreatCircle?.activeRoute?.estimatedTimeOfArrival?.value || '';
      
      // Parse ETA (Format: "MM-DD'T'HH:MM'Z'" oder "00-00T00:00Z" für N/A)
      let etaMonth = 0, etaDay = 0, etaHour = 24, etaMinute = 60;
      if (etaString && etaString !== '00-00T00:00Z' && etaString !== '00-00T24:60Z') {
        const etaMatch = etaString.match(/(\d+)-(\d+)T(\d+):(\d+)/);
        if (etaMatch) {
          etaMonth = parseInt(etaMatch[1]) || 0;
          etaDay = parseInt(etaMatch[2]) || 0;
          etaHour = parseInt(etaMatch[3]) || 24;
          etaMinute = parseInt(etaMatch[4]) || 60;
        }
      }
      
      // Draught in 0.1m (AIS erwartet Draught * 10)
      const draughtDecimeters = Math.round(draft * 10);
      
      // DTE (Data Terminal Equipment) - 0 = ready
      // SignalK speichert dies nicht, setze auf 0 (ready)
      const dte = 0;

      let bits = '';
      bits += (5).toString(2).padStart(6,'0');               // Type 5
      bits += (0).toString(2).padStart(2,'0');               // Repeat Indicator (always 0)
      bits += mmsi.toString(2).padStart(30,'0');             // MMSI
      bits += aisVersion.toString(2).padStart(2,'0');        // AIS Version
      bits += imo.toString(2).padStart(30,'0');              // IMO Number
      bits += this.callsignToSixBit(vessel.callSign ?? '');  // CallSign (42 bits)
      bits += this.textToSixBit(vessel.name ?? '', 20);      // Ship Name (120 bits)
      bits += shipType.toString(2).padStart(8,'0');          // Ship Type
      bits += toBow.toString(2).padStart(9,'0');             // To Bow
      bits += toStern.toString(2).padStart(9,'0');           // To Stern
      bits += toPort.toString(2).padStart(6,'0');            // To Port
      bits += toStarboard.toString(2).padStart(6,'0');       // To Starboard
      bits += epfd.toString(2).padStart(4,'0');              // EPFD Type
      bits += etaMonth.toString(2).padStart(4,'0');          // ETA Month
      bits += etaDay.toString(2).padStart(5,'0');            // ETA Day
      bits += etaHour.toString(2).padStart(5,'0');           // ETA Hour
      bits += etaMinute.toString(2).padStart(6,'0');         // ETA Minute
      bits += draughtDecimeters.toString(2).padStart(8,'0'); // Draught
      bits += this.textToSixBit(destination, 20);            // Destination (120 bits)
      bits += dte.toString(2);                               // DTE
      bits += '0';                                           // Spare

      // Debug: Prüfe Bit-Länge
      if (vessel.name === 'VIVRE' || vessel.name === 'ARGUS' || vessel.name === 'MS ROSE') {
        console.log(`\n[Type 5 Bit Construction for ${vessel.name}]`);
        console.log(`Total bits: ${bits.length} (should be 424)`);
      }

      return this.bitsToPayload(bits);
    } catch(err) {
      console.error('Error creating type5:', err);
      return null;
    }
  }

  static createNMEASentence(payload, fragmentCount = 1, fragmentNum = 1, messageId = null, channel = 'B') {
    const msgId = messageId !== null ? messageId.toString() : '';
    const fillBits = (6 - (payload.length * 6) % 6) % 6;
    const sentence = `AIVDM,${fragmentCount},${fragmentNum},${msgId},${channel},${payload},${fillBits}`;
    const checksum = this.calculateChecksum('!' + sentence);
    return `!${sentence}*${checksum}`;
  }
}

// SignalK Fetcher
class SignalKFetcher {
  constructor(host, port) {
    this.baseUrl = `http://${host}:${port}/signalk/v1/api`;
  }

  async getVessels() {
    return new Promise((resolve, reject) => {
      http.get(`${this.baseUrl}/vessels`, res => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(JSON.parse(data)));
      }).on('error', reject);
    });
  }

  parseVessels(vesselsData) {
    const vessels = [];
    for (const [key, vessel] of Object.entries(vesselsData)) {
      if (key === 'self') continue;
      const mmsiMatch = key.match(/mmsi:(\d+)/);
      if (!mmsiMatch) continue;
      
      // CallSign ist direkt im vessel-Objekt (kleingeschrieben!)
      let callSign = vessel.callsign || ''; // Direkt im Objekt
      
      // Fallback auf communication.callsignVhf falls vorhanden
      if (!callSign && vessel.communication?.callsignVhf) {
        callSign = vessel.communication.callsignVhf;
      }
      
      vessels.push({
        urn: key,
        mmsi: mmsiMatch[1],
        name: vessel.name || 'Unknown',
        callSign: callSign,
        navigation: vessel.navigation || {},
        navStatus: vessel.navigationStatus,
        timestamp: vessel.timestamp,
        raim: vessel.raim,
        maneuver: vessel.maneuver,
        rot: vessel.rot,
        ...vessel
      });
    }
    return vessels;
  }
}

// TCP Server
class NMEAServer {
  constructor(port) {
    this.port = port;
    this.clients = [];
  }

  start() {
    this.server = net.createServer(socket => {
      console.log(`Client connected: ${socket.remoteAddress}:${socket.remotePort}`);
      this.clients.push(socket);
      socket.on('end', () => { this.clients = this.clients.filter(c => c !== socket); });
      socket.on('error', () => { this.clients = this.clients.filter(c => c !== socket); });
    });
    this.server.listen(this.port, () => console.log(`NMEA TCP Server listening on port ${this.port}`));
  }

  broadcast(message) {
    this.clients.forEach(client => {
      try { client.write(message + '\r\n'); }
      catch (err) { console.error('Error sending to client:', err); }
    });
  }

  stop() {
    if (this.server) this.server.close();
    this.clients.forEach(c => c.destroy());
    this.clients = [];
  }
}

// AIS Converter
class AISConverter {
  constructor(config) {
    this.config = config;
    this.fetcher = new SignalKFetcher(config.signalkHost, config.signalkPort);
    this.server = new NMEAServer(config.nmeaPort);
    this.interval = null;
    this.messageIdCounter = 0;
  }

  async start() {
    console.log('Starting AIS to NMEA Converter...');
    this.server.start();
    await this.update();
    this.interval = setInterval(() => this.update(), this.config.updateInterval);
  }

  async update() {
    try {
      const vesselsData = await this.fetcher.getVessels();
      const vessels = this.fetcher.parseVessels(vesselsData);
      this.messageIdCounter = (this.messageIdCounter + 1) % 10;

      console.log(`\n[${new Date().toISOString()}] Processing ${vessels.length} vessels`);

      vessels.forEach(vessel => {
        // Type 1
        const payload1 = AISEncoder.createPositionReport(vessel);
        if (payload1) {
          const sentence1 = AISEncoder.createNMEASentence(payload1,1,1,this.messageIdCounter,'B');
          this.server.broadcast(sentence1);
          
          // Debug für VIVRE und ARGUS
          if (vessel.name === 'VIVRE' || vessel.name === 'ARGUS') {
            console.log(`\n=== DEBUG: ${vessel.name} ===`);
            console.log(`MMSI: ${vessel.mmsi}`);
            const nav = vessel.navigation || {};
            const pos = nav.position?.value || nav.position || {};
            console.log(`Position: Lat ${pos.latitude}, Lon ${pos.longitude}`);
            const sogRaw = nav.speedOverGround?.value || nav.speedOverGround || 0;
            const cogRaw = nav.courseOverGroundTrue?.value || nav.courseOverGroundTrue || 0;
            const headingRaw = nav.headingTrue?.value || nav.headingTrue || 0;
            console.log(`SOG: ${typeof sogRaw === 'number' ? sogRaw : 0} m/s (raw: ${JSON.stringify(sogRaw)})`);
            console.log(`COG: ${typeof cogRaw === 'number' ? cogRaw : 0} rad (raw: ${JSON.stringify(cogRaw)})`);
            console.log(`Heading: ${typeof headingRaw === 'number' ? headingRaw : 0} rad`);
            console.log(`State: ${nav.state?.value || 'unknown'}`);
            console.log(`CallSign: '${vessel.callSign}'`);
            console.log(`CallSign Length: ${vessel.callSign.length}`);
            console.log(`CallSign 6-bit encoded: ${AISEncoder.callsignToSixBit(vessel.callSign)}`);
            
            // Design-Daten
            const design = vessel.design || {};
            console.log(`\nDesign Data:`);
            console.log(`  Length: ${design.length?.value?.overall || 0} m`);
            console.log(`  Beam: ${design.beam?.value || 0} m`);
            console.log(`  Draft: ${design.draft?.value?.maximum || 0} m`);
            console.log(`  Ship Type: ${design.aisShipType?.value?.id || 0} (${design.aisShipType?.value?.name || 'Unknown'})`);
            
            // Destination & ETA
            const destination = vessel.navigation?.destination?.commonName?.value || '';
            const eta = vessel.navigation?.courseGreatCircle?.activeRoute?.estimatedTimeOfArrival?.value || '';
            console.log(`\nVoyage Data:`);
            console.log(`  Destination: '${destination}'`);
            console.log(`  ETA: '${eta}'`);
            console.log(`  IMO: '${vessel.imo || '0'}'`);
            
            console.log(`\nType 1 (Position Report):`);
            console.log(sentence1);
          }
        }

        // Type 5 - nur senden wenn CallSign vorhanden ist
        if (vessel.callSign && vessel.callSign.length > 0) {
          const payload5 = AISEncoder.createStaticVoyage(vessel);
          if (payload5) {
            // Type 5 ist immer 424 bits = 71 chars (424/6 aufgerundet)
            // Split in 2 sentences (max 62 chars per fragment)
            if (payload5.length <= 62) {
              // Passt in ein Fragment
              const sentence5 = AISEncoder.createNMEASentence(payload5, 1, 1, this.messageIdCounter, 'B');
              this.server.broadcast(sentence5);
              
              if (vessel.name === 'VIVRE' || vessel.name === 'ARGUS' || vessel.name === 'MS ROSE') {
                console.log(`\nType 5 (Static Data) Single Fragment:`);
                console.log(sentence5);
              }
            } else {
              // Braucht 2 Fragmente
              const fragment1 = payload5.substring(0, 62);
              const fragment2 = payload5.substring(62);
              
              const sentence5_1 = AISEncoder.createNMEASentence(fragment1, 2, 1, this.messageIdCounter, 'B');
              const sentence5_2 = AISEncoder.createNMEASentence(fragment2, 2, 2, this.messageIdCounter, 'B');
              
              this.server.broadcast(sentence5_1);
              this.server.broadcast(sentence5_2);
              
              if (vessel.name === 'VIVRE' || vessel.name === 'ARGUS' || vessel.name === 'MS ROSE') {
                console.log(`\nType 5 (Static Data) Fragment 1/2:`);
                console.log(sentence5_1);
                console.log(`  Fragment 1 payload length: ${fragment1.length}`);
                console.log(`\nType 5 (Static Data) Fragment 2/2:`);
                console.log(sentence5_2);
                console.log(`  Fragment 2 payload length: ${fragment2.length}`);
                console.log(`  Total payload length: ${payload5.length}`);
              }
            }
          }
        } else {
          if (vessel.name === 'VIVRE' || vessel.name === 'ARGUS' || vessel.name === 'MS ROSE') {
            console.log(`\nType 5 skipped - no CallSign available`);
          }
        }
      });
      
      console.log(`\nBroadcasted messages for ${vessels.length} vessels`);
    } catch(err) {
      console.error('Error updating vessels:', err);
    }
  }

  stop() {
    if (this.interval) clearInterval(this.interval);
    this.server.stop();
    console.log('Converter stopped');
  }
}

// Start
const converter = new AISConverter(CONFIG);
converter.start();

process.on('SIGINT', () => { converter.stop(); process.exit(0); });
process.on('SIGTERM', () => { converter.stop(); process.exit(0); });

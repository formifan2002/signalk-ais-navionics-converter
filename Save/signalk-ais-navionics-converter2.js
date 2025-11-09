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
    for (let i = 0; i < bits.length; i += 6) {
      let chunk = bits.substr(i, 6).padEnd(6, '0');
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

      const navStatus = vessel.navStatus ?? 5; // Moored default
      const timestamp = vessel.timestamp ?? 15; // UTC Seconds
      const raim = vessel.raim ?? 0;           // RAIM
      const maneuver = vessel.maneuver ?? 0;   // Maneuver Indicator
      const rot = vessel.rot ?? 128;           // Rate of Turn
      const speedOverGround = nav.speedOverGround?.value || nav.speedOverGround || 0;
      const courseOverGround = nav.courseOverGroundTrue?.value || nav.courseOverGroundTrue || 0;
      const headingTrue = nav.headingTrue?.value || nav.headingTrue || 0;

      const lon = Math.round(longitude * 600000);
      const lat = Math.round(latitude * 600000);
      const sog = Math.round(speedOverGround * 10); // 0.1 knots
      const cog = Math.round(courseOverGround * 10);
      const heading = Math.round(headingTrue);

      let bits = '';
      bits += (1).toString(2).padStart(6, '0');               // Message Type 1
      bits += (0).toString(2).padStart(2, '0');               // Repeat
      bits += mmsi.toString(2).padStart(30, '0');             // MMSI
      bits += navStatus.toString(2).padStart(4, '0');         // Navigation Status
      bits += rot.toString(2).padStart(8, '0');               // ROT
      bits += sog.toString(2).padStart(10, '0');              // SOG
      bits += (0).toString(2);                                // Position Accuracy
      bits += this.toTwosComplement(lon, 28).toString(2).padStart(28, '0'); // Longitude
      bits += this.toTwosComplement(lat, 27).toString(2).padStart(27, '0'); // Latitude
      bits += cog.toString(2).padStart(12, '0');              // COG
      bits += heading.toString(2).padStart(9, '0');           // True Heading
      bits += timestamp.toString(2).padStart(6, '0');         // Timestamp
      bits += maneuver.toString(2).padStart(2, '0');          // Maneuver Indicator
      bits += '000';                                          // Spare
      bits += raim.toString();                                // RAIM
      bits += '0000000000000000000';                          // Radio Status

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
      const imo = parseInt(vessel.imo);
	  
      // Hole Design-Daten
      const design = vessel.design || {};
      const length = design.length?.value?.overall || 0;
      const beam = design.beam?.value || 0;
      const shipType = design.aisShipType?.value?.id || 0;
      
      // Hole Dimensions aus sensors.ais falls vorhanden
      const ais = vessel.sensors?.ais || {};
      const fromBow = ais.fromBow?.value || 0;
      const fromCenter = ais.fromCenter?.value || 0;
      
      // Berechne Dimensionen für AIS
      const toBow = Math.round(fromBow);
      const toStern = Math.round(length - fromBow);
      const toPort = Math.round(beam / 2 - fromCenter);
      const toStarboard = Math.round(beam / 2 + fromCenter);

      // Hole destination falls vorhanden
      const destination = vessel.navigation?.destination?.commonName?.value || '';

      let bits = '';
      bits += (5).toString(2).padStart(6,'0');              // Type
      bits += (0).toString(2).padStart(2,'0');              // Repeat
      bits += mmsi.toString(2).padStart(30,'0');            // MMSI
      bits += (0).toString(2).padStart(2,'0');              // AIS Version
      bits += imo.toString(2).padStart(30,'0');             // IMO Number
      bits += this.callsignToSixBit(vessel.callSign ?? ''); // CallSign
      bits += this.textToSixBit(vessel.name ?? '', 20);     // Ship Name
      bits += shipType.toString(2).padStart(8,'0');         // Ship Type
      bits += toBow.toString(2).padStart(9,'0');            // To Bow
      bits += toStern.toString(2).padStart(9,'0');          // To Stern
      bits += toPort.toString(2).padStart(6,'0');           // To Port
      bits += toStarboard.toString(2).padStart(6,'0');      // To Starboard
      bits += (1).toString(2).padStart(4,'0');              // EPFD
      bits += (0).toString(2).padStart(4,'0');              // ETA Month
      bits += (0).toString(2).padStart(5,'0');              // ETA Day
      bits += (0).toString(2).padStart(5,'0');              // ETA Hour
      bits += (0).toString(2).padStart(6,'0');              // ETA Minute
      bits += (0).toString(2).padStart(8,'0');              // Draught
      bits += this.textToSixBit(destination, 20);           // Destination
      bits += (0).toString(2);                              // DTE
      bits += '0';                                          // Spare

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
          
          // Debug für VIVRE
          if (vessel.name === 'VIVRE') {
            console.log(`\n=== DEBUG: ${vessel.name} ===`);
            console.log(`MMSI: ${vessel.mmsi}`);
            const nav = vessel.navigation || {};
            const pos = nav.position?.value || nav.position || {};
            console.log(`Position: Lat ${pos.latitude}, Lon ${pos.longitude}`);
            console.log(`SOG: ${nav.speedOverGround?.value || nav.speedOverGround || 0} m/s`);
            console.log(`COG: ${nav.courseOverGroundTrue?.value || nav.courseOverGroundTrue || 0} rad`);
            console.log(`Heading: ${nav.headingTrue?.value || nav.headingTrue || 0} rad`);
            console.log(`CallSign: '${vessel.callSign}'`);
            console.log(`CallSign Length: ${vessel.callSign.length}`);
            console.log(`CallSign 6-bit encoded: ${AISEncoder.callsignToSixBit(vessel.callSign)}`);
            
            // Design-Daten
            const design = vessel.design || {};
            console.log(`\nDesign Data:`);
            console.log(`  Length: ${design.length?.value?.overall || 0} m`);
            console.log(`  Beam: ${design.beam?.value || 0} m`);
            console.log(`  Ship Type: ${design.aisShipType?.value?.id || 0} (${design.aisShipType?.value?.name || 'Unknown'})`);
            
            console.log(`\nType 1 (Position Report):`);
            console.log(sentence1);
          }
        }

        // Type 5
        const payload5 = AISEncoder.createStaticVoyage(vessel);
        if (payload5) {
          // Split in 2 sentences if too long
          const maxPayload = 62; // 62 chars ~ 372 bits
          const fragments = [];
          for (let i=0;i<payload5.length;i+=maxPayload) fragments.push(payload5.substr(i,maxPayload));
          fragments.forEach((frag,index)=>{
            const sentence5 = AISEncoder.createNMEASentence(frag,fragments.length,index+1,this.messageIdCounter,'B');
            this.server.broadcast(sentence5);
            
            // Debug für VIVRE
            if (vessel.name === 'VIVRE') {
              console.log(`\nType 5 (Static Data) Fragment ${index+1}/${fragments.length}:`);
              console.log(sentence5);
            }
          });
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

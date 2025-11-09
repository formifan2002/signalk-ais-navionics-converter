const net = require('net');
const http = require('http');

// --------------------
// Konfiguration
// --------------------
const CONFIG = {
  signalkHost: '192.168.188.25',
  signalkPort: 4000,
  nmeaPort: 10113,
  updateInterval: 5000, // alle 5 Sekunden
};

// --------------------
// AIS Encoder
// --------------------
class AISEncoder {
  static encode6bit(val) {
    if (val < 0 || val > 63) throw new Error("6-bit out of range");
    return val <= 39 ? String.fromCharCode(val + 48) : String.fromCharCode(val + 56);
  }

  static toTwosComplement(value, bits) {
    if (value < 0) value = (1 << bits) + value;
    return value;
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
      const pos = nav.position || {};

      // Robuste Positionsabfrage
      const latitude = pos.latitude 
                    ?? pos.value?.latitude 
                    ?? nav.position?.value?.latitude 
                    ?? nav.position?.latitude;

      const longitude = pos.longitude 
                     ?? pos.value?.longitude 
                     ?? nav.position?.value?.longitude 
                     ?? nav.position?.longitude;

      if (latitude === undefined || longitude === undefined) return null;

      const navStatus = vessel.navStatus ?? 5;
      const timestamp = vessel.timestamp ?? 15;
      const raim = vessel.raim ?? 0;
      const maneuver = vessel.maneuver ?? 0;
      const rot = vessel.rot ?? 128;
      const speedOverGround = nav.speedOverGround?.value ?? nav.speedOverGround ?? 0;
      const courseOverGround = nav.courseOverGroundTrue?.value ?? nav.courseOverGroundTrue ?? 0;
      const headingTrue = nav.headingTrue?.value ?? nav.headingTrue ?? 0;

      const lon = Math.round(longitude * 600000);
      const lat = Math.round(latitude * 600000);
      const sog = Math.round(speedOverGround * 10);
      const cog = Math.round(courseOverGround * 10);
      const heading = Math.round(headingTrue);

      let bits = '';
      bits += (1).toString(2).padStart(6, '0');
      bits += (0).toString(2).padStart(2, '0');
      bits += mmsi.toString(2).padStart(30, '0');
      bits += navStatus.toString(2).padStart(4, '0');
      bits += rot.toString(2).padStart(8, '0');
      bits += sog.toString(2).padStart(10, '0');
      bits += (0).toString(2);
      bits += this.toTwosComplement(lon, 28).toString(2).padStart(28, '0');
      bits += this.toTwosComplement(lat, 27).toString(2).padStart(27, '0');
      bits += cog.toString(2).padStart(12, '0');
      bits += heading.toString(2).padStart(9, '0');
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

  static createNMEASentence(payload, fragmentCount = 1, fragmentNum = 1, messageId = null, channel = 'B') {
    const msgId = messageId !== null ? messageId.toString() : '';
    const fillBits = (6 - (payload.length * 6) % 6) % 6;
    const sentence = `AIVDM,${fragmentCount},${fragmentNum},${msgId},${channel},${payload},${fillBits}`;
    const checksum = this.calculateChecksum('!' + sentence);
    return `!${sentence}*${checksum}`;
  }
}

// --------------------
// SignalK Fetcher
// --------------------
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
      vessels.push({
        urn: key,
        mmsi: mmsiMatch[1],
        name: vessel.name || 'Unknown',
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

// --------------------
// NMEA TCP Server
// --------------------
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

// --------------------
// AIS Converter
// --------------------
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

      vessels.forEach(vessel => {
        const payload = AISEncoder.createPositionReport(vessel);
        if (payload) {
          const sentence = AISEncoder.createNMEASentence(payload, 1, 1, this.messageIdCounter, 'B');
          this.server.broadcast(sentence);
          console.log(`[${vessel.name}] NMEA: ${sentence}`);
        } else {
          console.log(`[${vessel.name}] No position data`);
        }
      });
    } catch (err) {
      console.error('Error updating vessels:', err);
    }
  }

  stop() {
    if (this.interval) clearInterval(this.interval);
    this.server.stop();
    console.log('Converter stopped');
  }
}

// --------------------
// Start Converter
// --------------------
const converter = new AISConverter(CONFIG);
converter.start();

process.on('SIGINT', () => { converter.stop(); process.exit(0); });
process.on('SIGTERM', () => { converter.stop(); process.exit(0); });

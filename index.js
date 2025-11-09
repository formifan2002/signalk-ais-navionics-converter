const net = require('net');
const dgram = require('dgram');
const AISEncoder = require('./ais-encoder');

module.exports = function(app) {
  let plugin = {
    id: 'signalk-ais-nmea-converter',
    name: 'AIS to NMEA 0183 Converter',
    description: 'Converts AIS data to NMEA 0183 sentences for TCP clients and VesselFinder'
  };

  let tcpServer = null;
  let udpClient = null;
  let updateInterval = null;
  let vesselFinderInterval = null;
  let tcpClients = [];
  let newClients = [];
  let previousVesselsState = new Map();
  let messageIdCounter = 0;
  let ownMMSI = null;
  let vesselFinderLastUpdate = 0;

  plugin.schema = {
    type: 'object',
    required: ['tcpPort'],
    properties: {
      tcpPort: {
        type: 'number',
        title: 'TCP Port',
        description: 'Port for NMEA TCP server',
        default: 10113
      },
      updateInterval: {
        type: 'number',
        title: 'Update Interval (seconds)',
        description: 'How often to send updates to TCP clients',
        default: 15
      },
      skipWithoutCallsign: {
        type: 'boolean',
        title: 'Skip vessels without callsign',
        default: false
      },
      skipStaleData: {
        type: 'boolean',
        title: 'Skip vessels with stale data',
        default: true
      },
      staleDataThresholdMinutes: {
        type: 'number',
        title: 'Stale data threshold (minutes)',
        default: 60
      },
      minAlarmSOG: {
        type: 'number',
        title: 'Minimum SOG for alarm (m/s)',
        description: 'SOG below this value will be set to 0',
        default: 0.2
      },
      logMMSI: {
        type: 'string',
        title: 'Debug MMSI',
        description: 'MMSI for detailed debug output (empty = all)',
        default: ''
      },
      vesselFinderEnabled: {
        type: 'boolean',
        title: 'Enable VesselFinder forwarding',
        default: false
      },
      vesselFinderHost: {
        type: 'string',
        title: 'VesselFinder Host',
        default: 'ais.vesselfinder.com'
      },
      vesselFinderPort: {
        type: 'number',
        title: 'VesselFinder Port',
        default: 5500
      },
      vesselFinderUpdateRate: {
        type: 'number',
        title: 'VesselFinder Update Rate (seconds)',
        default: 60
      }
    }
  };

  plugin.start = function(options) {
    app.debug('Starting AIS to NMEA Converter plugin');
    
    // Hole eigene MMSI
    getOwnMMSI().then(() => {
      startTCPServer(options);
      startUpdateLoop(options);
      
      if (options.vesselFinderEnabled && options.vesselFinderHost) {
        startVesselFinderForwarding(options);
      }
    });
  };

  plugin.stop = function() {
    app.debug('Stopping AIS to NMEA Converter plugin');
    
    if (updateInterval) clearInterval(updateInterval);
    if (vesselFinderInterval) clearInterval(vesselFinderInterval);
    
    if (tcpServer) {
      tcpClients.forEach(client => client.destroy());
      tcpClients = [];
      tcpServer.close();
      tcpServer = null;
    }
    
    if (udpClient) {
      udpClient.close();
      udpClient = null;
    }
    
    previousVesselsState.clear();
  };

  function getOwnMMSI() {
    return new Promise((resolve) => {
      if (ownMMSI) {
        resolve(ownMMSI);
        return;
      }
      
      const selfData = app.getSelfPath('mmsi');
      if (selfData) {
        ownMMSI = selfData.toString();
        app.debug(`Own MMSI detected: ${ownMMSI}`);
      }
      resolve(ownMMSI);
    });
  }

  function startTCPServer(options) {
    tcpServer = net.createServer((socket) => {
      app.debug(`TCP client connected: ${socket.remoteAddress}:${socket.remotePort}`);
      tcpClients.push(socket);
      newClients.push(socket);

      socket.on('end', () => {
        app.debug(`TCP client disconnected`);
        tcpClients = tcpClients.filter(c => c !== socket);
        newClients = newClients.filter(c => c !== socket);
      });

      socket.on('error', (err) => {
        app.error(`TCP socket error: ${err}`);
        tcpClients = tcpClients.filter(c => c !== socket);
        newClients = newClients.filter(c => c !== socket);
      });
    });

    tcpServer.listen(options.tcpPort, () => {
      app.debug(`NMEA TCP Server listening on port ${options.tcpPort}`);
      app.setPluginStatus(`TCP Server running on port ${options.tcpPort}`);
    });
  }

  function startVesselFinderForwarding(options) {
    udpClient = dgram.createSocket('udp4');
    app.debug(`VesselFinder UDP forwarding enabled: ${options.vesselFinderHost}:${options.vesselFinderPort}`);
  }

  function broadcastTCP(message) {
    tcpClients.forEach(client => {
      try {
        client.write(message + '\r\n');
      } catch (err) {
        app.error(`Error broadcasting to TCP client: ${err}`);
      }
    });
  }

  function sendToVesselFinder(message, options) {
    if (!udpClient || !options.vesselFinderEnabled) return;
    
    try {
      const buffer = Buffer.from(message + '\r\n');
      udpClient.send(buffer, 0, buffer.length, options.vesselFinderPort, options.vesselFinderHost, (err) => {
        if (err) {
          app.error(`Error sending to VesselFinder: ${err}`);
        }
      });
    } catch (error) {
      app.error(`VesselFinder send error: ${error}`);
    }
  }

  function startUpdateLoop(options) {
    // Initiales Update
    processVessels(options, 'Startup');
    
    // Regelmäßige Updates
    updateInterval = setInterval(() => {
      processVessels(options, 'Scheduled');
    }, options.updateInterval * 1000);
  }

  function getVessels() {
    const vessels = [];
    const allVessels = app.getPath('vessels');
    
    if (!allVessels) return vessels;
    
    for (const [vesselId, vessel] of Object.entries(allVessels)) {
      if (vesselId === 'self') continue;
      
      const mmsiMatch = vesselId.match(/mmsi:(\d+)/);
      if (!mmsiMatch) continue;
      
      const mmsi = mmsiMatch[1];
      if (ownMMSI && mmsi === ownMMSI) continue;
      
      vessels.push({
        mmsi: mmsi,
        name: vessel.name || 'Unknown',
        callsign: vessel.callsign || vessel.callSign || vessel.communication?.callsignVhf || '',
        navigation: vessel.navigation || {},
        design: vessel.design || {},
        sensors: vessel.sensors || {},
        imo: vessel.imo || '0'
      });
    }
    
    return vessels;
  }

  function filterVessels(vessels, options) {
    const now = new Date();
    const filtered = [];
    
    for (const vessel of vessels) {
      let callSign = vessel.callsign || '';
      const hasRealCallsign = callSign && callSign.length > 0;
      
      if (!hasRealCallsign) {
        callSign = 'UNKNOWN';
      }
      
      // Stale data check
      if (options.skipStaleData) {
        const posTimestamp = vessel.navigation?.position?.timestamp;
        if (posTimestamp) {
          const lastUpdate = new Date(posTimestamp);
          const ageMs = now - lastUpdate;
          const thresholdMs = options.staleDataThresholdMinutes * 60 * 1000;
          
          if (ageMs > thresholdMs) {
            const ageSec = Math.floor(ageMs / 1000);
            const days = Math.floor(ageSec / 86400);
            const hours = Math.floor((ageSec % 86400) / 3600);
            const minutes = Math.floor((ageSec % 3600) / 60);
            
            let ageStr = '';
            if (days > 0) ageStr += `${days}d `;
            if (hours > 0) ageStr += `${hours}h `;
            if (minutes > 0) ageStr += `${minutes}m`;
            
            if (!options.logMMSI || vessel.mmsi === options.logMMSI) {
              app.debug(`Skipped (stale): ${vessel.mmsi} ${vessel.name} - ${ageStr.trim()} ago`);
            }
            continue;
          }
        }
      }
      
      // Callsign check
      if (options.skipWithoutCallsign && !hasRealCallsign) {
        if (!options.logMMSI || vessel.mmsi === options.logMMSI) {
          app.debug(`Skipped (no callsign): ${vessel.mmsi} ${vessel.name}`);
        }
        continue;
      }
      
      vessel.callSign = callSign;
      filtered.push(vessel);
    }
    
    return filtered;
  }

  function processVessels(options, reason) {
    try {
      const vessels = getVessels();
      const filtered = filterVessels(vessels, options);
      
      messageIdCounter = (messageIdCounter + 1) % 10;
      const hasNewClients = newClients.length > 0;
      const nowTimestamp = Date.now();
      const vesselFinderUpdateDue = options.vesselFinderEnabled && 
        (nowTimestamp - vesselFinderLastUpdate) >= (options.vesselFinderUpdateRate * 1000);
      
      let sentCount = 0;
      let unchangedCount = 0;
      let vesselFinderCount = 0;
      
      filtered.forEach(vessel => {
        const currentState = JSON.stringify({
          position: vessel.navigation?.position,
          speedOverGround: vessel.navigation?.speedOverGround,
          courseOverGroundTrue: vessel.navigation?.courseOverGroundTrue,
          headingTrue: vessel.navigation?.headingTrue,
          state: vessel.navigation?.state,
          name: vessel.name,
          callSign: vessel.callSign
        });
        
        const previousState = previousVesselsState.get(vessel.mmsi);
        const hasChanged = !previousState || previousState !== currentState || hasNewClients;
        
        if (!hasChanged && !vesselFinderUpdateDue) {
          unchangedCount++;
          return;
        }
        
        previousVesselsState.set(vessel.mmsi, currentState);
        
        // Type 1
        const payload1 = AISEncoder.createPositionReport(vessel, options);
        if (payload1) {
          const sentence1 = AISEncoder.createNMEASentence(payload1, 1, 1, messageIdCounter, 'B');
          
          if (hasChanged) {
            broadcastTCP(sentence1);
            sentCount++;
          }
          
          if (vesselFinderUpdateDue) {
            sendToVesselFinder(sentence1, options);
            vesselFinderCount++;
          }
        }
        
        // Type 5
        const shouldSendType5 = vessel.callSign && vessel.callSign.length > 0 && 
                                (vessel.callSign !== 'UNKNOWN' || !options.skipWithoutCallsign);
        
        if (shouldSendType5) {
          const payload5 = AISEncoder.createStaticVoyage(vessel);
          if (payload5) {
            if (payload5.length <= 62) {
              const sentence5 = AISEncoder.createNMEASentence(payload5, 1, 1, messageIdCounter, 'B');
              if (hasChanged) broadcastTCP(sentence5);
              if (vesselFinderUpdateDue) sendToVesselFinder(sentence5, options);
            } else {
              const fragment1 = payload5.substring(0, 62);
              const fragment2 = payload5.substring(62);
              const sentence5_1 = AISEncoder.createNMEASentence(fragment1, 2, 1, messageIdCounter, 'B');
              const sentence5_2 = AISEncoder.createNMEASentence(fragment2, 2, 2, messageIdCounter, 'B');
              
              if (hasChanged) {
                broadcastTCP(sentence5_1);
                broadcastTCP(sentence5_2);
              }
              if (vesselFinderUpdateDue) {
                sendToVesselFinder(sentence5_1, options);
                sendToVesselFinder(sentence5_2, options);
              }
            }
          }
        }
      });
      
      if (hasNewClients) {
        newClients = [];
      }
      
      if (vesselFinderUpdateDue) {
        vesselFinderLastUpdate = nowTimestamp;
        app.debug(`VesselFinder: sent ${vesselFinderCount} vessels`);
      }
      
      app.debug(`${reason}: sent ${sentCount}, unchanged ${unchangedCount}, clients ${tcpClients.length}`);
      
    } catch (err) {
      app.error(`Error processing vessels: ${err}`);
    }
  }

  return plugin;
};
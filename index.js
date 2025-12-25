const net = require('net');
const dgram = require('dgram');
const axios = require('axios');
const AISEncoder = require('./ais-encoder');
const WebSocket = require('ws');

module.exports = function(app) {
  let plugin = {
    id: 'signalk-ais-navionics-converter',
    name: 'AIS to NMEA 0183 converter for TPC clients (e.g. Navionics, OpenCpn)',
    description: 'SignalK plugin to convert AIS data to NMEA 0183 sentences to TCP clients (e.g. Navionics boating app, OpenCpn) and optional to vesselfinder.com'
  };
  const encoder = new AISEncoder(app);
  let tcpServer = null;
  let udpClient = null;
  let wsServer = null;
  let updateInterval = null;
  let tcpClients = [];
  let newTcpClients = [];
  let newWSClients = [];
  let previousVesselsState = new Map();
  let lastTCPBroadcast = new Map();
  let messageIdCounter = 0;
  let ownMMSI = null;
  let vesselFinderLastUpdate = 0;
  let signalkApiUrl = null;
  let signalkAisfleetUrl = null;
  let cloudVesselsCache = null;
  let cloudVesselsLastFetch = 0;
  let aisfleetEnabled= false;

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
      wsPort: { 
        type: 'number',
        title: 'WebSocket Port for AIS and last position timestamp data',
        description: 'Port for WebSocket server (web clients can connect here)',
        default: 10114
      },
      updateInterval: {
        type: 'number',
        title: 'Update interval for changed vessels (seconds, default: 15)',
        description: 'How often to send updates to TCP clients (only changed vessels)',
        default: 15
      },
      tcpResendInterval: {
        type: 'number',
        title: 'Update interval for unchanged vessels (seconds, default: 60)',
        description: 'How often to resend unchanged vessels to TCP clients (0=disabled) - if 0 or too high vessels might disappear in Navionics boating app', 
        default: 60
      },
      skipWithoutCallsign: {
        type: 'boolean',
        title: 'Skip vessels without callsign',
        description: 'Vessels without callsign will not be send', 
        default: false
      },
      skipStaleData: {
        type: 'boolean',
        title: 'Skip vessels with stale data',
        description: 'Do not send vessels without unchanged data (yes/no, default: yes)', 
        default: true
      },
      staleDataThresholdMinutes: {
        type: 'number',
        title: 'Stale data threshold (minutes)',
        description: 'Data where the position timestamp is older then n minutes will not be send',
        default: 60
      },
      staleDataShipnameAddTime: {
        type: 'number',
        title: 'Timestamp last update of position added to ship name (minutes, 0=disabled)',
        description: 'The timestamp of the last position update will be added to the ship name, if the data is older then actual time - minutes',
        default: 5
      },
      minAlarmSOG: {
        type: 'number',
        title: 'Minimum SOG for alarm (m/s)',
        description: 'SOG below this value will be set to 0',
        default: 0.2
      },
      maxMinutesSOGToZero: {
        type: 'number',
        title: 'Maximum minutes before SOG is set to 0 (0=no correction of SOG)',
        description: 'SOG will be set to 0 if last position timestamp is older then current time - minutes',
        default: 0
      },      
      logDebugDetails: {
        type: 'boolean',
        title: 'Debug vessel details',
        description: 'Detailed debug output in server log for all vessels - only visible if plugin is in debug mode',
        default: false
      },
      logMMSI: {
        type: 'string',
        title: 'Debug only MMSI',
        description: 'Only data for this MMSI will be shown in the detailed debug output in server log - only visible if plugin is in debug mode. Must be different from own MMSI.',
        default: ''
      },
      logDebugStale: {
        type: 'boolean',
        title: 'Debug all vessel stale vessels',
        description: 'Detailed debug output in server log for all stale vessels - only visible if plugin is in debug mode and debug all vessel details is enabled',
        default: false
      },
      logDebugJSON: {
        type: 'boolean',
        title: 'Debug all JSON data for vessels',
        description: 'Detailed debug JSON output in server log for all vessels - only visible if plugin is in debug mode and debug all vessel details is enabled',
        default: false
      },
      logDebugAIS: {
        type: 'boolean',
        title: 'Debug all AIS data for vessels',
        description: 'Detailed debug AIS data output in server log for all vessels - only visible if plugin is in debug mode and debug all vessel details is enabled',
        default: false
      },
	  logDebugSOG: {
        type: 'boolean',
        title: 'Debug all vessels with corrected SOG',
        description: 'Detailed debug output in server log for all vessels with corrected SOG - only visible if plugin is in debug mode and debug all vessel details is enabled',
        default: false
      },
      vesselFinderEnabled: {
        type: 'boolean',
        title: 'Enable VesselFinder forwarding',
        description: 'AIS type 1 messages (position) will be send to vesselfinder.com via UDP',
        default: false
      },
      vesselFinderHost: {
        type: 'string',
        title: 'VesselFinder Host (default: ais.vesselfinder.com)',
        default: 'ais.vesselfinder.com'
      },
      vesselFinderPort: {
        type: 'number',
        title: 'VesselFinder UDP Port (default: 5500)',
        default: 5500
      },
      vesselFinderUpdateRate: {
        type: 'number',
        title: 'VesselFinder Update Rate (seconds)',
        default: 60
      },
      cloudVesselsEnabled: {
        type: 'boolean',
        title: 'Include vessels received from AISFleet.com',
        description: 'Beside vessels available in SignalK vessels from aisfleet.com will taken into account',
        default: true
      },
      cloudVesselsUpdateInterval: {
        type: 'number',
        title: 'Cloud vessels update interval (seconds)',
        description: 'How often to fetch vessels from AISFleet.com (default: 60, recommended: 60-300)',
        default: 60
      },
      cloudVesselsRadius: {
        type: 'number',
        title: 'Radius (from own vessel) to include vessels from AISFleet.com (nautical miles)',
        default: 10
      },
      cloudVesselsTimeout: {
        type: 'number',
        title: 'Timeout in seconds to fetch the data from AISFleet.com (default: 15)',
        default: 15
      }
    }
  };

  plugin.start = function(options) {
    app.debug('AIS to NMEA Converter plugin will start in 5 seconds...');

    setTimeout(() => {
      app.debug('Starting AIS to NMEA Converter plugin');

      // Ermittle SignalK API URL
      const port = app.config.settings.port || 3000;
      let hostname = app.config.settings.hostname || '0.0.0.0';
      
      // Wenn 0.0.0.0, verwende 127.0.0.1 für lokale Aufrufe
      if (hostname === '0.0.0.0' || hostname === '::') {
        hostname = '127.0.0.1';
      }
      signalkAisfleetUrl= `http://${hostname}:${port}/signalk/plugins/aisfleet/config`;
      signalkApiUrl = `http://${hostname}:${port}/signalk/v1/api`;

      // Hole eigene MMSI
      getOwnMMSI().then(() => {
        startTCPServer(options);
        if (options.wsPort && options.wsPort > 0){
          startWebSocketServer(options);
        }
        startUpdateLoop(options);

        if (options.vesselFinderEnabled && options.vesselFinderHost) {
          startVesselFinderForwarding(options);
        }
      });
    }, 5000);
  };

  plugin.stop = function() {
    app.debug('Stopping AIS to NMEA Converter plugin');
    
    if (updateInterval) clearInterval(updateInterval);
    
    if (tcpServer) {
      tcpClients.forEach(client => client.destroy());
      tcpClients = [];
      tcpServer.close();
      tcpServer = null;
    }
    if (wsServer) {
      wsServer.clients.forEach(client => client.terminate());
      newWSClients = [];
      wsServer.close();
      wsServer = null;
    }
    if (udpClient) {
      udpClient.close();
      udpClient = null;
    }
    
    previousVesselsState.clear();
    lastTCPBroadcast.clear();
    cloudVesselsCache = null; // ← NEU
    cloudVesselsLastFetch = 0; // ← NEU
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
      newTcpClients.push(socket);

      socket.on('end', () => {
        app.debug(`TCP client disconnected`);
        tcpClients = tcpClients.filter(c => c !== socket);
        newTcpClients = newTcpClients.filter(c => c !== socket);
      });

      socket.on('error', (err) => {
        app.error(`TCP socket error: ${err}`);
        tcpClients = tcpClients.filter(c => c !== socket);
        newTcpClients = newTcpClients.filter(c => c !== socket);
      });
    });

    tcpServer.listen(options.tcpPort, () => {
      const statusText= `TCP Server running on port ${options.tcpPort}` + (options.wsPort && options.wsPort > 0 ? ` - WS server on port ${options.wsPort}` : '');
      app.debug(statusText);
      app.setPluginStatus(statusText);
    });
  }

  function startWebSocketServer(options) {
  const wsPort = options.wsPort || 10114;
  
  try {
    wsServer = new WebSocket.Server({ port: wsPort });
    
    wsServer.on('listening', () => {
      app.debug(`AIS WebSocket Server listening on port ${wsPort}`);
    });
    
    wsServer.on('connection', (ws, req) => {
      const clientIP = req.socket.remoteAddress;
      app.debug(`WebSocket client connected from ${clientIP}`);
      newWSClients.push(ws);
      setTimeout(() => {
        processVessels(options, 'New WebSocket Client connected');
      }, 100);
      ws.isAlive = true;
      ws.on('pong', () => {
        ws.isAlive = true;
      });
      
      ws.on('close', () => {
        newWSClients = newWSClients.filter(c => c !== ws);
        app.debug(`WebSocket client disconnected`);
      });
      
      ws.on('error', (err) => {
        newWSClients = newWSClients.filter(c => c !== ws);
        app.error(`WebSocket client error: ${err.message}`);
      });
    });
    
    // Heartbeat interval (prüft alle 30 Sekunden ob Clients noch verbunden sind)
    const heartbeat = setInterval(() => {
      wsServer.clients.forEach((ws) => {
        if (ws.isAlive === false) {
          return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping();
      });
    }, 30000);
    
    wsServer.on('close', () => {
      clearInterval(heartbeat);
    });
    
    wsServer.on('error', (err) => {
      app.error(`WebSocket Server error: ${err.message}`);
    });
    
  } catch (err) {
    app.error(`Failed to start WebSocket Server: ${err.message}`);
  }
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
    // Broadcast message to SignalK TCP server on port 10110
    // app.emit('nmea0183out', message)
  }

  function broadcastWebSocket(message) {
    if (!wsServer) return;
    
    wsServer.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(message);
        } catch (err) {
          app.error(`Error broadcasting to WebSocket client: ${err}`);
        }
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
    processVessels(options, 'Inital startup');
    
    // Regelmäßige Updates
    updateInterval = setInterval(() => {
      processVessels(options, 'Scheduled resend');
    }, options.updateInterval * 1000);
   
  }

  function fetchVesselsFromAPI() {
    return new Promise((resolve, reject) => {
      if (!signalkApiUrl) {
        app.error('signalkApiUrl not initialized yet');
        resolve(null);
        return;
      }
      
      const url = `${signalkApiUrl}/vessels`;
      app.debug(`Fetching SignalK vessels from URL: ${url}`);
      
      const http = require('http');
      
      http.get(url, (res) => {
        let data = '';
        
        if (res.statusCode !== 200) {
          app.error(`HTTP ${res.statusCode} from ${url}`);
          resolve(null); // ← Wichtig: resolve(null) statt reject()
          return;
        }
        
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          try {
            const result = JSON.parse(data);
            app.debug(`Parsed JSON, ${Object.keys(result).length} vessels from SignalK API`);
            resolve(result);
          } catch (err) {
            app.error(`Invalid JSON from ${url}: ${err.message}`);
            app.error(`Data preview: ${data.substring(0, 200)}`);
            resolve(null); 
          }
        });
      }).on('error', (err) => {
        app.error(`HTTP request error for ${url}: ${err.message}`);
        resolve(null); 
      });
    });
  }

  function fetchCloudVessels(options) {
    if (!options.cloudVesselsEnabled) {
      return Promise.resolve(null);
    }
    
    try {
      // Hole eigene Position
      const position = app.getSelfPath('navigation.position');
      if (!position || !position.value || !position.value.latitude || !position.value.longitude) {
        app.error('No self position available for cloud vessels fetch');
        return Promise.resolve(null);
      }
      
      const lat = position.value.latitude;
      const lng = position.value.longitude;
      const radius = options.cloudVesselsRadius || 10;
      
      if (!ownMMSI) {
        app.error('No own MMSI available for cloud vessels fetch');
        return Promise.resolve(null);
      }
      
      const url = `https://aisfleet.com/api/vessels/nearby?lat=${lat}&lng=${lng}&radius=${radius}&mmsi=${ownMMSI}`;
      app.debug(`Fetching cloud vessels from AISFleet API (radius: ${radius}nm) - URL: ${url}`);
      
      const requestConfig = {
        method: 'get',
        maxBodyLength: Infinity,
        url: url,
        headers: {},
        timeout: ((options?.cloudVesselsTimeout ?? 15) * 1000)
      };
      
      const startTime = Date.now();
      
      return axios.request(requestConfig)
        .then(response => {
          const duration = Date.now() - startTime;
          
          const data = response.data;
          
          if (data.vessels && Array.isArray(data.vessels)) {
            app.debug(`Retrieved ${data.vessels.length} vessels from AISFleet cloud API`);
            
            // Konvertiere zu SignalK-Format
            const cloudVessels = {};
            data.vessels.forEach(vessel => {
              if (!vessel.mmsi || vessel.mmsi === ownMMSI) return;
              
              const vesselId = `urn:mrn:imo:mmsi:${vessel.mmsi}`;
              const vesselData = {};
              
              // Basis-Informationen
              if (vessel.mmsi) {
                vesselData.mmsi = vessel.mmsi;
              }
              
              if (vessel.name) {
                vesselData.name = vessel.name;
              }
              
              if (vessel.call_sign) {
                vesselData.communication = {
                  callsignVhf: vessel.call_sign
                };
              }
              
              if (vessel.imo_number) {
                vesselData.imo = vessel.imo_number;
              }
              
              // Design-Daten - Format kompatibel zu SignalK
              const design = {};
              if (vessel.design_length) {
                design.length = {
                  value: {
                    overall: vessel.design_length
                  }
                };
              }
              if (vessel.design_beam) {
                design.beam = {
                  value: vessel.design_beam
                };
              }
              if (vessel.design_draft) {
                design.draft = {
                  value: {
                    maximum: vessel.design_draft
                  }
                };
              }
              if (vessel.ais_ship_type) {
                design.aisShipType = {
                  value: {
                    id: vessel.ais_ship_type
                  }
                };
              }
              if (Object.keys(design).length > 0) {
                vesselData.design = design;
              }
              
              // Navigation
              const navigation = {};
              
              if (vessel.last_position) {
                navigation.position = {
                  value: {
                    latitude: vessel.last_position.latitude,
                    longitude: vessel.last_position.longitude
                  },
                  timestamp: vessel.last_position.timestamp
                };
              }
              
              if (vessel.latest_navigation) {
                const nav = vessel.latest_navigation;
                const navTimestamp = nav.timestamp;
                
                if (nav.course_over_ground !== null && nav.course_over_ground !== undefined) {
                  // COG 360° ist ungültig, setze auf 0°
                  let cog = nav.course_over_ground;
                  if (cog >= 360) {
                    cog = 0;
                  }
                  navigation.courseOverGroundTrue = {
                    value: cog,
                    timestamp: navTimestamp
                  };
                }
                
                if (nav.speed_over_ground !== null && nav.speed_over_ground !== undefined) {
                  navigation.speedOverGround = {
                    value: nav.speed_over_ground * 0.514444, // knots to m/s
                    timestamp: navTimestamp
                  };
                }
                
                if (nav.heading !== null && nav.heading !== undefined) {
                  // Heading 360° ist ungültig, setze auf 0°
                  let heading = nav.heading;
                  if (heading >= 360) {
                    heading = 0;
                  }
                  navigation.headingTrue = {
                    value: heading * Math.PI / 180, // degrees to radians
                    timestamp: navTimestamp
                  };
                }
                
                if (nav.rate_of_turn !== null && nav.rate_of_turn !== undefined) {
                  navigation.rateOfTurn = {
                    value: nav.rate_of_turn * Math.PI / 180, // degrees/s to radians/s
                    timestamp: navTimestamp
                  };
                }
                
                if (nav.navigation_status !== null && nav.navigation_status !== undefined) {
                  navigation.state = {
                    value: nav.navigation_status,
                    timestamp: navTimestamp
                  };
                }
              }
              
              if (Object.keys(navigation).length > 0) {
                vesselData.navigation = navigation;
              }
              
              cloudVessels[vesselId] = vesselData;
            });
            
            return cloudVessels;
          } else {
            app.debug('No vessels array in AISFleet API response');
            return null;
          }
        })
        .catch(error => {
          if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
            app.error(`AISFleet API timeout after 15s - consider reducing radius or check internet connection`);
          } else if (error.response?.status >= 500) {
            app.error(`AISFleet API fetch failed: server error ${error.response.status}`);
          } else if (error.response?.status === 403) {
            app.error('AISFleet API fetch failed: access denied');
          } else if (error.response?.status) {
            app.error(`AISFleet API fetch failed: HTTP ${error.response.status}`);
          } else if (error.code) {
            app.error(`AISFleet API fetch failed: ${error.code} - ${error.message}`);
          } else {
            app.error(`AISFleet API fetch failed: ${error.message || 'Unknown error'}`);
          }
          return null;
        });
      
    } catch (error) {
      app.error(`Error in fetchCloudVessels: ${error.message}`);
      return Promise.resolve(null);
    }
  }
  
  function mergeVesselData(vessel1, vessel2) {
    // Merge zwei Vessel-Objekte, neuere Timestamps haben Vorrang
    const merged = JSON.parse(JSON.stringify(vessel1)); // Deep copy
    
    if (!vessel2) return merged;
    
    // Spezialbehandlung für name und callsign: Gefüllte Werte haben immer Vorrang
    const vessel1Name = vessel1.name;
    const vessel2Name = vessel2.name;
    const vessel1Callsign = vessel1.communication?.callsignVhf || vessel1.callsign;
    const vessel2Callsign = vessel2.communication?.callsignVhf || vessel2.callsign;
    
    // Name: Bevorzuge gefüllte Werte über "Unknown" oder leere Werte
    if (vessel2Name && vessel2Name !== 'Unknown' && vessel2Name !== '') {
      if (!vessel1Name || vessel1Name === 'Unknown' || vessel1Name === '') {
        merged.name = vessel2Name;
      }
    }
    
    // Callsign: Bevorzuge gefüllte Werte über leere Werte
    if (vessel2Callsign && vessel2Callsign !== '') {
      if (!vessel1Callsign || vessel1Callsign === '') {
        if (!merged.communication) merged.communication = {};
        merged.communication.callsignVhf = vessel2Callsign;
        // Setze auch die anderen Varianten
        merged.callsign = vessel2Callsign;
      }
    }
    
    // Funktion zum Vergleichen und Mergen von Objekten mit Timestamps
    const mergeWithTimestamp = (target, source, path = '') => {
      if (!source) return;
      
      for (const key in source) {
        const sourcePath = path ? `${path}.${key}` : key;
        
        // Überspringe name und callsign-Felder, die bereits behandelt wurden
        if (key === 'name' || key === 'callsign' || key === 'callSign') {
          continue;
        }
        
        // Überspringe communication.callsignVhf, wurde bereits behandelt
        if (path === 'communication' && key === 'callsignVhf') {
          continue;
        }
        
        if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
          // Prüfe ob Objekt einen Timestamp hat
          if (source[key].timestamp && target[key]?.timestamp) {
            const sourceTime = new Date(source[key].timestamp);
            const targetTime = new Date(target[key].timestamp);
            
            if (sourceTime > targetTime) {
              target[key] = source[key];
            }
          } else if (source[key].timestamp && !target[key]?.timestamp) {
            // Source hat Timestamp, Target nicht - nehme Source
            target[key] = source[key];
          } else if (!source[key].timestamp && target[key]?.timestamp) {
            // Target hat Timestamp, Source nicht - behalte Target
            // Nichts tun
          } else {
            // Kein Timestamp in beiden - rekursiv mergen
            if (!target[key]) target[key] = {};
            mergeWithTimestamp(target[key], source[key], sourcePath);
          }
        } else if (!target[key] && source[key]) {
          // Target hat keinen Wert, übernehme von Source
          target[key] = source[key];
        }
      }
    };
    
    mergeWithTimestamp(merged, vessel2);
    return merged;
  }

  function mergeVesselSources(signalkVessels, cloudVessels, options) {
    const merged = {};
    const loggedVessels = new Set();
    const logMMSI = options.logMMSI || '';

    app.debug(`Merging vessels - SignalK: ${signalkVessels ? Object.keys(signalkVessels).length : 0}, Cloud: ${cloudVessels ? Object.keys(cloudVessels).length : 0}`);
    
    // Füge alle SignalK Vessels hinzu
    if (signalkVessels) {
      for (const [vesselId, vessel] of Object.entries(signalkVessels)) {
        merged[vesselId] = vessel;
      }
    }
    
    // Merge SignalK Schiffe mit Cloud Schiffen
    if (cloudVessels) {
      for (const [vesselId, cloudVessel] of Object.entries(cloudVessels)) {
        const mmsiMatch = vesselId.match(/mmsi:(\d+)/);
        const mmsi = mmsiMatch ? mmsiMatch[1] : null;
        const shouldLog = options.logDebugJSON && options.logDebugDetails && (mmsi === "" || mmsi === logMMSI)
        if (merged[vesselId]) {
          // Schiff existiert in beiden Quellen - merge mit Timestamp-Vergleich
          merged[vesselId] = mergeVesselData(merged[vesselId], cloudVessel);
          if (shouldLog) {
            app.debug(`Merged vessel ${vesselId} (${mmsi}):`);
            app.debug(JSON.stringify(merged[vesselId], null, 2));
            loggedVessels.add(vesselId);
          }
        } else {
          // Schiff nur in Cloud - direkt hinzufügen
          merged[vesselId] = cloudVessel;
          if (shouldLog) {
            app.debug(`Cloud-only vessel ${vesselId} (${mmsi}):`);
            app.debug(JSON.stringify(cloudVessel, null, 2));
            loggedVessels.add(vesselId);
          }
        }
      }
    }

    for (const [vesselId, vessel] of Object.entries(merged)) {

      // MMSI extrahieren
      const mmsiMatch = vesselId.match(/mmsi:(\d+)/);
      const mmsi = mmsiMatch ? mmsiMatch[1] : null;

      const vessel = merged[vesselId];
      const name = vessel?.name;
      const ts = vessel?.navigation?.position?.timestamp;
      const staleLimit = options.staleDataShipnameAddTime;

      if (name && ts && staleLimit > 0) {

        const diffMinutes = Math.floor((Date.now() - new Date(ts)) / 60000);

        if (diffMinutes >= staleLimit) {

          let suffix;
          if (diffMinutes >= 1440) {
            suffix = ` DAY${Math.ceil(diffMinutes / 1440)}`;
          } else if (diffMinutes >= 60) {
            suffix = ` HOUR${Math.ceil(diffMinutes / 60)}`;
          } else {
            suffix = ` MIN${diffMinutes}`;
          }

          vessel.nameStale = `${name}${suffix}`.substring(0, 20);
        }
      }
      const shouldLog = options.logDebugJSON && options.logDebugDetails && (mmsi === "" || mmsi === logMMSI) && !loggedVessels.has(vesselId)
      if (shouldLog) {
        app.debug(`SignalK-only vessel ${vesselId} (${mmsi}):`);
        app.debug(JSON.stringify(vessel, null, 2));
      }
    }
    app.debug(`Total merged vessels: ${Object.keys(merged).length}`);
    return merged;
  }

function getVessels(options,aisfleetEnabled) {
    const now = Date.now();
    const cloudUpdateInterval = (options.cloudVesselsUpdateInterval || 60) * 1000; // Default 60 Sekunden
    
    // Entscheide ob Cloud Vessels neu geholt werden müssen
    const needsCloudUpdate = options.cloudVesselsEnabled && !aisfleetEnabled && 
      (now - cloudVesselsLastFetch >= cloudUpdateInterval);
    const cloudPromise = needsCloudUpdate 
      ? fetchCloudVessels(options).then(result => {
          if (result) {
            cloudVesselsCache = result;
            cloudVesselsLastFetch = now;
          }
          return cloudVesselsCache;
        })
      : Promise.resolve(cloudVesselsCache);
    
    return Promise.all([
      fetchVesselsFromAPI(),
      cloudPromise
    ]).then(([signalkVessels, cloudVessels]) => {
      const vessels = [];
      
      // Merge beide Datenquellen (falls aisfleet plugin nicht aktiviert ist)
      const allVessels =  mergeVesselSources(signalkVessels, cloudVessels, options)
      
      if (!allVessels) return vessels;      
      for (const [vesselId, vessel] of Object.entries(allVessels)) {
        if (vesselId === 'self') continue;
        
        const mmsiMatch = vesselId.match(/mmsi:(\d+)/);
        if (!mmsiMatch) continue;
        
        const mmsi = mmsiMatch[1];
        if (ownMMSI && mmsi === ownMMSI) continue;
        
        // IMO-Extraktion verbessert - prüfe mehrere Quellen und filtere ungültige Werte
        let imo = null;
        
        // Prüfe vessel.registrations.imo zuerst (häufigste SignalK-Struktur)
        if (vessel.registrations?.imo) {
          const imoStr = vessel.registrations.imo.toString().replace(/[^\d]/g, '');
          const imoNum = parseInt(imoStr);
          if (imoNum && imoNum > 0) {
            imo = imoNum;
          }
        }
        
        // Falls nicht gefunden, prüfe vessel.imo
        if (!imo && vessel.imo) {
          const imoStr = vessel.imo.toString().replace(/[^\d]/g, '');
          const imoNum = parseInt(imoStr);
          if (imoNum && imoNum > 0) {
            imo = imoNum;
          }
        }
        
        // Fallback auf 0 wenn nichts gefunden
        if (!imo) {
          imo = 0;
        }
        
        vessels.push({
          mmsi: mmsi,
          name: vessel.nameStale || vessel.name || 'Unknown',
          callsign: vessel.callsign || vessel.callSign || vessel.communication?.callsignVhf || '',
          navigation: vessel.navigation || {},
          design: vessel.design || {},
          sensors: vessel.sensors || {},
          destination: vessel.navigation?.destination?.commonName?.value || null,
          imo: imo
        });
      }
      
      return vessels;
    }).catch(err => {
      app.error(`Error in getVessels: ${err}`);
      return [];
    });
  }

  function filterVessels(vessels, options) {
    const now = new Date();
    const filtered = [];
    let countStale = 0;
    let countNoCallsign = 0;
    let countInvalidMMSI = 0;
    let countInvalidNameAndMMSI = 0;
    let countBaseStations = 0;
    for (const vessel of vessels) {
      if (vessel?.sensors?.ais?.class?.meta?.value === "BASE") {
        countBaseStations++;
        continue; // Überspringe Basisstationen
      }
      if (!vessel.mmsi || vessel.mmsi.length !== 9 || isNaN(parseInt(vessel.mmsi))) {
        if (options.logDebugDetails && (!options.logMMSI || vessel.mmsi === options.logMMSI)) {
          app.debug(`Skipped (invalid MMSI): ${vessel.mmsi} ${vessel.name}`);
        }
        countInvalidMMSI++;
        continue;
      }
      let callsign = vessel.callsign || '';
      const hasRealCallsign = callsign && callsign.length > 0;
      
      if (!hasRealCallsign) {
        callsign = 'UNKNOWN';
      }
      
      // Hole Position Timestamp für mehrere Checks
      let posTimestamp = vessel.navigation?.position?.timestamp;
      
      // Fallback für verschachtelte Strukturen (z.B. nach Merge)
      if (!posTimestamp && vessel.navigation?.position?.value) {
        posTimestamp = vessel.navigation.position.value.timestamp;
      }
      
      // Stale data check
      if (options.skipStaleData && posTimestamp) {
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
          
          if (options.logDebugDetails && options.logDebugStale &&  (!options.logMMSI || vessel.mmsi === options.logMMSI)) {
            app.debug(`Skipped (stale): ${vessel.mmsi} ${vessel.name} - ${ageStr.trim()} ago`);
          }
          countStale++;
          continue;
        }
      }
      
      // SOG Korrektur basierend auf Position Timestamp Alter
      if (options.maxMinutesSOGToZero > 0 && posTimestamp) {
        const lastUpdate = new Date(posTimestamp);
        const ageMs = now - lastUpdate;
        const sogThresholdMs = options.maxMinutesSOGToZero * 60 * 1000;
        if (ageMs > sogThresholdMs) {
          // Position ist zu alt, setze SOG auf 0
          if (vessel.navigation && vessel.navigation.speedOverGround) {
            let originalSOG = vessel.navigation.speedOverGround.value !== undefined 
              ? vessel.navigation.speedOverGround.value 
              : vessel.navigation.speedOverGround;
            
            // Stelle sicher, dass originalSOG eine Zahl ist
            if (typeof originalSOG !== 'number') {
              originalSOG = 0;
            }
            
            if (vessel.navigation.speedOverGround.value !== undefined) {
              vessel.navigation.speedOverGround.value = 0;
            } else {
              vessel.navigation.speedOverGround = 0;
            }

            if (options.logDebugDetails && options.logDebugSOG && (!options.logMMSI || vessel.mmsi === options.logMMSI)) {
              const ageMinutes = Math.floor(ageMs / 60000)
              app.debug(`SOG corrected to 0 for ${vessel.mmsi} ${vessel.name} - position age: ${ageMinutes}min (was: ${originalSOG.toFixed(2)} m/s)`);
            }
          }
        }
      }

     // Filtere Schiffe ohne Name und Callsign aus
      const hasValidName = vessel.name && vessel.name.toLowerCase() !== 'unknown';
      if (!hasValidName && !hasRealCallsign){
        if (options.logDebugDetails && (!options.logMMSI || vessel.mmsi === options.logMMSI)) {
          app.debug(`Skipped (no valid name and no valid callsign): ${vessel.mmsi} - Name: "${vessel.name}", Callsign: "${vessel.callsign}"`);
        }
        countInvalidNameAndMMSI++;
        continue ;
      }
      // Callsign check
      if (options.skipWithoutCallsign && !hasRealCallsign ){
        if (options.logDebugDetails && (!options.logMMSI || vessel.mmsi === options.logMMSI)) {
          app.debug(`Skipped (no callsign): ${vessel.mmsi} ${vessel.name}`);
        }
        countNoCallsign++;
        continue;
      }      
      vessel.callsign = callsign;
      filtered.push(vessel);
    }
    const countFiltered = countStale + countNoCallsign + countInvalidMMSI + countInvalidNameAndMMSI+countBaseStations;
    (countFiltered > 0) &&
    app.debug(
      `Remaining vessels after filtering: ${filtered.length} (Skipped: ${
        [
          `Total: ${countFiltered}`,
          countStale > 0 ? `Stale: ${countStale}` : "",
          countNoCallsign > 0 ? `No Callsign: ${countNoCallsign}` : "",
          countBaseStations > 0 ? `Base Stations: ${countBaseStations}` : "",
          countInvalidMMSI > 0 ? `Invalid MMSI: ${countInvalidMMSI}` : "",
          countInvalidNameAndMMSI > 0 ? `No Name & Callsign: ${countInvalidNameAndMMSI}` : ""
        ].filter(Boolean).join(", ")
      })`
    );
    return filtered;
  }

  async function processVessels(options, reason) {
  try {
    // Prüfen ob AIS Fleet Plugin installiert/aktiviert ist
    let aisfleetEnabled = false;
    try {
      const aisResponse = await fetch(signalkAisfleetUrl);
      if (aisResponse.ok) {
        const aisData = await aisResponse.json();
        aisfleetEnabled = !!aisData.enabled;
      }
    } catch (err) {
      app.debug("AIS Fleet plugin not installed or unreachable:", err);
    }
    getVessels(options,aisfleetEnabled).then(vessels => {
      try {
        const filtered = filterVessels(vessels, options);
        
        // Erstelle Set der aktuellen MMSIs
        const currentMMSIs = new Set(filtered.map(v => v.mmsi));
        
        // Bereinige Maps von Schiffen die nicht mehr existieren
        cleanupMaps(currentMMSIs, options);
        
        messageIdCounter = (messageIdCounter + 1) % 10;
        const hasNewClients = newTcpClients.length > 0 || newWSClients.length > 0;
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
            callsign: vessel.callsign
          });
          
          const previousState = previousVesselsState.get(vessel.mmsi);
          const hasChanged = !previousState || previousState !== currentState || hasNewClients;
          
          // TCP Resend Check
          const lastBroadcast = lastTCPBroadcast.get(vessel.mmsi) || 0;
          const timeSinceLastBroadcast = nowTimestamp - lastBroadcast;
          const needsTCPResend = timeSinceLastBroadcast >= (options.tcpResendInterval*1000);
          
          if (!hasChanged && !vesselFinderUpdateDue && !needsTCPResend) {
            unchangedCount++;
            return;
          }
          
          previousVesselsState.set(vessel.mmsi, currentState);
          
          // Bestimme ob an TCP gesendet werden soll
          const sendToTCP = hasChanged || needsTCPResend;
          
          // Debug-Logging für spezifische MMSI
          const shouldLogDebug = options.logDebugDetails && options.logDebugAIS && (!options.logMMSI || vessel.mmsi === options.logMMSI);

          // AIS-Klasse aus Vessel lesen
          const aisClass = vessel?.sensors?.ais?.class?.value;
          // Standard: Class A (Type 1), wenn nichts gesetzt ist
          const isClassA = !aisClass || aisClass.trim() === '' || aisClass.toUpperCase() === 'A';
          // Payload je nach Klasse erzeugen
          const payload = isClassA
            ? encoder.createPositionReportType1(vessel, options)
            : encoder.createPositionReportType19(vessel, options);
            if (payload) {
            const sentence = encoder.createNMEASentence(payload, 1, 1, messageIdCounter, 'B');
            
            if (shouldLogDebug) {
              app.debug(`MMSI ${vessel.mmsi} - Type ${isClassA?'1':'19'}: ${sentence}`);
            }
            if (sendToTCP) {
                broadcastTCP(sentence);
                broadcastWebSocket(sentence);
                // Zusätzliche Übertragung des kompletten Vessel object
                broadcastWebSocket(JSON.stringify(vessel));
                sentCount++;
                lastTCPBroadcast.set(vessel.mmsi, nowTimestamp);
              }
            
            // VesselFinder: nur Type 1 Nachrichten und nur wenn Position nicht älter als 5 Minuten
            if (vesselFinderUpdateDue) {
              let posTimestamp = vessel.navigation?.position?.timestamp;
              if (!posTimestamp && vessel.navigation?.position?.value) {
                posTimestamp = vessel.navigation.position.value.timestamp;
              }
              
              if (posTimestamp) {
                const posAge = nowTimestamp - new Date(posTimestamp).getTime();
                const fiveMinutes = 5 * 60 * 1000;
                
                if (posAge <= fiveMinutes) {
                  sendToVesselFinder(sentence, options);
                  vesselFinderCount++;
                } else if (shouldLogDebug) {
                  app.debug(`[${vessel.mmsi}] Skipped VesselFinder (position age: ${Math.floor(posAge/60000)}min)`);
                }
              }
            }
          }
          
          // Type 5 (Class A) bzw. Type 24 (Class B) - nur an TCP Clients, NICHT an VesselFinder
          const shouldSendStaticVoyage = vessel.callsign && vessel.callsign.length > 0 && 
                                  (vessel.callsign.toLowerCase() !== 'unknown' || !options.skipWithoutCallsign);
          
          if (shouldSendStaticVoyage && sendToTCP) {
              if (isClassA) {
                // --- Class A: Type 5 ---
                const payload5 = encoder.createStaticVoyage(vessel);
                if (payload5) {
                  if (payload5.length <= 62) {
                    const sentence5 = encoder.createNMEASentence(payload5, 1, 1, messageIdCounter, 'B');
                    if (shouldLogDebug) {
                      app.debug(`[${vessel.mmsi}] Type 5: ${sentence5}`);
                    }
                    broadcastTCP(sentence5);
                    broadcastWebSocket(sentence5);
                  } else {
                    const fragment1 = payload5.substring(0, 62);
                    const fragment2 = payload5.substring(62);
                    const sentence5_1 = encoder.createNMEASentence(fragment1, 2, 1, messageIdCounter, 'B');
                    const sentence5_2 = encoder.createNMEASentence(fragment2, 2, 2, messageIdCounter, 'B');
                    if (shouldLogDebug) {
                      app.debug(`[${vessel.mmsi}] Type 5 (1/2): ${sentence5_1}`);
                      app.debug(`[${vessel.mmsi}] Type 5 (2/2): ${sentence5_2}`);
                    }
                    broadcastTCP(sentence5_1);
                    broadcastWebSocket(sentence5_1);
                    broadcastTCP(sentence5_2);
                    broadcastWebSocket(sentence5_2);
                  }
                }
              } else {
                // --- Class B: Type 24 ---
                const payload24 = encoder.createStaticVoyageType24(vessel);
                if (payload24) {
                  // Part A
                  const sentence24A = encoder.createNMEASentence(payload24.partA, 1, 1, messageIdCounter, 'B');
                  if (shouldLogDebug) {
                    app.debug(`[${vessel.mmsi}] Type 24 Part A: ${sentence24A}`);
                  }
                  broadcastTCP(sentence24A);
                  broadcastWebSocket(sentence24A);

                  // Part B
                  const sentence24B = encoder.createNMEASentence(payload24.partB, 1, 1, messageIdCounter, 'B');
                  if (shouldLogDebug) {
                    app.debug(`[${vessel.mmsi}] Type 24 Part B: ${sentence24B}`);
                  }
                  broadcastTCP(sentence24B);
                  broadcastWebSocket(sentence24B);
                }
              }
          }
        });
        
        if (hasNewClients) {
          if (newTcpClients.length > 0) {
            newTcpClients = [];
          }
          if (newWSClients.length > 0) {
            newWSClients = [];
          }
        }
        
        if (vesselFinderUpdateDue) {
          vesselFinderLastUpdate = nowTimestamp;
          app.debug(`VesselFinder: sent ${vesselFinderCount} vessels changed in last ${options.vesselFinderUpdateRate} seconds.`);
        }
        
        app.debug(`${reason}: sent ${sentCount}, unchanged ${unchangedCount}, clients ${tcpClients.length}`);
        
      } catch (err) {
        app.error(`Error processing vessels: ${err}`);
      }
    }).catch(err => {
      app.error(`Error in processVessels: ${err}`);
    });
  } catch (err) {
    app.error(`Error in processVessels outer try: ${err}`);
  }    
  }
  
  function cleanupMaps(currentMMSIs, options) {
    // Entferne Einträge aus previousVesselsState
    let removedFromState = 0;
    for (const mmsi of previousVesselsState.keys()) {
      if (!currentMMSIs.has(mmsi)) {
        previousVesselsState.delete(mmsi);
        removedFromState++;
      }
    }
    
    // Entferne Einträge aus lastTCPBroadcast
    let removedFromBroadcast = 0;
    for (const mmsi of lastTCPBroadcast.keys()) {
      if (!currentMMSIs.has(mmsi)) {
        lastTCPBroadcast.delete(mmsi);
        removedFromBroadcast++;
      }
    }
    
    if (options.logDebugDetails && (removedFromState > 0 || removedFromBroadcast > 0)) {
      app.debug(`Map cleanup: removed ${removedFromState} from previousVesselsState, ${removedFromBroadcast} from lastTCPBroadcast`);
    }
  }

  return plugin;
};
const net = require("net");
const dgram = require("dgram");
const axios = require("axios");
const AISEncoder = require("./ais-encoder");
const WebSocket = require("ws");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const os = require("os");
const openapi = require("./openApi.json");

module.exports = function (app) {
	let plugin = {
		id: "signalk-ais-navionics-converter",
		name: "AIS converter to NMEA 0183 (TCP) and NMEA 2000 PGNs",
		description:
			"SignalK plugin to convert AIS data to NMEA 0183 (TCP) and generate NMEA 2000 AIS PGNs, with optional forwarding to other servers (e.g. vesselfinder.com)",
	};

	const encoder = new AISEncoder(app);

	// Globale Variablen
	let CAN_AVAILABLE = false;
	let canChannel = null; // ← NEU: SocketCAN Channel
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
	let forwardingLastUpdate = 0;
	let signalkApiUrl = null;
	let cloudVesselsCache = null;
	let cloudVesselsLastFetch = 0;
	let aisfleetEnabled = false;
	let processing = false;
	let pendingFullUpdate = false;
	let canBusQueue = [];
	let canBusProcessing = false;

	plugin.schema = {
		type: "object",
		required: ["tcpPort"],
		properties: {
			tcpPort: {
				type: "number",
				title: "TCP Port",
				description: "Port for NMEA TCP server",
				default: 10113,
			},
			wsPort: {
				type: "number",
				title: "WebSocket Port for AIS and last position timestamp data",
				description: "Port for WebSocket server (web clients can connect here)",
				default: 10114,
			},
			updateInterval: {
				type: "number",
				title: "Update interval for changed vessels (seconds, default: 15)",
				description:
					"How often to send updates to TCP clients (only changed vessels)",
				default: 15,
			},
			tcpResendInterval: {
				type: "number",
				title: "Update interval for unchanged vessels (seconds, default: 60)",
				description:
					"How often to resend unchanged vessels to TCP clients (0=disabled)",
				default: 60,
			},
			skipWithoutCallsign: {
				type: "boolean",
				title: "Skip vessels without callsign",
				description: "Vessels without callsign will not be send",
				default: false,
			},
			skipStaleData: {
				type: "boolean",
				title: "Skip vessels with stale data",
				description: "Do not send vessels without unchanged data",
				default: true,
			},
			staleDataThresholdMinutes: {
				type: "number",
				title: "Stale data threshold (minutes)",
				description:
					"Data where the position timestamp is older then n minutes will not be send",
				default: 60,
			},
			staleDataShipnameAddTime: {
				type: "number",
				title:
					"Timestamp last update of position added to ship name (minutes, 0=disabled)",
				description:
					"The timestamp of the last position update will be added to the ship name",
				default: 5,
			},
			minAlarmSOG: {
				type: "number",
				title: "Minimum SOG for alarm (m/s)",
				description: "SOG below this value will be set to 0",
				default: 0.2,
			},
			maxMinutesSOGToZero: {
				type: "number",
				title:
					"Maximum minutes before SOG is set to 0 (0=no correction of SOG)",
				description:
					"SOG will be set to 0 if last position timestamp is older then current time - minutes",
				default: 0,
			},
			language: {
				type: "string",
				title: "Language of the plugin",
				default: "de",
			},
			logDebugDetails: {
				type: "boolean",
				title: "Debug vessel details",
				description: "Detailed debug output in server log for all vessels",
				default: false,
			},
			logMMSI: {
				type: "string",
				title: "Debug only MMSI",
				description:
					"Only data for this MMSI will be shown in the detailed debug output",
				default: "",
			},
			logDebugStale: {
				type: "boolean",
				title: "Debug all vessel stale vessels",
				description:
					"Detailed debug output in server log for all stale vessels",
				default: false,
			},
			logDebugJSON: {
				type: "boolean",
				title: "Debug all JSON data for vessels",
				description: "Detailed debug JSON output in server log for all vessels",
				default: false,
			},
			logDebugAIS: {
				type: "boolean",
				title: "Debug all AIS data for vessels",
				description:
					"Detailed debug AIS data output in server log for all vessels",
				default: false,
			},
			logDebugSOG: {
				type: "boolean",
				title: "Debug all vessels with corrected SOG",
				description:
					"Detailed debug output in server log for all vessels with corrected SOG",
				default: false,
			},
			nmea2000Creation: {
				type: "boolean",
				title: "NMEA2000 record creation",
				description: "Create NMEA2000 records on can bus for all AIS vessels",
				default: false,
			},
			nmea2000Interface: {
				type: "string",
				title: "NMEA2000 can interface",
				description:
					"Can bus interface to be used for creation of NMEA2000 records",
				default: "",
			},
			nmea2000Src: {
				type: "number",
				title: "NMEA2000 source address",
				description:
					"Device address (Source Address) which device on the bus sent the message (min 0, max 251)",
				default: 42,
			},
			forwardings: {
				type: "array",
				title: "Forwarding destinations",
				description: "List of hosts to forward AIS messages to",
				items: {
					type: "object",
					properties: {
						host: {
							type: "string",
							title: "Host",
							description: "Hostname or IP address",
						},
						port: {
							type: "number",
							title: "Port",
							description: "UDP port number",
							minimum: 1,
							maximum: 65535,
						},
					},
					required: ["host", "port"],
				},
				default: [],
			},
			forwardingUpdateRate: {
				type: "number",
				title: "Forwarding Update Rate (seconds)",
				description: "How often to send updates to all forwarding destinations",
				default: 60,
			},
			cloudVesselsEnabled: {
				type: "boolean",
				title: "Include vessels received from AISFleet.com",
				description:
					"Beside vessels available in SignalK vessels from aisfleet.com will taken into account",
				default: true,
			},
			cloudVesselsUpdateInterval: {
				type: "number",
				title: "Cloud vessels update interval (seconds)",
				description:
					"How often to fetch vessels from AISFleet.com (default: 60, recommended: 60-300)",
				default: 60,
			},
			cloudVesselsRadius: {
				type: "number",
				title:
					"Radius (from own vessel) to include vessels from AISFleet.com (nautical miles)",
				default: 10,
			},
			cloudVesselsTimeout: {
				type: "number",
				title:
					"Timeout in seconds to fetch the data from AISFleet.com (default: 15)",
				default: 15,
			},
		},
	};

	// OpenAPI Definition bereitstellen
	plugin.getOpenApi = () => openapi;

	plugin.registerWithRouter = function (router) {
		app.debug("Registering API routes for AIS converter plugin");

		router.get("/can-interfaces", (req, res) => {
			app.debug("GET /can-interfaces called");
			try {
				const interfaces = getCanInterfaces();
				res.json(interfaces);
			} catch (err) {
				app.error(`Error getting CAN interfaces: ${err.message}`);
				res.status(500).json({
					error: "Failed to get CAN interfaces",
					message: err.message,
				});
			}
		});

		router.get("/openapi", (req, res) => {
			res.sendFile(path.join(__dirname, "openApi.json"));
		});

		router.get("/plugin-status", (req, res) => {
			app.debug("GET /plugin-status called");
			const options = app.readPluginOptions();
			try {
				res.json({
					enabled: options.enabled,
					wsPort: options.configuration.wsPort,
				});
			} catch (err) {
				app.error(`Error reading plugin status: ${err.message}`);
				res.status(500).json({
					error: "Failed to read plugin status",
					message: err.message,
				});
			}
		});

		router.get("/aisfleet-status", async (req, res) => {
			app.debug("GET /aisfleet-status called");
			try {
				const enabled = await isPluginEnabled(
					"aisfleet",
					"Data will be fetched from AISFleet.com",
				);
				const baseDir = app.getDataDirPath();
				const aisFleetConfigPath = path.join(
					path.dirname(baseDir),
					"aisfleet.json",
				);
				const installed = fs.existsSync(aisFleetConfigPath);

				res.json({
					enabled: enabled,
					installed: installed,
				});
			} catch (err) {
				app.error(`Error checking AIS Fleet status: ${err.message}`);
				res.status(500).json({
					error: "Failed to check AIS Fleet status",
					message: err.message,
				});
			}
		});
	};

	plugin.start = function (options) {
		app.debug("AIS to NMEA Converter plugin will start in 5 seconds...");

		// Prüfe ob socketcan verfügbar ist
		let canModule = null;
		try {
			canModule = require("socketcan");
		} catch (err) {
			app.debug(
				"socketcan module not available. Install with: npm install socketcan",
			);
			app.debug("Falling back to cansend commands (slower)");
		}

		if (options.nmea2000Creation) {
			CAN_AVAILABLE = canInterfaceExists(options.nmea2000Interface);

			if (!CAN_AVAILABLE) {
				app.debug(
					`CAN interface '${options.nmea2000Interface}' not found. NMEA2000 PGN creation disabled.`,
				);
			} else if (!canModule) {
				// Fallback Mode (ohne socketcan)
				app.debug(
					`Using slow cansend fallback. Install socketcan for better performance.`,
				);
				encoder.setFallbackMode(true, options.nmea2000Interface);
				encoder.createPGN60928AddressClaim(plugin.id, options);
			} else {
				// Native SocketCAN Mode
				try {
					canChannel = canModule.createRawChannel(
						options.nmea2000Interface,
						true,
					);

					canChannel.addListener("onMessage", (msg) => {
						if (msg.err) {
							app.error(`CAN bus error: ${JSON.stringify(msg)}`);
						} else {
							// optional: normale CAN-Frames
							// app.debug(`CAN RX ${msg.id.toString(16)}`);
						}
					});

					canChannel.start();
					encoder.setCanChannel(canChannel);

					app.debug(`Native SocketCAN enabled on ${options.nmea2000Interface}`);
					encoder.createPGN60928AddressClaim(plugin.id, options);
				} catch (err) {
					app.error(`Failed to start SocketCAN: ${err.message}`);
					CAN_AVAILABLE = false;
				}
			}
		}

		setTimeout(() => {
			app.debug("Starting AIS to NMEA Converter plugin");

			// Ermittle SignalK API URL
			const port = app.config.settings.port || 3000;
			let hostname = app.config.settings.hostname || "0.0.0.0";

			// Wenn 0.0.0.0, verwende 127.0.0.1 für lokale Aufrufe
			if (hostname === "0.0.0.0" || hostname === "::") {
				hostname = "127.0.0.1";
			}
			signalkApiUrl = `http://${hostname}:${port}/signalk/v1/api`;

			// Hole eigene MMSI
			getOwnMMSI().then(() => {
				startTCPServer(options);
				if (options.wsPort && options.wsPort > 0) {
					startWebSocketServer(options);
				}
				startUpdateLoop(options);

				if (options.forwardings && options.forwardings.length > 0) {
					startForwardingServer(options);
				}
			});
		}, 5000);
	};

	plugin.stop = function () {
		app.debug("Stopping AIS to NMEA Converter plugin");

		if (updateInterval) clearInterval(updateInterval);

		if (tcpServer) {
			tcpClients.forEach((client) => client.destroy());
			tcpClients = [];
			tcpServer.close();
			tcpServer = null;
		}

		if (wsServer) {
			wsServer.clients.forEach((client) => client.terminate());
			newWSClients = [];
			wsServer.close();
			wsServer = null;
		}

		if (udpClient) {
			udpClient.close();
			udpClient = null;
		}

		// SocketCAN Channel schließen
		if (canChannel) {
			try {
				canChannel.stop();
				app.debug("SocketCAN channel closed");
			} catch (err) {
				app.error(`Error closing CAN channel: ${err.message}`);
			}
			canChannel = null;
		}

		previousVesselsState.clear();
		lastTCPBroadcast.clear();
		cloudVesselsCache = null;
		cloudVesselsLastFetch = 0;
	};

	// CAN Bus Queue Processing - OPTIMIERT
	async function processCanBusQueue() {
		if (canBusProcessing || canBusQueue.length === 0) return;
		canBusProcessing = true;

		while (canBusQueue.length > 0) {
			const { vessel, pgns, options } = canBusQueue.shift();

			// Alle PGNs eines Schiffes sequentiell senden (wichtig für Fast-Packet!)
			for (const pgn of pgns) {
				try {
					await encoder.sendToCANBus(vessel, pgn, options);
				} catch (err) {
					app.error(
						`CAN bus send error for ${vessel.mmsi} PGN ${pgn.pgn}: ${err.message}`,
					);
				}
				// Kleine Pause zwischen verschiedenen PGN-Typen desselben Schiffs
				await new Promise((resolve) => setTimeout(resolve, 5));
			}

			// Minimale Pause zwischen Schiffen
			if (canBusQueue.length > 0) {
				await new Promise((resolve) => setTimeout(resolve, 2));
			}
		}

		canBusProcessing = false;

		// Prüfe ob neue Einträge hinzugekommen sind
		if (canBusQueue.length > 0) {
			setImmediate(() => processCanBusQueue());
		}
	}

	function canInterfaceExists(iface) {
		try {
			const output = execSync(`ip link show ${iface}`).toString();
			const isUp = output.includes("UP");
			return isUp;
		} catch (err) {
			return false;
		}
	}

	function getCanInterfaces() {
		const interfaces = fs.readdirSync("/sys/class/net");

		const canIfaces = interfaces.filter(
			(iface) => iface.startsWith("can") || iface.startsWith("vcan"),
		);

		const result = {};

		for (const iface of canIfaces) {
			let state = "unknown";

			try {
				const output = execSync(`ip link show ${iface}`).toString();
				state = output.includes("UP") ? "up" : "down";
			} catch (err) {
				state = "error";
			}

			result[iface] = { state };
		}

		return result;
	}

	function getOwnMMSI() {
		return new Promise((resolve) => {
			if (ownMMSI) {
				resolve(ownMMSI);
				return;
			}

			const selfData = app.getSelfPath("mmsi");
			if (selfData) {
				ownMMSI = selfData.toString();
				app.debug(`Own MMSI detected: ${ownMMSI}`);
			}
			resolve(ownMMSI);
		});
	}

	function startTCPServer(options) {
		tcpServer = net.createServer((socket) => {
			app.debug(
				`TCP client connected: ${socket.remoteAddress}:${socket.remotePort}`,
			);
			tcpClients.push(socket);
			newTcpClients.push(socket);

			socket.on("end", () => {
				app.debug(`TCP client disconnected`);
				tcpClients = tcpClients.filter((c) => c !== socket);
				newTcpClients = newTcpClients.filter((c) => c !== socket);
			});

			socket.on("error", (err) => {
				app.error(`TCP socket error: ${err}`);
				tcpClients = tcpClients.filter((c) => c !== socket);
				newTcpClients = newTcpClients.filter((c) => c !== socket);
			});
		});

		tcpServer.listen(options.tcpPort, () => {
			const statusText =
				`TCP server port ${options.tcpPort}` +
				(options.wsPort && options.wsPort > 0
					? ` - WS server port ${options.wsPort}`
					: "") +
				(CAN_AVAILABLE === true && options.nmea2000Interface
					? ` - NMEA2000 creation on ${options.nmea2000Interface}`
					: "");

			app.debug(statusText);
			app.setPluginStatus(statusText);
		});
	}

	function startWebSocketServer(options) {
		const wsPort = options.wsPort || 10114;

		try {
			wsServer = new WebSocket.Server({ port: wsPort });

			wsServer.on("listening", () => {
				app.debug(`AIS WebSocket Server listening on port ${wsPort}`);
			});

			wsServer.on("connection", (ws, req) => {
				const clientIP = req.socket.remoteAddress;
				app.debug(`WebSocket client connected from ${clientIP}`);
				newWSClients.push(ws);
				setTimeout(() => {
					safeProcessVessels(options, "New WebSocket Client connected");
				}, 100);
				ws.isAlive = true;
				ws.on("pong", () => {
					ws.isAlive = true;
				});

				ws.on("close", () => {
					newWSClients = newWSClients.filter((c) => c !== ws);
					app.debug(`WebSocket client disconnected`);
				});

				ws.on("error", (err) => {
					newWSClients = newWSClients.filter((c) => c !== ws);
					app.error(`WebSocket client error: ${err.message}`);
				});
			});

			// Heartbeat interval
			const heartbeat = setInterval(() => {
				wsServer.clients.forEach((ws) => {
					if (ws.isAlive === false) {
						return ws.terminate();
					}
					ws.isAlive = false;
					ws.ping();
				});
			}, 30000);

			wsServer.on("close", () => {
				clearInterval(heartbeat);
			});

			wsServer.on("error", (err) => {
				app.error(`WebSocket Server error: ${err.message}`);
			});
		} catch (err) {
			app.error(`Failed to start WebSocket Server: ${err.message}`);
		}
	}

	function startForwardingServer(options) {
		if (!options.forwardings || options.forwardings.length === 0) return;

		udpClient = dgram.createSocket("udp4");
		
		let forwardingList = options.forwardings
			.map((f) => `${f.host}:${f.port}`)
			.join(", ");
		
		app.debug(
			`Forwarding UDP enabled for: ${forwardingList}`,
		);
	}

	function broadcastTCP(message) {
		tcpClients.forEach((client) => {
			try {
				client.write(message + "\r\n");
			} catch (err) {
				app.error(`Error broadcasting to TCP client: ${err}`);
			}
		});
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

	function sendToForwardings(message, options) {
		if (!udpClient || !options.forwardings || options.forwardings.length === 0) return;

		app.debug(`sendToForwardings called with ${options.forwardings.length} forwarding destinations`);

		const forwardings = options.forwardings;
		
		forwardings.forEach((forwarding) => {
			try {
				const buffer = Buffer.from(message + "\r\n");
				udpClient.send(
					buffer,
					0,
					buffer.length,
					forwarding.port,
					forwarding.host,
					(err) => {
						if (err) {
							app.error(
								`Error sending to forwarding ${forwarding.host}:${forwarding.port}: ${err}`,
							);
						} 
					},
				);
			} catch (error) {
				app.error(`Forwarding send error: ${error}`);
			}
		});
	}

	function startUpdateLoop(options) {
		safeProcessVessels(options, "Initial startup");

		updateInterval = setInterval(() => {
			safeProcessVessels(options, "Scheduled resend");
		}, options.updateInterval * 1000);
	}

	function fetchVesselsFromAPI() {
		return new Promise((resolve, reject) => {
			if (!signalkApiUrl) {
				app.error("signalkApiUrl not initialized yet");
				resolve(null);
				return;
			}

			const url = `${signalkApiUrl}/vessels`;
			app.debug(`Fetching SignalK vessels from URL: ${url}`);

			const http = require("http");

			http
				.get(url, (res) => {
					let data = "";

					if (res.statusCode !== 200) {
						app.error(`HTTP ${res.statusCode} from ${url}`);
						resolve(null);
						return;
					}

					res.on("data", (chunk) => {
						data += chunk;
					});

					res.on("end", () => {
						try {
							const result = JSON.parse(data);
							app.debug(
								`Parsed JSON, ${
									Object.keys(result).length
								} vessels from SignalK API`,
							);
							resolve(result);
						} catch (err) {
							app.error(`Invalid JSON from ${url}: ${err.message}`);
							resolve(null);
						}
					});
				})
				.on("error", (err) => {
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
			const position = app.getSelfPath("navigation.position");
			if (
				!position ||
				!position.value ||
				!position.value.latitude ||
				!position.value.longitude
			) {
				app.error("No self position available for cloud vessels fetch");
				return Promise.resolve(null);
			}

			const lat = position.value.latitude;
			const lng = position.value.longitude;
			const radius = options.cloudVesselsRadius || 10;

			if (!ownMMSI) {
				app.error("No own MMSI available for cloud vessels fetch");
				return Promise.resolve(null);
			}

			const url = `https://aisfleet.com/api/vessels/nearby?lat=${lat}&lng=${lng}&radius=${radius}&mmsi=${ownMMSI}`;
			app.debug(
				`Fetching cloud vessels from AISFleet API (radius: ${radius}nm)`,
			);

			const requestConfig = {
				method: "get",
				maxBodyLength: Infinity,
				url: url,
				headers: {},
				timeout: (options?.cloudVesselsTimeout ?? 15) * 1000,
			};

			return axios
				.request(requestConfig)
				.then((response) => {
					const data = response.data;

					if (data.vessels && Array.isArray(data.vessels)) {
						app.debug(
							`Retrieved ${data.vessels.length} vessels from AISFleet cloud API`,
						);

						// Konvertiere zu SignalK-Format
						const cloudVessels = {};
						data.vessels.forEach((vessel) => {
							if (!vessel.mmsi || vessel.mmsi === ownMMSI) return;

							const vesselId = `urn:mrn:imo:mmsi:${vessel.mmsi}`;
							const vesselData = {};

							if (vessel.mmsi) vesselData.mmsi = vessel.mmsi;
							if (vessel.name) vesselData.name = vessel.name;
							if (vessel.call_sign) {
								vesselData.communication = { callsignVhf: vessel.call_sign };
							}
							if (vessel.imo_number) vesselData.imo = vessel.imo_number;

							// Design-Daten
							const design = {};
							if (vessel.design_length) {
								design.length = { value: { overall: vessel.design_length } };
							}
							if (vessel.design_beam) {
								design.beam = { value: vessel.design_beam };
							}
							if (vessel.design_draft) {
								design.draft = { value: { maximum: vessel.design_draft } };
							}
							if (vessel.ais_ship_type) {
								design.aisShipType = { value: { id: vessel.ais_ship_type } };
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
										longitude: vessel.last_position.longitude,
									},
									timestamp: vessel.last_position.timestamp,
								};
							}

							if (vessel.latest_navigation) {
								const nav = vessel.latest_navigation;
								const navTimestamp = nav.timestamp;

								if (
									nav.course_over_ground !== null &&
									nav.course_over_ground !== undefined
								) {
									let cog = nav.course_over_ground;
									if (cog >= 360) cog = 0;
									navigation.courseOverGroundTrue = {
										value: cog,
										timestamp: navTimestamp,
									};
								}

								if (
									nav.speed_over_ground !== null &&
									nav.speed_over_ground !== undefined
								) {
									navigation.speedOverGround = {
										value: nav.speed_over_ground * 0.514444, // knots to m/s
										timestamp: navTimestamp,
									};
								}

								if (nav.heading !== null && nav.heading !== undefined) {
									let heading = nav.heading;
									if (heading >= 360) heading = 0;
									navigation.headingTrue = {
										value: (heading * Math.PI) / 180,
										timestamp: navTimestamp,
									};
								}

								if (
									nav.rate_of_turn !== null &&
									nav.rate_of_turn !== undefined
								) {
									navigation.rateOfTurn = {
										value: (nav.rate_of_turn * Math.PI) / 180,
										timestamp: navTimestamp,
									};
								}

								if (
									nav.navigation_status !== null &&
									nav.navigation_status !== undefined
								) {
									navigation.state = {
										value: nav.navigation_status,
										timestamp: navTimestamp,
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
						app.debug("No vessels array in AISFleet API response");
						return null;
					}
				})
				.catch((error) => {
					if (error.code === "ECONNABORTED" || error.code === "ETIMEDOUT") {
						app.error(
							`AISFleet API timeout after ${options.cloudVesselsTimeout}s`,
						);
					} else if (error.response?.status >= 500) {
						app.error(`AISFleet API server error ${error.response.status}`);
					} else if (error.response?.status === 403) {
						app.error("AISFleet API access denied");
					} else if (error.code) {
						app.error(`AISFleet API error: ${error.code}`);
					} else {
						app.error(`AISFleet API error: ${error.message || "Unknown"}`);
					}
					return null;
				});
		} catch (error) {
			app.error(`Error in fetchCloudVessels: ${error.message}`);
			return Promise.resolve(null);
		}
	}

	function mergeVesselData(vessel1, vessel2) {
		const merged = JSON.parse(JSON.stringify(vessel1)); // Deep copy

		if (!vessel2) return merged;

		// Name und Callsign: Gefüllte Werte haben Vorrang
		const vessel1Name = vessel1.name;
		const vessel2Name = vessel2.name;
		const vessel1Callsign =
			vessel1.communication?.callsignVhf || vessel1.callsign;
		const vessel2Callsign =
			vessel2.communication?.callsignVhf || vessel2.callsign;

		if (vessel2Name && vessel2Name !== "Unknown" && vessel2Name !== "") {
			if (!vessel1Name || vessel1Name === "Unknown" || vessel1Name === "") {
				merged.name = vessel2Name;
			}
		}

		if (vessel2Callsign && vessel2Callsign !== "") {
			if (!vessel1Callsign || vessel1Callsign === "") {
				if (!merged.communication) merged.communication = {};
				merged.communication.callsignVhf = vessel2Callsign;
				merged.callsign = vessel2Callsign;
			}
		}

		// Merge mit Timestamp-Vergleich
		const mergeWithTimestamp = (target, source, path = "") => {
			if (!source) return;

			for (const key in source) {
				if (key === "name" || key === "callsign" || key === "callSign")
					continue;
				if (path === "communication" && key === "callsignVhf") continue;

				if (
					source[key] &&
					typeof source[key] === "object" &&
					!Array.isArray(source[key])
				) {
					if (source[key].timestamp && target[key]?.timestamp) {
						const sourceTime = new Date(source[key].timestamp);
						const targetTime = new Date(target[key].timestamp);

						if (sourceTime > targetTime) {
							target[key] = source[key];
						}
					} else if (source[key].timestamp && !target[key]?.timestamp) {
						target[key] = source[key];
					} else if (!source[key].timestamp && !target[key]?.timestamp) {
						if (!target[key]) target[key] = {};
						mergeWithTimestamp(
							target[key],
							source[key],
							path ? `${path}.${key}` : key,
						);
					}
				} else if (!target[key] && source[key]) {
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
		const logMMSI = options.logMMSI || "";

		app.debug(
			`Merging vessels - SignalK: ${
				signalkVessels ? Object.keys(signalkVessels).length : 0
			}, Cloud: ${cloudVessels ? Object.keys(cloudVessels).length : 0}`,
		);

		if (signalkVessels) {
			for (const [vesselId, vessel] of Object.entries(signalkVessels)) {
				merged[vesselId] = vessel;
			}
		}

		if (cloudVessels) {
			for (const [vesselId, cloudVessel] of Object.entries(cloudVessels)) {
				const mmsiMatch = vesselId.match(/mmsi:(\d+)/);
				const mmsi = mmsiMatch ? mmsiMatch[1] : null;
				const shouldLog =
					options.logDebugJSON &&
					options.logDebugDetails &&
					(logMMSI === "" || mmsi === logMMSI);

				if (merged[vesselId]) {
					merged[vesselId] = mergeVesselData(merged[vesselId], cloudVessel);
					if (shouldLog) {
						app.debug(`Merged vessel ${vesselId} (${mmsi})`);
						loggedVessels.add(vesselId);
					}
				} else {
					merged[vesselId] = cloudVessel;
					if (shouldLog) {
						app.debug(`Cloud-only vessel ${vesselId} (${mmsi})`);
						loggedVessels.add(vesselId);
					}
				}
			}
		}

		// Stale Name Suffix hinzufügen
		for (const [vesselId, vessel] of Object.entries(merged)) {
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
		}

		app.debug(`Total merged vessels: ${Object.keys(merged).length}`);
		return merged;
	}

	function getVessels(options, aisfleetEnabled) {
		const now = Date.now();
		const cloudUpdateInterval =
			(options.cloudVesselsUpdateInterval || 60) * 1000;

		const needsCloudUpdate =
			options.cloudVesselsEnabled &&
			!aisfleetEnabled &&
			now - cloudVesselsLastFetch >= cloudUpdateInterval;

		const cloudPromise = needsCloudUpdate
			? fetchCloudVessels(options).then((result) => {
					if (result) {
						cloudVesselsCache = result;
						cloudVesselsLastFetch = now;
					}
					return cloudVesselsCache;
				})
			: Promise.resolve(cloudVesselsCache);

		return Promise.all([fetchVesselsFromAPI(), cloudPromise])
			.then(([signalkVessels, cloudVessels]) => {
				const vessels = [];

				const allVessels = mergeVesselSources(
					signalkVessels,
					cloudVessels,
					options,
				);

				if (!allVessels) return vessels;

				for (const [vesselId, vessel] of Object.entries(allVessels)) {
					if (vesselId === "self") continue;

					const mmsiMatch = vesselId.match(/mmsi:(\d+)/);
					if (!mmsiMatch) continue;

					const mmsi = mmsiMatch[1];
					if (ownMMSI && mmsi === ownMMSI) continue;

					// IMO-Extraktion
					let imo = null;
					if (vessel.registrations?.imo) {
						const imoStr = vessel.registrations.imo
							.toString()
							.replace(/[^\d]/g, "");
						const imoNum = parseInt(imoStr);
						if (imoNum && imoNum > 0) imo = imoNum;
					}
					if (!imo && vessel.imo) {
						const imoStr = vessel.imo.toString().replace(/[^\d]/g, "");
						const imoNum = parseInt(imoStr);
						if (imoNum && imoNum > 0) imo = imoNum;
					}
					if (!imo) imo = 0;

					vessels.push({
						mmsi: mmsi,
						name: vessel.nameStale || vessel.name || "Unknown",
						callsign:
							vessel.callsign ||
							vessel.callSign ||
							vessel.communication?.callsignVhf ||
							"",
						navigation: vessel.navigation || {},
						design: vessel.design || {},
						sensors: vessel.sensors || {},
						destination:
							vessel.navigation?.destination?.commonName?.value || null,
						imo: imo,
					});
				}

				return vessels;
			})
			.catch((err) => {
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
				continue;
			}

			if (
				!vessel.mmsi ||
				vessel.mmsi.length !== 9 ||
				isNaN(parseInt(vessel.mmsi))
			) {
				countInvalidMMSI++;
				continue;
			}

			let callsign = vessel.callsign || "";
			const hasRealCallsign = callsign && callsign.length > 0;

			if (!hasRealCallsign) {
				callsign = "UNKNOWN";
			}

			// Position Timestamp holen
			let posTimestamp = vessel.navigation?.position?.timestamp;
			if (!posTimestamp && vessel.navigation?.position?.value) {
				posTimestamp = vessel.navigation.position.value.timestamp;
			}

			// Stale data check
			if (options.skipStaleData && posTimestamp) {
				const lastUpdate = new Date(posTimestamp);
				const ageMs = now - lastUpdate;
				const thresholdMs = options.staleDataThresholdMinutes * 60 * 1000;

				if (ageMs > thresholdMs) {
					countStale++;
					continue;
				}
			}

			// SOG Korrektur basierend auf Position Timestamp
			if (options.maxMinutesSOGToZero > 0 && posTimestamp) {
				const lastUpdate = new Date(posTimestamp);
				const ageMs = now - lastUpdate;
				const sogThresholdMs = options.maxMinutesSOGToZero * 60 * 1000;

				if (ageMs > sogThresholdMs) {
					if (vessel.navigation && vessel.navigation.speedOverGround) {
						if (vessel.navigation.speedOverGround.value !== undefined) {
							vessel.navigation.speedOverGround.value = 0;
						} else {
							vessel.navigation.speedOverGround = 0;
						}
					}
				}
			}

			// Filtere Schiffe ohne Name und Callsign
			const hasValidName =
				vessel.name && vessel.name.toLowerCase() !== "unknown";
			if (!hasValidName && !hasRealCallsign) {
				countInvalidNameAndMMSI++;
				continue;
			}

			// Callsign check
			if (options.skipWithoutCallsign && !hasRealCallsign) {
				countNoCallsign++;
				continue;
			}

			vessel.callsign = callsign;
			filtered.push(vessel);
		}

		const countFiltered =
			countStale +
			countNoCallsign +
			countInvalidMMSI +
			countInvalidNameAndMMSI +
			countBaseStations;
		if (countFiltered > 0) {
			app.debug(
				`Remaining vessels after filtering: ${filtered.length} (Skipped: ${[
					`Total: ${countFiltered}`,
					countStale > 0 ? `Stale: ${countStale}` : "",
					countNoCallsign > 0 ? `No Callsign: ${countNoCallsign}` : "",
					countBaseStations > 0 ? `Base Stations: ${countBaseStations}` : "",
					countInvalidMMSI > 0 ? `Invalid MMSI: ${countInvalidMMSI}` : "",
					countInvalidNameAndMMSI > 0
						? `No Name & Callsign: ${countInvalidNameAndMMSI}`
						: "",
				]
					.filter(Boolean)
					.join(", ")})`,
			);
		}
		return filtered;
	}

	async function safeProcessVessels(options, reason) {
		if (processing) {
			pendingFullUpdate = true;
			app.debug(`Skipping ${reason}, still processing`);
			return;
		}

		processing = true;

		try {
			await processVessels(options, reason);
		} finally {
			processing = false;

			if (pendingFullUpdate) {
				pendingFullUpdate = false;
				app.debug(`Running queued update after ${reason}`);
				safeProcessVessels(options, "Queued update");
			}
		}
	}

	function sanitizeKeys(obj) {
		if (obj === null || typeof obj !== "object") {
			return obj;
		}

		const clean = Array.isArray(obj) ? [] : {};

		for (const key of Object.keys(obj)) {
			// Key bereinigen: Anführungszeichen entfernen oder ersetzen
			const safeKey = key.replace(/"/g, "'");

			// Rekursiv weitergehen
			clean[safeKey] = sanitizeKeys(obj[key]);
		}

		return clean;
	}

	async function processVessels(options, reason) {
		try {
			// Prüfen ob AIS Fleet Plugin installiert/aktiviert ist
			const aisfleetEnabled = await isPluginEnabled(
				"aisfleet",
				"Data will be fetched from AISFleet.com",
			);
			const vessels = await getVessels(options, aisfleetEnabled);

			try {
				const filtered = filterVessels(vessels, options);

				const currentMMSIs = new Set(filtered.map((v) => v.mmsi));
				cleanupMaps(currentMMSIs, options);

				messageIdCounter = (messageIdCounter + 1) % 10;
				const hasNewClients =
					newTcpClients.length > 0 || newWSClients.length > 0;
				const nowTimestamp = Date.now();
				const forwardingUpdateDue =
					options.forwardings &&
					options.forwardings.length > 0 &&
					nowTimestamp - forwardingLastUpdate >=
						options.forwardingUpdateRate * 1000;

				if (options.forwardings && options.forwardings.length > 0) {
					app.debug(
						`Forwarding check: ${forwardingUpdateDue ? 'DUE' : 'NOT DUE'} | Last update: ${forwardingLastUpdate} | Now: ${nowTimestamp} | Interval: ${options.forwardingUpdateRate}s | Time since last: ${Math.round((nowTimestamp - forwardingLastUpdate) / 1000)}s`,
					);
				}

				let sentCount = 0;
				let unchangedCount = 0;
				let forwardingCount = 0;

				for (const vessel of filtered) {
					// PGN-Array für dieses Schiff
					const canPgns = [];

					const currentState = JSON.stringify({
						position: vessel.navigation?.position,
						speedOverGround: vessel.navigation?.speedOverGround,
						courseOverGroundTrue: vessel.navigation?.courseOverGroundTrue,
						headingTrue: vessel.navigation?.headingTrue,
						state: vessel.navigation?.state,
						name: vessel.name,
						callsign: vessel.callsign,
					});

					const previousState = previousVesselsState.get(vessel.mmsi);
					const hasChanged =
						!previousState || previousState !== currentState || hasNewClients;

					const lastBroadcast = lastTCPBroadcast.get(vessel.mmsi) || 0;
					const timeSinceLastBroadcast = nowTimestamp - lastBroadcast;
					const needsTCPResend =
						timeSinceLastBroadcast >= options.tcpResendInterval * 1000;

					if (!hasChanged && !forwardingUpdateDue && !needsTCPResend) {
						unchangedCount++;
						continue;
					}

					previousVesselsState.set(vessel.mmsi, currentState);

					const sendToTCP = hasChanged || needsTCPResend;

					const shouldLogDebug =
						options.logDebugDetails &&
						options.logDebugAIS &&
						(!options.logMMSI || vessel.mmsi === options.logMMSI);

					const aisClass = vessel?.sensors?.ais?.class?.value;
					const isClassA =
						!aisClass ||
						aisClass.trim() === "" ||
						aisClass.toUpperCase() === "A";

					const payload = isClassA
						? encoder.createPositionReportType1(vessel, options)
						: encoder.createPositionReportType19(vessel, options);

					if (payload) {
						const sentence = encoder.createNMEASentence(
							payload,
							1,
							1,
							messageIdCounter,
							"B",
						);

						if (shouldLogDebug) {
							app.debug(
								`MMSI ${vessel.mmsi} - Type ${
									isClassA ? "1" : "19"
								}: ${sentence}`,
							);
						}

						if (sendToTCP) {
							broadcastTCP(sentence);
							broadcastWebSocket(sentence);
							const safeVessel = sanitizeKeys(vessel);
							broadcastWebSocket(JSON.stringify(safeVessel));
							sentCount++;
							lastTCPBroadcast.set(vessel.mmsi, nowTimestamp);
						}

						// PGN sammeln statt sofort senden
						if (CAN_AVAILABLE) {
							const pgn = isClassA
								? encoder.createPGN129038(vessel, options)
								: encoder.createPGN129039(vessel, options);

							if (pgn) {
								canPgns.push(pgn);
							}
						}

						if (forwardingUpdateDue) {
							let posTimestamp = vessel.navigation?.position?.timestamp;
							if (!posTimestamp && vessel.navigation?.position?.value) {
								posTimestamp = vessel.navigation.position.value.timestamp;
							}

							if (posTimestamp) {
								const posAge = nowTimestamp - new Date(posTimestamp).getTime();
								const fiveMinutes = 5 * 60 * 1000;

								if (posAge <= fiveMinutes) {
									app.debug(`Sending to forwardings for vessel MMSI ${vessel.mmsi}`);
									sendToForwardings(sentence, options);
									forwardingCount++;
								}
							}
						}
					}

					const shouldSendStaticVoyage =
						vessel.callsign &&
						vessel.callsign.length > 0 &&
						(vessel.callsign.toLowerCase() !== "unknown" ||
							!options.skipWithoutCallsign);

					if (shouldSendStaticVoyage && sendToTCP) {
						if (isClassA) {
							const payload5 = encoder.createStaticVoyage(vessel);
							if (payload5) {
								if (payload5.length <= 62) {
									const sentence5 = encoder.createNMEASentence(
										payload5,
										1,
										1,
										messageIdCounter,
										"B",
									);
									if (shouldLogDebug) {
										app.debug(`[${vessel.mmsi}] Type 5: ${sentence5}`);
									}
									broadcastTCP(sentence5);
									broadcastWebSocket(sentence5);
								} else {
									const fragment1 = payload5.substring(0, 62);
									const fragment2 = payload5.substring(62);
									const sentence5_1 = encoder.createNMEASentence(
										fragment1,
										2,
										1,
										messageIdCounter,
										"B",
									);
									const sentence5_2 = encoder.createNMEASentence(
										fragment2,
										2,
										2,
										messageIdCounter,
										"B",
									);
									if (shouldLogDebug) {
										app.debug(`[${vessel.mmsi}] Type 5 (1/2): ${sentence5_1}`);
										app.debug(`[${vessel.mmsi}] Type 5 (2/2): ${sentence5_2}`);
									}
									broadcastTCP(sentence5_1);
									broadcastWebSocket(sentence5_1);
									broadcastTCP(sentence5_2);
									broadcastWebSocket(sentence5_2);
								}

								if (CAN_AVAILABLE) {
									const pgn = encoder.createPGN129794(vessel, options);
									if (pgn) {
										canPgns.push(pgn);
									}
								}
							}
						} else {
							const payload24 = encoder.createStaticVoyageType24(vessel);
							if (payload24) {
								const sentence24A = encoder.createNMEASentence(
									payload24.partA,
									1,
									1,
									messageIdCounter,
									"B",
								);
								if (shouldLogDebug) {
									app.debug(`[${vessel.mmsi}] Type 24 Part A: ${sentence24A}`);
								}
								broadcastTCP(sentence24A);
								broadcastWebSocket(sentence24A);

								if (CAN_AVAILABLE) {
									const pgna = encoder.createPGN129809(vessel, options);
									if (pgna) {
										canPgns.push(pgna);
									}
								}

								const sentence24B = encoder.createNMEASentence(
									payload24.partB,
									1,
									1,
									messageIdCounter,
									"B",
								);
								if (shouldLogDebug) {
									app.debug(`[${vessel.mmsi}] Type 24 Part B: ${sentence24B}`);
								}
								broadcastTCP(sentence24B);
								broadcastWebSocket(sentence24B);

								if (CAN_AVAILABLE) {
									const pgnb = encoder.createPGN129810(vessel, options);
									if (pgnb) {
										canPgns.push(pgnb);
									}
								}
							}
						}
					}

					// Am Ende der Vessel-Verarbeitung: PGNs in Queue einreihen
					if (canPgns.length > 0) {
						canBusQueue.push({ vessel, pgns: canPgns, options });
						// Non-blocking Start der Queue-Verarbeitung
						setImmediate(() => processCanBusQueue());
					}
				} // Ende for

				if (hasNewClients) {
					if (newTcpClients.length > 0) newTcpClients = [];
					if (newWSClients.length > 0) newWSClients = [];
				}

				if (forwardingUpdateDue) {
					forwardingLastUpdate = nowTimestamp;
					app.debug(
						`Forwarding: sent ${forwardingCount} vessels changed in last ${options.forwardingUpdateRate} seconds.`,
					);
				}

				app.debug(
					`${reason}: sent ${sentCount}, unchanged ${unchangedCount}, TCP clients ${
						tcpClients.length
					}, Websocket clients ${wsServer ? wsServer.clients.size : 0}`,
				);
			} catch (err) {
				app.error(`Error processing vessels: ${err}`);
			}
		} catch (err) {
			app.error(`Error in processVessels outer try: ${err}`);
		}
	}

	function cleanupMaps(currentMMSIs, options) {
		let removedFromState = 0;
		for (const mmsi of previousVesselsState.keys()) {
			if (!currentMMSIs.has(mmsi)) {
				previousVesselsState.delete(mmsi);
				removedFromState++;
			}
		}

		let removedFromBroadcast = 0;
		for (const mmsi of lastTCPBroadcast.keys()) {
			if (!currentMMSIs.has(mmsi)) {
				lastTCPBroadcast.delete(mmsi);
				removedFromBroadcast++;
			}
		}

		if (
			options.logDebugDetails &&
			(removedFromState > 0 || removedFromBroadcast > 0)
		) {
			app.debug(
				`Map cleanup: removed ${removedFromState} from previousVesselsState, ${removedFromBroadcast} from lastTCPBroadcast`,
			);
		}
	}

	async function isPluginEnabled(plugin, additionalText = "") {
		try {
			const features = await app.getFeatures();

			if (!features || !Array.isArray(features.plugins)) {
				app.debug("SignalK getFeatures() returned no plugins[] array.");
				return false;
			}

			const aisfleet = features.plugins.find(
				(p) => p.id && p.id.toLowerCase() === plugin,
			);

			if (!aisfleet) {
				app.debug(`Plugin ${plugin} not installed. ${additionalText}`);
				return false;
			}

			if (aisfleet.enabled === true) {
				return true;
			}

			app.debug(
				`Plugin ${plugin} installed but not enabled. ${additionalText}`,
			);
			return false;
		} catch (err) {
			app.debug(
				"Error calling app.getFeatures(). Data will be fetched from AISFleet.com:",
				err.message,
			);
			return false;
		}
	}

	return plugin;
};	
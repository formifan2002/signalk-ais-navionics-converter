# SignalK AIS to NMEA 0183 Converter

A SignalK plugin that converts AIS vessel data to NMEA 0183 sentences and broadcasts them via TCP to clients like Navionics Boating App. Optionally forwards AIS data to VesselFinder.com and integrates cloud vessel data from AISFleet.com.

## Features

- **TCP Server**: Broadcasts NMEA 0183 AIS messages (Type 1 and Type 5) to connected clients
- **Smart Update Logic**: 
  - Sends updates immediately when vessel data changes
  - Resends unchanged vessels periodically to prevent timeout in navigation apps
  - Sends complete dataset to newly connected clients
- **Cloud Integration**: Fetches nearby vessels from AISFleet.com API and merges with local AIS data
- **Data Quality**:
  - Filters stale data based on configurable age threshold
  - Corrects invalid COG/Heading values (360° → 0°)
  - Optionally sets SOG to 0 for vessels with outdated position data
  - Adds timestamp suffix to vessel names with old position data
- **VesselFinder.com Support**: Optional UDP forwarding of AIS Type 1 messages
- **Flexible Filtering**: Skip vessels without callsign or valid identification
- **Debug Options**: Detailed logging for specific MMSI or all vessels

## Installation

1. Install via SignalK App Store or manually:
```bash
cd ~/.signalk
npm install signalk-ais-navionics-converter
```

2. Restart SignalK server

3. Configure the plugin in SignalK admin interface → Plugin Config → AIS to NMEA 0183 Converter

## Configuration Parameters

### Basic Settings

#### TCP Port
- **Default**: 10113
- **Description**: Port for the NMEA 0183 TCP server. Configure your navigation app (e.g., Navionics) to connect to this port.

#### Update Interval for Changed Vessels
- **Default**: 15 (seconds)
- **Description**: How often to check for and send updates when vessel data changes. Lower values = more real-time updates but higher CPU usage.

#### Update Interval for Unchanged Vessels
- **Default**: 60 (seconds)
- **Description**: How often to resend data for vessels that haven't changed. Important for apps like Navionics to prevent vessels from disappearing. Set to 0 to disable (not recommended).

### Data Filtering

#### Skip Vessels Without Callsign
- **Default**: false
- **Description**: When enabled, vessels without a callsign will not be transmitted.

#### Skip Vessels With Stale Data
- **Default**: true
- **Description**: When enabled, vessels with outdated position data will not be transmitted.

#### Stale Data Threshold
- **Default**: 60 (minutes)
- **Description**: Position data older than this threshold will be considered stale and filtered out (if "Skip Vessels With Stale Data" is enabled).

#### Timestamp Added to Ship Name
- **Default**: 5 (minutes, 0=disabled)
- **Description**: Adds a timestamp suffix to the vessel name if position data is older than specified minutes. Format: `SHIPNAME MIN15`, `SHIPNAME HOUR2`, or `SHIPNAME DAY3`. Vessel names are truncated to 20 characters.

### Speed Over Ground (SOG) Correction

#### Minimum SOG for Alarm
- **Default**: 0.2 (m/s)
- **Description**: SOG values below this threshold will be set to 0. Used by the AIS encoder.

#### Maximum Minutes Before SOG Set to Zero
- **Default**: 0 (minutes, 0=disabled)
- **Description**: Automatically sets SOG to 0 for vessels whose position timestamp is older than specified minutes. Prevents false collision warnings in navigation apps for vessels with outdated data. Set to 0 to disable this feature.

### VesselFinder Integration

#### Enable VesselFinder Forwarding
- **Default**: false
- **Description**: When enabled, AIS Type 1 messages (position reports) are forwarded to VesselFinder.com via UDP.

#### VesselFinder Host
- **Default**: ais.vesselfinder.com
- **Description**: Hostname for VesselFinder UDP server.

#### VesselFinder UDP Port
- **Default**: 5500
- **Description**: UDP port for VesselFinder server.

#### VesselFinder Update Rate
- **Default**: 60 (seconds)
- **Description**: How often to send position updates to VesselFinder.

### AISFleet Cloud Integration

#### Include Vessels from AISFleet.com
- **Default**: true
- **Description**: Fetches nearby vessels from AISFleet.com cloud API and merges them with local SignalK vessel data. Requires internet connection and own position.

#### Radius for Cloud Vessels
- **Default**: 10 (nm / nautical miles)
- **Description**: Radius around own vessel position to fetch cloud vessels from AISFleet.com (1-100 nm).

### Debug Options

#### Debug All Vessel Details
- **Default**: false
- **Description**: Enables detailed debug logging for all vessels in the server log. Only visible when plugin is in debug mode. Useful for troubleshooting but generates lots of log data.

#### Debug MMSI
- **Default**: empty
- **Description**: MMSI number for detailed debug output of a specific vessel. Only visible when plugin is in debug mode. Leave empty to disable.

## How It Works

### Data Flow

1. **Data Collection**:
   - Fetches vessel data from SignalK API (`http://<IP_OF_SIGNALK_SERVER>:<PORT_SIGNALK_SERVER>/signalk/v1/api/vessels`)
   - Optionally fetches nearby vessels from AISFleet.com API
   - Merges both sources, preferring newer timestamps

2. **Data Processing**:
   - Filters out stale data based on age threshold
   - Corrects invalid navigation values (COG 360° → 0°)
   - Applies SOG correction for outdated positions
   - Filters vessels without valid name AND callsign

3. **NMEA Generation**:
   - Creates AIS Type 1 messages (position reports)
   - Creates AIS Type 5 messages (static vessel data)
   - Encodes as NMEA 0183 sentences

4. **Broadcasting**:
   - Sends to all connected TCP clients
   - Optionally forwards to VesselFinder.com via UDP
   - Resends periodically to prevent client timeouts

### Merge Logic

When the same vessel exists in both SignalK and AISFleet cloud data:
- **Position/Navigation**: Uses data with newer timestamp
- **Name**: Prefers any non-"Unknown" value
- **Callsign**: Prefers any non-empty value

### Client Connection Handling

When a new TCP client connects:
- Complete dataset of all vessels is sent immediately
- Client appears in "clients" count in logs
- Ensures navigation app shows all vessels right away

## Usage with Navionics Boating App

1. Configure plugin with desired settings
2. In Navionics app:
   - Go to Settings → Connected devices
   - Add new TCP (not UDP) connection
   - Enter SignalK server IP address
   - Enter configured TCP port (default: 10113)
3. Enable connection in Navionics
4. Vessels should appear on chart immediately

## Troubleshooting

### No vessels appear in navigation app
- Check that plugin is enabled and TCP server is running
- Verify TCP port in app matches plugin configuration
- Check firewall settings on SignalK server
- Enable debug logging to see if vessels are being sent

### Vessels disappear after a while
- Increase "Update Interval for Unchanged Vessels" (recommended: 60 seconds)
- Check if "Skip Vessels With Stale Data" is filtering out vessels
- Increase "Stale Data Threshold" if needed

### False collision warnings
- Enable "Maximum Minutes Before SOG Set to Zero"
- Set appropriate threshold (e.g., 5-10 minutes)
- This prevents CPA calculations for vessels with outdated position

### Too many/few vessels
- Adjust "Stale Data Threshold" to filter outdated vessels
- Enable/disable "Include Vessels from AISFleet.com"
- Adjust "Radius for Cloud Vessels" to control area coverage

## Debug Logging

To enable debug output:
1. In SignalK admin interface: Server → Settings → Logging
2. Change setting for plugin  `AIS to NMEA 0183 converter for TPC clients (e.g. Navionics)` to debug logging
3. Restart SignalK
4. Check logs in Server → Logs

Debug information includes:
- Number of vessels sent/unchanged
- Connected clients count
- Vessel filtering reasons
- AIS sentence output (when Debug MMSI is set)

## Requirements

- SignalK server (Node.js version)
- Own vessel position (for AISFleet cloud integration)
- Own vessel MMSI
- Internet connection (for AISFleet cloud features)
- Navigation app with NMEA 0183 TCP support (e.g., Navionics)

## License

MIT

## Author

Dirk Behrendt

## Contributing

Issues and pull requests are welcome!

## Changelog

### Version 1.0.0
- Initial release
- TCP server for NMEA 0183 AIS broadcasting
- SignalK and AISFleet cloud data integration
- VesselFinder.com UDP forwarding
- Smart filtering and data correction
- Configurable update intervals
# SignalK AIS to NMEA 0183 Converter

A SignalK plugin that converts AIS vessel data to NMEA 0183 sentences and broadcasts them via TCP to clients like 'Navionics Boating App' or 'OpenCpn'. Optionally forwards AIS data to VesselFinder.com and integrates cloud vessel data from AISFleet.com.

It is intended for vessels that do not have their own AIS receiver on board.

IMPORTANT: The following are required for the plugin to function:
  - a valid GPS position (visible in the SignalK Data Browser) in navigation.position
  - MMSI of your own vessel maintained in SignalK server settings (Server → Settings)

## Content

- [Features](#features)
- [Installation](#installation)
- [Configuration Parameters](#configuration-parameters)
  - [Basic Settings](#basic-settings)
    - [TCP Port](#tcp-port)
    - [Websocket Port](#websocket-port)
    - [Update Interval for Changed Vessels](#update-interval-for-changed-vessels)
    - [Update Interval for Unchanged Vessels](#update-interval-for-unchanged-vessels)
  - [Data Filtering](#data-filtering)
    - [Skip Vessels Without Callsign](#skip-vessels-without-callsign)
    - [Skip Vessels With Stale Data](#skip-vessels-with-stale-data)
    - [Stale Data Threshold](#stale-data-threshold)
    - [Timestamp Added to Ship Name](#timestamp-added-to-ship-name)
  - [Speed Over Ground (SOG) Correction](#speed-over-ground-sog-correction)
    - [Minimum SOG for Alarm](#minimum-sog-for-alarm)
    - [Maximum Minutes Before SOG Set to Zero](#maximum-minutes-before-sog-set-to-zero)
  - [VesselFinder Integration](#vesselfinder-integration)
    - [Enable VesselFinder Forwarding](#enable-vesselfinder-forwarding)
    - [VesselFinder Host](#vesselfinder-host)
    - [VesselFinder UDP Port](#vesselfinder-udp-port)
    - [VesselFinder Update Rate](#vesselfinder-update-rate)
  - [AISFleet Cloud Integration](#aisfleet-cloud-integration)
    - [Include Vessels from AISFleetcom](#include-vessels-from-aisfleetcom)
    - [Radius for Cloud Vessels](#radius-for-cloud-vessels)
  - [Debug Options](#debug-options)
    - [Debug All Vessel Details](#debug-all-vessel-details)
    - [Debug MMSI](#debug-mmsi)
    - [Debug Stale](#Debug-stale)
    - [Debug JSON](#debug-json)
    - [Debug AIS](#debug-ais-data)
    - [Debug corrected SOG](#debug-corrected-sog)
- [How It Works](#how-it-works)
  - [Data Flow](#data-flow)
  - [Merge Logic](#merge-logic)
  - [Client Connection Handling](#client-connection-handling)
- [Usage with Navionics Boating App](#usage-with-navionics-boating-app)
- [Usage with OpenCpn](#usage-with-openCpn)
- [Troubleshooting](#troubleshooting)
  - [No vessels appear in navigation app](#no-vessels-appear-in-navigation-app)
  - [Vessels disappear after a while](#vessels-disappear-after-a-while)
  - [False collision warnings](#false-collision-warnings)
  - [Too manyfew vessels](#too-manyfew-vessels)
- [Debug Logging](#debug-logging)
- [Requirements](#requirements)
- [License](#license)
- [Author](#author)
- [Contributing](#contributing)
- [Changelog](#changelog)

## Features

- **TCP Server**: Broadcasts NMEA 0183 AIS messages ([Type 1 - Position report AIS class A](https://gpsd.gitlab.io/gpsd/AIVDM.html#_types_1_2_and_3_position_report_class_a), [Type 19 - Extended position report AIS class B](https://gpsd.gitlab.io/gpsd/AIVDM.html#_type_19_extended_class_b_cs_position_report), [Type 5 - static and voyage related data class A](https://gpsd.gitlab.io/gpsd/AIVDM.html#_type_5_static_and_voyage_related_data) and [Type 24 - static data report class B](https://gpsd.gitlab.io/gpsd/AIVDM.html#_type_24_static_data_report)) to connected clients
- **Websocket Server**: Same data broadcasted by the TCP server is send via a separate Websocket Server to connected clients. In addition the vessel data is broadcasted as JSON object ({"mmsi": 123456, ....})
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

Warning: AIS data provided by this plugin can assist navigation. However, it never replaces the skipper's responsibility. I exclude any liability for damages resulting from the use of this plugin.

## Installation

1. Install via SignalK App Store 
2. Restart SignalK server
3. Configure the plugin in SignalK admin interface → Server → Plugin Config → AIS to NMEA 0183 converter for TPC clients (e.g. Navionics)

## Configuration Parameters

### Basic Settings

#### TCP Port
- **Default**: 10113
- **Description**: Port for the NMEA 0183 TCP server. Configure your navigation app (e.g., Navionics, OpenCpn) to connect to this port.

#### Websocket Port
- **Default**: 10114
- **Description**: All AIS (NMEA 0183) messages are send by an own websocket server on this port to connected clients. In addition the data of the vessels is send as JSON. Data can then be used by other plugins / apps (as clients). For the communication with the Navionics app, this port is not needed. If port is set to 0 no  Websocket server is started.

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
- **Description**: When enabled, AIS Type 1 and Type 19 messages (position reports for AIS class A and B) are forwarded to VesselFinder.com via UDP.

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
- **Description**: Fetches nearby vessels from AISFleet.com cloud API and merges them with local SignalK vessel data. Requires internet connection and own position (in SignalK key "navigation.position" must exist). If the plugin "AIS Fleet" is already installed and enabled in SignalK, this option is not shown.

#### Radius for Cloud Vessels
- **Default**: 10 (nm / nautical miles)
- **Description**: Radius around own vessel position to fetch cloud vessels from AISFleet.com (1-100 nm).

### Debug Options

#### Debug All Vessel Details
- **Default**: false
- **Description**: Enables detailed debug logging for all vessels in the server log. Option only visible if plugin is in debug mode. Useful for troubleshooting or understanding of send data.

#### Debug MMSI
- **Default**: empty
- **Description**: Debug output will be filtered for only this MMSI. Option only visible if plugin is in debug mode. Leave empty to disable.

#### Debug Stale
- **Default**: false
- **Description**: Stale vessels will be shown in debug log - option only visible if plugin is in debug mode and debug all vessel details is enabled

#### Debug JSON
- **Default**: false
- **Description**: JSON data of vessels will be shown in debug log - option only visible if plugin is in debug mode and debug all vessel details is enabled

#### Debug AIS data
- **Default**: false
- **Description**:  AIS NMEA0183 data output will be shown in debug log - option only visible if plugin is in debug mode and debug all vessel details is enabled

#### Debug corrected SOG
- **Default**: false
- **Description**:  Vessels with corrected SOG will be shown in the debug log - option only visible if plugin is in debug mode and debug all vessel details is enabled

## How It Works

### Data Flow

1. **Data Collection**:
   - Fetches vessel data from SignalK API (`http://<IP_OF_SIGNALK_SERVER>:<PORT_SIGNALK_SERVER>/signalk/v1/api/vessels`)
     - use other SignalK plugins (like AisHub WS) to receive more vessels for SignalK with AIS information
   - Optionally fetches nearby vessels from AISFleet.com API (if plugin "AIS Fleet" is not installed or not enabled)
   - Merges both sources, preferring newer timestamps

2. **Data Processing**:
   - Filters out stale data based on age threshold
   - Corrects invalid navigation values (COG 360° → 0°)
   - Applies SOG correction for outdated positions
   - Filters vessels without valid name AND callsign

3. **NMEA Generation**:
   - Creates AIS Type 1 (class A) or Type 19 (class B) messages (position reports)
   - Creates AIS Type 5 (class A) or Type 25 (class B) messages (static vessel data)
   - Encodes as NMEA 0183 sentences

4. **Broadcasting**:
   - Sends to all connected TCP clients
   - Sends to all connected Websocket clients
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
   - Go to Menu → Connected devices
     - Add new connection (via + sign in upper right corner)
     - Enter name for the connection (e.g. SignalkAIS)
     - Enter SignalK server IP address
     - Enter configured TCP port (default: 10113 - same setting like in SignalK plugin)
     - Select TCP (not UDP) 
     - Save connection
   - Go to Menu → Chart options → AIS settings 
     - turn 'Display AIS targets' on
3. Vessels should appear on chart immediately and in 'Connected devices' you should see as status for the connection: 'connected' (in green) and 'AIS data reception'

## Usage with OpenCpn

1. Configure plugin with desired settings
2. In OpenCpn:
   - Go to Menu → Tools → Options → Connections
     - Add new connection as follows:
         ![OpenCPN Screenshot1](img/OpenCpn1.png)
         ![OpenCPN Screenshot2](img/OpenCpn2.png)
     - Save connection
   - Go to Menu → AIS 
     - enable AIS targets
3. Vessels should appear on chart immediately 

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
- Enable/disable "Include Vessels from AISFleet.com" (if plugin "AIS Fleet" is not installed)
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
- Own vessel position (for AISFleet cloud integration, if "AIS Fleet" plugin is not installed)
- Own vessel MMSI
- Navigation app with NMEA 0183 TCP support (e.g. Navionics boating app, OpenCpn,...)

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
### Version 1.0.1
 - enhanced debug logs
### Version 1.0.2
 - Changed to "Embedded Plugin Configuration Forms"
 ### Version 1.0.3
 - AIS message types for class A / B separated
 - AIS Websocket server added
 ### Version 1.0.4
 - minor bug corrections for unavailable ROT / Heading
 ### Version 1.0.5
 - bug fixing Heading

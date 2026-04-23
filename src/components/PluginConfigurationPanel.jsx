import React, { useState, useEffect } from 'react';

const PluginConfigurationPanel = ({ configuration, save }) => {
  const [config, setConfig] = useState(configuration || {});
  const [initialConfig, setInitialConfig] = useState(configuration);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [showDialog, setShowDialog] = useState(false);
  const [dialogData, setDialogData] = useState({ title: '', message: '', callback: null });
  const [ownMMSI, setOwnMMSI] = useState(null);
  const [aisfleetEnabled, setAisfleetEnabled] = useState(false);
  const [portError, setPortError] = useState('');
  const [nmea2000Interfaces, setNmea2000Interfaces] = useState([]); 
  
  const translations = {
    de: {
      general: 'Allgemein',
      tcpServer: 'TCP Server',
      filtering: 'Filterung',
      debugging: 'Debugging',
      forwarding: 'Weiterleitung',
      cloudVessels: 'Cloud Vessels (AISFleet)',
      
      tcpPort: 'TCP Port:',
      wsPort: 'WebSocket Port:',
      updateInterval: 'Update-Intervall für geänderte Schiffe (Sekunden):',
      tcpResendInterval: 'Update-Intervall für unveränderte Schiffe (Sekunden):',
      
      skipWithoutCallsign: 'Schiffe ohne Rufzeichen überspringen',
      skipStaleData: 'Schiffe mit alten Daten überspringen',
      staleDataThreshold: 'Schwellenwert für alte Daten (Minuten):',
      staleDataShipname: 'Zeitstempel zum Schiffsnamen hinzufügen wenn die letzte Positionsmeldung älter ist als x Minuten (0=deaktiviert):',
      
      minAlarmSOG: 'SOG (und COG) wird auf 0 gesetzt, wenn die Geschwindigkeit kleiner als x Knoten ist (0=deaktiviert):',
      maxMinutesSOGToZero: 'SOG wird auf 0 gesetzt wenn die letzte Positionsmeldung älter ist als x Minuten (0=keine Korrektur):',
      
      logDebugDetails: 'Debug Schiff-Details',
      logMMSI: 'Filter Debug-Ausgabe nur für MMSI:',
      logDebugStale: 'Debug alte Schiffe',
      logDebugJSON: 'Debug JSON-Daten',
      logDebugAIS: 'Debug AIS-Daten',
      logDebugSOG: 'Debug Schiffe mit korrigierter SOG',
      
      nmea2000Creation: 'Erstelle NMEA2000 Datensätze',
      nmea2000CreationHelp: 'Erzeugt NMEA2000 Position Report PGN 129038 (Class A) / PGN 129039 (Class B), PGN 129794 (Class A Static and Voyage Related Data), PGN 129809+129810 (Class B static data Part A+B).',
      nmea2000Interface: 'NMEA2000 CAN-Bus-Schnittstelle',
      nmea2000InterfaceHelp: 'Es werden nur aktive CAN- oder vCAN-Schnittstellen angezeigt.',
      nmea2000Src: 'Adresse des sendenden Geräts im NMEA2000‑Netzwerk (0-251)',

      forwardingHost: 'Host:',
      forwardingPort: 'UDP Port:',
      forwardingUpdateRate: 'Update Rate (Sekunden):',
      addConnection: 'Neue Verbindung',
      deleteConnection: 'Verbindung löschen',
      
      cloudVesselsEnabled: 'Schiffe von AISFleet.com einbeziehen',
      cloudVesselsUpdateInterval: 'Cloud Vessels Update-Intervall (Sekunden):',
      cloudVesselsRadius: 'Radius von eigenem Schiff (Seemeilen):',
      cloudVesselsTimeout: 'Timeout in Sekunden zum Abrufen der Daten von AISFleet.com (Standard: 15)',
      
      portError: 'TCP Port und WebSocket Port müssen unterschiedlich sein',
      
      save: 'Speichern',
      cancel: 'Abbruch',
      unsavedWarning: 'Es gibt ungespeicherte Änderungen. Wirklich abbrechen?',
      unsavedTitle: 'Ungespeicherte Änderungen',
      yes: 'Ja',
      no: 'Nein'
    },
    en: {
      general: 'General',
      tcpServer: 'TCP Server',
      filtering: 'Filtering',
      debugging: 'Debugging',
      forwarding: 'Forwarding',
      cloudVessels: 'Cloud Vessels (AISFleet)',
      
      tcpPort: 'TCP Port:',
      wsPort: 'WebSocket Port:',
      updateInterval: 'Update interval for changed vessels (seconds):',
      tcpResendInterval: 'Update interval for unchanged vessels (seconds):',
      
      skipWithoutCallsign: 'Skip vessels without callsign',
      skipStaleData: 'Skip vessels with stale data',
      staleDataThreshold: 'Stale data threshold (minutes):',
      staleDataShipname: 'Add timestamp to vessel name if the last position report is older than x minutes (0=disabled):',
      
      minAlarmSOG: 'SOG (and COG) is set to 0 if the speed is less than x knots (0=disabled):',
      maxMinutesSOGToZero: 'SOG is set to 0 if the last position report is older than x minutes (0=no correction):',
      
      logDebugDetails: 'Debug vessel details',
      logMMSI: 'Filter Debug only for MMSI:',
      logDebugStale: 'Debug stale vessels',
      logDebugJSON: 'Debug JSON data',
      logDebugAIS: 'Debug AIS data',
      logDebugSOG: 'Debug vessels with corrected SOG',

      nmea2000Creation: 'Create NMEA2000 records',
      nmea2000CreationHelp: 'Generates NMEA2000 Position Report PGN 129038 (Class A) / PGN 129039 (Class B), PGN 129794 (Class A Static and Voyage Related Data), PGN 129809+129810 (Class B static data Part A+B).',
      nmea2000Interface: 'NMEA2000 CAN Bus Interface',
      nmea2000InterfaceHelp: 'Only active CAN or vCAN interfaces are shown.',
      nmea2000Src: 'Source address of the transmitting device on the NMEA2000 network (0-251)',

      forwardingHost: 'Host:',
      forwardingPort: 'UDP Port:',
      forwardingUpdateRate: 'Update Rate (seconds):',
      addConnection: 'Add Connection',
      deleteConnection: 'Delete connection',
      
      cloudVesselsEnabled: 'Include vessels from AISFleet.com',
      cloudVesselsUpdateInterval: 'Cloud Vessels update interval (seconds):',
      cloudVesselsRadius: 'Radius from own vessel (nautical miles):',
      cloudVesselsTimeout: 'Timeout in seconds to fetch the data from AISFleet.com (default: 15)',

      
      portError: 'TCP Port and WebSocket Port must be different',
      
      save: 'Save',
      cancel: 'Cancel',
      unsavedWarning: 'There are unsaved changes. Really cancel?',
      unsavedTitle: 'Unsaved changes',
      yes: 'Yes',
      no: 'No'
    }
  };

  const [currentLang, setCurrentLang] = useState(config.language === 'de' ? 'de' : 'en');
  const t = translations[currentLang];

  // Hole eigene MMSI, CAN interfaces und Status des Plugin aisfleet  beim Laden
  useEffect(() => {
    const fetchData = async () => {
      try {
        const protocol = window.location.protocol;
        const hostname = window.location.hostname;
        const port = window.location.port;
        const baseUrl = `${protocol}//${hostname}${port ? ':' + port : ''}`;

        const nmea2000InterfacesUrl = `${baseUrl}/plugins/signalk-ais-navionics-converter/can-interfaces`;
        const aisfleetUrl = `${baseUrl}/plugins/signalk-ais-navionics-converter/aisfleet-status`;
        const url = `${baseUrl}/signalk/v1/api/self`;
        // 1. MMSI laden
        const response = await fetch(url);
        if (response.ok) {
          const data = await response.json();
          let vesselKey = null;

          if (typeof data === 'string') {
            vesselKey = data.replace('vessels.', '');
          } else if (data.vessels && typeof data.vessels === 'object') {
            const mmsiMatch = Object.keys(data.vessels).find(key => key.includes('mmsi:'));
            vesselKey = mmsiMatch;
          }

          if (vesselKey) {
            const mmsi = vesselKey.match(/mmsi:(\d+)/)?.[1];
            if (mmsi) setOwnMMSI(mmsi);
          }
        }
        // 2. AIS Fleet Plugin prüfen
        try {
          const aisResponse = await fetch(aisfleetUrl);

          if (aisResponse.ok) {
            const aisData = await aisResponse.json();

            // Nur true, wenn installed === true UND enabled === true
            const isEnabled = aisData.installed === true && aisData.enabled === true;

            setAisfleetEnabled(isEnabled);
          } else {
            setAisfleetEnabled(false);
          }
        } catch {
          setAisfleetEnabled(false);
        }

      // 3. NMEA2000 Interfaces laden
      try {
        if (config.nmea2000Src === undefined) { handleConfigChange("nmea2000Src", 42)};
        const ifaceRes = await fetch(nmea2000InterfacesUrl);
        const ifaceData = await ifaceRes.json();

        // Nur aktive Interfaces extrahieren
        const activeIfaces = Object.entries(ifaceData)
          .filter(([_, info]) => info.state === "up")
          .map(([iface]) => iface);

        setNmea2000Interfaces(activeIfaces);

        // 1) Wenn config einen Wert hat → vorauswählen
        if (config?.nmea2000Interface && activeIfaces.includes(config.nmea2000Interface)) {
          handleConfigChange("nmea2000Interface", config.nmea2000Interface);
        }

        // 2) Wenn noch nichts gesetzt ist → erstes Interface automatisch setzen
        else if (!config?.nmea2000Interface && activeIfaces.length > 0) {
          handleConfigChange("nmea2000Interface", activeIfaces[0]);
        }

      } catch (err) {
        console.error("Fehler beim Laden der CAN-Interfaces:", err);
      }


      } catch (err) {
        console.error("Failed to fetch data:", err);
      }
    };

    setTimeout(fetchData, 500);
  }, []);   


  const handleConfigChange = (key, value) => {
    setConfig(prev => ({ ...prev, [key]: value }));
    
    // Überprüfe Port-Nummern
    if (key === 'tcpPort' || key === 'wsPort') {
      const tcpPort = key === 'tcpPort' ? value : config.tcpPort;
      const wsPort = key === 'wsPort' ? value : config.wsPort;
      
      if (tcpPort && wsPort && tcpPort !== 0 && wsPort !== 0 && tcpPort === wsPort) {
        setPortError(t.portError);
      } else {
        setPortError('');
      }
    }
  };

  // Weiterleitungen verwalten
  const handleAddForwarding = () => {
    const forwardings = config.forwardings || [];
    const newForwardings = [...forwardings, { host: '', port: 5500 }];
    handleConfigChange('forwardings', newForwardings);
  };

  const handleUpdateForwarding = (index, field, value) => {
    const forwardings = [...(config.forwardings || [])];
    forwardings[index] = { ...forwardings[index], [field]: value };
    handleConfigChange('forwardings', forwardings);
  };

  const handleDeleteForwarding = (index) => {
    const forwardings = config.forwardings || [];
    const newForwardings = forwardings.filter((_, i) => i !== index);
    handleConfigChange('forwardings', newForwardings);
  };

  const isMMSIInvalid = () => {
    return ownMMSI && config.logMMSI && config.logMMSI === ownMMSI;
  };

  const isPortInvalid = () => {
    const tcpPort = config.tcpPort || 10113;
    const wsPort = config.wsPort || 10114;
    return tcpPort !== 0 && wsPort !== 0 && tcpPort === wsPort;
  };

  const checkUnsavedChanges = () => {
    return JSON.stringify(config) !== JSON.stringify(initialConfig);
  };

  const handleSave = () => {
    if (isMMSIInvalid()) return;
    if (isPortInvalid()) return;

    setLoading(true);
    setTimeout(async () => {
      try {
        if (save && typeof save === 'function') {
          await save(config);
        }
        setInitialConfig(config);
        setStatus('success');
        setTimeout(() => setStatus(''), 3000);
      } catch (err) {
        console.error("Error saving config:", err);
        setStatus('error');
        setTimeout(() => setStatus(''), 3000);
      } finally {
        setLoading(false);
      }
    }, 500);
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.title}>
          {currentLang === 'de' ? 'AIS-Navionics-Konverter Konfiguration' : 'AIS-Navionics-Converter Configuration'}
        </h1>
        <div style={styles.languageSelector}>
          <button
            onClick={() => setCurrentLang('de')}
            style={{
              ...styles.langButton,
              ...(currentLang === 'de' ? styles.langButtonActive : {})
            }}
          >
            Deutsch
          </button>
          <button
            onClick={() => setCurrentLang('en')}
            style={{
              ...styles.langButton,
              ...(currentLang === 'en' ? styles.langButtonActive : {})
            }}
          >
            English
          </button>
        </div>
      </div>

      {/* General */}
      <div style={styles.section}>
        <h2 style={styles.sectionTitle}>{t.general}</h2>
        <div style={styles.formGroup}>
          <label style={styles.label}>
            {currentLang === 'de' ? 'Sprache / Language:' : 'Language / Sprache:'}
          </label>
          <select
            value={config.language || 'de'}
            onChange={(e) => {
              handleConfigChange('language', e.target.value);
              setCurrentLang(e.target.value);
            }}
            style={styles.input}
          >
            <option value="de">Deutsch</option>
            <option value="en">English</option>
          </select>
        </div>
      </div>

      {/* TCP Server */}
      <div style={styles.section}>
        <h2 style={styles.sectionTitle}>{t.tcpServer}</h2>
        <div style={styles.formGroup}>
          <label style={styles.label}>{t.tcpPort}</label>
          <input
            type="number"
            min="1"
            max="65535"
            value={config.tcpPort || 10113}
            onChange={(e) => handleConfigChange('tcpPort', Number(e.target.value))}
            style={styles.input}
          />
        </div>

        <div style={styles.formGroup}>
          <label style={styles.label}>{t.wsPort}</label>
          <input
            type="number"
            min="1"
            max="65535"
            value={config.wsPort || 10114}
            onChange={(e) => handleConfigChange('wsPort', Number(e.target.value))}
            style={styles.input}
          />
        </div>

        <div style={styles.formGroup}>
          <label style={styles.label}>{t.updateInterval}</label>
          <input
            type="number"
            min="1"
            value={config.updateInterval || 60}
            onChange={(e) => handleConfigChange('updateInterval', Number(e.target.value))}
            style={styles.input}
          />
        </div>

        <div style={styles.formGroup}>
          <label style={styles.label}>{t.tcpResendInterval}</label>
          <input
            type="number"
            min="1"
            value={config.tcpResendInterval || 300}
            onChange={(e) => handleConfigChange('tcpResendInterval', Number(e.target.value))}
            style={styles.input}
          />
        </div>

        {portError && (
          <div style={styles.error}>{portError}</div>
        )}
      </div>

      {/* Filtering */}
      <div style={styles.section}>
        <h2 style={styles.sectionTitle}>{t.filtering}</h2>
        <div style={styles.checkbox}>
          <input
            type="checkbox"
            id="skipWithoutCallsign"
            checked={config.skipWithoutCallsign || false}
            onChange={(e) => handleConfigChange('skipWithoutCallsign', e.target.checked)}
          />
          <label htmlFor="skipWithoutCallsign" style={{ margin: 0 }}>
            {t.skipWithoutCallsign}
          </label>
        </div>

        <div style={styles.checkbox}>
          <input
            type="checkbox"
            id="skipStaleData"
            checked={config.skipStaleData || false}
            onChange={(e) => handleConfigChange('skipStaleData', e.target.checked)}
          />
          <label htmlFor="skipStaleData" style={{ margin: 0 }}>
            {t.skipStaleData}
          </label>
        </div>

        {config.skipStaleData && (
          <div style={styles.formGroup}>
            <label style={styles.label}>{t.staleDataThreshold}</label>
            <input
              type="number"
              min="1"
              value={config.staleDataThreshold || 60}
              onChange={(e) => handleConfigChange('staleDataThreshold', Number(e.target.value))}
              style={styles.input}
            />
          </div>
        )}

        {config.skipStaleData && (
          <div style={styles.formGroup}>
            <label style={styles.label}>{t.staleDataShipname}</label>
            <input
              type="number"
              min="0"
              value={config.staleDataShipname || 0}
              onChange={(e) => handleConfigChange('staleDataShipname', Number(e.target.value))}
              style={styles.input}
            />
          </div>
        )}

        <div style={styles.formGroup}>
          <label style={styles.label}>{t.minAlarmSOG}</label>
          <input
            type="number"
            min="0"
            step="0.1"
            value={config.minAlarmSOG || 0}
            onChange={(e) => handleConfigChange('minAlarmSOG', Number(e.target.value))}
            style={styles.input}
          />
        </div>

        <div style={styles.formGroup}>
          <label style={styles.label}>{t.maxMinutesSOGToZero}</label>
          <input
            type="number"
            min="0"
            value={config.maxMinutesSOGToZero || 0}
            onChange={(e) => handleConfigChange('maxMinutesSOGToZero', Number(e.target.value))}
            style={styles.input}
          />
        </div>
      </div>

      {/* Debugging */}
      <div style={styles.section}>
        <h2 style={styles.sectionTitle}>{t.debugging}</h2>
        <div style={styles.checkbox}>
          <input
            type="checkbox"
            id="logDebugDetails"
            checked={config.logDebugDetails || false}
            onChange={(e) => handleConfigChange('logDebugDetails', e.target.checked)}
          />
          <label htmlFor="logDebugDetails" style={{ margin: 0 }}>
            {t.logDebugDetails}
          </label>
        </div>

        {config.logDebugDetails && (
          <div style={styles.formGroup}>
            <label style={styles.label}>{t.logMMSI}</label>
            <input
              type="text"
              placeholder="e.g. 227651230"
              value={config.logMMSI || ''}
              onChange={(e) => handleConfigChange('logMMSI', e.target.value)}
              style={styles.input}
            />
            {isMMSIInvalid() && (
              <div style={styles.error}>
                {currentLang === 'de'
                  ? 'MMSI darf nicht die eigene MMSI sein!'
                  : 'MMSI must not be the own vessel MMSI!'}
              </div>
            )}
          </div>
        )}

        <div style={styles.checkbox}>
          <input
            type="checkbox"
            id="logDebugStale"
            checked={config.logDebugStale || false}
            onChange={(e) => handleConfigChange('logDebugStale', e.target.checked)}
          />
          <label htmlFor="logDebugStale" style={{ margin: 0 }}>
            {t.logDebugStale}
          </label>
        </div>

        <div style={styles.checkbox}>
          <input
            type="checkbox"
            id="logDebugJSON"
            checked={config.logDebugJSON || false}
            onChange={(e) => handleConfigChange('logDebugJSON', e.target.checked)}
          />
          <label htmlFor="logDebugJSON" style={{ margin: 0 }}>
            {t.logDebugJSON}
          </label>
        </div>

        <div style={styles.checkbox}>
          <input
            type="checkbox"
            id="logDebugAIS"
            checked={config.logDebugAIS || false}
            onChange={(e) => handleConfigChange('logDebugAIS', e.target.checked)}
          />
          <label htmlFor="logDebugAIS" style={{ margin: 0 }}>
            {t.logDebugAIS}
          </label>
        </div>

        <div style={styles.checkbox}>
          <input
            type="checkbox"
            id="logDebugSOG"
            checked={config.logDebugSOG || false}
            onChange={(e) => handleConfigChange('logDebugSOG', e.target.checked)}
          />
          <label htmlFor="logDebugSOG" style={{ margin: 0 }}>
            {t.logDebugSOG}
          </label>
        </div>
      </div>

      {/* NMEA2000 */}
      <div style={styles.section}>
        <h2 style={styles.sectionTitle}>NMEA 2000</h2>
        <div style={styles.checkbox}>
          <input
            type="checkbox"
            id="nmea2000Creation"
            checked={config.nmea2000Creation || false}
            onChange={(e) => handleConfigChange('nmea2000Creation', e.target.checked)}
          />
          <label htmlFor="nmea2000Creation" style={{ margin: 0 }}>
            {t.nmea2000Creation}
          </label>
        </div>
        <div style={{ fontSize: '0.85em', color: '#666', marginBottom: '15px' }}>
          {t.nmea2000CreationHelp}
        </div>

        {config.nmea2000Creation && (
          <>
            <div style={styles.formGroup}>
              <label style={styles.label}>{t.nmea2000Interface}</label>
              <div style={{ fontSize: '0.85em', color: '#666', marginBottom: '10px' }}>
                {t.nmea2000InterfaceHelp}
              </div>
              <select
                value={config.nmea2000Interface || ''}
                onChange={(e) => handleConfigChange('nmea2000Interface', e.target.value)}
                style={styles.input}
              >
                {nmea2000Interfaces.map(iface => (
                  <option key={iface} value={iface}>{iface}</option>
                ))}
              </select>
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>{t.nmea2000Src}</label>
              <input
                type="number"
                min="0"
                max="251"
                value={config.nmea2000Src || 42}
                onChange={(e) => handleConfigChange('nmea2000Src', Number(e.target.value))}
                style={styles.input}
              />
            </div>
          </>
        )}
      </div>

      {/* Forwarding */}
      <div style={styles.section}>
        <h2 style={styles.sectionTitle}>{t.forwarding}</h2>
        
        <div style={styles.formGroup}>
          <label style={styles.label}>{t.forwardingUpdateRate}</label>
          <input
            type="number"
            min="1"
            value={config.forwardingUpdateRate || 60}
            onChange={(e) => handleConfigChange('forwardingUpdateRate', Number(e.target.value))}
            style={styles.input}
          />
        </div>

        {/* Forwardings List */}
        <div style={styles.forwardingsList}>
          {(config.forwardings || []).map((forwarding, index) => (
            <div key={index} style={styles.forwardingItem}>
              <div style={styles.forwardingInputsRow}>
                <div style={styles.forwardingInputGroup}>
                  <label style={{...styles.label, marginBottom: '5px'}}>{t.forwardingHost}</label>
                  <input
                    type="text"
                    placeholder="e.g. ais.vesselfinder.com"
                    value={forwarding.host || ''}
                    onChange={(e) => handleUpdateForwarding(index, 'host', e.target.value)}
                    style={{...styles.input, width: '100%'}}
                  />
                </div>

                <div style={styles.forwardingInputGroup}>
                  <label style={{...styles.label, marginBottom: '5px'}}>{t.forwardingPort}</label>
                  <input
                    type="number"
                    min="1"
                    max="65535"
                    placeholder="e.g. 5500"
                    value={forwarding.port || ''}
                    onChange={(e) => handleUpdateForwarding(index, 'port', Number(e.target.value))}
                    style={{...styles.input, width: '100%'}}
                  />
                </div>

                <button
                  onClick={() => handleDeleteForwarding(index)}
                  style={styles.deleteButton}
                  title={t.deleteConnection}
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Add Connection Button */}
        <button
          onClick={handleAddForwarding}
          style={styles.addConnectionButton}
        >
          + {t.addConnection}
        </button>
      </div>

      {/* Cloud Vessels */}
      {aisfleetEnabled && (
        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>{t.cloudVessels}</h2>
          <div style={styles.checkbox}>
            <input
              type="checkbox"
              id="cloudVesselsEnabled"
              checked={config.cloudVesselsEnabled || false}
              onChange={(e) => handleConfigChange('cloudVesselsEnabled', e.target.checked)}
            />
            <label htmlFor="cloudVesselsEnabled" style={{ margin: 0 }}>
              {t.cloudVesselsEnabled}
            </label>
          </div>

          {config.cloudVesselsEnabled && (
            <>
              <div style={styles.formGroup}>
                <label style={styles.label}>{t.cloudVesselsUpdateInterval}</label>
                <input
                  type="number"
                  min="1"
                  value={config.cloudVesselsUpdateInterval || 300}
                  onChange={(e) => handleConfigChange('cloudVesselsUpdateInterval', Number(e.target.value))}
                  style={styles.input}
                />
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>{t.cloudVesselsRadius}</label>
                <input
                  type="number"
                  min="1"
                  value={config.cloudVesselsRadius || 10}
                  onChange={(e) => handleConfigChange('cloudVesselsRadius', Number(e.target.value))}
                  style={styles.input}
                />
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>{t.cloudVesselsTimeout}</label>
                <input
                  type="number"
                  min="1"
                  value={config.cloudVesselsTimeout || 15}
                  onChange={(e) => handleConfigChange('cloudVesselsTimeout', Number(e.target.value))}
                  style={styles.input}
                />
              </div>

            </>
          )}
        </div>
      )}

      {status && (
        <div style={{...styles.statusMessage, ...(status === 'error' ? styles.error : styles.success)}}>
          {status === 'success' 
            ? (currentLang === 'de' ? 'Konfiguration gespeichert' : 'Configuration saved')
            : (currentLang === 'de' ? 'Fehler beim Speichern' : 'Error saving')}
        </div>
      )}

      <div style={styles.buttonGroup}>
        <button
          onClick={handleSave}
          disabled={loading || isMMSIInvalid() || isPortInvalid()}
          style={{
            ...styles.button, 
            ...styles.primaryButton, 
            ...((isMMSIInvalid() || isPortInvalid()) ? { opacity: 0.5, cursor: 'not-allowed' } : {})
          }}
        >
          {t.save}
        </button>
        <button
          onClick={() => {
            if (checkUnsavedChanges()) {
              setDialogData({
                title: t.unsavedTitle,
                message: t.unsavedWarning,
                callback: () => setConfig(initialConfig)
              });
              setShowDialog(true);
            } else {
              setConfig(initialConfig);
            }
          }}
          style={{...styles.button, ...styles.secondaryButton}}
        >
          {t.cancel}
        </button>
      </div>

      {showDialog && (
        <div style={styles.dialog}>
          <div style={styles.dialogContent}>
            <h4 style={styles.dialogTitle}>{dialogData.title}</h4>
            <p>{dialogData.message}</p>
            <div style={styles.dialogButtons}>
              <button
                onClick={() => setShowDialog(false)}
                style={{...styles.button, ...styles.secondaryButton}}
              >
                {t.no}
              </button>
              <button
                onClick={() => {
                  if (dialogData.callback) dialogData.callback();
                  setShowDialog(false);
                }}
                style={{...styles.button, ...styles.primaryButton}}
              >
                {t.yes}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const styles = {
  container: {
    padding: '20px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '30px',
    paddingBottom: '20px',
    borderBottom: '2px solid #667eea',
  },
  title: {
    margin: 0,
    fontSize: '1.5em',
    fontWeight: '600',
    color: '#333',
  },
  helpButton: {
    padding: '8px 16px',
    backgroundColor: '#667eea',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontWeight: '500',
    fontSize: '0.95em',
    transition: 'background 0.3s',
  },
  languageSelector: {
    display: 'flex',
    gap: '10px',
    marginBottom: '30px',
  },
  langButton: {
    padding: '8px 16px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    cursor: 'pointer',
    fontWeight: '500',
    backgroundColor: '#f5f5f5',
  },
  langButtonActive: {
    backgroundColor: '#667eea',
    color: 'white',
    borderColor: '#667eea',
  },
  section: {
    marginBottom: '30px',
  },
  sectionTitle: {
    fontSize: '1.2em',
    fontWeight: '600',
    marginBottom: '15px',
    color: '#333',
    borderBottom: '2px solid #667eea',
    paddingBottom: '10px',
  },
  formGroup: {
    marginBottom: '15px',
  },
  label: {
    display: 'block',
    fontWeight: '500',
    marginBottom: '5px',
    color: '#333',
  },
  input: {
    padding: '8px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    fontSize: '1em',
    width: '200px',
  },
  checkbox: {
    display: 'flex',
    alignItems: 'center',
    marginBottom: '8px',
    cursor: 'pointer',
    gap: '8px',
  },
  forwardingsList: {
    marginBottom: '15px',
    backgroundColor: '#f9f9f9',
    padding: '10px',
    borderRadius: '4px',
    border: '1px solid #e0e0e0',
  },
  forwardingItem: {
    marginBottom: '15px',
    paddingBottom: '15px',
    borderBottom: '1px solid #ddd',
  },
  forwardingItem_last: {
    marginBottom: '0',
    paddingBottom: '0',
    borderBottom: 'none',
  },
  forwardingInputsRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 150px 50px',
    gap: '15px',
    alignItems: 'flex-end',
  },
  forwardingInputGroup: {
    display: 'flex',
    flexDirection: 'column',
  },
  deleteButton: {
    backgroundColor: '#ff6b6b',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    padding: '8px 12px',
    cursor: 'pointer',
    fontWeight: 'bold',
    fontSize: '1.2em',
    transition: 'background 0.3s',
    height: '36px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteButton_hover: {
    backgroundColor: '#ff5252',
  },
  addConnectionButton: {
    padding: '10px 20px',
    backgroundColor: '#28a745',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontWeight: '500',
    fontSize: '1em',
    transition: 'background 0.3s',
  },
  addConnectionButton_hover: {
    backgroundColor: '#218838',
  },
  buttonGroup: {
    display: 'flex',
    gap: '10px',
    marginTop: '30px',
    paddingTop: '20px',
    borderTop: '1px solid #ddd',
  },
  button: {
    padding: '10px 20px',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontWeight: '500',
    fontSize: '1em',
  },
  primaryButton: {
    backgroundColor: '#667eea',
    color: 'white',
  },
  secondaryButton: {
    backgroundColor: '#6c757d',
    color: 'white',
  },
  statusMessage: {
    padding: '12px',
    borderRadius: '4px',
    marginBottom: '15px',
    fontSize: '0.95em',
  },
  success: {
    backgroundColor: '#d4edda',
    color: '#155724',
  },
  error: {
    backgroundColor: '#f8d7da',
    color: '#721c24',
    padding: '12px',
    borderRadius: '4px',
    marginBottom: '15px',
  },
  dialog: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  dialogContent: {
    backgroundColor: 'white',
    padding: '30px',
    borderRadius: '8px',
    maxWidth: '400px',
    boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
  },
  dialogTitle: {
    marginTop: 0,
    marginBottom: '15px',
    fontSize: '1.1em',
  },
  dialogButtons: {
    display: 'flex',
    gap: '10px',
    justifyContent: 'flex-end',
    marginTop: '20px',
  }
};

export default PluginConfigurationPanel;

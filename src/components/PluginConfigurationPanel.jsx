import React, { useState } from 'react';

const PluginConfigurationPanel = ({ configuration, save }) => {
  const [config, setConfig] = useState(configuration || {});
  const [initialConfig, setInitialConfig] = useState(configuration);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [showDialog, setShowDialog] = useState(false);
  const [dialogData, setDialogData] = useState({ title: '', message: '', callback: null });
  const [ownMMSI, setOwnMMSI] = useState(null);

  const translations = {
    de: {
      general: 'Allgemein',
      tcpServer: 'TCP Server',
      filtering: 'Filterung',
      debugging: 'Debugging',
      vesselFinder: 'VesselFinder',
      cloudVessels: 'Cloud Vessels (AISFleet)',
      
      tcpPort: 'TCP Port:',
      updateInterval: 'Update-Intervall für geänderte Schiffe (Sekunden):',
      tcpResendInterval: 'Update-Intervall für unveränderte Schiffe (Sekunden):',
      
      skipWithoutCallsign: 'Schiffe ohne Rufzeichen überspringen',
      skipStaleData: 'Schiffe mit alten Daten überspringen',
      staleDataThreshold: 'Schwellenwert für alte Daten (Minuten):',
      staleDataShipname: 'Zeitstempel zum Schiffsnamen hinzufügen ab (Minuten, 0=deaktiviert):',
      
      minAlarmSOG: 'Minimale SOG für Alarm (m/s):',
      maxMinutesSOGToZero: 'Maximum Minuten vor SOG auf 0 gesetzt (0=keine Korrektur):',
      
      logDebugDetails: 'Debug alle Schiff-Details',
      logMMSI: 'Filter Debug-Ausgabe für MMSI:',
      logDebugStale: 'Debug alte Schiffe',
      logDebugJSON: 'Debug JSON-Daten',
      logDebugAIS: 'Debug AIS-Daten',
      logDebugSOG: 'Debug Schiffe mit korrigierter SOG',
      
      vesselFinderEnabled: 'VesselFinder-Weiterleitung aktivieren',
      vesselFinderHost: 'VesselFinder Host:',
      vesselFinderPort: 'VesselFinder UDP Port:',
      vesselFinderUpdateRate: 'VesselFinder Update Rate (Sekunden):',
      
      cloudVesselsEnabled: 'Schiffe von AISFleet.com einbeziehen',
      cloudVesselsUpdateInterval: 'Cloud Vessels Update-Intervall (Sekunden):',
      cloudVesselsRadius: 'Radius von eigenem Schiff (Seemeilen):',
      
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
      vesselFinder: 'VesselFinder',
      cloudVessels: 'Cloud Vessels (AISFleet)',
      
      tcpPort: 'TCP Port:',
      updateInterval: 'Update interval for changed vessels (seconds):',
      tcpResendInterval: 'Update interval for unchanged vessels (seconds):',
      
      skipWithoutCallsign: 'Skip vessels without callsign',
      skipStaleData: 'Skip vessels with stale data',
      staleDataThreshold: 'Stale data threshold (minutes):',
      staleDataShipname: 'Add timestamp to ship name from (minutes, 0=disabled):',
      
      minAlarmSOG: 'Minimum SOG for alarm (m/s):',
      maxMinutesSOGToZero: 'Maximum minutes before SOG set to 0 (0=no correction):',
      
      logDebugDetails: 'Debug all vessel details',
      logMMSI: 'Filter Debug MMSI:',
      logDebugStale: 'Debug stale vessels',
      logDebugJSON: 'Debug JSON data',
      logDebugAIS: 'Debug AIS data',
      logDebugSOG: 'Debug vessels with corrected SOG',
      
      vesselFinderEnabled: 'Enable VesselFinder forwarding',
      vesselFinderHost: 'VesselFinder Host:',
      vesselFinderPort: 'VesselFinder UDP Port:',
      vesselFinderUpdateRate: 'VesselFinder Update Rate (seconds):',
      
      cloudVesselsEnabled: 'Include vessels from AISFleet.com',
      cloudVesselsUpdateInterval: 'Cloud Vessels update interval (seconds):',
      cloudVesselsRadius: 'Radius from own vessel (nautical miles):',
      
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

  // Hole eigene MMSI beim Laden
  React.useEffect(() => {
    const fetchOwnMMSI = async () => {
      try {
        const protocol = window.location.protocol;
        const hostname = window.location.hostname;
        const port = window.location.port;
        const url = `${protocol}//${hostname}${port ? ':' + port : ''}/signalk/v1/api/self`;
        
        console.log('Fetching own MMSI from:', url);
        console.log('Protocol:', protocol, 'Hostname:', hostname, 'Port:', port);
        
        const response = await fetch(url);
        console.log('Response status:', response.status);
        
        if (response.ok) {
          const data = await response.json();
          console.log('Self data received:', JSON.stringify(data, null, 2));
          
          // Data könnte String oder Objekt sein
          let vesselKey = null;
          if (typeof data === 'string') {
            // String Format: "vessels.urn:mrn:imo:mmsi:211177520"
            vesselKey = data.replace('vessels.', '');
            console.log('Parsed vessel key from string:', vesselKey);
          } else if (data.vessels && typeof data.vessels === 'object') {
            // Objekt Format
            const mmsiMatch = Object.keys(data.vessels).find(key => key.includes('mmsi:'));
            vesselKey = mmsiMatch;
            console.log('Found vessel key in object:', vesselKey);
          }
          
          if (vesselKey) {
            const mmsi = vesselKey.match(/mmsi:(\d+)/)?.[1];
            console.log('Extracted MMSI:', mmsi);
            if (mmsi) {
              setOwnMMSI(mmsi);
            }
          }
        } else {
          console.error('Failed to fetch self data, status:', response.status);
        }
      } catch (err) {
        console.error('Failed to fetch own MMSI:', err);
        // Fehler ignorieren - Validierung wird einfach nicht aktiviert
      }
    };
    
    // Verzögert starten um sicherzustellen dass DOM ready ist
    setTimeout(fetchOwnMMSI, 500);
  }, []);

  const handleConfigChange = (key, value) => {
    setConfig(prev => ({ ...prev, [key]: value }));
  };

  const isMMSIInvalid = () => {
    return ownMMSI && config.logMMSI && config.logMMSI === ownMMSI;
  };

  const checkUnsavedChanges = () => {
    return JSON.stringify(config) !== JSON.stringify(initialConfig);
  };

  const handleSave = () => {
    // Validiere Debug MMSI
    if (isMMSIInvalid()) {
      setStatus('error');
      const errorMsg = currentLang === 'de' 
        ? 'Fehler: Sie können nicht die eigene MMSI zum Filtern verwenden!'
        : 'Error: You cannot use your own MMSI for filtering!';
      alert(errorMsg);
      return;
    }

    setLoading(true);
    if (save) {
      try {
        const result = save(config);
        
        if (result && typeof result.then === 'function') {
          // save() gibt ein Promise zurück
          result
            .then(() => {
              setStatus('success');
              setInitialConfig(config);
              setTimeout(() => setStatus(''), 3000);
            })
            .catch(err => {
              setStatus('error');
              setTimeout(() => setStatus(''), 3000);
            })
            .finally(() => {
              setLoading(false);
            });
        } else {
          // save() gibt kein Promise zurück - assume success
          setStatus('success');
          setInitialConfig(config);
          setTimeout(() => setStatus(''), 3000);
          setLoading(false);
        }
      } catch (err) {
        console.error('Error in handleSave:', err);
        setStatus('error');
        setTimeout(() => setStatus(''), 3000);
        setLoading(false);
      }
    }
  };

  const handleLanguageChange = (lang) => {
    setCurrentLang(lang);
    handleConfigChange('language', lang === 'de');
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2 style={styles.title}>AIS to NMEA 0183 Converter</h2>
        <button 
          onClick={() => window.open('https://github.com/formifan2002/signalk-ais-navionics-converter', '_blank')}
          style={styles.helpButton}
        >
          ℹ️ {currentLang === 'de' ? 'Hilfe' : 'Help'}
        </button>
      </div>

      <div style={styles.languageSelector}>
        <button 
          onClick={() => handleLanguageChange('de')}
          style={{...styles.langButton, ...(currentLang === 'de' ? styles.langButtonActive : {})}}
        >
          Deutsch
        </button>
        <button 
          onClick={() => handleLanguageChange('en')}
          style={{...styles.langButton, ...(currentLang === 'en' ? styles.langButtonActive : {})}}
        >
          English
        </button>
      </div>

      {/* TCP Server */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>{t.tcpServer}</h3>
        
        <div style={styles.formGroup}>
          <label style={styles.label}>{t.tcpPort}</label>
          <div style={{
            display: 'block',
            fontSize: '0.85em',
            color: '#666',
            marginTop: '8px',
            marginBottom: '12px',
            fontStyle: 'italic',
            lineHeight: '1.4'
          }}>
            {currentLang === 'de' 
              ? 'Dieser Port ist später in der Navionics boating app im Menüpunkt \'Gekoppelte Geräte\' als TCP Port anzugeben.'
              : 'This port must be specified later in the Navionics boating app under the menu item \'Paired Devices\' as TCP Port.'}
          </div>
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
          <label style={styles.label}>{t.updateInterval}</label>
          <input
            type="number"
            min="1"
            value={config.updateInterval || 15}
            onChange={(e) => handleConfigChange('updateInterval', Number(e.target.value))}
            style={styles.input}
          />
        </div>

        <div style={styles.formGroup}>
          <label style={styles.label}>{t.tcpResendInterval}</label>
          <input
            type="number"
            min="0"
            value={config.tcpResendInterval || 60}
            onChange={(e) => handleConfigChange('tcpResendInterval', Number(e.target.value))}
            style={styles.input}
          />
        </div>
      </div>

      {/* Filtering */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>{t.filtering}</h3>

        <div style={styles.formGroup}>
          <label style={styles.checkbox}>
            <input
              type="checkbox"
              checked={config.skipWithoutCallsign || false}
              onChange={(e) => handleConfigChange('skipWithoutCallsign', e.target.checked)}
            />
            {t.skipWithoutCallsign}
          </label>
        </div>

        <div style={styles.formGroup}>
          <label style={styles.checkbox}>
            <input
              type="checkbox"
              checked={config.skipStaleData !== false}
              onChange={(e) => handleConfigChange('skipStaleData', e.target.checked)}
            />
            {t.skipStaleData}
          </label>
        </div>

        {config.skipStaleData !== false && (
          <div style={styles.formGroup}>
            <label style={styles.label}>{t.staleDataThreshold}</label>
            <input
              type="number"
              min="1"
              value={config.staleDataThresholdMinutes || 60}
              onChange={(e) => handleConfigChange('staleDataThresholdMinutes', Number(e.target.value))}
              style={styles.input}
            />
          </div>
        )}

        <div style={styles.formGroup}>
          <label style={styles.label}>{t.staleDataShipname}</label>
          <input
            type="number"
            min="0"
            value={config.staleDataShipnameAddTime || 5}
            onChange={(e) => handleConfigChange('staleDataShipnameAddTime', Number(e.target.value))}
            style={styles.input}
          />
        </div>

        <div style={styles.formGroup}>
          <label style={styles.label}>{t.minAlarmSOG}</label>
          <input
            type="number"
            min="0"
            step="0.1"
            value={config.minAlarmSOG || 0.2}
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
        <h3 style={styles.sectionTitle}>{t.debugging}</h3>

        <div style={styles.formGroup}>
          <label style={styles.checkbox}>
            <input
              type="checkbox"
              checked={config.logDebugDetails || false}
              onChange={(e) => handleConfigChange('logDebugDetails', e.target.checked)}
            />
            {t.logDebugDetails}
          </label>
        </div>

        {config.logDebugDetails && (
          <>
            <div style={styles.formGroup}>
              <label style={styles.label}>{t.logMMSI}</label>
              <div style={{
                display: 'block',
                fontSize: '0.85em',
                color: '#666',
                marginTop: '8px',
                marginBottom: '12px',
                fontStyle: 'italic',
                lineHeight: '1.4'
              }}>
                {currentLang === 'de' 
                  ? 'Debug Ausgaben werden nur für das Schiff mit dieser MMSI erzeugt. Für das eigene Schiff / die eigene MMSI werden keine AIS Daten erzeugt. Wenn das Feld leer bleibt, werden Debug-Ausgaben für alle Schiffe (außer dem eigenen) erzeugt.'
                  : 'Debug output is only generated for the vessel with this MMSI. No AIS data is generated for your own vessel / own MMSI. If the field is left empty, debug output is generated for all vessels (except your own).'}
              </div>
              <input
                type="text"
                value={config.logMMSI || ''}
                onChange={(e) => handleConfigChange('logMMSI', e.target.value)}
                placeholder="e.g. 123456789"
                style={{
                  ...styles.input,
                  ...(isMMSIInvalid() ? { borderColor: '#dc3545', backgroundColor: '#fff5f5' } : {})
                }}
              />
              {isMMSIInvalid() && (
                <div style={{
                  color: '#dc3545',
                  fontSize: '0.85em',
                  marginTop: '8px',
                  fontWeight: '500'
                }}>
                  {currentLang === 'de' 
                    ? '❌ Sie können nicht die eigene MMSI verwenden!'
                    : '❌ You cannot use your own MMSI!'}
                </div>
              )}
            </div>

            <div style={styles.formGroup}>
              <label style={styles.checkbox}>
                <input
                  type="checkbox"
                  checked={config.logDebugStale || false}
                  onChange={(e) => handleConfigChange('logDebugStale', e.target.checked)}
                />
                {t.logDebugStale}
              </label>
            </div>

            <div style={styles.formGroup}>
              <label style={styles.checkbox}>
                <input
                  type="checkbox"
                  checked={config.logDebugJSON || false}
                  onChange={(e) => handleConfigChange('logDebugJSON', e.target.checked)}
                />
                {t.logDebugJSON}
              </label>
            </div>

            <div style={styles.formGroup}>
              <label style={styles.checkbox}>
                <input
                  type="checkbox"
                  checked={config.logDebugAIS || false}
                  onChange={(e) => handleConfigChange('logDebugAIS', e.target.checked)}
                />
                {t.logDebugAIS}
              </label>
            </div>

            <div style={styles.formGroup}>
              <label style={styles.checkbox}>
                <input
                  type="checkbox"
                  checked={config.logDebugSOG || false}
                  onChange={(e) => handleConfigChange('logDebugSOG', e.target.checked)}
                />
                {t.logDebugSOG}
              </label>
            </div>
          </>
        )}
      </div>

      {/* VesselFinder */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>{t.vesselFinder}</h3>

        <div style={styles.formGroup}>
          <label style={styles.checkbox}>
            <input
              type="checkbox"
              checked={config.vesselFinderEnabled || false}
              onChange={(e) => handleConfigChange('vesselFinderEnabled', e.target.checked)}
            />
            {t.vesselFinderEnabled}
          </label>
        </div>

        {config.vesselFinderEnabled && (
          <>
            <div style={styles.formGroup}>
              <label style={styles.label}>{t.vesselFinderHost}</label>
              <input
                type="text"
                value={config.vesselFinderHost || 'ais.vesselfinder.com'}
                onChange={(e) => handleConfigChange('vesselFinderHost', e.target.value)}
                style={styles.input}
              />
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>{t.vesselFinderPort}</label>
              <input
                type="number"
                min="1"
                max="65535"
                value={config.vesselFinderPort || 5500}
                onChange={(e) => handleConfigChange('vesselFinderPort', Number(e.target.value))}
                style={styles.input}
              />
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>{t.vesselFinderUpdateRate}</label>
              <input
                type="number"
                min="1"
                value={config.vesselFinderUpdateRate || 60}
                onChange={(e) => handleConfigChange('vesselFinderUpdateRate', Number(e.target.value))}
                style={styles.input}
              />
            </div>
          </>
        )}
      </div>

      {/* Cloud Vessels */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>{t.cloudVessels}</h3>

        <div style={styles.formGroup}>
          <label style={styles.checkbox}>
            <input
              type="checkbox"
              checked={config.cloudVesselsEnabled !== false}
              onChange={(e) => handleConfigChange('cloudVesselsEnabled', e.target.checked)}
            />
            {t.cloudVesselsEnabled}
          </label>
        </div>

        {config.cloudVesselsEnabled !== false && (
          <>
            <div style={styles.formGroup}>
              <label style={styles.label}>{t.cloudVesselsUpdateInterval}</label>
              <input
                type="number"
                min="1"
                value={config.cloudVesselsUpdateInterval || 60}
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
          </>
        )}
      </div>

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
          disabled={loading || isMMSIInvalid()}
          style={{...styles.button, ...styles.primaryButton, ...(isMMSIInvalid() ? { opacity: 0.5, cursor: 'not-allowed' } : {})}}
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
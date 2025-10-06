import React, { useState, useEffect, useRef } from 'react';

const StrategyDashboard = () => {
  const [tables, setTables] = useState([]);
  const [tableCounter, setTableCounter] = useState(0);
  const [showModal, setShowModal] = useState(false);
  const [activeTableIndex, setActiveTableIndex] = useState(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [savedConfigs, setSavedConfigs] = useState({});
  const [selectedConfig, setSelectedConfig] = useState('');
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [configName, setConfigName] = useState('');
  const [storageMode, setStorageMode] = useState('browser'); // 'browser' or 'backend'
  const wsRef = useRef(null);
  
  const params = new URLSearchParams(window.location.search);
  const selectedExList = (params.get('selected') || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const defaultEx = (params.get('default') || '').trim().toLowerCase();
  const initialExchange = defaultEx || selectedExList[0] || '';
  
  const [modalForm, setModalForm] = useState({
    exchange: initialExchange,
    strategy: '',
    symbol: 'BTC',
    optionExpiry: '',
    futureExpiry: '',
    strikeInterval: '1000',
    gap: '1000',
    noPrtFolio: '10',
    ratio1: '1',
    ratio2: '2',
    strategyLegType: '1331',
    strikeMode: 'auto',
    nearestStrike: ''
  });

  const [availableData, setAvailableData] = useState({
    deribit: { expiries: [], strikes: { min: 0, max: 0 }, instruments: [] },
    binance: { expiries: [], strikes: { min: 0, max: 0 }, instruments: [] }
  });
  const [limitExchanges] = useState(selectedExList);
  const [isLoadingExpiries, setIsLoadingExpiries] = useState(false);

  const loadSavedConfigs = async () => {
    try {
      if (storageMode === 'backend') {
        const response = await fetch('http://localhost:8080/api/configs');
        const result = await response.json();
        if (result.success) {
          setSavedConfigs(result.configs || {});
        } else {
          console.error('Failed to load backend configs:', result.error);
          setSavedConfigs({});
        }
      } else {
        const saved = JSON.parse(window.localStorage.getItem('namedStrategyConfigs') || '{}');
        setSavedConfigs(saved);
      }
    } catch (error) {
      console.error('Failed to load configs:', error);
      setSavedConfigs({});
    }
  };

  useEffect(() => {
    loadSavedConfigs();
  }, [storageMode]);

  const saveCurrentConfig = async () => {
    if (!configName.trim()) {
      alert('Please enter a configuration name');
      return;
    }

    const configToSave = tables.map(t => ({
      id: t.id,
      config: t.config
    }));

    try {
      if (storageMode === 'backend') {
        const response = await fetch('http://localhost:8080/api/configs/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: configName.trim(),
            config: configToSave
          })
        });

        const result = await response.json();
        if (result.success) {
          await loadSavedConfigs();
          setShowSaveDialog(false);
          setConfigName('');
          alert(`Configuration "${configName.trim()}" saved to backend successfully!`);
        } else {
          alert('Failed to save configuration: ' + (result.error || 'Unknown error'));
        }
      } else {
        const newConfigs = {
          ...savedConfigs,
          [configName.trim()]: configToSave
        };

        window.localStorage.setItem('namedStrategyConfigs', JSON.stringify(newConfigs));
        setSavedConfigs(newConfigs);
        setShowSaveDialog(false);
        setConfigName('');
        alert(`Configuration "${configName.trim()}" saved to browser successfully!`);
      }
    } catch (error) {
      console.error('Failed to save configuration:', error);
      alert('Failed to save configuration: ' + error.message);
    }
  };

  const loadConfig = (name) => {
    if (!name) return;
    
    const config = savedConfigs[name];
    if (!config) return;

    const loadedTables = config.map(c => ({
      ...c,
      data: [],
      liveData: null,
      isLoading: true 
    }));
    
    setTables(loadedTables);
    setTableCounter(config.length);
    setSelectedConfig(name);
    
    console.log(`📦 Loading ${config.length} strategies...`);
    
    setTimeout(async () => {
      for (let i = 0; i < config.length; i++) {
        const table = loadedTables[i];
        console.log(`🔄 Starting subscription for ${table.id}...`);
        
        try {
          const response = await fetch('http://localhost:8080/api/strategy/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              tableId: table.id, 
              config: table.config 
            })
          });

          const result = await response.json();
          
          if (result.success) {
            setTables(prevTables => {
              const newTables = [...prevTables];
              const tableIndex = newTables.findIndex(t => t.id === table.id);
              if (tableIndex !== -1) {
                newTables[tableIndex] = {
                  ...newTables[tableIndex],
                  data: result.data?.data || [],
                  liveData: result.data ? {
                    ltp: parseFloat(result.data.spotPrice),
                    timestamp: new Date().toLocaleTimeString()
                  } : null,
                  isLoading: false
                };
              }
              return newTables;
            });
            console.log(`✅ ${table.id} loaded successfully`);
          } else {
            console.error(`❌ Failed to load ${table.id}:`, result.error);
            setTables(prevTables => {
              const newTables = [...prevTables];
              const tableIndex = newTables.findIndex(t => t.id === table.id);
              if (tableIndex !== -1) {
                newTables[tableIndex].isLoading = false;
              }
              return newTables;
            });
          }
        } catch (error) {
          console.error(`❌ Error loading ${table.id}:`, error);
          setTables(prevTables => {
            const newTables = [...prevTables];
            const tableIndex = newTables.findIndex(t => t.id === table.id);
            if (tableIndex !== -1) {
              newTables[tableIndex].isLoading = false;
            }
            return newTables;
          });
        }
        if (i < config.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
      
      alert(`Configuration "${name}" loaded successfully!`);
    }, 100);
  };

  const deleteConfig = async () => {
    if (!selectedConfig) {
      alert('Please select a configuration to delete');
      return;
    }

    if (!window.confirm(`Are you sure you want to delete configuration "${selectedConfig}"?`)) {
      return;
    }

    try {
      if (storageMode === 'backend') {
        const response = await fetch('http://localhost:8080/api/configs/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: selectedConfig })
        });

        const result = await response.json();
        if (result.success) {
          await loadSavedConfigs();
          setSelectedConfig('');
          alert(`Configuration "${selectedConfig}" deleted successfully!`);
        } else {
          alert('Failed to delete configuration: ' + (result.error || 'Unknown error'));
        }
      } else {
        const newConfigs = { ...savedConfigs };
        delete newConfigs[selectedConfig];
        
        window.localStorage.setItem('namedStrategyConfigs', JSON.stringify(newConfigs));
        setSavedConfigs(newConfigs);
        setSelectedConfig('');
        alert(`Configuration "${selectedConfig}" deleted successfully!`);
      }
    } catch (error) {
      console.error('Failed to delete configuration:', error);
      alert('Failed to delete configuration: ' + error.message);
    }
  };

  useEffect(() => {
    let reconnectTimer = null;

    const connect = () => {
      try {
        const ws = new WebSocket("ws://localhost:8080");
        wsRef.current = ws;

        ws.onopen = () => {
          console.log("✅ WebSocket connected");
          setWsConnected(true);
        };

        ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            
            if (message.type === 'strategyUpdate' && message.data) {
              setTables(prevTables => {
                const updatedTables = [...prevTables];
                
                message.data.forEach(strategyData => {
                  const tableIndex = updatedTables.findIndex(t => t.id === strategyData.tableId);
                  if (tableIndex !== -1) {
                    updatedTables[tableIndex] = {
                      ...updatedTables[tableIndex],
                      data: strategyData.data,
                      liveData: {
                        ltp: parseFloat(strategyData.spotPrice),
                        timestamp: new Date(strategyData.timestamp).toLocaleTimeString()
                      }
                    };
                  }
                });
                
                return updatedTables;
              });
            }
          } catch (err) {
            console.error("Failed to parse message:", err);
          }
        };

        ws.onerror = (err) => {
          console.error("WebSocket error", err);
        };

        ws.onclose = () => {
          console.log("WebSocket disconnected");
          setWsConnected(false);
          reconnectTimer = setTimeout(connect, 2000);
        };
      } catch (err) {
        console.error("WebSocket setup failed:", err);
        reconnectTimer = setTimeout(connect, 2000);
      }
    };

    connect();

    return () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      try {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.close();
        }
      } catch {}
    };
  }, []);

  const fetchDeribitInstruments = async () => {
    try {
      setIsLoadingExpiries(true);
      const response = await fetch('http://localhost:8080/api/fetch-metadata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exchange: 'deribit' })
      });
      
      const result = await response.json();
      
      if (result.success && result.metadata) {
        setAvailableData(prev => ({
          ...prev,
          deribit: result.metadata
        }));
        
        const expiries = result.metadata.expiries || [];
        setModalForm(prev => ({ 
          ...prev, 
          optionExpiry: prev.optionExpiry || (expiries[0] || ''),
          futureExpiry: prev.futureExpiry || (expiries[0] || '')
        }));
      }
    } catch (error) {
      console.error('Failed to fetch Deribit instruments:', error);
    } finally {
      setIsLoadingExpiries(false);
    }
  };

  const fetchBinanceInstruments = async () => {
    try {
      setIsLoadingExpiries(true);
      const response = await fetch('http://localhost:8080/api/fetch-metadata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exchange: 'binance' })
      });
      
      const result = await response.json();
      
      if (result.success && result.metadata) {
        setAvailableData(prev => ({
          ...prev,
          binance: result.metadata
        }));
        
        const expiries = result.metadata.expiries || [];
        setModalForm(prev => ({ 
          ...prev, 
          optionExpiry: prev.optionExpiry || (expiries[0] || ''),
          futureExpiry: prev.futureExpiry || (expiries[0] || '')
        }));
      }
    } catch (error) {
      console.error('Failed to fetch Binance instruments:', error);
    } finally {
      setIsLoadingExpiries(false);
    }
  };

  useEffect(() => {
    const ex = modalForm.exchange;
    if (!ex) return;

    const loaded = availableData[ex]?.expiries?.length > 0;

    if (!loaded) {
      if (ex === 'deribit') fetchDeribitInstruments();
      if (ex === 'binance') fetchBinanceInstruments();
    } else {
      const firstExpiry = availableData[ex].expiries[0] || '';
      setModalForm(prev => ({ 
        ...prev, 
        optionExpiry: prev.optionExpiry || firstExpiry, 
        futureExpiry: prev.futureExpiry || firstExpiry 
      }));
    }
  }, [modalForm.exchange, availableData]);

  const addTable = () => {
    const newTable = {
      id: `table_${tableCounter}`,
      config: { 
        exchange: initialExchange, 
        strategy: '', 
        symbol: 'BTC', 
        optionExpiry: '', 
        futureExpiry: '', 
        strikeInterval: 1000, 
        gap: 1000, 
        noPrtFolio: 10, 
        strikeMode: 'auto',
        ratio1: 1,
        ratio2: 2,
        strategyLegType: '1331',
        nearestStrike: ''
      },
      data: [],
      liveData: null,
      isLoading: false
    };
    setTables([...tables, newTable]);
    setTableCounter(tableCounter + 1);
    setActiveTableIndex(tables.length);
    setModalForm({
      exchange: initialExchange,
      strategy: '',
      symbol: 'BTC',
      optionExpiry: '',
      futureExpiry: '',
      strikeInterval: '1000',
      gap: '1000',
      noPrtFolio: '10',
      ratio1: '1',
      ratio2: '2',
      strategyLegType: '1331',
      strikeMode: 'auto',
      nearestStrike: ''
    });
    
    setShowModal(true);
  };

  const openSettings = (index) => {
    setActiveTableIndex(index);
    const config = tables[index].config;

    setModalForm({
      exchange: config.exchange || initialExchange,
      strategy: config.strategy || '',
      symbol: config.symbol || 'BTC',
      optionExpiry: config.optionExpiry || '',
      futureExpiry: config.futureExpiry || '',
      strikeInterval: String(config.strikeInterval || 1000),
      gap: String(config.gap || 1000),
      noPrtFolio: String(config.noPrtFolio || 10),
      ratio1: String(config.ratio1 || 1),
      ratio2: String(config.ratio2 || 2),
      strategyLegType: config.strategyLegType || '1331',
      strikeMode: config.strikeMode || 'auto',
      nearestStrike: String(config.nearestStrike || '')
    });
    
    setShowModal(true);
  };

  const applyStrategy = async () => {
    if (activeTableIndex === null) return;

    if (!modalForm.exchange || !modalForm.strategy || !modalForm.optionExpiry) {
      alert('Please fill in all required fields: Exchange, Strategy, and Option Expiry');
      return;
    }

    const config = {
      exchange: modalForm.exchange,
      strategy: modalForm.strategy,
      symbol: modalForm.symbol,
      optionExpiry: modalForm.optionExpiry,
      futureExpiry: modalForm.futureExpiry,
      strikeInterval: parseInt(modalForm.strikeInterval) || 1000,
      gap: parseInt(modalForm.gap) || 1000,
      noPrtFolio: parseInt(modalForm.noPrtFolio) || 10,
      ratio1: parseInt(modalForm.ratio1) || 1,
      ratio2: parseInt(modalForm.ratio2) || 2,
      strategyLegType: modalForm.strategyLegType || '1331',
      strikeMode: modalForm.strikeMode || 'auto',
      nearestStrike: modalForm.nearestStrike ? parseInt(modalForm.nearestStrike) : ''
    };

    try {
      const tableId = tables[activeTableIndex].id;
      
      const response = await fetch('http://localhost:8080/api/strategy/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tableId, config })
      });

      const result = await response.json();
      
      if (result.success) {
        setTables(prevTables => {
          const newTables = [...prevTables];
          newTables[activeTableIndex] = { 
            ...newTables[activeTableIndex], 
            config, 
            data: result.data?.data || [],
            liveData: result.data ? {
              ltp: parseFloat(result.data.spotPrice),
              timestamp: new Date().toLocaleTimeString()
            } : null
          };
          return newTables;
        });
        
        setShowModal(false);
      } else {
        alert('Failed to apply strategy: ' + (result.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('Apply strategy error:', error);
      alert('Failed to apply strategy: ' + error.message);
    }
  };

  const removeTable = async (id) => {
    try {
      await fetch('http://localhost:8080/api/strategy/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tableId: id })
      });
      
      setTables(tables.filter(table => table.id !== id));
    } catch (error) {
      console.error('Remove table error:', error);
    }
  };

  const renderTable = (table) => {
    const { config, data } = table;
    if (!data || data.length === 0) {
      return (
        <div style={{ padding: '40px', textAlign: 'center', color: '#999' }}>
          Configure strategy to see results
        </div>
      );
    }

    const strategy = config.strategy.toLowerCase();

    if (strategy === 'jelly' || strategy === 'synthetic') {
      return (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
          <thead>
            <tr>
              <th style={{ background: '#f8f9fa', padding: '8px', border: '1px solid #dee2e6' }}>Strike</th>
              <th style={{ background: '#f8f9fa', padding: '8px', border: '1px solid #dee2e6' }}>Conversion</th>
              <th style={{ background: '#f8f9fa', padding: '8px', border: '1px solid #dee2e6' }}>Reversal</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row, idx) => {
              const convNum = row.conversion != null ? parseFloat(row.conversion) : null;
              const revNum = row.reversal != null ? parseFloat(row.reversal) : null;
              return (
                <tr key={idx} style={{ background: row.strike === row.nearest_strike ? '#ffff99' : 'transparent' }}>
                  <td style={{ padding: '6px', textAlign: 'center', border: '1px solid #dee2e6', fontWeight: row.strike === row.nearest_strike ? 'bold' : 'normal' }}>
                    {row.strike}
                  </td>
                  <td style={{ 
                    padding: '6px', 
                    textAlign: 'center', 
                    border: '1px solid #dee2e6', 
                    color: convNum != null ? (convNum >= 0 ? '#27ae60' : '#c0392b') : 'inherit' 
                  }}>
                    {row.conversion != null ? row.conversion : '-'}
                  </td>
                  <td style={{ 
                    padding: '6px', 
                    textAlign: 'center', 
                    border: '1px solid #dee2e6', 
                    color: revNum != null ? (revNum >= 0 ? '#27ae60' : '#c0392b') : 'inherit' 
                  }}>
                    {row.reversal != null ? row.reversal : '-'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      );
    }

    if (strategy === 'butterfly' || strategy === 'pulse_butterfly') {
      const ceData = data.filter(d => d.type === 'CE');
      const peData = data.filter(d => d.type === 'PE');
      
      return (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
          <thead>
            <tr>
              <th colSpan="3" style={{ background: '#ffe8e8', padding: '8px', border: '1px solid #dee2e6' }}>PE Data</th>
              <th colSpan="3" style={{ background: '#e8f5e8', padding: '8px', border: '1px solid #dee2e6' }}>CE Data</th>
            </tr>
            <tr>
              {['Long', 'Short', 'Strike', 'Strike', 'Long', 'Short'].map((h, i) => (
                <th key={i} style={{ padding: '8px', border: '1px solid #dee2e6', background: '#f8f9fa' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: Math.max(ceData.length, peData.length) }).map((_, idx) => {
              const ce = ceData[idx];
              const pe = peData[idx];
              return (
                <tr key={idx}>
                  <td style={{ padding: '6px', textAlign: 'center', border: '1px solid #dee2e6' }}>
                    {pe?.long_value || '-'}
                  </td>
                  <td style={{ padding: '6px', textAlign: 'center', border: '1px solid #dee2e6' }}>
                    {pe?.short_value || '-'}
                  </td>
                  <td style={{ 
                    padding: '6px', 
                    textAlign: 'center', 
                    border: '1px solid #dee2e6', 
                    background: pe?.l2 === pe?.nearest_strike ? '#ffff99' : 'transparent', 
                    fontWeight: pe?.l2 === pe?.nearest_strike ? 'bold' : 'normal' 
                  }}>
                    {pe?.l2 || '-'}
                  </td>
                  <td style={{ 
                    padding: '6px', 
                    textAlign: 'center', 
                    border: '1px solid #dee2e6', 
                    background: ce?.l2 === ce?.nearest_strike ? '#ffff99' : 'transparent', 
                    fontWeight: ce?.l2 === ce?.nearest_strike ? 'bold' : 'normal' 
                  }}>
                    {ce?.l2 || '-'}
                  </td>
                  <td style={{ padding: '6px', textAlign: 'center', border: '1px solid #dee2e6' }}>
                    {ce?.long_value || '-'}
                  </td>
                  <td style={{ padding: '6px', textAlign: 'center', border: '1px solid #dee2e6' }}>
                    {ce?.short_value || '-'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      );
    }

    if (strategy === 'ratio') {
      const ceData = data.filter(d => d.type === 'CE');
      const peData = data.filter(d => d.type === 'PE');
      
      return (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
          <thead>
            <tr>
              <th colSpan="2" style={{ background: '#ffe8e8', padding: '8px', border: '1px solid #dee2e6' }}>PE Data</th>
              <th rowSpan="2" style={{ padding: '8px', border: '1px solid #dee2e6', background: '#f8f9fa' }}>Strike</th>
              <th colSpan="2" style={{ background: '#e8f5e8', padding: '8px', border: '1px solid #dee2e6' }}>CE Data</th>
            </tr>
            <tr>
              {['Buy', 'Sell', 'Buy', 'Sell'].map((h, i) => (
                <th key={i} style={{ padding: '8px', border: '1px solid #dee2e6', background: '#f8f9fa' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: Math.max(ceData.length, peData.length) }).map((_, idx) => {
              const ce = ceData[idx];
              const pe = peData[idx];
              const strike = ce?.l1 || pe?.l1;
              return (
                <tr key={idx}>
                  <td style={{ padding: '6px', textAlign: 'center', border: '1px solid #dee2e6' }}>
                    {pe?.buy_value || '-'}
                  </td>
                  <td style={{ padding: '6px', textAlign: 'center', border: '1px solid #dee2e6' }}>
                    {pe?.sell_value || '-'}
                  </td>
                  <td style={{ 
                    padding: '6px', 
                    textAlign: 'center', 
                    border: '1px solid #dee2e6', 
                    background: strike === ce?.nearest_strike ? '#ffff99' : 'transparent', 
                    fontWeight: strike === ce?.nearest_strike ? 'bold' : 'normal' 
                  }}>
                    {strike || '-'}
                  </td>
                  <td style={{ padding: '6px', textAlign: 'center', border: '1px solid #dee2e6' }}>
                    {ce?.buy_value || '-'}
                  </td>
                  <td style={{ padding: '6px', textAlign: 'center', border: '1px solid #dee2e6' }}>
                    {ce?.sell_value || '-'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      );
    }

    return null;
  };

  return (
    <div style={{ padding: '20px', background: '#f5f5f5', minHeight: '100vh', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', background: 'white', padding: '15px', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)', flexWrap: 'wrap', gap: '10px' }}>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', padding: '6px 12px', background: '#f8f9fa', borderRadius: '4px' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: wsConnected ? '#27ae60' : '#e74c3c' }}></span>
            {wsConnected ? 'Connected' : 'Disconnected'}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 12px', background: '#f0f0f0', borderRadius: '4px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '13px', cursor: 'pointer' }}>
              <input 
                type="radio" 
                name="storageMode" 
                value="browser" 
                checked={storageMode === 'browser'} 
                onChange={(e) => setStorageMode(e.target.value)}
              />
              Browser
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '13px', cursor: 'pointer' }}>
              <input 
                type="radio" 
                name="storageMode" 
                value="backend" 
                checked={storageMode === 'backend'} 
                onChange={(e) => setStorageMode(e.target.value)}
              />
              Backend
            </label>
          </div>
          
          <select 
            value={selectedConfig} 
            onChange={(e) => loadConfig(e.target.value)}
            style={{ padding: '8px 12px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '13px', minWidth: '220px' }}
          >
            <option value="">-- Select Saved Configuration --</option>
            {Object.keys(savedConfigs).map(name => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>

          <button 
            onClick={() => setShowSaveDialog(true)} 
            style={{ padding: '8px 15px', background: '#27ae60', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', fontSize: '13px' }}
          >
            Save Current
          </button>

          <button 
            onClick={deleteConfig} 
            style={{ padding: '8px 15px', background: '#e74c3c', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', fontSize: '13px', opacity: selectedConfig ? 1 : 0.5 }}
            disabled={!selectedConfig}
          >
            Delete
          </button>
        </div>
        
        <button onClick={addTable} style={{ padding: '8px 15px', background: '#3498db', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', fontSize: '13px' }}>
          + Add Strategy Table
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(400px, 1fr))', gap: '20px' }}>
        {tables.map((table, index) => (
          <div key={table.id} style={{ background: 'white', borderRadius: '8px', boxShadow: '0 2px 8px rgba(0,0,0,0.1)', overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '12px 15px', background: '#f8f9fa', borderBottom: '1px solid #dee2e6' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 'bold', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ color: '#3b82f6', fontWeight: 600 }}>
                    {table.config.exchange?.toUpperCase()}
                  </span>
                  {table.config.strategy || 'Strategy'} {table.config.gap ? `${table.config.gap}` : ''}
                  {table.liveData && (
                    <span style={{ background: '#9fd5e7', color: 'black', padding: '2px 8px', borderRadius: '4px', fontSize: '11px' }}>
                      {table.liveData.ltp?.toFixed(2)}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
                  {table.config.symbol}
                  {table.config.optionExpiry && ` ${table.config.optionExpiry} (O)`}
                  {table.config.futureExpiry && (table.config.strategy === 'Jelly') && ` ${table.config.futureExpiry} (F)`}
                </div>
                {table.liveData && (
                  <div style={{ fontSize: '10px', color: '#999', marginTop: '2px' }}>{table.liveData.timestamp}</div>
                )}
              </div>
              <div style={{ display: 'flex', gap: '5px' }}>
                <button onClick={() => openSettings(index)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px 8px', fontSize: '14px' }}>
                  ⚙️
                </button>
                <button onClick={() => removeTable(table.id)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px 8px', fontSize: '14px', color: '#e74c3c' }}>
                  ✕
                </button>
              </div>
            </div>
            <div style={{ padding: '10px', maxHeight: '400px', overflowY: 'auto' }}>
              {renderTable(table)}
            </div>
          </div>
        ))}
      </div>

      {showSaveDialog && (
        <div onClick={() => setShowSaveDialog(false)} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1001 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'white', borderRadius: '8px', padding: '30px', width: '90%', maxWidth: '500px', boxShadow: '0 4px 20px rgba(0,0,0,0.3)' }}>
            <h3 style={{ margin: '0 0 10px 0', fontSize: '16px', fontWeight: '600' }}>Save Configuration</h3>
            <p style={{ margin: '0 0 20px 0', fontSize: '14px', color: '#333' }}>
              Enter a name for this configuration (Storage: <strong>{storageMode === 'backend' ? 'Backend Server' : 'Browser Local'}</strong>):
            </p>
            <input
              type="text"
              value={configName}
              onChange={(e) => setConfigName(e.target.value)}
              style={{ width: '100%', padding: '10px', border: '1px solid #ccc', borderRadius: '2px', fontSize: '14px', marginBottom: '20px', boxSizing: 'border-box' }}
              onKeyPress={(e) => e.key === 'Enter' && saveCurrentConfig()}
              autoFocus
            />
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowSaveDialog(false)}
                style={{ padding: '8px 24px', background: '#e0e0e0', color: '#333', border: 'none', borderRadius: '2px', cursor: 'pointer', fontSize: '13px' }}
              >
                Cancel
              </button>
              <button
                onClick={saveCurrentConfig}
                style={{ padding: '8px 24px', background: '#4285f4', color: 'white', border: 'none', borderRadius: '2px', cursor: 'pointer', fontSize: '13px' }}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {showModal && (
        <div onClick={() => setShowModal(false)} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'white', borderRadius: '8px', width: '90%', maxWidth: '800px', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 4px 20px rgba(0,0,0,0.3)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px', borderBottom: '1px solid #dee2e6' }}>
              <h3 style={{ margin: 0, fontSize: '18px' }}>Strategy Settings</h3>
              <button onClick={() => setShowModal(false)} style={{ background: 'none', border: 'none', fontSize: '24px', cursor: 'pointer', color: '#999' }}>×</button>
            </div>
            <div style={{ padding: '20px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '15px', marginBottom: '20px' }}>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <label style={{ fontWeight: 'bold', marginBottom: '5px', fontSize: '12px' }}>Exchange</label>
                  <select value={modalForm.exchange} onChange={(e) => setModalForm({...modalForm, exchange: e.target.value})} style={{ padding: '8px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '13px' }}>
                    <option value="">--Select--</option>
                    {(limitExchanges && limitExchanges.length > 0 ? limitExchanges : ['binance','deribit']).map(ex => (
                      <option key={ex} value={ex}>{ex.charAt(0).toUpperCase() + ex.slice(1)}</option>
                    ))}
                  </select>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <label style={{ fontWeight: 'bold', marginBottom: '5px', fontSize: '12px' }}>Strategy</label>
                  <select value={modalForm.strategy} onChange={(e) => setModalForm({...modalForm, strategy: e.target.value})} style={{ padding: '8px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '13px' }}>
                    <option value="">--Select--</option>
                    <option value="Jelly">Jelly</option>
                    <option value="Synthetic">Synthetic</option>
                    <option value="Butterfly">Butterfly</option>
                    <option value="Ratio">Ratio</option>
                    <option value="Pulse_Butterfly">Pulse Butterfly</option>
                  </select>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <label style={{ fontWeight: 'bold', marginBottom: '5px', fontSize: '12px' }}>Symbol</label>
                  <input type="text" value={modalForm.symbol} onChange={(e) => setModalForm({...modalForm, symbol: e.target.value})} style={{ padding: '8px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '13px' }} />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <label style={{ fontWeight: 'bold', marginBottom: '5px', fontSize: '12px' }}>Option Expiry</label>
                  <select value={modalForm.optionExpiry} onChange={(e) => setModalForm({ ...modalForm, optionExpiry: e.target.value })} disabled={!modalForm.exchange || isLoadingExpiries} style={{ padding: '8px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '13px' }}>
                    <option value="">{!modalForm.exchange ? 'Select exchange first' : (isLoadingExpiries ? 'Loading...' : '--Select--')}</option>
                    {(availableData[modalForm.exchange]?.expiries || []).map(exp => (
                      <option key={exp} value={exp}>{exp}</option>
                    ))}
                  </select>
                </div>

                {modalForm.strategy === 'Jelly' && (
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <label style={{ fontWeight: 'bold', marginBottom: '5px', fontSize: '12px' }}>Future Expiry</label>
                    <select value={modalForm.futureExpiry} onChange={(e) => setModalForm({ ...modalForm, futureExpiry: e.target.value })} disabled={!modalForm.exchange || isLoadingExpiries} style={{ padding: '8px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '13px' }}>
                      <option value="">{!modalForm.exchange ? 'Select exchange first' : (isLoadingExpiries ? 'Loading...' : '--Select--')}</option>
                      {(availableData[modalForm.exchange]?.expiries || []).map(exp => (
                        <option key={exp} value={exp}>{exp}</option>
                      ))}
                    </select>
                  </div>
                )}

                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <label style={{ fontWeight: 'bold', marginBottom: '5px', fontSize: '12px' }}>No. Portfolio</label>
                  <input type="number" value={modalForm.noPrtFolio} onChange={(e) => setModalForm({...modalForm, noPrtFolio: e.target.value})} min="1" style={{ padding: '8px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '13px' }} />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <label style={{ fontWeight: 'bold', marginBottom: '5px', fontSize: '12px' }}>Strike Interval</label>
                  <input type="number" value={modalForm.strikeInterval} onChange={(e) => setModalForm({...modalForm, strikeInterval: e.target.value})} style={{ padding: '8px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '13px' }} />
                </div>

                {['Butterfly', 'Ratio', 'Pulse_Butterfly'].includes(modalForm.strategy) && (
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <label style={{ fontWeight: 'bold', marginBottom: '5px', fontSize: '12px' }}>Gap</label>
                    <input type="number" value={modalForm.gap} onChange={(e) => setModalForm({...modalForm, gap: e.target.value})} style={{ padding: '8px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '13px' }} />
                  </div>
                )}

                {modalForm.strategy === 'Ratio' && (
                  <>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <label style={{ fontWeight: 'bold', marginBottom: '5px', fontSize: '12px' }}>Ratio 1</label>
                      <input type="number" value={modalForm.ratio1} onChange={(e) => setModalForm({...modalForm, ratio1: e.target.value})} style={{ padding: '8px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '13px' }} />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <label style={{ fontWeight: 'bold', marginBottom: '5px', fontSize: '12px' }}>Ratio 2</label>
                      <input type="number" value={modalForm.ratio2} onChange={(e) => setModalForm({...modalForm, ratio2: e.target.value})} style={{ padding: '8px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '13px' }} />
                    </div>
                  </>
                )}

                {modalForm.strategy === 'Pulse_Butterfly' && (
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <label style={{ fontWeight: 'bold', marginBottom: '5px', fontSize: '12px' }}>Strategy Leg Type</label>
                    <select value={modalForm.strategyLegType} onChange={(e) => setModalForm({...modalForm, strategyLegType: e.target.value})} style={{ padding: '8px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '13px' }}>
                      <option value="1331">1331</option>
                      <option value="1221">1221</option>
                    </select>
                  </div>
                )}

                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <label style={{ fontWeight: 'bold', marginBottom: '5px', fontSize: '12px' }}>Strike Mode</label>
                  <div style={{ display: 'flex', gap: '15px', alignItems: 'center', marginTop: '8px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '5px', fontWeight: 'normal' }}>
                      <input type="radio" name="strikeMode" value="auto" checked={modalForm.strikeMode === 'auto'} onChange={(e) => setModalForm({...modalForm, strikeMode: e.target.value})} /> Auto
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '5px', fontWeight: 'normal' }}>
                      <input type="radio" name="strikeMode" value="custom" checked={modalForm.strikeMode === 'custom'} onChange={(e) => setModalForm({...modalForm, strikeMode: e.target.value})} /> Custom
                    </label>
                  </div>
                </div>

                {modalForm.strikeMode === 'custom' && (
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <label style={{ fontWeight: 'bold', marginBottom: '5px', fontSize: '12px' }}>Nearest Strike</label>
                    <input type="number" value={modalForm.nearestStrike} onChange={(e) => setModalForm({...modalForm, nearestStrike: e.target.value})} style={{ padding: '8px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '13px' }} />
                  </div>
                )}
              </div>

              <button onClick={applyStrategy} style={{ width: '100%', padding: '12px', background: '#3498db', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', fontSize: '13px', transition: 'background 0.2s' }}>
                Apply Settings
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default StrategyDashboard;
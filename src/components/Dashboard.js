
import React, { useState, useEffect, useRef } from 'react';
import { AlertCircle } from 'lucide-react';
import ExchangeSelector from './ExchangeSelector';
import DataGrid from './DataGrid';
import './Dashboard.css';

const Dashboard = () => {
  const [selectedExchanges, setSelectedExchanges] = useState([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [marketData, setMarketData] = useState({});
  const [availableData, setAvailableData] = useState({});
  const [config, setConfig] = useState({});
  const [appliedConfig, setAppliedConfig] = useState({});
  const [notification, setNotification] = useState(null);
  const wsRef = useRef(null);

  const exchanges = [
    { id: 'deribit', name: 'Deribit', color: 'bg-blue-500', available: true, type: 'crypto', allowMultiple: true },
    { id: 'binance', name: 'Binance BTC', color: 'bg-yellow-500', available: true, type: 'crypto', allowMultiple: false },
    { id: 'bybit', name: 'Bybit BTC', color: 'bg-purple-500', available: true, type: 'crypto', allowMultiple: false }
  ];

  const showNotification = (message, type = 'error') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 5000);
  };

  useEffect(() => {
    const connectWebSocket = () => {
      wsRef.current = new WebSocket('ws://localhost:8080');
      
      wsRef.current.onopen = () => {
        console.log('✅ WebSocket connected');
      };

      wsRef.current.onmessage = (event) => {
        const message = JSON.parse(event.data);
        if (message.type === 'marketData') {
          setMarketData(prev => ({
            ...prev,
            ...message.data
          }));
        }
      };

      wsRef.current.onclose = () => {
        console.log('WebSocket disconnected, reconnecting...');
        setTimeout(connectWebSocket, 300);
      };

      wsRef.current.onerror = (error) => {
        console.error('WebSocket error:', error);
      };
    };

    connectWebSocket();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

const handleAddInstance = (exchangeId) => {
  const baseId = exchangeId.split('_')[0];
  const existingInstances = selectedExchanges.filter(id => id.startsWith(baseId));
  
  // Determine next available symbol
  const usedSymbols = existingInstances.map(id => {
    const cfg = config[id];
    return cfg?.symbol || 'BTC';
  });
  
  const defaultSymbol = usedSymbols.includes('BTC') && !usedSymbols.includes('ETH') ? 'ETH' : 'BTC';
  const newInstanceId = `${baseId}_${defaultSymbol.toLowerCase()}`;
  
  // Check if this instance already exists
  if (selectedExchanges.includes(newInstanceId)) {
    showNotification(`Deribit ${defaultSymbol} already exists!`, 'warning');
    return;
  }
    const defaultGap = defaultSymbol === 'ETH' ? 50 : 1000;
    
    const newConfig = {
      symbol: defaultSymbol,
      instrumentType: 'option',
      expiry: '',
      startStrike: '',
      gap: defaultGap,
      entryCount: 5
    };

    setSelectedExchanges(prev => [...prev, newInstanceId]);
    setConfig(prev => ({
      ...prev,
      [newInstanceId]: newConfig
    }));
    
    fetchMetadata(newInstanceId, defaultSymbol);
    showNotification(`Added Deribit instance for ${defaultSymbol}`, 'success');
  };

  const fetchMetadata = async (exchangeId, symbol = null) => {
    try {
      setIsLoading(true);
      
      const baseExchange = exchangeId.split('_')[0];
      const body = { exchange: baseExchange };
      
      if (baseExchange === 'deribit') {
        body.symbol = symbol || config[exchangeId]?.symbol || 'BTC';
      }
      
      const response = await fetch('http://localhost:8080/api/fetch-metadata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      const result = await response.json();
      
      if (result.success) {
        setAvailableData(prev => ({
          ...prev,
          [exchangeId]: result.metadata
        }));
        showNotification(`${exchangeId} metadata loaded`, 'success');
      }
    } catch (error) {
      showNotification(`Failed to fetch ${exchangeId} metadata: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const validateStrikeRange = (exchange, startStrike) => {
    const { min, max } = availableData[exchange]?.strikes || { min: 0, max: 0 };
    const strike = parseFloat(startStrike);
    
    if (strike < min || strike > max) {
      showNotification(
        `Strike ${strike} is out of range for ${exchange}. Available: ${min} - ${max}`,
        'warning'
      );
      return false;
    }
    return true;
  };

  const handleExchangeToggle = (exchangeId) => {
    setSelectedExchanges((prev) => {
      if (prev.includes(exchangeId)) {
        return prev.filter((id) => id !== exchangeId);
      } else {
        const defaultConfig = {
          deribit: {
            symbol: 'BTC',
            instrumentType: 'option',
            expiry: '',
            startStrike: '',
            gap: 1000,
            entryCount: 5
          },
          binance: {
            instrumentType: 'option',
            expiry: '',
            startStrike: '',
            gap: 1000,
            entryCount: 5
          },
          bybit: {
            instrumentType: 'option',
            expiry: '',
            startStrike: '',
            gap: 1000,
            entryCount: 5
          }
        };

        setConfig(prev => ({
          ...prev,
          [exchangeId]: defaultConfig[exchangeId]
        }));
        
        fetchMetadata(exchangeId);
        return [...prev, exchangeId];
      }
    });
  };

  const handleConfigChange = (exchange, field, value) => {
    setConfig(prev => ({
      ...prev,
      [exchange]: {
        ...prev[exchange],
        [field]: value
      }
    }));
    
    if (exchange.startsWith('deribit') && field === 'symbol') {
      setTimeout(() => fetchMetadata(exchange, value), 100);
    }
  };

  const handleSubmit = async (specificExchange = null) => {
    const exchangesToSubmit = specificExchange ? [specificExchange] : selectedExchanges;
    
    if (exchangesToSubmit.length === 0) {
      showNotification('Please select at least one exchange', 'warning');
      return;
    }

    try {
      setIsLoading(true);
      
      for (const exchange of exchangesToSubmit) {
        const exchangeConfig = config[exchange];
        if (exchangeConfig?.instrumentType === 'option' && exchangeConfig.startStrike && 
            !validateStrikeRange(exchange, exchangeConfig.startStrike)) {
          setIsLoading(false);
          return;
        }
      }

      setMarketData((prev) => {
        const updated = { ...prev };
        exchangesToSubmit.forEach(ex => {
          Object.keys(updated).forEach((key) => {
            if (key.startsWith(`${ex}_`)) {
              delete updated[key];
            }
          });
        });
        return updated;
      });

      const submitConfig = {};
      exchangesToSubmit.forEach(ex => {
        const baseExchange = ex.split('_')[0];
        submitConfig[ex] = {
          ...config[ex],
          baseExchange: baseExchange
        };
      });

      const response = await fetch('http://localhost:8080/api/start-streaming', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          exchanges: exchangesToSubmit,
          config: submitConfig
        })
      });

      const result = await response.json();
      
      if (result.success) {
        setIsStreaming(true);
        setAppliedConfig(prev => {
          const next = { ...prev };
          exchangesToSubmit.forEach(ex => { next[ex] = { ...config[ex] }; });
          return next;
        });
        showNotification(`Streaming started for ${exchangesToSubmit.join(', ')}`, 'success');
      } else {
        showNotification('Failed to start streaming: ' + result.error);
      }
    } catch (error) {
      showNotification('Error starting streaming: ' + error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleExitExchange = async (exchangeId) => {
    try {
      await fetch('http://localhost:8080/api/stop-streaming', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exchanges: [exchangeId] })
      });

      setSelectedExchanges((prev) => prev.filter((id) => id !== exchangeId));

      setMarketData((prev) => {
        const updated = { ...prev };
        Object.keys(updated).forEach((key) => {
          if (key.startsWith(`${exchangeId}_`)) {
            delete updated[key];
          }
        });
        return updated;
      });

      setAppliedConfig(prev => {
        const next = { ...prev };
        delete next[exchangeId];
        return next;
      });

      setConfig(prev => {
        const next = { ...prev };
        delete next[exchangeId];
        return next;
      });

      setAvailableData(prev => {
        const next = { ...prev };
        delete next[exchangeId];
        return next;
      });

      showNotification(`${exchangeId} streaming stopped`, "info");
    } catch (error) {
      showNotification(`Failed to stop ${exchangeId}: ${error.message}`);
    }
  };

  const isSpotReferenceRow = (exchangeId, row, appliedSymbol) => {
    const ex = exchangeId.split('_')[0].toLowerCase();
    const inst = (row?.instrument || '').toUpperCase();
    
    if (ex === 'deribit') {
      const expectedPerp = `${appliedSymbol}-PERPETUAL`;
      return inst === expectedPerp;
    }
    
    if (ex === 'binance' || ex === 'bybit') {
      const isTypeSpot = (row?.type || '').toLowerCase() === 'spot';
      const isTypeFuture = (row?.type || '').toLowerCase() === 'future';
      
      if (isTypeSpot && inst === 'BTCUSDT') return true;
      if (isTypeFuture && inst === 'BTCUSDT') return true;
      
      return false;
    }
    
    return false;
  };

  
  const filteredMarketData = Object.keys(marketData).reduce((filtered, key) => {
  // Extract base exchange from the data key (e.g., "deribit" from "deribit_BTC-17OCT25")
  const keyParts = key.split('_');
  const baseExchangeFromKey = keyParts[0]; // "deribit", "binance", "bybit"
  
  // Find matching selected exchange
  const exchangeMatch = selectedExchanges.find(exchange => {
    const selectedBase = exchange.split('_')[0];
    return selectedBase === baseExchangeFromKey;
  });
  
  if (!exchangeMatch) return filtered;

  const row = marketData[key];
  const instrument = row?.instrument || '';
  const applied = appliedConfig[exchangeMatch];
  
  if (!applied) {
    filtered[key] = row;
    return filtered;
  }

  const appliedSymbol = (applied.symbol || 'BTC').toUpperCase();
  
  // Check if this is spot/perpetual reference row
  if (isSpotReferenceRow(exchangeMatch, row, appliedSymbol)) {
    filtered[key] = row;
    return filtered;
  }

  const baseExchange = exchangeMatch.split('_')[0];
  let include = false;
  const type = applied.instrumentType;
  const upperInstrument = instrument.toUpperCase();
  
  // For Deribit, check if instrument matches the applied symbol
  if (baseExchange === 'deribit') {
    if (!upperInstrument.startsWith(`${appliedSymbol}-`)) {
      return filtered; // Wrong symbol, skip
    }
  }
  
  if (type === 'option') {
    const isOption = /^(BTC|ETH)-\d{1,2}[A-Z]{3}\d{2,4}-\d{3,6}-[CP](-USDT)?$/i.test(upperInstrument);

    if (isOption) {
      include = true;

      if (applied.expiry && applied.expiry.trim()) {
        const expiryNorm = applied.expiry.trim().toUpperCase();
        const expiryPattern = expiryNorm.replace(/^\d{1,2}/, '');
        
        const hasExpiry = upperInstrument.includes(`-${expiryNorm}-`) || 
                         upperInstrument.includes(`-${expiryPattern}-`);
        
        include = hasExpiry;
      }

      if (include && applied.startStrike && applied.startStrike.trim()) {
        const start = parseInt(applied.startStrike);
        const gap = parseInt(applied.gap || 1000);
        const count = parseInt(applied.entryCount || 5);

        const parts = upperInstrument.split('-');
        const strikePart = parts.find(p => /^\d+$/.test(p));
        const strike = parseInt(strikePart);

        if (!isNaN(start) && !isNaN(strike) && gap > 0 && count > 0) {
          const validStrikes = Array.from({ length: count }, (_, i) => start + i * gap);
          include = validStrikes.includes(strike);
        }
      }
    }
  } 
  else if (type === 'future') {
    if (baseExchange === 'deribit') {
      const parts = upperInstrument.split('-');
      // Show all futures for the selected symbol (BTC or ETH)
      include = parts.length === 2 && parts[0] === appliedSymbol && !upperInstrument.includes('PERPETUAL');
    } else if (baseExchange === 'binance') {
      include = 
        upperInstrument === 'BTCUSDT' || 
        /^BTCUSDT_\d{6}$/.test(upperInstrument) ||
        /^BTCUSDT-\d{2}[A-Z]{3}\d{2}$/.test(upperInstrument);
    } else if (baseExchange === 'bybit') {
      include = 
        upperInstrument === 'BTCUSDT' || 
        /^BTCUSDT-\d{2}[A-Z]{3}\d{2}$/.test(upperInstrument);
    }
  } 
  else if (type === 'spot') {
    include = /btcusdt/i.test(instrument) && /spot/i.test(row?.type);
  }
  
  if (include) {
    filtered[key] = row;
  }
  
  return filtered;
}, {});

  return (
    <div className="dashboard-container">
      {notification && (
        <div className={`notification notification-${notification.type}`}>
          <AlertCircle className="notification-icon" />
          <p>{notification.message}</p>
        </div>
      )}

      <div className="dashboard-content">
        <ExchangeSelector
          exchanges={exchanges}
          selectedExchanges={selectedExchanges}
          onExchangeToggle={handleExchangeToggle}
          onSubmit={handleSubmit}
          onExit={handleExitExchange}
          isStreaming={isStreaming}
          isLoading={isLoading}
          config={config}
          onConfigChange={handleConfigChange}
          availableData={availableData}
          onAddInstance={handleAddInstance}
          marketData={marketData}
        />
        <DataGrid 
          marketData={filteredMarketData} 
          appliedConfig={appliedConfig}
          selectedExchanges={selectedExchanges}
        />
      </div>
    </div>
  );
};

export default Dashboard;
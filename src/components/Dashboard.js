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
  const [availableData, setAvailableData] = useState({
    deribit: { expiries: [], strikes: { min: 0, max: 0 }, instruments: {} },
    binance: { expiries: [], strikes: { min: 0, max: 0 }, instruments: {} }
  });
  const [config, setConfig] = useState({
    deribit: {
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
    }
  });
  const [appliedConfig, setAppliedConfig] = useState({});
  const [notification, setNotification] = useState(null);
  const wsRef = useRef(null);

  const exchanges = [
    { id: 'deribit', name: 'Deribit BTC', color: 'bg-blue-500', available: true, type: 'crypto' },
    { id: 'binance', name: 'Binance BTC', color: 'bg-yellow-500', available: true, type: 'crypto' },
    { id: 'nse_zerodha', name: 'NSE (Zerodha)', color: 'bg-green-500', available: false, type: 'indian' },
    { id: 'nse_xts', name: 'NSE (XTS)', color: 'bg-emerald-500', available: false, type: 'indian' },
    { id: 'bse_zerodha', name: 'BSE (Zerodha)', color: 'bg-red-500', available: false, type: 'indian' },
    { id: 'bse_xts', name: 'BSE (XTS)', color: 'bg-rose-500', available: false, type: 'indian' }
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

  const fetchMetadata = async (exchangeId) => {
    try {
      setIsLoading(true);
      const response = await fetch('http://localhost:8080/api/fetch-metadata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exchange: exchangeId })
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
    const { min, max } = availableData[exchange].strikes;
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
        if (exchangeConfig.instrumentType === 'option' && exchangeConfig.startStrike && 
            !validateStrikeRange(exchange, exchangeConfig.startStrike)) {
          setIsLoading(false);
          return;
        }
      }

      const submitConfig = {};
      exchangesToSubmit.forEach(ex => {
        submitConfig[ex] = config[ex];
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

      showNotification(`${exchangeId} streaming stopped`, "info");
    } catch (error) {
      showNotification(`Failed to stop ${exchangeId}: ${error.message}`);
    }
  };

  const isSpotReferenceRow = (exchangeId, row) => {
    const ex = (exchangeId || '').toLowerCase();
    const inst = (row?.instrument || '').toUpperCase();
    
    if (ex === 'deribit') {
      return inst === 'BTC-PERPETUAL';
    }
    
    if (ex === 'binance') {
      const isTypeSpot = (row?.type || '').toLowerCase() === 'spot';
      const isTypeFuture = (row?.type || '').toLowerCase() === 'future';
      
      if (isTypeSpot && inst === 'BTCUSDT') return true;
      if (isTypeFuture && inst === 'BTCUSDT') return true;
      
      return false;
    }
    
    return false;
  };

  const filteredMarketData = Object.keys(marketData).reduce((filtered, key) => {
    const exchangeMatch = selectedExchanges.find(exchange => key.startsWith(`${exchange}_`));
    if (!exchangeMatch) return filtered;

    const row = marketData[key];
    const instrument = row?.instrument || '';
    
    if (isSpotReferenceRow(exchangeMatch, row)) {
      filtered[key] = row;
      return filtered;
    }

    const applied = appliedConfig[exchangeMatch];

    if (!applied) {
      filtered[key] = row;
      return filtered;
    }

    let include = false;
    const type = applied.instrumentType;
    const parts = instrument.split('-');
    
    if (type === 'option') {
      const isOption = parts.length === 4;
      
      if (isOption) {
        include = true;
        
        if (applied.expiry && include) {
          include = instrument.includes(applied.expiry);
        }
        
        const start = parseInt(applied.startStrike);
        const gap = parseInt(applied.gap);
        const count = parseInt(applied.entryCount);
        
        if (include && !isNaN(start) && !isNaN(gap) && !isNaN(count) && gap > 0 && count > 0) {
          const strike = parseInt(parts[2]);
          let found = false;
          for (let i = 0; i < count; i++) {
            if (strike === start + i * gap) {
              found = true;
              break;
            }
          }
          include = found;
        }
      }
    } else if (type === 'future') {
      if (exchangeMatch === 'deribit') {
        include = parts.length === 2 && parts[0] === 'BTC' && !instrument.includes('PERPETUAL');
      } else if (exchangeMatch === 'binance') {
        include = 
          instrument === 'BTCUSDT' || 
          /^BTCUSDT_\d{6}$/.test(instrument) ||
          /^[A-Z]+USDT$/.test(instrument);
      }
    } else if (type === 'spot') {
      if (exchangeMatch === 'binance') {
        include = /btcusdt/i.test(instrument) && /spot/i.test(row?.type);
      } else {
        include = /btcusdt/i.test(instrument) && /spot/i.test(row?.type);
      }
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
        />
        <DataGrid marketData={filteredMarketData} />
      </div>
    </div>
  );
};

export default Dashboard;
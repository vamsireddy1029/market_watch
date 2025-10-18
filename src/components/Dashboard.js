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
    { id: 'deribit_btc', name: 'Deribit', color: 'bg-blue-500', available: true, type: 'crypto', allowMultiple: true },
    { id: 'binance', name: 'Binance BTC', color: 'bg-yellow-500', available: true, type: 'crypto', allowMultiple: false },
    { id: 'bybit', name: 'Bybit BTC', color: 'bg-purple-500', available: true, type: 'crypto', allowMultiple: false },
    { id: 'lighter', name: 'Lighter', color: 'bg-green-500', available: true, type: 'perpetual', allowMultiple: false },
    { id: 'okx', name: 'OKX', color: 'bg-indigo-500', available: true, type: 'crypto', allowMultiple: false }
  ];

  const showNotification = (message, type = 'error') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 5000);
  };

  useEffect(() => {
    console.log('🔌 Initializing WebSocket connection...');
    
    const connectWebSocket = () => {
      const ws = new WebSocket('ws://localhost:8080');
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('✅ WebSocket connected to server');
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          
          if (message.type === 'marketData') {
            const receivedKeys = Object.keys(message.data);
            console.log('📥 Received', receivedKeys.length, 'keys:', receivedKeys.slice(0, 3));
            
            setMarketData((prev) => {
              const updated = { ...prev, ...message.data };
              console.log('📊 Total marketData keys now:', Object.keys(updated).length);
              return updated;
            });
          }
        } catch (error) {
          console.error('❌ Error parsing WebSocket message:', error);
        }
      };

      ws.onerror = (error) => {
        console.error('❌ WebSocket error:', error);
      };

      ws.onclose = () => {
        console.log('🔌 WebSocket disconnected, reconnecting in 1s...');
        setTimeout(connectWebSocket, 1000);
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
    
    if (baseId !== 'deribit') {
      showNotification('Only Deribit supports multiple instances!', 'warning');
      return;
    }
    
    const existingInstances = selectedExchanges.filter(id => id.startsWith(baseId));
    const usedSymbols = existingInstances.map(id => config[id]?.symbol || 'BTC');
    
    let newSymbol;
    if (usedSymbols.includes('BTC') && !usedSymbols.includes('ETH')) {
      newSymbol = 'ETH';
    } else if (usedSymbols.includes('ETH') && !usedSymbols.includes('BTC')) {
      newSymbol = 'BTC';
    } else if (!usedSymbols.includes('BTC')) {
      newSymbol = 'BTC';
    } else {
      showNotification('Both BTC and ETH instances already exist!', 'warning');
      return;
    }
    
    const newInstanceId = `${baseId}_${newSymbol.toLowerCase()}`;
    
    if (selectedExchanges.includes(newInstanceId)) {
      showNotification(`Deribit ${newSymbol} already exists!`, 'warning');
      return;
    }
    
    const defaultGap = newSymbol === 'ETH' ? 50 : 1000;
    const newConfig = {
      symbol: newSymbol,
      instrumentType: 'future',
      expiry: '',
      startStrike: '',
      gap: defaultGap,
      entryCount: 5
    };

    setSelectedExchanges(prev => [...prev, newInstanceId]);
    setConfig(prev => ({ ...prev, [newInstanceId]: newConfig }));
    fetchMetadata(newInstanceId, newSymbol);
    showNotification(`Added Deribit ${newSymbol}. Click Submit to start streaming.`, 'success');
  };

  const fetchMetadata = async (exchangeId, symbol = null) => {
    try {
      setIsLoading(true);
      const baseExchange = exchangeId.split('_')[0];
      
      if (baseExchange === 'lighter') {
        setAvailableData(prev => ({
          ...prev,
          [exchangeId]: { perpetuals: ['BTC-USD', 'ETH-USD'], totalMarkets: 2 }
        }));
        setIsLoading(false);
        return;
      }

      // ✅ FIX: Proper handling for all exchanges
      const body = { 
        exchange: baseExchange, 
        instrumentType: 'all'
      };

      
      if (baseExchange === 'deribit') {
        body.symbol = symbol || config[exchangeId]?.symbol || 'BTC';
      } else if (baseExchange === 'okx') {
        body.symbol = symbol || config[exchangeId]?.symbol || 'BTC';
      }
      
      console.log('📡 Fetching metadata:', body);
      
      const response = await fetch('http://localhost:8080/api/fetch-metadata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      const result = await response.json();
      
      if (result.success) {
        setAvailableData(prev => ({ ...prev, [exchangeId]: result.metadata }));
        
        const futCount = result.metadata.instruments?.futures?.length || 0;
        const optCount = result.metadata.instruments?.options?.length || 0;
        const perpCount = result.metadata.instruments?.perpetual?.length || 0;
        
        let message = `${baseExchange.toUpperCase()}: `;
        if (perpCount > 0) message += `${perpCount} perpetual, `;
        if (futCount > 0) message += `${futCount} futures, `;
        if (optCount > 0) message += `${optCount} options`;
        
        showNotification(message, 'success');
      } else {
        showNotification(`Failed to fetch ${exchangeId} metadata: ${result.error || 'Unknown error'}`);
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
      showNotification(`Strike ${strike} out of range. Available: ${min} - ${max}`, 'warning');
      return false;
    }
    return true;
  };

  const handleExchangeToggle = (exchangeId) => {
    setSelectedExchanges((prev) => {
      if (prev.includes(exchangeId)) {
        return prev.filter((id) => id !== exchangeId);
      } else {
        let actualExchangeId = exchangeId === 'deribit' ? 'deribit_btc' : exchangeId;
        const baseExchange = actualExchangeId.split('_')[0];
        
        const defaultConfig = {
          deribit: { symbol: 'BTC', instrumentType: 'future', expiry: '', startStrike: '', gap: 1000, entryCount: 5 },
          binance: { symbol: 'BTC', instrumentType: 'future', expiry: '', startStrike: '', gap: 1000, entryCount: 5 },
          bybit: {symbol: 'BTC', instrumentType: 'future', expiry: '', startStrike: '', gap: 1000, entryCount: 5 },
          lighter: { instrumentType: 'perpetual' },
          okx: { instrumentType: 'swap', symbol: 'BTC', expiry: '', startStrike: '', gap: 1000, entryCount: 5 }
        };

        setConfig(prev => ({ ...prev, [actualExchangeId]: defaultConfig[baseExchange] }));
        fetchMetadata(actualExchangeId);
        return [...prev, actualExchangeId];
      }
    });
  };

  const handleConfigChange = (exchange, field, value) => {
  setConfig(prev => ({
    ...prev,
    [exchange]: { ...prev[exchange], [field]: value }
  }));
  
  const baseExchange = exchange.split('_')[0];
  const currentConfig = config[exchange] || {};
  
  // ✅ Auto-fetch metadata when key fields change
  if (field === 'symbol') {
    // Symbol changed - re-fetch metadata
    if (baseExchange === 'deribit' || baseExchange === 'okx') {
      setTimeout(() => fetchMetadata(exchange, value), 100);
    }
  } else if (field === 'strategy') {
    // Strategy changed - check if we need to fetch expiries
    const hasSymbol = currentConfig.symbol || (baseExchange !== 'deribit' && baseExchange !== 'okx');
    if (hasSymbol && !availableData[exchange]) {
      setTimeout(() => fetchMetadata(exchange, currentConfig.symbol), 100);
    }
  } else if (field === 'instrumentType') {
    // Instrument type changed for OKX
    if (baseExchange === 'okx') {
      setTimeout(() => fetchMetadata(exchange, currentConfig.symbol), 100);
    }
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
        const baseExchange = exchange.split('_')[0];
        
        if (!['lighter', 'okx'].includes(baseExchange) && 
            exchangeConfig?.instrumentType === 'option' && 
            exchangeConfig.startStrike && 
            !validateStrikeRange(exchange, exchangeConfig.startStrike)) {
          setIsLoading(false);
          return;
        }
      }

      setMarketData((prev) => {
        const updated = { ...prev };
        exchangesToSubmit.forEach(ex => {
          Object.keys(updated).forEach((key) => {
            if (key.startsWith(`${ex}_`) || key.startsWith(ex.split('_')[0] + '_')) {
              delete updated[key];
            }
          });
        });
        return updated;
      });

      const submitConfig = {};
      exchangesToSubmit.forEach(ex => {
        submitConfig[ex] = { ...config[ex] };
      });

      console.log('🚀 Submitting config:', submitConfig);

      const response = await fetch('http://localhost:8080/api/start-streaming', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exchanges: exchangesToSubmit, config: submitConfig })
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
        const baseEx = exchangeId.split('_')[0];
        Object.keys(updated).forEach((key) => {
          if (key.startsWith(`${exchangeId}_`) || key.startsWith(baseEx + '_')) {
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
    const symbol = appliedSymbol || 'BTC';
    
    if (ex === 'deribit') {
      return inst === `${symbol}-PERPETUAL`;
    }
    
    if (ex === 'binance') {
      const rowType = (row?.type || '').toLowerCase();
      return ((rowType === 'spot' || rowType === 'future') && inst === 'BTCUSDT');
    }
    
    if (ex === 'bybit') {
      const rowType = (row?.type || '').toLowerCase();
      return (rowType === 'future' && inst === 'BTCUSDT');
    }
    
    if (ex === 'lighter') {
      return row?.type === 'perpetual';
    }

    if (ex === 'okx') {
      const rowType = (row?.type || '').toLowerCase();
      return rowType === 'swap' && inst.includes(`${symbol}-USDT-SWAP`);
    }
    
    return false;
  };

  const filteredMarketData = Object.keys(marketData).reduce((filtered, key) => {
    const row = marketData[key];
    const instrument = row?.instrument || '';
    const upperInstrument = instrument.toUpperCase();
    
    const keyParts = key.split('_');
    let matchingExchange = null;
    
    if (keyParts[0] === 'deribit' && keyParts.length >= 3) {
      matchingExchange = `${keyParts[0]}_${keyParts[1]}`;
    } else if (keyParts[0] === 'okx' && keyParts.length >= 3) {
      matchingExchange = `${keyParts[0]}_${keyParts[1]}`;
    } else if (keyParts[0] === 'lighter') {
      matchingExchange = 'lighter';
    } else {
      matchingExchange = keyParts[0];
    }
    
    if (!matchingExchange || !appliedConfig[matchingExchange]) {
      return filtered;
    }
    
    const applied = appliedConfig[matchingExchange];
    const appliedSymbol = (applied.symbol || 'BTC').toUpperCase();
    const baseExchange = matchingExchange.split('_')[0];
    
    if (isSpotReferenceRow(matchingExchange, row, appliedSymbol)) {
      filtered[key] = row;
      return filtered;
    }

    if (baseExchange === 'lighter') {
      filtered[key] = row;
      return filtered;
    }

    let include = false;
    const type = applied.instrumentType;
    
    if (baseExchange === 'deribit') {
      if (type === 'future') {
        const parts = upperInstrument.split('-');
        include = parts.length === 2 && 
                  parts[0] === appliedSymbol && 
                  !upperInstrument.includes('PERPETUAL');
        
        if (include && applied.expiry && applied.expiry.trim()) {
          const expiryNorm = applied.expiry.trim().toUpperCase().replace(/^0+/, '');
          include = upperInstrument.includes(`-${expiryNorm}`);
        }
      } 
      else if (type === 'option') {
        const isOption = /^[A-Z]{3}-\d{1,2}[A-Z]{3}\d{2}-\d{4,6}-[CP]$/i.test(upperInstrument);
        
        if (isOption && upperInstrument.startsWith(`${appliedSymbol}-`)) {
          include = true;

          if (applied.expiry && applied.expiry.trim()) {
            const expiryNorm = applied.expiry.trim().toUpperCase().replace(/^0+/, '');
            include = upperInstrument.includes(`-${expiryNorm}-`);
          }

          if (include && applied.startStrike && applied.startStrike.trim()) {
            const start = parseInt(applied.startStrike);
            const gap = parseInt(applied.gap || 1000);
            const count = parseInt(applied.entryCount || 5);
            const parts = upperInstrument.split('-');
            const strike = parseInt(parts[2]);

            if (!isNaN(start) && !isNaN(strike) && gap > 0 && count > 0) {
              const validStrikes = Array.from({ length: count }, (_, i) => start + i * gap);
              include = validStrikes.includes(strike);
            }
          }
        }
      }
    }
    
    else if (baseExchange === 'binance') {
      if (type === 'future') {
        include = upperInstrument === 'BTCUSDT' || 
                  /^BTCUSDT[_-]\d{6}$/i.test(upperInstrument);
      } 
      else if (type === 'option') {
        // Binance options format: BTC-251018-100000-C or similar
        const isOption = /^BTC-\d{6}-\d{4,6}-[CP]$/i.test(upperInstrument);
        
        if (isOption) {
          include = true;

          // Filter by expiry if specified
          if (applied.expiry && applied.expiry.trim()) {
            const expiryNorm = applied.expiry.trim();
            include = upperInstrument.includes(`-${expiryNorm}-`);
          }

          // Filter by strike range if specified
          if (include && applied.startStrike && applied.startStrike.trim()) {
            const start = parseInt(applied.startStrike);
            const gap = parseInt(applied.gap || 1000);
            const count = parseInt(applied.entryCount || 5);
            const parts = upperInstrument.split('-');
            const strike = parseInt(parts[2]);

            if (!isNaN(start) && !isNaN(strike) && gap > 0 && count > 0) {
              const validStrikes = Array.from({ length: count }, (_, i) => start + i * gap);
              include = validStrikes.includes(strike);
            }
          }
        }
      }
      else if (type === 'spot') {
        include = upperInstrument === 'BTCUSDT' && (row?.type || '').toLowerCase() === 'spot';
      }
    }
    
    else if (baseExchange === 'bybit') {
      if (type === 'future') {
        include = upperInstrument === 'BTCUSDT' || 
                  /^BTC-\d{1,2}[A-Z]{3}\d{2}$/i.test(upperInstrument);
      } 
      else if (type === 'option') {
        const isOption = /^BTC-\d{1,2}[A-Z]{3}\d{2}-\d{3,6}-[CP]$/i.test(upperInstrument);
        
        if (isOption) {
          include = true;

          if (applied.expiry && applied.expiry.trim()) {
            let expiryNorm = applied.expiry.trim().toUpperCase();
            if (/^\d{1,2}[A-Z]{3}\d{2}$/i.test(expiryNorm)) {
              include = upperInstrument.includes(`-${expiryNorm}-`);
            }
          }

          if (include && applied.startStrike && applied.startStrike.trim()) {
            const start = parseInt(applied.startStrike);
            const gap = parseInt(applied.gap || 1000);
            const count = parseInt(applied.entryCount || 5);
            const parts = upperInstrument.split('-');
            const strike = parseInt(parts[2]);

            if (!isNaN(start) && !isNaN(strike) && gap > 0 && count > 0) {
              const validStrikes = Array.from({ length: count }, (_, i) => start + i * gap);
              include = validStrikes.includes(strike);
            }
          }
        }
      }
    }
    
    else if (baseExchange === 'okx') {
      const rowType = (row?.type || '').toLowerCase();

      if (type === 'swap' && rowType === 'swap') {
        include = true;
      }
      else if (type === 'futures' && rowType === 'futures') {
        include = true;
      }
      else if (type === 'spot' && rowType === 'spot') {
        include = true;
      }
      else if (type === 'option' && rowType === 'option') {
        include = true;

        if (applied.expiry && applied.expiry.trim()) {
          const expiryNorm = applied.expiry.trim().toUpperCase();
          include = upperInstrument.includes(expiryNorm);
        }

        if (include && applied.startStrike && applied.startStrike.trim()) {
          const start = parseInt(applied.startStrike);
          const gap = parseInt(applied.gap || 1000);
          const count = parseInt(applied.entryCount || 5);
          const parts = upperInstrument.split('-');
          const strikePart = parts.length >= 4 ? parts[3] : null;
          const strike = parseInt(strikePart);

          if (!isNaN(start) && !isNaN(strike) && gap > 0 && count > 0) {
            const validStrikes = Array.from({ length: count }, (_, i) => start + i * gap);
            include = validStrikes.includes(strike);
          }
        }
      }
    }
    
    if (include) {
      filtered[key] = row;
    }
    
    return filtered;
  }, {});
  
  useEffect(() => {
    console.log('🔍 marketData keys:', Object.keys(marketData).length);
    console.log('🔍 filteredMarketData keys:', Object.keys(filteredMarketData).length);
    console.log('🔍 appliedConfig:', appliedConfig);
    console.log('🔍 selectedExchanges:', selectedExchanges);
  }, [marketData, filteredMarketData, appliedConfig, selectedExchanges]);

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
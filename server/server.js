const express = require('express');
const cors = require('cors');
const WebSocket = require('ws');
const http = require('http');
const fs = require('fs').promises;
const path = require('path');
const DeribitConnector = require('./connectors/DeribitConnector');
const BinanceConnector = require('./connectors/BinanceConnector');
const BybitConnector = require('./connectors/ByBitConnector');
const LighterConnector = require('./connectors/Lighterconnector');
const OKXConnector = require('./connectors/OKXConnector');
const StrategyCalculator = require('./StrategyCalculator');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());

const marketData = {};
const metadata = {
  deribit: { expiries: [], strikes: { min: 0, max: 0 }, instruments: {} },
  binance: { expiries: [], strikes: { min: 0, max: 0 }, instruments: {} },
  bybit: { expiries: [], strikes: { min: 0, max: 0 }, instruments: {} },
  okx: { expiries: [], strikes: { min: 0, max: 0 }, instruments: {} }
};
const activeConnectors = {};
const strategyConnectors = {};
const connectedClients = new Set();
const strategyCalculator = new StrategyCalculator();
const CONFIG_FILE_PATH = path.join(__dirname, 'strategy-configs.json');

/**
 * Ensures consistent key format across all exchanges
 * @param {string} exchange - Exchange instance ID (e.g., 'deribit_btc', 'okx', 'binance')
 * @param {string} instrument - Instrument name
 * @param {object} config - Exchange config (to extract symbol if needed)
 * @returns {string} - Properly formatted key
 */
function formatMarketDataKey(exchange, instrument, config = {}) {
  const baseExchange = exchange.split('_')[0].toLowerCase();
  const instrumentUpper = (instrument || '').toUpperCase();
  
  let formattedKey;
  
  if (baseExchange === 'binance') {
    if (instrumentUpper.includes('-') && instrumentUpper.match(/-\d+-[CP]$/)) {
      formattedKey = `binance_${instrumentUpper}`;
    } else if (instrumentUpper.includes('_')) {
      formattedKey = `binance_${instrumentUpper}`;
    } else {
      formattedKey = `binance_${instrumentUpper}`;
    }
  } else if (baseExchange === 'deribit') {
    let symbol = (config.symbol || 'BTC').toLowerCase();
    
    if (!config.symbol && instrumentUpper.includes('-')) {
      const parts = instrumentUpper.split('-');
      if (parts.length >= 1) {
        symbol = parts[0].toLowerCase();
      }
    }
    
    formattedKey = `deribit_${symbol}_${instrumentUpper}`;
  } else if (baseExchange === 'bybit') {
    formattedKey = `bybit_${instrumentUpper}`;
  } else if (baseExchange === 'okx') {
    let symbol = (config.symbol || 'BTC').toLowerCase();
    
    if (!config.symbol && instrumentUpper.includes('-')) {
      const parts = instrumentUpper.split('-');
      if (parts.length >= 1) {
        symbol = parts[0].toLowerCase();
      }
    }
    
    formattedKey = `okx_${symbol}_${instrumentUpper}`;
  } else if (baseExchange === 'lighter') {
    formattedKey = `lighter_${instrumentUpper}`;
  } else {
    formattedKey = `${baseExchange}_${instrumentUpper}`;
  }
  
  return formattedKey;
}

// ==================== FILE I/O ====================
async function loadConfigsFromFile() {
  try {
    const data = await fs.readFile(CONFIG_FILE_PATH, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    console.error('Error loading configs:', error);
    return {};
  }
}

async function saveConfigsToFile(configs) {
  try {
    await fs.writeFile(CONFIG_FILE_PATH, JSON.stringify(configs, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error('Error saving configs:', error);
    return false;
  }
}

// ==================== WEBSOCKET BROADCASTING ====================
function broadcastMarketData(key, data) {
  if (key.includes('binance') && key.includes('251018')) {
    console.log('📤 [BROADCAST] Key:', key);
    console.log('📤 [BROADCAST] Data:', JSON.stringify(data, null, 2));
  }
  
  const message = JSON.stringify({ 
    type: 'marketData', 
    data: { [key]: data } 
  });
  
  let sentCount = 0;
  connectedClients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
      sentCount++;
    }
  });
  
  if (key.includes('binance') && key.includes('251018')) {
    console.log(`📤 [BROADCAST] Sent to ${sentCount} clients`);
  }
}

// ==================== STRATEGY UPDATES ====================
let strategyUpdateInterval = null;
let lastUpdateTime = Date.now();
let updateCount = 0;

function startStrategyUpdates() {
  if (strategyUpdateInterval) {
    console.log('⚠️ Strategy updates already running');
    return;
  }
  
  console.log('🚀 Starting REAL-TIME strategy updates (50ms interval)');
  
  strategyUpdateInterval = setInterval(() => {
    try {
      const updates = strategyCalculator.calculateAllStrategies();
      
      if (updates.length > 0 && connectedClients.size > 0) {
        const message = JSON.stringify({ 
          type: 'strategyUpdate', 
          data: updates,
          serverTime: Date.now()
        });
        
        let sentCount = 0;
        let failedCount = 0;
        
        connectedClients.forEach(client => {
          if (client.readyState === WebSocket.OPEN) {
            try {
              client.send(message);
              sentCount++;
            } catch (e) {
              console.error('❌ Send error:', e.message);
              failedCount++;
            }
          } else {
            connectedClients.delete(client);
          }
        });
        
        updateCount++;
        
        if (Date.now() - lastUpdateTime > 5000) {
          const avgHz = (updateCount / 5).toFixed(1);
          console.log(`📊 Updates: ${avgHz}Hz | Clients: ${sentCount} | Strategies: ${updates.length}`);
          lastUpdateTime = Date.now();
          updateCount = 0;
        }
        
        if (failedCount > 0) {
          console.warn(`⚠️ Failed to send to ${failedCount} clients`);
        }
      }
    } catch (error) {
      console.error('❌ Strategy update error:', error.message);
    }
  }, 50);
}

function stopStrategyUpdates() {
  if (strategyUpdateInterval) {
    clearInterval(strategyUpdateInterval);
    strategyUpdateInterval = null;
    console.log('⏸️ Strategy updates stopped');
  }
}

// ==================== WEBSOCKET CONNECTION ====================
wss.on('connection', (ws) => {
  console.log('✅ Client connected');
  connectedClients.add(ws);
  
  ws.send(JSON.stringify({ type: 'marketData', data: marketData }));
  
  const strategies = strategyCalculator.calculateAllStrategies();
  if (strategies.length > 0) {
    ws.send(JSON.stringify({ type: 'strategyUpdate', data: strategies }));
  }
  
  ws.on('message', (message) => {
    try {
      const parsed = JSON.parse(message);
      if (parsed.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
      }
    } catch (e) {
      // Ignore invalid messages
    }
  });
  
  ws.on('close', () => {
    console.log('❌ Client disconnected');
    connectedClients.delete(ws);
  });
  
  ws.on('error', (error) => {
    console.error('❌ WebSocket error:', error);
    connectedClients.delete(ws);
  });
});

// ==================== CONNECTOR HELPER ====================
function getConnector(exchange, onData, onMetadata) {
  const ex = exchange.toLowerCase();
  console.log(`🔧 Creating connector for: ${ex}`);
  
  if (ex === 'deribit' || ex.startsWith('deribit_')) {
    console.log('✅ Creating Deribit connector');
    return new DeribitConnector(onData, onMetadata);
  } else if (ex === 'binance' || ex.startsWith('binance_')) {
    console.log('✅ Creating Binance connector');
    return new BinanceConnector(onData, onMetadata);
  } else if (ex === 'bybit' || ex.startsWith('bybit_')) {
    console.log('✅ Creating Bybit connector');
    return new BybitConnector(onData, onMetadata);
  } else if (ex === 'lighter' || ex.startsWith('lighter_')) {
    console.log('✅ Creating Lighter connector');
    return new LighterConnector(onData, onMetadata);
  } else if (ex === 'okx' || ex.startsWith('okx_')) {
    console.log('✅ Creating OKX connector');
    return new OKXConnector(onData, onMetadata);
  }
  throw new Error(`Unknown exchange: ${exchange}`);
}

// ==================== CONFIGURATION ENDPOINTS ====================
app.get('/api/configs', async (req, res) => {
  try {
    const configs = await loadConfigsFromFile();
    res.json({ success: true, configs });
  } catch (error) {
    console.error('Get configs error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/configs/save', async (req, res) => {
  try {
    const { name, config } = req.body;
    if (!name || !config) {
      return res.status(400).json({ success: false, error: 'Name and config required' });
    }
    
    const configs = await loadConfigsFromFile();
    configs[name] = config;
    
    const saved = await saveConfigsToFile(configs);
    if (saved) {
      console.log(`Configuration "${name}" saved`);
      res.json({ success: true });
    } else {
      res.status(500).json({ success: false, error: 'Failed to save' });
    }
  } catch (error) {
    console.error('Save config error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/configs/delete', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) {
      return res.status(400).json({ success: false, error: 'Name required' });
    }
    
    const configs = await loadConfigsFromFile();
    if (!configs[name]) {
      return res.status(404).json({ success: false, error: 'Config not found' });
    }
    
    delete configs[name];
    const saved = await saveConfigsToFile(configs);
    
    if (saved) {
      console.log(`Configuration "${name}" deleted`);
      res.json({ success: true });
    } else {
      res.status(500).json({ success: false, error: 'Failed to delete' });
    }
  } catch (error) {
    console.error('Delete config error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/fetch-metadata', async (req, res) => {
  const { exchange, instrumentType, symbol, strategy } = req.body;
  console.log('🚨 [FETCH-METADATA] Request received:', req.body);
  try {
    let baseExchange = exchange;
    if (exchange && exchange.includes('_')) {
      baseExchange = exchange.split('_')[0];
    }
    
    baseExchange = baseExchange.toLowerCase();
    const symbolToUse = symbol || 'BTC';
    
    const isJellyOrSynthetic = strategy && ['jelly', 'synthetic'].includes(strategy.toLowerCase());
    
    console.log(`📡 Fetching metadata for ${baseExchange} (${symbolToUse}, type: ${instrumentType}, strategy: ${strategy})...`);
    
    const onData = (rawKey, data) => {
      const key = formatMarketDataKey(exchange, data.instrument, { symbol: symbolToUse });
      console.log('💾 [Metadata] Storing:', key);
      marketData[key] = data;
      strategyCalculator.updateMarketData(key, data);
      broadcastMarketData(key, data);
    };
    
    const onMetadata = (ex, data) => {
      console.log(`📊 Metadata received for ${ex}:`, {
        expiries: data.expiries?.length || 0,
        futureExpiries: data.futureExpiries?.length || 0,
        optionExpiries: data.optionExpiries?.length || 0
      });
      
      if (!metadata[baseExchange]) {
        metadata[baseExchange] = data;
      } else {
        metadata[baseExchange] = {
          ...metadata[baseExchange],
          ...data,
          expiries: [...new Set([...(metadata[baseExchange].expiries || []), ...(data.expiries || [])])],
          futureExpiries: [...new Set([...(metadata[baseExchange].futureExpiries || []), ...(data.futureExpiries || [])])],
          optionExpiries: [...new Set([...(metadata[baseExchange].optionExpiries || []), ...(data.optionExpiries || [])])],
          instruments: { ...(metadata[baseExchange].instruments || {}), ...(data.instruments || {}) }
        };
      }
    };
    
    console.log(`🔧 Creating connector for: ${baseExchange}`);
    const tempConnector = getConnector(baseExchange, onData, onMetadata);
    
    if (isJellyOrSynthetic) {
      console.log('🎯 Jelly/Synthetic detected - fetching BOTH options and futures...');
      
      await tempConnector.connect({ 
        isMetadataFetch: true,
        instrumentType: 'option',
        symbol: symbolToUse
      });
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      if (tempConnector && typeof tempConnector.disconnect === 'function') {
        tempConnector.disconnect();
      }
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const futureConnector = getConnector(baseExchange, onData, onMetadata);
      await futureConnector.connect({ 
        isMetadataFetch: true,
        instrumentType: 'future',
        symbol: symbolToUse
      });
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      if (futureConnector && typeof futureConnector.disconnect === 'function') {
        futureConnector.disconnect();
      }
    } else {
      await tempConnector.connect({ 
        isMetadataFetch: true,
        instrumentType: instrumentType || 'all',
        symbol: symbolToUse
      });
      console.log("hello: ", instrumentType);
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      if (tempConnector && typeof tempConnector.disconnect === 'function') {
        tempConnector.disconnect();
      }
    }
    
    const metadataResult = metadata[baseExchange];
    
    if (!metadataResult) {
      console.error(`❌ No metadata found for ${baseExchange}`);
      return res.status(500).json({ 
        success: false, 
        error: `No metadata available for ${baseExchange}` 
      });
    }
    
    console.log(`✅ Returning metadata for ${baseExchange}:`, {
      optionExpiries: metadataResult?.optionExpiries?.length || 0,
      futureExpiries: metadataResult?.futureExpiries?.length || 0
    });
    
    res.json({ success: true, metadata: metadataResult });
  } catch (error) {
    console.error('❌ Metadata fetch error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== STREAMING ENDPOINTS ====================
app.post('/api/start-streaming', async (req, res) => {
  const { exchanges, config } = req.body;
  
  console.log('🚀 [START-STREAMING] Request received:', {
    exchanges,
    config
  });
  
  try {
    for (const exchange of exchanges) {
      console.log(`🚀 Starting ${exchange}...`);
      
      const baseExchange = exchange.split('_')[0];
      
      if (activeConnectors[exchange]) {
        console.log(`🛑 Stopping existing ${exchange} connector...`);
        activeConnectors[exchange].disconnect();
        delete activeConnectors[exchange];
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      console.log(`🧹 Clearing old data for ${exchange}...`);
      Object.keys(marketData).forEach(key => {
        if (key.startsWith(`${baseExchange}_`)) {
          console.log(`🗑️ Deleting old key: ${key}`);
          delete marketData[key];
        }
      });
      
      const onData = (rawInstrument, data) => {
        const key = formatMarketDataKey(exchange, data.instrument, config[exchange] || {});
        
        console.log(`💾 [${exchange}] Storing key: ${key}`);
        console.log(`💾 [${exchange}] Data:`, {
          instrument: data.instrument,
          bid: data.best_bid_price,
          ask: data.best_ask_price
        });
        
        marketData[key] = data;
        strategyCalculator.updateMarketData(key, data);
        broadcastMarketData(key, data);
      };
      
      const onMetadata = () => {};
      
      const connector = getConnector(baseExchange, onData, onMetadata);
      await connector.connect({ 
        ...config[exchange], 
        isMetadataFetch: false 
      });
      activeConnectors[exchange] = connector;
      
      await new Promise(resolve => setTimeout(resolve, 1500));
      console.log(`✅ ${exchange} connector started with config:`, config[exchange]);
    }
    
    console.log(`📊 [MARKETDATA] Total keys: ${Object.keys(marketData).length}`);
    
    const binanceKeys = Object.keys(marketData).filter(k => k.startsWith('binance'));
    console.log(`📊 [MARKETDATA] Binance keys: ${binanceKeys.length}`);
    if (binanceKeys.length > 0) {
      console.log(`📊 [MARKETDATA] Sample Binance keys:`, binanceKeys.slice(0, 5));
    } else {
      console.warn(`⚠️ [MARKETDATA] NO BINANCE KEYS FOUND!`);
      console.log(`📊 [MARKETDATA] All keys:`, Object.keys(marketData).slice(0, 10));
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Start streaming error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/stop-streaming', async (req, res) => {
  const { exchanges } = req.body;
  
  try {
    for (const exchange of exchanges) {
      console.log(`🛑 Stopping ${exchange}...`);
      
      if (activeConnectors[exchange]) {
        activeConnectors[exchange].disconnect();
        delete activeConnectors[exchange];
      }
      
      Object.keys(marketData).forEach(key => {
        if (key.startsWith(`${exchange}_`)) {
          delete marketData[key];
        }
      });
    }
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Stop streaming error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== STRATEGY ENDPOINTS ====================
app.post('/api/strategy/add', async (req, res) => {
  try {
    const { tableId, config } = req.body;
    
    if (!config.symbol) {
      config.symbol = 'BTC';
    }
    
    if (!tableId || !config) {
      return res.status(400).json({ success: false, error: 'tableId and config required' });
    }
    
    console.log('📊 Adding strategy:', { tableId, config });
    
    Object.keys(strategyConnectors).forEach(key => {
      if (key.startsWith(`${tableId}_`)) {
        console.log(`🛑 Stopping existing connector: ${key}`);
        strategyConnectors[key].disconnect();
        delete strategyConnectors[key];
      }
    });
    
    strategyCalculator.addStrategy(tableId, config);
    
    const exchange = config.exchange.toLowerCase();
    const symbol = (config.symbol || 'BTC').toLowerCase();
    const baseConnectorKey = `${tableId}_${exchange}_${symbol}`;
    
    console.log(`🔧 Creating connectors with base key: ${baseConnectorKey}`);
    
    const onData = (rawInstrument, data) => {
      const key = formatMarketDataKey(exchange, data.instrument, config);
      
      if (exchange === 'binance' && data.instrument.includes('-')) {
        console.log(`💾 [Strategy ${tableId}] Key: ${key}`);
        console.log(`💾 [Strategy ${tableId}] Instrument: ${data.instrument}`);
      }
      
      marketData[key] = data;
      strategyCalculator.updateMarketData(key, data);
      broadcastMarketData(key, data);
    };
    
    const onMetadata = () => {};
    
    if (config.strategy.toLowerCase() === 'jelly') {
      console.log('🎯 Setting up Jelly strategy with dual subscriptions...');
      
      const optionConnectorConfig = {
        isMetadataFetch: false,
        instrumentType: 'option',
        expiry: config.optionExpiry,
        strikeInterval: config.strikeInterval,
        noPrtFolio: config.noPrtFolio,
        strategy: config.strategy,
        symbol: config.symbol
      };
      
      console.log('📡 Creating option connector...');
      const optionConnector = getConnector(exchange, onData, onMetadata);
      await optionConnector.connect(optionConnectorConfig);
      strategyConnectors[`${baseConnectorKey}_option`] = optionConnector;
      console.log(`✅ Option connector created`);
      
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const futureConnectorConfig = {
        isMetadataFetch: false,
        instrumentType: 'future',
        futureExpiry: config.futureExpiry,
        strategy: config.strategy,
        symbol: config.symbol
      };
      
      console.log('📡 Creating future connector...');
      const futureConnector = getConnector(exchange, onData, onMetadata);
      await futureConnector.connect(futureConnectorConfig);
      strategyConnectors[`${baseConnectorKey}_future`] = futureConnector;
      console.log(`✅ Future connector created`);
      
    } else if (config.strategy.toLowerCase() === 'synthetic') {
      const optionConnectorConfig = {
        isMetadataFetch: false,
        instrumentType: 'option',
        expiry: config.optionExpiry,
        strikeInterval: config.strikeInterval,
        noPrtFolio: config.noPrtFolio,
        strategy: config.strategy,
        symbol: config.symbol
      };
      
      const optionConnector = getConnector(exchange, onData, onMetadata);
      await optionConnector.connect(optionConnectorConfig);
      strategyConnectors[`${baseConnectorKey}_option`] = optionConnector;
      
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const futureConnectorConfig = {
        isMetadataFetch: false,
        instrumentType: 'future',
        futureExpiry: config.optionExpiry,
        strategy: config.strategy,
        symbol: config.symbol
      };
      
      const futureConnector = getConnector(exchange, onData, onMetadata);
      await futureConnector.connect(futureConnectorConfig);
      strategyConnectors[`${baseConnectorKey}_future`] = futureConnector;
      
    } else {
      let instrumentType, expiryToSubscribe;
      
      if (config.strategy.toLowerCase() === 'c-f/f') {
        instrumentType = 'future';
        
        const fut1IsAll = !config.fut1Expiry || config.fut1Expiry === 'all';
        const fut2IsAll = !config.fut2Expiry || config.fut2Expiry === 'all';
        
        expiryToSubscribe = (fut1IsAll || fut2IsAll) ? null : config.futureExpiry;
        console.log('📋 C-F/F Strategy - subscribing to futures');
      } else {
        instrumentType = 'option';
        expiryToSubscribe = config.optionExpiry;
        console.log(`📋 ${config.strategy} Strategy - subscribing to options`);
      }
      
      const connectorConfig = {
        isMetadataFetch: false,
        instrumentType: instrumentType,
        expiry: expiryToSubscribe,
        strikeInterval: config.strikeInterval,
        noPrtFolio: config.noPrtFolio,
        strategy: config.strategy,
        futureExpiry: config.futureExpiry,
        fut1Expiry: config.fut1Expiry,
        fut2Expiry: config.fut2Expiry,
        symbol: config.symbol,
        selectedFutures: config.selectedFutures,
        subscribeAllFutures: config.strategy.toLowerCase() === 'c-f/f'
      };
      
      console.log('📡 Creating connector...');
      const connector = getConnector(exchange, onData, onMetadata);
      await connector.connect(connectorConfig);
      strategyConnectors[baseConnectorKey] = connector;
      console.log(`✅ Connector created`);
    }
    
    startStrategyUpdates();
    
    console.log('⏳ Waiting for market data...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    const result = strategyCalculator.calculateStrategy(tableId);
    
    console.log(`📊 Strategy calculation result: ${result?.data?.length || 0} rows`);
    
    const relevantKeys = Object.keys(marketData).filter(k => 
      k.startsWith(`${exchange}_`)
    );
    console.log(`📊 Market data keys for ${exchange}: ${relevantKeys.length}`);
    if (relevantKeys.length > 0) {
      console.log(`📊 Sample keys:`, relevantKeys.slice(0, 10));
    } else {
      console.warn(`⚠️ NO MARKET DATA KEYS for ${exchange}!`);
    }
    
    res.json({ success: true, data: result });
    
  } catch (error) {
    console.error('❌ Add strategy error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/strategy/remove', (req, res) => {
  try {
    const { tableId } = req.body;
    
    if (!tableId) {
      return res.status(400).json({ success: false, error: 'tableId required' });
    }
    
    console.log(`🗑️ Removing strategy: ${tableId}`);
    
    Object.keys(strategyConnectors).forEach(key => {
      if (key.startsWith(`${tableId}_`)) {
        console.log(`🛑 Disconnecting connector: ${key}`);
        strategyConnectors[key].disconnect();
        delete strategyConnectors[key];
      }
    });
    
    strategyCalculator.removeStrategy(tableId);
    
    if (strategyCalculator.activeStrategies.size === 0) {
      console.log('⏸️ No active strategies, stopping updates...');
      stopStrategyUpdates();
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Remove strategy error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/strategy/all', (req, res) => {
  try {
    const strategies = strategyCalculator.calculateAllStrategies();
    res.json({ success: true, data: strategies });
  } catch (error) {
    console.error('❌ Get strategies error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== C-F/F ROW MANAGEMENT ====================
app.post('/api/strategy/cff/add-row', async (req, res) => {
  try {
    const { tableId, exchange, fut1Expiry, fut2Expiry, insertAfterIndex } = req.body;
    
    if (!tableId || !exchange || !fut1Expiry || !fut2Expiry) {
      return res.status(400).json({ 
        success: false, 
        error: 'tableId, exchange, fut1Expiry, and fut2Expiry required' 
      });
    }
    
    const config = strategyCalculator.activeStrategies.get(tableId);
    if (!config) {
      return res.status(404).json({ success: false, error: 'Strategy not found' });
    }
    
    if (!config.selectedFutures) {
      const currentRows = strategyCalculator.calculateCashFuture(config);
      config.selectedFutures = currentRows.map(row => `${row.exchange}_${row.fut1}_${row.fut2}`);
    }
    
    const futureId = `${exchange.toLowerCase()}_${fut1Expiry}_${fut2Expiry}`;
    
    if (!config.selectedFutures.includes(futureId)) {
      if (typeof insertAfterIndex === 'number' && insertAfterIndex >= 0) {
        config.selectedFutures.splice(insertAfterIndex + 1, 0, futureId);
      } else {
        config.selectedFutures.push(futureId);
      }
    }
    
    const ex = exchange.toLowerCase();
    const connectorKey = `${tableId}_${ex}`;
    
    if (!strategyConnectors[connectorKey]) {
      const onData = (rawKey, data) => {
        const key = formatMarketDataKey(ex, data.instrument, config);
        marketData[key] = data;
        strategyCalculator.updateMarketData(key, data);
        broadcastMarketData(key, data);
      };
      
      const newConnector = getConnector(ex, onData, () => {});
      await newConnector.connect({
        isMetadataFetch: false,
        instrumentType: 'future',
        strategy: 'C-F/F',
        subscribeAllFutures: true
      });
      strategyConnectors[connectorKey] = newConnector;
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
    
    const result = strategyCalculator.calculateStrategy(tableId);
    
    res.json({ 
      success: true, 
      data: result ? result.data : [],
      selectedFutures: config.selectedFutures
    });
    
  } catch (error) {
    console.error('❌ Add row error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/strategy/cff/remove-row', async (req, res) => {
  try {
    const { tableId, exchange, fut1Expiry, fut2Expiry } = req.body;

    console.log('🗑️ C-F/F Remove Row:', { tableId, exchange, fut1Expiry, fut2Expiry });
    
    if (!tableId || !exchange || !fut1Expiry || !fut2Expiry) {
      return res.status(400).json({ 
        success: false, 
        error: 'tableId, exchange, fut1Expiry and fut2Expiry required' 
      });
    }
    
    const config = strategyCalculator.activeStrategies.get(tableId);
    if (!config) {
      return res.status(404).json({ success: false, error: 'Strategy not found' });
    }
    
    const isAllExpiriesMode = !config.selectedFutures;
    
    if (isAllExpiriesMode) {
      console.log('📋 Converting from "All Expiries" to custom selection...');
      const allCurrentRows = strategyCalculator.calculateCashFuture(config);
      console.log(`📊 Total rows before removal: ${allCurrentRows.length}`);
      
      config.selectedFutures = [];
      allCurrentRows.forEach(row => {
        const rowId = `${row.exchange}_${row.fut1}_${row.fut2}`;
        const removeId = `${exchange.toLowerCase()}_${fut1Expiry}_${fut2Expiry}`;
        
        if (rowId !== removeId) {
          config.selectedFutures.push(rowId);
        }
      });
      
      console.log(`✅ Custom mode with ${config.selectedFutures.length} futures`);
    } else {
      const futureId = `${exchange.toLowerCase()}_${fut1Expiry}_${fut2Expiry}`;
      const before = config.selectedFutures.length;
      config.selectedFutures = config.selectedFutures.filter(f => f !== futureId);
      console.log(`✅ Removed: ${before} → ${config.selectedFutures.length}`);
    }
    
    const ex = exchange.toLowerCase();
    const connectorKey = `${tableId}_${ex}`;
    const connector = strategyConnectors[connectorKey];
    
    if (connector) {
      if (ex === 'binance') {
        const fut1Symbol = `BTCUSDT_${fut1Expiry}`;
        const fut2Symbol = `BTCUSDT_${fut2Expiry}`;
        connector.ws.send(JSON.stringify({
          method: "UNSUBSCRIBE",
          params: [
            `${fut1Symbol.toLowerCase()}@ticker`,
            `${fut2Symbol.toLowerCase()}@ticker`
          ],
          id: Date.now()
        }));
        console.log(`🔌 Unsubscribed: ${fut1Symbol}, ${fut2Symbol}`);
      } else if (ex === 'deribit') {
        const fut1Symbol = `BTC-${fut1Expiry}`;
        const fut2Symbol = `BTC-${fut2Expiry}`;
        connector.send({
          jsonrpc: "2.0",
          id: Date.now(),
          method: "public/unsubscribe",
          params: { channels: [
            `ticker.${fut1Symbol}.100ms`,
            `ticker.${fut2Symbol}.100ms`
          ]}
        });
        console.log(`🔌 Unsubscribed: ${fut1Symbol}, ${fut2Symbol}`);
      } else if (ex === 'bybit') {
        const fut1Symbol = `BTCUSDT-${fut1Expiry}`;
        const fut2Symbol = `BTCUSDT-${fut2Expiry}`;
        connector.ws.send(JSON.stringify({
          op: 'unsubscribe',
          args: [
            `tickers.${fut1Symbol}`,
            `tickers.${fut2Symbol}`
          ]
        }));
        console.log(`🔌 Unsubscribed: ${fut1Symbol}, ${fut2Symbol}`);
      }
    }
    
    await new Promise(resolve => setTimeout(resolve, 500));
    
    const result = strategyCalculator.calculateStrategy(tableId);
    console.log(`✅ Recalculated: ${result?.data?.length || 0} rows remaining`);
    
    res.json({ 
      success: true, 
      data: result ? result.data : [],
      selectedFutures: config.selectedFutures || []
    });
    
  } catch (error) {
    console.error('❌ Remove row error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/metadata/:exchange', (req, res) => {
  const { exchange } = req.params;
  res.json(metadata[exchange.toLowerCase()] || {});
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok',
    connections: connectedClients.size,
    activeExchanges: Object.keys(activeConnectors),
    activeStrategies: strategyCalculator.activeStrategies.size,
    marketDataKeys: Object.keys(marketData).length,
    configFile: CONFIG_FILE_PATH
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📁 Config file: ${CONFIG_FILE_PATH}`);
  console.log(`🏦 Supported exchanges: Deribit, Binance, Bybit, OKX, Lighter`);
});

process.on('SIGTERM', () => {
  console.log('⚠️ SIGTERM received, closing...');
  stopStrategyUpdates();
  Object.values(strategyConnectors).forEach(conn => conn.disconnect());
  Object.values(activeConnectors).forEach(conn => conn.disconnect());
  wss.close(() => {
    server.close(() => {
      console.log('✅ Server closed gracefully');
      process.exit(0);
    });
  });
});
const express = require('express');
const cors = require('cors');
const WebSocket = require('ws');
const http = require('http');
const fs = require('fs').promises;
const path = require('path');
const DeribitConnector = require('./connectors/DeribitConnector');
const BinanceConnector = require('./connectors/BinanceConnector');
const BybitConnector = require('./connectors/ByBitConnector');
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
  bybit: { expiries: [], strikes: { min: 0, max: 0 }, instruments: {} }
};
const activeConnectors = {};
const strategyConnectors = {};
const connectedClients = new Set();

const strategyCalculator = new StrategyCalculator();

const CONFIG_FILE_PATH = path.join(__dirname, 'strategy-configs.json');

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

function broadcastMarketData(key, data) {
  const message = JSON.stringify({ type: 'marketData', data: { [key]: data } });
  connectedClients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send(message);
  });
}

function broadcastStrategyUpdates() {
  const updates = strategyCalculator.calculateAllStrategies();
  if (updates.length > 0) {
    const message = JSON.stringify({ type: 'strategyUpdate', data: updates });
    connectedClients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) client.send(message);
    });
  }
}

wss.on('connection', (ws) => {
  console.log('Client connected');
  connectedClients.add(ws);
  
  ws.send(JSON.stringify({ type: 'marketData', data: marketData }));
  
  const strategies = strategyCalculator.calculateAllStrategies();
  if (strategies.length > 0) {
    ws.send(JSON.stringify({ type: 'strategyUpdate', data: strategies }));
  }
  
  ws.on('close', () => {
    console.log('Client disconnected');
    connectedClients.delete(ws);
  });
  
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
    connectedClients.delete(ws);
  });
});

let strategyUpdateInterval = null;

function startStrategyUpdates() {
  if (!strategyUpdateInterval) {
    strategyUpdateInterval = setInterval(() => broadcastStrategyUpdates(), 500);
  }
}

function stopStrategyUpdates() {
  if (strategyUpdateInterval) {
    clearInterval(strategyUpdateInterval);
    strategyUpdateInterval = null;
  }
}

// ==================== Helper Function to Get Connector ====================
function getConnector(exchange, onData, onMetadata) {
  const ex = exchange.toLowerCase();
  if (ex === 'deribit') {
    return new DeribitConnector(onData, onMetadata);
  } else if (ex === 'binance') {
    return new BinanceConnector(onData, onMetadata);
  } else if (ex === 'bybit') {
    return new BybitConnector(onData, onMetadata);
  }
  throw new Error(`Unknown exchange: ${exchange}`);
}

// ==================== Configuration Endpoints ====================

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
  const { exchange, instrumentType } = req.body;
  
  try {
    console.log(`Fetching ${instrumentType || 'option'} metadata for ${exchange}...`);
    
    const onData = (key, data) => {
      marketData[key] = data;
      strategyCalculator.updateMarketData(key, data);
      broadcastMarketData(key, data);
    };
    
    const onMetadata = (ex, data) => {
      metadata[ex] = data;
    };
    
    const tempConnector = getConnector(exchange, onData, onMetadata);
    await tempConnector.connect({ 
      isMetadataFetch: true,
      instrumentType: instrumentType || 'option'
    });
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    if (tempConnector) tempConnector.disconnect();
    
    res.json({ success: true, metadata: metadata[exchange.toLowerCase()] });
  } catch (error) {
    console.error('Metadata fetch error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/start-streaming', async (req, res) => {
  const { exchanges, config } = req.body;
  
  try {
    for (const exchange of exchanges) {
      console.log(`Starting ${exchange}`);
      
      // ✅ Stop existing connector properly
      if (activeConnectors[exchange]) {
        console.log(`🛑 Stopping existing ${exchange} connector...`);
        activeConnectors[exchange].disconnect();
        delete activeConnectors[exchange];
        
        // ✅ Wait for cleanup
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      // ✅ Clear old market data for this exchange
      Object.keys(marketData).forEach(key => {
        if (key.startsWith(`${exchange}_`)) {
          delete marketData[key];
        }
      });
      
      const onData = (key, data) => {
        marketData[key] = data;
        strategyCalculator.updateMarketData(key, data);
        broadcastMarketData(key, data);
      };
      
      const onMetadata = () => {};
      const connector = getConnector(exchange, onData, onMetadata);
      await connector.connect({ ...config[exchange], isMetadataFetch: false });
      activeConnectors[exchange] = connector;
      
      console.log(`✅ ${exchange} connector started`);
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Start streaming error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/stop-streaming', async (req, res) => {
  const { exchanges } = req.body;
  
  try {
    for (const exchange of exchanges) {
      if (activeConnectors[exchange]) {
        activeConnectors[exchange].disconnect();
        delete activeConnectors[exchange];
      }
      Object.keys(marketData).forEach(key => {
        if (key.startsWith(`${exchange}_`)) delete marketData[key];
      });
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Stop streaming error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== Strategy Endpoints ====================

app.post('/api/strategy/add', async (req, res) => {
  try {
    const { tableId, config } = req.body;
    
    if (!tableId || !config) {
      return res.status(400).json({ success: false, error: 'tableId and config required' });
    }
    
    if (strategyConnectors[tableId]) {
      strategyConnectors[tableId].disconnect();
      delete strategyConnectors[tableId];
    }
    
    strategyCalculator.addStrategy(tableId, config);
    
    const exchange = config.exchange.toLowerCase();
    
    const onData = (key, data) => {
      marketData[key] = data;
      strategyCalculator.updateMarketData(key, data);
      broadcastMarketData(key, data);
    };
    
    const connectorConfig = {
      isMetadataFetch: false,
      instrumentType: config.strategy.toLowerCase() === 'c-f/f' ? 'future' : 'option',
      expiry: config.strategy.toLowerCase() === 'c-f/f' ? config.futureExpiry : config.optionExpiry,
      strikeInterval: config.strikeInterval,
      noPrtFolio: config.noPrtFolio,
      strategy: config.strategy,
      futureExpiry: config.futureExpiry
    };
    
    const connector = getConnector(exchange, onData, () => {});
    await connector.connect(connectorConfig);
    strategyConnectors[tableId] = connector;
    
    startStrategyUpdates();

    console.log('⏳ Waiting for market data...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    const result = strategyCalculator.calculateStrategy(tableId);
    console.log(`📊 Strategy data: ${result?.data?.length || 0} rows`);

    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Add strategy error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/strategy/remove', (req, res) => {
  try {
    const { tableId } = req.body;
    
    if (!tableId) {
      return res.status(400).json({ success: false, error: 'tableId required' });
    }
    
    Object.keys(strategyConnectors).forEach(key => {
      if (key.startsWith(`${tableId}_`)) {
        strategyConnectors[key].disconnect();
        delete strategyConnectors[key];
      }
    });
    
    strategyCalculator.removeStrategy(tableId);
    
    if (strategyCalculator.activeStrategies.size === 0) {
      stopStrategyUpdates();
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Remove strategy error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/strategy/all', (req, res) => {
  try {
    const strategies = strategyCalculator.calculateAllStrategies();
    res.json({ success: true, data: strategies });
  } catch (error) {
    console.error('Get strategies error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== C-F/F Row Management ====================

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
    
    // Ensure connectors for both futures exist
    const ex = exchange.toLowerCase();
    const connectorKey = `${tableId}_${ex}`;
    
    if (!strategyConnectors[connectorKey]) {
      const onData = (key, data) => {
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
    const { tableId, exchange, fut1Expiry, fut2Expiry, switchToCustomMode } = req.body;

    console.log('🗑️ C-F/F Remove Row:', { tableId, exchange, fut1Expiry, fut2Expiry, switchToCustomMode });
    
    if (!tableId || !exchange  || !fut1Expiry || !fut2Expiry) {
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
        const rowId = `${row.exchange}_${row.expiry}`;
        const removeId = `${exchange.toLowerCase()}_${fut1Expiry}_${fut2Expiry}`;
        
        if (rowId !== removeId) {
          config.selectedFutures.push(rowId);
        }
      });
      
      console.log(`✅ Custom mode with ${config.selectedFutures.length} futures`);
      console.log('📋 selectedFutures:', config.selectedFutures);
    } 
    else {
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
    configFile: CONFIG_FILE_PATH
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Config file: ${CONFIG_FILE_PATH}`);
  console.log(`Supported exchanges: Deribit, Binance, Bybit`);
});

process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing...');
  stopStrategyUpdates();
  Object.values(strategyConnectors).forEach(conn => conn.disconnect());
  Object.values(activeConnectors).forEach(conn => conn.disconnect());
  wss.close(() => {
    server.close(() => {
      console.log('Server closed');
      process.exit(0);
    });
  });
});
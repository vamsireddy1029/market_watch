const express = require('express');
const cors = require('cors');
const WebSocket = require('ws');
const http = require('http');
const fs = require('fs').promises;
const path = require('path');
const DeribitConnector = require('./connectors/DeribitConnector');
const BinanceConnector = require('./connectors/BinanceConnector');
const StrategyCalculator = require('./StrategyCalculator');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());

const marketData = {};
const metadata = {
  deribit: { expiries: [], strikes: { min: 0, max: 0 }, instruments: {} },
  binance: { expiries: [], strikes: { min: 0, max: 0 }, instruments: {} }
};
const activeConnectors = {};
const strategyConnectors = {};
const connectedClients = new Set();

const strategyCalculator = new StrategyCalculator();

// Configuration file path
const CONFIG_FILE_PATH = path.join(__dirname, 'strategy-configs.json');

// Load configurations from file
async function loadConfigsFromFile() {
  try {
    const data = await fs.readFile(CONFIG_FILE_PATH, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      // File doesn't exist, return empty object
      return {};
    }
    console.error('Error loading configs:', error);
    return {};
  }
}

// Save configurations to file
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
  const message = JSON.stringify({
    type: 'marketData',
    data: { [key]: data }
  });
  
  connectedClients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

function broadcastStrategyUpdates() {
  const updates = strategyCalculator.calculateAllStrategies();
  
  if (updates.length > 0) {
    const message = JSON.stringify({
      type: 'strategyUpdate',
      data: updates
    });
    
    connectedClients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }
}

wss.on('connection', (ws) => {
  console.log('Client connected');
  connectedClients.add(ws);
  
  ws.send(JSON.stringify({
    type: 'marketData',
    data: marketData
  }));
  
  const strategies = strategyCalculator.calculateAllStrategies();
  if (strategies.length > 0) {
    ws.send(JSON.stringify({
      type: 'strategyUpdate',
      data: strategies
    }));
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
    strategyUpdateInterval = setInterval(() => {
      broadcastStrategyUpdates();
    }, 500);
  }
}

function stopStrategyUpdates() {
  if (strategyUpdateInterval) {
    clearInterval(strategyUpdateInterval);
    strategyUpdateInterval = null;
  }
}

// ==================== Configuration Management Endpoints ====================

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
      console.log(`Configuration "${name}" saved to backend`);
      res.json({ success: true });
    } else {
      res.status(500).json({ success: false, error: 'Failed to save configuration' });
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
      return res.status(404).json({ success: false, error: 'Configuration not found' });
    }
    
    delete configs[name];
    
    const saved = await saveConfigsToFile(configs);
    
    if (saved) {
      console.log(`Configuration "${name}" deleted from backend`);
      res.json({ success: true });
    } else {
      res.status(500).json({ success: false, error: 'Failed to delete configuration' });
    }
  } catch (error) {
    console.error('Delete config error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== Metadata and Streaming Endpoints ====================

app.post('/api/fetch-metadata', async (req, res) => {
  const { exchange } = req.body;
  
  try {
    console.log(`Fetching metadata for ${exchange}...`);
    
    const onData = (key, data) => {
      marketData[key] = data;
      strategyCalculator.updateMarketData(key, data);
      broadcastMarketData(key, data);
    };
    
    const onMetadata = (ex, data) => {
      metadata[ex] = data;
    };
    
    let tempConnector;
    if (exchange === 'deribit') {
      tempConnector = new DeribitConnector(onData, onMetadata);
      await tempConnector.connect({ 
        isMetadataFetch: true,
        instrumentType: 'option' 
      });
    } else if (exchange === 'binance') {
      tempConnector = new BinanceConnector(onData, onMetadata);
      await tempConnector.connect({ 
        isMetadataFetch: true,
        instrumentType: 'option' 
      });
    }
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    if (tempConnector) {
      tempConnector.disconnect();
    }
    
    res.json({ success: true, metadata: metadata[exchange] });
  } catch (error) {
    console.error('Metadata fetch error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/start-streaming', async (req, res) => {
  const { exchanges, config } = req.body;
  
  try {
    for (const exchange of exchanges) {
      console.log(`Starting ${exchange} with config:`, config[exchange]);
      
      if (activeConnectors[exchange]) {
        console.log(`Stopping existing ${exchange} connector`);
        activeConnectors[exchange].disconnect();
        delete activeConnectors[exchange];
      }
      
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
      
      if (exchange === 'deribit') {
        const connector = new DeribitConnector(onData, onMetadata);
        await connector.connect({
          ...config[exchange],
          isMetadataFetch: false
        });
        activeConnectors[exchange] = connector;
        console.log(`Deribit streaming started`);
      } else if (exchange === 'binance') {
        const connector = new BinanceConnector(onData, onMetadata);
        await connector.connect({
          ...config[exchange],
          isMetadataFetch: false
        });
        activeConnectors[exchange] = connector;
        console.log(`Binance streaming started`);
      }
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
        if (key.startsWith(`${exchange}_`)) {
          delete marketData[key];
        }
      });
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Stop streaming error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== Strategy Management Endpoints ====================

app.post('/api/strategy/add', async (req, res) => {
  try {
    const { tableId, config } = req.body;
    
    if (!tableId || !config) {
      return res.status(400).json({ success: false, error: 'tableId and config required' });
    }
    
    if (strategyConnectors[tableId]) {
      console.log(`Stopping existing connector for ${tableId}`);
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
    
    const onMetadata = () => {};
    
    const connectorConfig = {
      isMetadataFetch: false,
      instrumentType: 'option',
      expiry: config.optionExpiry,
      strikeInterval: config.strikeInterval,
      noPrtFolio: config.noPrtFolio,
      strategy: config.strategy,
      futureExpiry: config.futureExpiry
    };
    
    console.log(`Creating ${exchange} connector for ${tableId}...`);
    
    let connector;
    if (exchange === 'deribit') {
      connector = new DeribitConnector(onData, onMetadata);
      await connector.connect(connectorConfig);
      strategyConnectors[tableId] = connector;
      console.log(`Deribit connector started for strategy ${tableId}`);
    } else if (exchange === 'binance') {
      connector = new BinanceConnector(onData, onMetadata);
      await connector.connect(connectorConfig);
      strategyConnectors[tableId] = connector;
      console.log(`Binance connector started for strategy ${tableId}`);
    }
    
    startStrategyUpdates();
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const result = strategyCalculator.calculateStrategy(tableId);
    
    console.log(`Initial strategy data:`, result ? `${result.data?.length || 0} rows` : 'null');
    
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
    
    if (strategyConnectors[tableId]) {
      console.log(`Stopping connector for strategy ${tableId}`);
      strategyConnectors[tableId].disconnect();
      delete strategyConnectors[tableId];
    }
    
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

app.get('/api/metadata/:exchange', (req, res) => {
  const { exchange } = req.params;
  res.json(metadata[exchange] || {});
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
});

process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing connections...');
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
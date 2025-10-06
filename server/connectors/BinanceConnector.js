const WebSocket = require('ws');
const axios = require('axios');

class BinanceConnector {
  constructor(onData, onMetadata) {
    this.ws = null;
    this.spotWs = null;
    this.futuresWs = null;
    this.isConnected = false;
    this.onData = onData;
    this.onMetadata = onMetadata;
    this.subscribedStreams = new Set();
    this.metadataTimer = null;
    this.reconnectAttempts = 0;
    this.isExplicitDisconnect = false;
    this.pingInterval = null;
    this.config = null;
    this.spotPriceReceived = false;
    this.currentSpotPrice = 0; // ✅ Store spot price here
    this.pendingConfig = null;
  }

  async connect(config) {
    this.config = config;
    
    return new Promise((resolve, reject) => {
      const { instrumentType } = config;
      let wsUrl = '';

      if (instrumentType === 'spot') {
        wsUrl = 'wss://stream.binance.com:9443/ws';
      } else if (instrumentType === 'future') {
        wsUrl = 'wss://fstream.binance.com/ws';
      } else if (instrumentType === 'option') {
        wsUrl = 'wss://nbstream.binance.com/eoptions/ws';
      }

      this.ws = new WebSocket(wsUrl);

      this.ws.on('open', async () => {
        this.isConnected = true;
        this.reconnectAttempts = 0;
        console.log(`✅ Binance ${instrumentType} connected`);
        
        this.startPing();
        
        setTimeout(async () => {
          if (config.isMetadataFetch) {
            await this.fetchMetadata(config);
            resolve();
          } else {
            // ✅ FIX: First get spot price, then subscribe to options
            await this.subscribeToSpotFirst(config);
            resolve();
          }
        }, 500);
      });

      this.ws.on('message', (data) => {
        try {
          const message = JSON.parse(data);
          if (message.result === null || message.id) return;
          this.handleMessage(message, instrumentType);
        } catch (error) {
          console.error('Binance parse error:', error);
        }
      });

      this.ws.on('error', (error) => {
        console.error('Binance error:', error.message);
      });

      this.ws.on('close', () => {
        this.isConnected = false;
        this.cleanup();
        console.log('Binance disconnected');
        
        if (!this.isExplicitDisconnect) {
          console.log('Reconnecting in 1s...');
          setTimeout(() => this.connect(this.config), 1000);
        }
      });
    });
  }

  startPing() {
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.ping();
      }
    }, 30000);
  }

  async subscribeToSpotFirst(config) {
    console.log('📊 Step 1: Getting spot price for Binance...');
    
    this.pendingConfig = config;
    this.spotPriceReceived = false;
    this.currentSpotPrice = 0; // ✅ Reset
    
    // Connect spot WebSocket to get current BTC price
    this.spotWs = new WebSocket('wss://stream.binance.com:9443/ws');
    this.spotWs.on('open', () => {
      console.log('✅ Spot reference connected');
      this.spotWs.send(JSON.stringify({
        method: "SUBSCRIBE",
        params: ['btcusdt@ticker'],
        id: 999
      }));
    });
    
    this.spotWs.on('message', (data) => {
      try {
        const message = JSON.parse(data);
        if (message.result === null || message.id) return;
        
        if (!this.spotPriceReceived) {
          this.spotPriceReceived = true;
          this.currentSpotPrice = parseFloat(message.c || message.lastPrice || 0); // ✅ Store it
          console.log(`✅ Binance spot price received: ${this.currentSpotPrice}`);
        }
        
        this.handleMessage(message, 'spot');
      } catch (e) {}
    });
    
    this.spotWs.on('error', () => {});
    
    // Wait for spot price (max 3 seconds)
    const startTime = Date.now();
    while (!this.spotPriceReceived && (Date.now() - startTime) < 3000) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    if (this.spotPriceReceived) {
      console.log('✅ Spot price received, now subscribing to options...');
    } else {
      console.log('⚠️ Timeout waiting for spot price, subscribing anyway...');
      this.currentSpotPrice = 60000; // Fallback
    }
    
    await this.subscribe(config);
  }

  async fetchMetadata(config) {
    console.log('📊 Fetching Binance metadata...');
    
    try {
      const { instrumentType } = config;
      
      if (instrumentType === 'option') {
        const res = await axios.get('https://eapi.binance.com/eapi/v1/exchangeInfo');
        const options = (res.data.optionSymbols || [])
          .filter(s => ['BTCUSDT', 'ETHUSDT'].includes(s.underlying));
        
        const expiries = new Set();
        const strikes = [];
        
        options.forEach(opt => {
          const parts = opt.symbol.split('-');
          if (parts[1]) expiries.add(parts[1]);
          if (parts[2]) strikes.push(parseInt(parts[2]));
        });

        const metadata = {
          expiries: Array.from(expiries).sort(),
          strikes: { min: Math.min(...strikes), max: Math.max(...strikes) },
          instruments: { options: options.map(o => o.symbol) }
        };

        this.onMetadata('binance', metadata);
        console.log(`✅ Binance: ${options.length} options`);
        
        this.ws.send(JSON.stringify({
          method: "SUBSCRIBE",
          params: ['BTCUSDT@ticker'],
          id: 1
        }));
        
      } else if (instrumentType === 'future') {
        const res = await axios.get('https://fapi.binance.com/fapi/v1/exchangeInfo');
        const futures = (res.data.symbols || [])
          .filter(s => s.status === 'TRADING' && s.symbol.startsWith('BTCUSDT'));
        
        const metadata = {
          instruments: { futures: futures.map(f => f.symbol) }
        };
        
        this.onMetadata('binance', metadata);
        console.log(`✅ Binance: ${futures.length} futures`);
        
      } else if (instrumentType === 'spot') {
        const res = await axios.get('https://api.binance.com/api/v3/exchangeInfo');
        const spot = (res.data.symbols || [])
          .filter(s => s.status === 'TRADING' && s.symbol === 'BTCUSDT');
        
        const metadata = {
          instruments: { spot: spot.map(s => s.symbol) }
        };
        
        this.onMetadata('binance', metadata);
        console.log(`✅ Binance: ${spot.length} spot`);
      }
      
      this.metadataTimer = setTimeout(() => this.disconnect(), 10000);
      
    } catch (error) {
      console.error('Metadata fetch failed:', error.message);
    }
  }

  async subscribe(config) {
    let streams = [];
    const { instrumentType, expiry, strikeInterval, noPrtFolio, futureExpiry, strategy } = config;

    if (instrumentType === 'spot') {
      streams = ['btcusdt@ticker'];
      
    } else if (instrumentType === 'future') {
      const res = await axios.get('https://fapi.binance.com/fapi/v1/exchangeInfo');
      const futures = (res.data.symbols || [])
        .filter(s =>
          s.status === 'TRADING' &&
          s.symbol.startsWith('BTCUSDT')
        )
        .map(s => s.symbol);

      const metadata = {
        instruments: { futures }
      };

      this.onMetadata('binance', metadata);
      console.log(`✅ Binance: ${futures.length} futures`);

      streams = futures.map(symbol => `${symbol.toLowerCase()}@ticker`);
    } 
    else if (instrumentType === 'option') {
      try {
        const res = await axios.get('https://eapi.binance.com/eapi/v1/exchangeInfo');
        let options = (res.data.optionSymbols || [])
          .filter(s => ['BTCUSDT', 'ETHUSDT'].includes(s.underlying));

        if (expiry) {
          options = options.filter(s => s.symbol.includes(`-${expiry}-`));
        }

        // ✅ Calculate strikes from actual stored spot price
        if (strikeInterval && noPrtFolio) {
          const spotPrice = this.currentSpotPrice || 60000; // Use stored spot price
          
          const interval = parseInt(strikeInterval);
          const nearestStrike = Math.round(spotPrice / interval) * interval;
          const portfolioCount = parseInt(noPrtFolio);
          
          const allowedStrikes = new Set();
          for (let i = -portfolioCount; i <= portfolioCount; i++) {
            allowedStrikes.add(nearestStrike + (i * interval));
          }
          
          console.log(`🎯 Binance calculated strikes around ${spotPrice}: Nearest=${nearestStrike}, Range=[${Math.min(...allowedStrikes)} to ${Math.max(...allowedStrikes)}]`);
          console.log(`🎯 First 5 strikes: [${Array.from(allowedStrikes).slice(0, 5).join(', ')}]`);
          
          options = options.filter(s => {
            const parts = s.symbol.split('-');
            return allowedStrikes.has(parseInt(parts[2]));
          });
          
          console.log(`🎯 After strike filter: ${options.length} options matched`);
        }

        streams = options.map(s => `${s.symbol}@ticker`);
        
        // Connect futures for Jelly/Synthetic
        const strategyLower = (strategy || '').toLowerCase();
        if (strategyLower === 'jelly' || strategyLower === 'synthetic') {
          console.log(`🎯 Jelly/Synthetic detected, connecting futures for expiry: ${futureExpiry}`);
          this.connectFuturesForJelly(futureExpiry);
        }
        
      } catch (e) {
        console.error('Option fetch failed:', e.message);
      }
    }

    if (streams.length === 0) return;

    const CHUNK = 100;
    for (let i = 0; i < streams.length; i += CHUNK) {
      const slice = streams.slice(i, i + CHUNK);
      this.ws.send(JSON.stringify({
        method: "SUBSCRIBE",
        params: slice,
        id: 1 + Math.floor(i / CHUNK)
      }));
      slice.forEach(s => this.subscribedStreams.add(s));
      await new Promise(r => setTimeout(r, 100));
    }
    
    console.log(`📊 Subscribed to ${streams.length} Binance ${instrumentType}s`);
  }

  connectFuturesForJelly(futureExpiry) {
    this.futuresWs = new WebSocket('wss://fstream.binance.com/ws');
    this.futuresWs.on('open', () => {
      console.log('✅ Futures connected for Jelly/Synthetic');
      
      let futureSymbol = 'btcusdt@ticker';
      
      if (futureExpiry && futureExpiry.length === 6) {
        futureSymbol = `btcusdt_${futureExpiry}@ticker`;
        console.log(`📈 Subscribing to quarterly future: ${futureSymbol}`);
      }
      
      this.futuresWs.send(JSON.stringify({
        method: 'SUBSCRIBE',
        params: [futureSymbol],
        id: 1001,
      }));
    });
    
    this.futuresWs.on('message', (data) => {
      try {
        const message = JSON.parse(data);
        if (message.result === null || message.id) return;
        
        const symbol = message.s || message.symbol;
        if (symbol) {
          const instrumentType = 'future';
          
          const lastPrice = parseFloat(message.c || message.lastPrice || message.lp || 0);
          const bidPrice = parseFloat(message.b || message.bo || 0);
          const askPrice = parseFloat(message.a || message.ao || 0);
          const markPrice = parseFloat(message.mp || message.c || 0);
          
          const converted = {
            exchange: 'binance',
            type: instrumentType,
            instrument: symbol,
            last_price: lastPrice.toFixed(2),
            best_bid_price: bidPrice.toFixed(2),
            best_ask_price: askPrice.toFixed(2),
            mark_price: markPrice.toFixed(2),
            min_price: parseFloat(message.l || 0).toFixed(2),
            max_price: parseFloat(message.h || 0).toFixed(2),
            volume: parseFloat(message.v || message.V || 0).toFixed(2)
          };
          
          this.onData(`binance_${symbol}`, converted);
        }
      } catch (e) {
        console.error('Futures message error:', e);
      }
    });
    this.futuresWs.on('error', (err) => {
      console.error('Futures WS error:', err);
    });
  }

  handleMessage(message, type) {
    if (message.result === null || message.id) return;

    const symbol = message.s || message.symbol;
    if (!symbol) return;

    const isOption = symbol.includes('-');
    let instrumentType = type;
    
    if (!type) {
      instrumentType = isOption ? 'option' : 'future';
    }

    const lastPrice = parseFloat(message.c || message.lastPrice || message.lp || 0);
    const bidPrice = parseFloat(message.b || message.bo || 0);
    const askPrice = parseFloat(message.a || message.ao || 0);
    const markPrice = parseFloat(message.mp || message.c || 0);
    const lowPrice = parseFloat(message.l || message.lowPrice || 0);
    const highPrice = parseFloat(message.h || message.highPrice || 0);
    const volume = parseFloat(message.v || message.V || 0);

    const converted = {
      exchange: 'binance',
      type: instrumentType,
      instrument: symbol,
      last_price: lastPrice.toFixed(2),
      best_bid_price: bidPrice.toFixed(2),
      best_ask_price: askPrice.toFixed(2),
      mark_price: markPrice.toFixed(2),
      min_price: lowPrice.toFixed(2),
      max_price: highPrice.toFixed(2),
      volume: volume.toFixed(2)
    };

    this.onData(`binance_${symbol}`, converted);
  }

  cleanup() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.metadataTimer) {
      clearTimeout(this.metadataTimer);
      this.metadataTimer = null;
    }
    this.subscribedStreams.clear();
    this.spotPriceReceived = false;
    this.currentSpotPrice = 0; // ✅ Reset
    this.pendingConfig = null;
  }

  disconnect() {
    this.isExplicitDisconnect = true;
    this.cleanup();
    
    [this.ws, this.spotWs, this.futuresWs].forEach(ws => {
      if (ws) {
        try {
          if (ws.readyState === WebSocket.OPEN) ws.close();
          else if (typeof ws.terminate === 'function') ws.terminate();
        } catch (e) {}
      }
    });
    
    this.ws = null;
    this.spotWs = null;
    this.futuresWs = null;
    this.isConnected = false;
  }
}

module.exports = BinanceConnector;
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
    this.currentSpotPrice = 0;
    this.pendingConfig = null;
    this.pricePollingInterval = null;
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
      } else {
        wsUrl = 'wss://nbstream.binance.com/eoptions/ws';
      }

      console.log(`🔌 Connecting to Binance WebSocket: ${wsUrl}`);
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
            await this.subscribeToSpotFirst(config);
            resolve();
          }
        }, 500);
      });

      this.ws.on('message', (data) => {
        try {
          const message = JSON.parse(data);
          
          // ✅ Skip subscription confirmation messages
          if (message.result === null || message.id) {
            console.log('📋 Subscription confirmation:', message);
            return;
          }
          
          // ✅ DEBUG: Log raw message for options
          if (instrumentType === 'option' && message.data) {
            console.log('📩 [RAW OPTION MESSAGE]:', JSON.stringify(message, null, 2));
          }
          
          this.handleMessage(message, instrumentType);
        } catch (error) {
          console.error('Binance parse error:', error);
        }
      });

      this.ws.on('error', (error) => {
        console.error('Binance WebSocket error:', error.message);
        reject(error);
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
    if (!this.ws) return;
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
    this.currentSpotPrice = 0;
    
    if (config.instrumentType === 'option') {
      try {
        const res = await axios.get('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT');
        this.currentSpotPrice = parseFloat(res.data.price || 60000);
        this.spotPriceReceived = true;
        console.log(`✅ Binance spot price from REST: ${this.currentSpotPrice}`);
      } catch (e) {
        console.log('⚠️ Failed to fetch spot price, using fallback');
        this.currentSpotPrice = 60000;
      }
      await this.subscribe(config);
      return;
    }
    
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
          this.currentSpotPrice = parseFloat(message.c || message.lastPrice || 0);
          console.log(`✅ Binance spot price received: ${this.currentSpotPrice}`);
        }
        
        this.handleMessage(message, 'spot');
      } catch (e) {}
    });
    
    this.spotWs.on('error', () => {});
    
    const startTime = Date.now();
    while (!this.spotPriceReceived && (Date.now() - startTime) < 3000) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    if (this.spotPriceReceived) {
      console.log('✅ Spot price received, now subscribing to instruments...');
    } else {
      console.log('⚠️ Timeout waiting for spot price, using fallback');
      this.currentSpotPrice = 60000;
    }
    
    await this.subscribe(config);
  }

  async fetchMetadata(config) {
    console.log('📊 Fetching Binance metadata...', config);

    try {
      const { instrumentType = 'all' } = config;

      const optionExpiriesSet = new Set();
      const futureExpiriesSet = new Set();
      const expiriesSet = new Set();
      const strikesArr = [];
      const instrumentsObj = { options: [], futures: [], perpetual: [] };

      if (instrumentType === 'future' || instrumentType === 'all') {
        const futuresUrl = 'https://fapi.binance.com/fapi/v1/exchangeInfo';
        const futuresRes = await axios.get(futuresUrl);
        const futuresData = futuresRes.data?.symbols || [];

        futuresData.forEach(sym => {
          if (sym.status !== 'TRADING') return;
          
          if (sym.contractType === 'PERPETUAL' && sym.symbol === 'BTCUSDT') {
            instrumentsObj.perpetual.push(sym.symbol);
          } else if (sym.symbol.startsWith('BTCUSDT_')) {
            const parts = sym.symbol.split('_');
            if (parts.length === 2) {
              const expiry = parts[1];
              expiriesSet.add(expiry);
              futureExpiriesSet.add(expiry);
              instrumentsObj.futures.push(sym.symbol);
            }
          }
        });

        console.log(`✅ Binance futures: ${instrumentsObj.futures.length}, futureExpiries: ${futureExpiriesSet.size}`);
      }

      if (instrumentType === 'option' || instrumentType === 'all') {
        const optionsUrl = 'https://eapi.binance.com/eapi/v1/exchangeInfo';
        const optionsRes = await axios.get(optionsUrl);
        const optionsData = optionsRes.data?.optionSymbols || [];

        optionsData.forEach(opt => {
          if (opt.underlying === 'BTCUSDT') {
            const expiryDate = new Date(opt.expiryDate);
            const yy = String(expiryDate.getFullYear()).slice(2);
            const mm = String(expiryDate.getMonth() + 1).padStart(2, '0');
            const dd = String(expiryDate.getDate()).padStart(2, '0');
            const expiryStr = `${yy}${mm}${dd}`;

            expiriesSet.add(expiryStr);
            optionExpiriesSet.add(expiryStr);
            strikesArr.push(parseFloat(opt.strikePrice));
            instrumentsObj.options.push(opt.symbol);
          }
        });

        console.log(`✅ Binance options: ${instrumentsObj.options.length}`);
      }

      const metadata = {
        expiries: Array.from(expiriesSet).sort(),
        futureExpiries: Array.from(futureExpiriesSet).sort(),
        optionExpiries: Array.from(optionExpiriesSet).sort(),
        strikes: strikesArr.length > 0 
          ? { min: Math.min(...strikesArr), max: Math.max(...strikesArr) } 
          : { min: 0, max: 0 },
        instruments: instrumentsObj
      };

      this.onMetadata('binance', metadata);
      
      console.log(`✅ Binance metadata:`, {
        totalExpiries: metadata.expiries.length,
        futureExpiries: metadata.futureExpiries.length,
        optionExpiries: metadata.optionExpiries.length
      });

      return metadata;

    } catch (error) {
      console.error('Binance metadata fetch failed:', error.message);
      throw error;
    }
  }

  async subscribe(config) {
    let streams = [];
    const { instrumentType, expiry, strikeInterval, noPrtFolio, futureExpiry, strategy } = config;

    if (instrumentType === 'spot') {
      streams = ['btcusdt@ticker'];
      
    } else if (instrumentType === 'future') {
      console.log('🎯 Fetching Binance futures for C-F/F strategy...');
      
      const res = await axios.get('https://fapi.binance.com/fapi/v1/exchangeInfo');
      const allSymbols = res.data.symbols || [];
      
      const perpetual = allSymbols.find(s => 
        s.status === 'TRADING' && 
        s.symbol === 'BTCUSDT' && 
        s.contractType === 'PERPETUAL'
      );
      
      const quarterlyFutures = allSymbols.filter(s =>
        s.status === 'TRADING' &&
        s.symbol.startsWith('BTCUSDT_')
      );
      
      let futuresList = [];
      
      if (perpetual) {
        futuresList.push(perpetual.symbol);
      }
      
      if (futureExpiry && futureExpiry.trim() !== '') {
        const targetExpiry = futureExpiry.trim();
        const matchedFuture = quarterlyFutures.find(f => 
          f.symbol.endsWith(`_${targetExpiry}`)
        );
        
        if (matchedFuture) {
          futuresList.push(matchedFuture.symbol);
          console.log(`✅ Added specific future: ${matchedFuture.symbol}`);
        } else {
          console.log(`⚠️ Future expiry ${targetExpiry} not found`);
        }
      } else {
        futuresList.push(...quarterlyFutures.map(f => f.symbol));
        console.log(`✅ Added ${quarterlyFutures.length} futures (All Expiries mode)`);
      }

      console.log(`✅ Total C-F/F futures: ${futuresList.length}`);

      this.startFuturesPricePolling(futuresList);
      streams = futuresList.map(symbol => `${symbol.toLowerCase()}@ticker`);
    }
    else if (instrumentType === 'option') {
      try {
        const res = await axios.get('https://eapi.binance.com/eapi/v1/exchangeInfo');
        let options = (res.data.optionSymbols || [])
          .filter(s => s.underlying === 'BTCUSDT');

        if (expiry && expiry.trim()) {
          console.log(`🎯 Filtering options by expiry: ${expiry}`);
          options = options.filter(opt => {
            const expiryDate = new Date(opt.expiryDate);
            const yy = String(expiryDate.getFullYear()).slice(2);
            const mm = String(expiryDate.getMonth() + 1).padStart(2, '0');
            const dd = String(expiryDate.getDate()).padStart(2, '0');
            const expiryStr = `${yy}${mm}${dd}`;
            return expiryStr === expiry.trim();
          });
          console.log(`✅ After expiry filter: ${options.length} options`);
        }

        if (strikeInterval && noPrtFolio) {
          const spotPrice = this.currentSpotPrice || 60000;
          
          const interval = parseInt(strikeInterval);
          const nearestStrike = Math.round(spotPrice / interval) * interval;
          const portfolioCount = parseInt(noPrtFolio);
          
          const allowedStrikes = new Set();
          for (let i = -portfolioCount; i <= portfolioCount; i++) {
            allowedStrikes.add(nearestStrike + (i * interval));
          }
          
          console.log(`🎯 Binance strikes around ${spotPrice}: Nearest=${nearestStrike}`);
          
          options = options.filter(opt => {
            const strike = parseFloat(opt.strikePrice);
            return allowedStrikes.has(strike);
          });
          
          console.log(`🎯 After strike filter: ${options.length} options`);
        }

        // ✅ CRITICAL FIX: Use correct stream format for options
        streams = options.map(s => `${s.symbol}@ticker`);
        
        console.log('📋 Sample option streams:', streams.slice(0, 3));
        
        const strategyLower = (strategy || '').toLowerCase();
        if (strategyLower === 'jelly' || strategyLower === 'synthetic') {
          console.log(`🎯 Jelly/Synthetic detected, connecting futures`);
          this.connectFuturesForJelly(futureExpiry);
        }
        
      } catch (e) {
        console.error('Option fetch failed:', e.message);
      }
    }

    if (streams.length === 0) return;

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const CHUNK = 100;
      for (let i = 0; i < streams.length; i += CHUNK) {
        const slice = streams.slice(i, i + CHUNK);
        
        console.log(`📤 Subscribing chunk ${Math.floor(i/CHUNK) + 1}:`, slice.slice(0, 2));
        
        this.ws.send(JSON.stringify({
          method: "SUBSCRIBE",
          params: slice,
          id: 1 + Math.floor(i / CHUNK)
        }));
        slice.forEach(s => this.subscribedStreams.add(s));
        await new Promise(r => setTimeout(r, 100));
      }
      
      console.log(`📊 Subscribed to ${streams.length} Binance ${instrumentType}s via WebSocket`);
    }
  }

  startFuturesPricePolling(futuresList) {
    console.log('📊 Starting futures price polling via REST API...');
    
    const pollPrices = async () => {
      try {
        for (const symbol of futuresList) {
          // ✅ Use depth API for better bid/ask data
          const url = `https://fapi.binance.com/fapi/v1/depth?symbol=${symbol}&limit=5`;
          const res = await axios.get(url);
          
          if (res.data && res.data.bids && res.data.asks) {
            const bestBid = res.data.bids[0] ? parseFloat(res.data.bids[0][0]) : 0;
            const bestAsk = res.data.asks[0] ? parseFloat(res.data.asks[0][0]) : 0;
            
            const converted = {
              exchange: 'binance',
              type: 'future',
              instrument: symbol,
              last_price: ((bestBid + bestAsk) / 2).toFixed(2),
              best_bid_price: bestBid.toFixed(2),
              best_ask_price: bestAsk.toFixed(2),
              mark_price: ((bestBid + bestAsk) / 2).toFixed(2),
              min_price: '0',
              max_price: '0',
              volume: '0'
            };
            
            const normalizedKey = `binance_${symbol.toLowerCase()}`;
            this.onData(normalizedKey, converted);
          }
        }
      } catch (error) {
        console.error('❌ Futures price polling error:', error.message);
      }
    };
    
    pollPrices();
    this.pricePollingInterval = setInterval(pollPrices, 500);
    console.log('✅ Futures price polling started (500ms interval)');
  }

  connectFuturesForJelly(futureExpiry) {
    console.log('🎯 Connecting futures for Jelly/Synthetic...');
    
    const futuresList = ['BTCUSDT'];
    if (futureExpiry && futureExpiry.length === 6) {
      futuresList.push(`BTCUSDT_${futureExpiry}`);
    }
    
    this.startFuturesPricePolling(futuresList);
  }

  unsubscribeFromInstrument(instrument) {
    const symbol = instrument.toLowerCase();
    const streamName = `${symbol}@ticker`;
    
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        method: 'UNSUBSCRIBE',
        params: [streamName],
        id: Date.now()
      }));
      console.log(`Unsubscribed from ${streamName}`);
    }
  }

  handleMessage(message, type) {
    // Skip subscription confirmations
    if (message.result === null || message.id) return;
    
    // ✅ CRITICAL FIX: Handle Binance options WebSocket format
    // Options come in { stream: "...", data: {...} } format
    let actualData = message;
    if (message.stream && message.data) {
      actualData = message.data;
      console.log('📩 [OPTION DATA] Stream:', message.stream);
    }
    
    const symbol = actualData.s || actualData.symbol;
    if (!symbol) {
      console.log('⚠️ No symbol in message:', actualData);
      return;
    }
    
    const isOption = symbol.includes('-');
    let instrumentType = type;
    if (!type) {
      instrumentType = isOption ? 'option' : 'future';
    }
    
    // ✅ Parse different field names for options vs futures
    const lastPrice = parseFloat(
      actualData.c || actualData.lastPrice || actualData.p || 0
    );
    const bidPrice = parseFloat(
      actualData.bo || actualData.b || actualData.bidPrice || 0
    );
    const askPrice = parseFloat(
      actualData.ao || actualData.a || actualData.askPrice || 0
    );
    const markPrice = parseFloat(
      actualData.mp || actualData.markPrice || actualData.c || lastPrice || 0
    );
    const lowPrice = parseFloat(
      actualData.l || actualData.lowPrice || actualData.low || 0
    );
    const highPrice = parseFloat(
      actualData.h || actualData.highPrice || actualData.high || 0
    );
    const volume = parseFloat(
      actualData.V || actualData.v || actualData.volume || 0
    );
    
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
    
    // ✅ DEBUG: Log converted data for options
    if (isOption) {
      console.log('✅ [CONVERTED]:', symbol, 'Last:', lastPrice.toFixed(2));
    }
    
    this.onData(`binance_${symbol.toLowerCase()}`, converted);
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
    if (this.pricePollingInterval) {
      clearInterval(this.pricePollingInterval);
      this.pricePollingInterval = null;
      console.log('🛑 Stopped futures price polling');
    }
    this.subscribedStreams.clear();
    this.spotPriceReceived = false;
    this.currentSpotPrice = 0;
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
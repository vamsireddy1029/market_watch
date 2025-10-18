const WebSocket = require('ws');
const axios = require('axios');

class BybitConnector {
  constructor(onData, onMetadata) {
    this.ws = null;
    this.spotWs = null;
    this.isConnected = false;
    this.onData = onData;
    this.onMetadata = onMetadata;
    this.subscribedChannels = new Set();
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.spotPriceReceived = false;
    this.currentSpotPrice = 0;
    this.pendingConfig = null;
    this.pingInterval = null;
    this.pricePollingInterval = null;
    this.lastKnownValues = new Map();
  }

  async connect(config) {
    return new Promise((resolve, reject) => {
      try {
        const { instrumentType = 'all' } = config;
        let wsUrl = '';

        if (instrumentType === 'spot') {
          wsUrl = 'wss://stream.bybit.com/v5/public/spot';
        } else if (instrumentType === 'future') {
          wsUrl = 'wss://stream.bybit.com/v5/public/linear';
        } else if (instrumentType === 'option') {
          wsUrl = 'wss://stream.bybit.com/v5/public/option';
        } else {
          wsUrl = 'wss://stream.bybit.com/v5/public/linear';
        }

        console.log(`🔌 Connecting to Bybit ${instrumentType} at ${wsUrl}`);
        this.ws = new WebSocket(wsUrl);

        this.ws.on('open', async () => {
          this.isConnected = true;
          this.reconnectAttempts = 0;
          console.log(`✅ Bybit ${instrumentType} connected`);
          this.startPing();

          setTimeout(async () => {
            try {
              if (config.isMetadataFetch) {
                await this.fetchMetadata(config);
                resolve();
              } else {
                await this.subscribeToInstruments(config);
                resolve();
              }
            } catch (e) {
              reject(e);
            }
          }, 500);
        });

        this.ws.on('message', (raw) => {
          try {
            const message = JSON.parse(raw);
            if (message.op === 'pong') return;
            this.handleMessage(message);
          } catch (error) {
            console.error('Bybit parse error:', error?.message || error);
          }
        });

        this.ws.on('error', (error) => {
          console.error('Bybit error:', error?.message || error);
        });

        this.ws.on('close', () => {
          this.isConnected = false;
          this.cleanup();
          console.log('Bybit disconnected');
          if ((this.reconnectAttempts < this.maxReconnectAttempts) && !config?.isMetadataFetch) {
            this.reconnectAttempts++;
            console.log(`Reconnecting... attempt ${this.reconnectAttempts}`);
            setTimeout(() => this.connect(config).catch(e => console.error('Reconnect failed:', e)), 3000);
          }
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  startPing() {
    if (this.pingInterval) clearInterval(this.pingInterval);
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(JSON.stringify({ op: 'ping' }));
        } catch (e) {
          // ignore
        }
      }
    }, 20000);
  }

  async fetchMetadata(config = {}) {
    console.log('📊 Fetching Bybit metadata...', config);
    try {
      const { instrumentType = 'all' } = config;
      
      const futureExpiriesSet = new Set();
      const optionExpiriesSet = new Set();
      const strikesArr = [];
      const instrumentsObj = { options: [], futures: [], perpetual: [] };

      // ===== FETCH FUTURES =====
      if (instrumentType === 'future' || instrumentType === 'all') {
        const futuresUrl = 'https://api.bybit.com/v5/market/instruments-info';
        const futuresRes = await axios.get(futuresUrl, { params: { category: 'linear' } });
        const futuresData = futuresRes.data?.result?.list || [];

        futuresData.forEach(sym => {
          const symbol = sym.symbol || '';
          if (!symbol || !symbol.startsWith('BTC')) return;
          
          if (sym.contractType === 'LinearPerpetual' && symbol === 'BTCUSDT') {
            instrumentsObj.perpetual.push(symbol);
          } else if (symbol.includes('-') && symbol !== 'BTCUSDT') {
            const parts = symbol.split('-');
            if (parts.length >= 2) {
              const dateStr = parts[1];
              futureExpiriesSet.add(dateStr);
              instrumentsObj.futures.push(symbol);
            }
          }
        });

        console.log(`✅ Bybit futures: ${instrumentsObj.futures.length}, futureExpiries: ${futureExpiriesSet.size}`);
      }

      // ===== FETCH OPTIONS =====
      if (instrumentType === 'option' || instrumentType === 'all') {
        let allOptions = [];
        let cursor = '';
        let hasMore = true;
        
        console.log('📄 Fetching Bybit options with pagination...');
        
        while (hasMore) {
          const params = { category: 'option', baseCoin: 'BTC', limit: 1000 };
          if (cursor) params.cursor = cursor;
          
          const res = await axios.get('https://api.bybit.com/v5/market/instruments-info', { params });
          const data = res.data?.result || {};
          const batch = data.list || [];
          
          allOptions.push(...batch);
          
          cursor = data.nextPageCursor || '';
          hasMore = cursor && cursor !== '';
          
          console.log(`📄 Fetched ${batch.length} options (total: ${allOptions.length})`);
          
          if (hasMore) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        }

        allOptions.forEach(opt => {
          const sym = opt.symbol || '';
          if (!sym) return;
          
          const parts = sym.split('-');
          if (parts.length >= 2) {
            const expiryStr = parts[1];
            optionExpiriesSet.add(expiryStr);
          }
          
          if (parts.length >= 3) {
            const strikeRaw = parts[2].replace(/[^0-9.]/g, '');
            const strikeVal = parseFloat(strikeRaw);
            if (!isNaN(strikeVal)) strikesArr.push(strikeVal);
          }
          
          instrumentsObj.options.push(sym);
        });

        console.log(`✅ Bybit options: ${allOptions.length}, optionExpiries: ${optionExpiriesSet.size}`);
      }

      const metadata = {
        expiries: Array.from(optionExpiriesSet).sort(),
        futureExpiries: Array.from(futureExpiriesSet).sort(),
        optionExpiries: Array.from(optionExpiriesSet).sort(),
        strikes: strikesArr.length > 0 
          ? { min: Math.min(...strikesArr), max: Math.max(...strikesArr) } 
          : { min: 0, max: 0 },
        instruments: instrumentsObj
      };

      this.onMetadata && this.onMetadata('bybit', metadata);
      console.log('✅ Bybit metadata:', { 
        optionExpiries: metadata.optionExpiries.length, 
        futureExpiries: metadata.futureExpiries.length,
        options: instrumentsObj.options.length,
        futures: instrumentsObj.futures.length
      });
      
      return metadata;
    } catch (error) {
      console.error('Bybit metadata fetch failed:', error?.message || error);
      throw error;
    }
  }

  async subscribeToInstruments(config = {}) {
    const channels = [];
    const { instrumentType, expiry, strikeInterval, noPrtFolio, futureExpiry, strategy } = config;
    console.log('🔔 Bybit subscribe config:', JSON.stringify(config, null, 2));
    
    try {
      if (instrumentType === 'spot') {
        // ✅ Bybit doesn't have spot, use perpetual instead
        console.log('⚠️ Bybit spot requested, using perpetual (BTCUSDT) instead');
        channels.push('tickers.BTCUSDT');
      } 
      else if (instrumentType === 'future' || (strategy && strategy.toLowerCase() === 'c-f/f')) {
        console.log('🎯 Fetching Bybit futures...');
        const res = await axios.get('https://api.bybit.com/v5/market/instruments-info', { params: { category: 'linear' } });
        const allSymbols = res.data?.result?.list || [];

        const perpetual = allSymbols.find(s => s.symbol === 'BTCUSDT' && s.contractType === 'LinearPerpetual');
        const quarterlyFutures = allSymbols.filter(s => 
          s.symbol && 
          s.symbol.startsWith('BTCUSDT-') && 
          s.symbol !== 'BTCUSDT' &&
          /^BTCUSDT-\d{2}[A-Z]{3}\d{2}$/.test(s.symbol)
        );

        console.log(`📊 Found ${quarterlyFutures.length} quarterly futures`);

        const futuresList = [];
        
        // Always add perpetual
        if (perpetual) {
          futuresList.push(perpetual.symbol);
        }

        const strategyLower = (strategy || '').toLowerCase();
        if (strategyLower === 'c-f/f') {
          futuresList.push(...quarterlyFutures.map(f => f.symbol));
          console.log(`✅ Added ${quarterlyFutures.length} futures for C-F/F`);
        }
        else if (futureExpiry && futureExpiry.trim() !== '') {
          const targetExpiry = futureExpiry.trim().toUpperCase();
          const matched = quarterlyFutures.find(f => f.symbol.endsWith(`-${targetExpiry}`));
          if (matched) {
            futuresList.push(matched.symbol);
            console.log(`✅ Added specific future: ${matched.symbol}`);
          }
        }

        console.log(`✅ Total futures to subscribe: ${futuresList.length}`);
        this.startFuturesPricePolling(futuresList);

        futuresList.forEach(symbol => {
          channels.push(`tickers.${symbol}`);
        });
      } 
      else if (instrumentType === 'option') {
        let allOptions = [];
        let cursor = '';
        let hasMore = true;
        
        while (hasMore) {
          const params = { category: 'option', baseCoin: 'BTC', limit: 1000 };
          if (cursor) params.cursor = cursor;
          
          const res = await axios.get('https://api.bybit.com/v5/market/instruments-info', { params });
          const data = res.data?.result || {};
          const batch = data.list || [];
          
          allOptions.push(...batch);
          
          cursor = data.nextPageCursor || '';
          hasMore = cursor && cursor !== '';
          
          if (hasMore) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        }
        
        let options = allOptions;
        console.log(`🎯 Total Bybit options fetched: ${options.length}`);

        if (expiry && expiry.trim() !== '') {
          const expiryNorm = expiry.trim().toUpperCase();
          console.log(`🔍 Filtering for option expiry: ${expiryNorm}`);
          
          options = options.filter(opt => {
            if (typeof opt.symbol !== 'string') return false;
            const parts = opt.symbol.split('-');
            return parts.length >= 2 && parts[1].toUpperCase() === expiryNorm;
          });
          
          console.log(`🎯 After expiry filter (${expiryNorm}): ${options.length} options`);
        }

        // Get current spot price from perpetual
        const perpRes = await axios.get('https://api.bybit.com/v5/market/tickers', { 
          params: { category: 'linear', symbol: 'BTCUSDT' } 
        });
        const perpData = perpRes.data?.result?.list?.[0];
        const spotPrice = perpData ? parseFloat(perpData.lastPrice || 60000) : 60000;
        console.log(`📊 Using spot price: ${spotPrice}`);

        if (strikeInterval && noPrtFolio) {
          const interval = parseInt(strikeInterval, 10);
          const portfolioCount = parseInt(noPrtFolio, 10);
          
          if (!isNaN(interval) && interval > 0 && !isNaN(portfolioCount) && portfolioCount > 0) {
            const nearestStrike = Math.round(spotPrice / interval) * interval;
            
            const allowedStrikes = new Set();
            for (let i = -portfolioCount; i <= portfolioCount; i++) {
              allowedStrikes.add(nearestStrike + (i * interval));
            }
            
            console.log(`🎯 Strike filter: Spot=${spotPrice}, Nearest=${nearestStrike}, Interval=${interval}, Count=${portfolioCount}`);
            
            options = options.filter(opt => {
              const parts = opt.symbol.split('-');
              if (parts.length < 3) return false;
              
              const strikeRaw = parts[2].replace(/[^0-9]/g, '');
              const strikeVal = parseInt(strikeRaw, 10);
              
              return allowedStrikes.has(strikeVal);
            });
            
            console.log(`🎯 After strike filter: ${options.length} options`);
          }
        } else if (config.startStrike && config.gap && config.entryCount) {
          const start = parseInt(config.startStrike, 10);
          const gap = parseInt(config.gap, 10);
          const count = parseInt(config.entryCount, 10);
          
          if (!isNaN(start) && !isNaN(gap) && !isNaN(count) && gap > 0 && count > 0) {
            const allowedStrikes = new Set();
            for (let i = 0; i < count; i++) {
              allowedStrikes.add(start + (i * gap));
            }
            
            console.log(`🎯 Manual strike filter: Start=${start}, Gap=${gap}, Count=${count}`);
            
            options = options.filter(opt => {
              const parts = opt.symbol.split('-');
              if (parts.length < 3) return false;
              
              const strikeRaw = parts[2].replace(/[^0-9]/g, '');
              const strikeVal = parseInt(strikeRaw, 10);
              
              return allowedStrikes.has(strikeVal);
            });
            
            console.log(`🎯 After manual strike filter: ${options.length} options`);
          }
        }

        options.forEach(opt => {
          if (!opt || !opt.symbol) return;
          const topic = `tickers.${opt.symbol}`;
          if (!this.subscribedChannels.has(topic)) channels.push(topic);
        });

        const strategyLower = (strategy || '').toLowerCase();
        if (strategyLower === 'jelly' || strategyLower === 'synthetic') {
          console.log('🎯 Jelly/Synthetic detected, connecting futures');
          this.connectFuturesForJelly(futureExpiry);
        }
      }

      if (channels.length === 0) {
        console.log('⚠️ No channels to subscribe!');
        return;
      }

      console.log(`📊 Total channels to subscribe: ${channels.length}`);
      this.batchSubscribe(channels);
    } catch (error) {
      console.error('❌ Bybit subscribe failed:', error?.message || error);
    }
  }

  batchSubscribe(channels) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('WebSocket is not open; cannot subscribe right now.');
      return;
    }

    const CHUNK = 10;
    for (let i = 0; i < channels.length; i += CHUNK) {
      const slice = channels.slice(i, i + CHUNK);
      try {
        this.ws.send(JSON.stringify({ op: 'subscribe', args: slice }));
      } catch (e) {
        console.error('Subscribe send failed:', e?.message || e);
      }
      slice.forEach(ch => this.subscribedChannels.add(ch));
    }
    console.log(`✅ Subscribed to ${this.subscribedChannels.size} Bybit channels`);
  }

  startFuturesPricePolling(futuresList) {
    if (!Array.isArray(futuresList) || futuresList.length === 0) {
      console.warn('No futures to poll for prices.');
      return;
    }

    console.log('📊 Starting Bybit futures price polling via REST API...');
    const pollPrices = async () => {
      try {
        for (const symbol of futuresList) {
          try {
            const url = 'https://api.bybit.com/v5/market/tickers';
            const res = await axios.get(url, { params: { category: 'linear', symbol } });
            const data = res.data?.result?.list?.[0];
            if (data) {
              const converted = {
                exchange: 'bybit',
                type: 'future',
                instrument: symbol,
                last_price: parseFloat(data.lastPrice || 0).toFixed(2),
                best_bid_price: parseFloat(data.bid1Price || 0).toFixed(2),
                best_ask_price: parseFloat(data.ask1Price || 0).toFixed(2),
                mark_price: parseFloat(data.markPrice || data.lastPrice || 0).toFixed(2),
                min_price: parseFloat(data.lowPrice24h || 0).toFixed(2),
                max_price: parseFloat(data.highPrice24h || 0).toFixed(2),
                volume: parseFloat(data.volume24h || 0).toFixed(2)
              };
              
              const normalizedKey = `bybit_${symbol}`;
              this.updateWithCaching(normalizedKey, converted);
            }
          } catch (innerErr) {
            // Silence per-symbol errors
          }
        }
      } catch (error) {
        console.error('❌ Bybit futures price polling error:', error?.message || error);
      }
    };

    pollPrices();
    if (this.pricePollingInterval) clearInterval(this.pricePollingInterval);
    this.pricePollingInterval = setInterval(pollPrices, 500);
    console.log('✅ Bybit futures price polling started (500ms interval)');
  }

  connectFuturesForJelly(futureExpiry) {
    console.log('🎯 Connecting Bybit futures for Jelly/Synthetic...');
    const futuresList = ['BTCUSDT'];
    if (futureExpiry && typeof futureExpiry === 'string' && futureExpiry.length >= 5) {
      futuresList.push(`BTCUSDT-${futureExpiry}`);
    }
    this.startFuturesPricePolling(futuresList);
  }

  updateWithCaching(key, newData) {
    const lastData = this.lastKnownValues.get(key);
    
    if (!lastData) {
      this.lastKnownValues.set(key, newData);
      this.onData && this.onData(key, newData);
      return;
    }

    const mergedData = {
      exchange: newData.exchange,
      type: newData.type,
      instrument: newData.instrument,
      last_price: parseFloat(newData.last_price) > 0 ? newData.last_price : lastData.last_price,
      best_bid_price: parseFloat(newData.best_bid_price) > 0 ? newData.best_bid_price : lastData.best_bid_price,
      best_ask_price: parseFloat(newData.best_ask_price) > 0 ? newData.best_ask_price : lastData.best_ask_price,
      mark_price: parseFloat(newData.mark_price) > 0 ? newData.mark_price : lastData.mark_price,
      min_price: parseFloat(newData.min_price) > 0 ? newData.min_price : lastData.min_price,
      max_price: parseFloat(newData.max_price) > 0 ? newData.max_price : lastData.max_price,
      volume: parseFloat(newData.volume) > 0 ? newData.volume : lastData.volume
    };

    this.lastKnownValues.set(key, mergedData);
    this.onData && this.onData(key, mergedData);
  }

  handleMessage(message, forcedType) {
    try {
      if (!message || message.op === 'pong' || message.success === true) return;

      const topic = message.topic || message.arg?.channel || null;
      const data = message.data || (Array.isArray(message.result) ? message.result[0] : message.result) || null;

      if (!data && !message.result) return;

      let symbol = data?.symbol || data?.s || message.arg?.symbol || null;
      if (!symbol && typeof topic === 'string') {
        const parts = topic.split('.');
        symbol = parts.length > 1 ? parts.slice(1).join('.') : null;
      }
      if (!symbol) return;

      const upperSymbol = symbol.toUpperCase();
      
      let cleanSymbol = upperSymbol;
      if (cleanSymbol.endsWith('-USDT')) {
        cleanSymbol = cleanSymbol.slice(0, -5);
      }
      
      const isOption = /^BTC-\d{1,2}[A-Z]{3}\d{2,4}-\d{3,6}-[CP]$/i.test(cleanSymbol);
      const isFuture = /^BTCUSDT-\d{2}[A-Z]{3}\d{2}$/i.test(upperSymbol);
      const isSpotOrderbook = topic && topic.startsWith('orderbook.');
      
      let instrumentType;
      if (forcedType) {
        instrumentType = forcedType;
      } else if (isSpotOrderbook) {
        instrumentType = 'spot';
      } else if (isOption) {
        instrumentType = 'option';
      } else if (isFuture) {
        instrumentType = 'future';
      } else {
        instrumentType = upperSymbol === 'BTCUSDT' ? 'future' : 'spot';
      }

      const payload = Array.isArray(data) ? (data[0] || {}) : (data || {});

      let bestBid, bestAsk, lastPrice;

      if (isSpotOrderbook) {
        bestBid = (payload.b && Array.isArray(payload.b) && payload.b[0]) 
          ? parseFloat(payload.b[0][0]) 
          : 0;
        bestAsk = (payload.a && Array.isArray(payload.a) && payload.a[0]) 
          ? parseFloat(payload.a[0][0]) 
          : 0;
        lastPrice = bestBid > 0 && bestAsk > 0 ? (bestBid + bestAsk) / 2 : 0;
      } else {
        bestBid = parseFloat(payload.bid1Price ?? payload.bidPrice ?? payload.best_bid_price ?? 0);
        bestAsk = parseFloat(payload.ask1Price ?? payload.askPrice ?? payload.best_ask_price ?? 0);
        lastPrice = parseFloat(payload.lastPrice ?? payload.last ?? 0);
      }

      const markPrice = parseFloat(payload.markPrice ?? lastPrice);
      const lowPrice = parseFloat(payload.lowPrice24h ?? payload.min_price ?? 0);
      const highPrice = parseFloat(payload.highPrice24h ?? payload.max_price ?? 0);
      const volume = parseFloat(payload.volume24h ?? payload.volume ?? 0);

      const converted = {
        exchange: 'bybit',
        type: instrumentType,
        instrument: cleanSymbol,
        last_price: Number.isFinite(lastPrice) ? lastPrice.toFixed(2) : '0.00',
        best_bid_price: Number.isFinite(bestBid) ? bestBid.toFixed(2) : '0.00',
        best_ask_price: Number.isFinite(bestAsk) ? bestAsk.toFixed(2) : '0.00',
        mark_price: Number.isFinite(markPrice) ? markPrice.toFixed(2) : '0.00',
        min_price: Number.isFinite(lowPrice) ? lowPrice.toFixed(2) : '0.00',
        max_price: Number.isFinite(highPrice) ? highPrice.toFixed(2) : '0.00',
        volume: Number.isFinite(volume) ? volume.toFixed(2) : '0.00'
      };

      const normalizedKey = `bybit_${cleanSymbol}`;
      this.updateWithCaching(normalizedKey, converted);

    } catch (err) {
      console.error('Error in handleMessage:', err?.message || err);
    }
  }

  unsubscribeFromInstrument(instrument) {
    if (!instrument) return;
    const topic = `tickers.${instrument}`;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify({ op: 'unsubscribe', args: [topic] }));
        console.log(`Unsubscribed from ${topic}`);
      } catch (e) {
        console.error('Unsubscribe failed:', e?.message || e);
      }
    }
    this.subscribedChannels.delete(topic);
  }

  cleanup() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.pricePollingInterval) {
      clearInterval(this.pricePollingInterval);
      this.pricePollingInterval = null;
    }
    this.subscribedChannels.clear();
    this.spotPriceReceived = false;
    this.currentSpotPrice = 0;
    this.pendingConfig = null;
    this.lastKnownValues.clear();
  }

  disconnect() {
    this.cleanup();
    [this.ws, this.spotWs].forEach(ws => {
      if (ws) {
        try {
          if (ws.readyState === WebSocket.OPEN) ws.close();
          else if (typeof ws.terminate === 'function') ws.terminate();
        } catch (e) {
          // ignore
        }
      }
    });
    this.ws = null;
    this.spotWs = null;
    this.isConnected = false;
  }
}

module.exports = BybitConnector;
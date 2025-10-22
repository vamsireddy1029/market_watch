const WebSocket = require('ws');

class DeribitConnector {
  constructor(onData, onMetadata) {
    this.ws = null;
    this.onData = onData;
    this.onMetadata = onMetadata;
    this.spotPrice = 0;
    this.symbol = 'BTC';
    this.pendingRequests = new Map();
    this.requestId = 1;
    this.heartbeatInterval = null;
    this.reconnectTimer = null;
    this.isConnecting = false;
    this.shouldReconnect = true;
    this.lastMessageTime = Date.now();
    this.subscribedChannels = [];
    this.connectionAttempts = 0;
    this.maxReconnectAttempts = 10;
  }

  async connect(config = {}) {
    const {
      isMetadataFetch = false,
      instrumentType = 'all',
      expiry = null,
      strikeInterval = 1000,
      noPrtFolio = 10,
      strategy = '',
      symbol = 'BTC',
      subscribeAllFutures = false,
      futureExpiry = null,
      fut1Expiry = null,
      fut2Expiry = null
    } = config;

    this.symbol = symbol.toUpperCase();
    this.config = config;
    this.shouldReconnect = !isMetadataFetch; // Only reconnect for live streaming
    
    console.log(`🔌 Connecting Deribit for ${this.symbol}...`);
    console.log(`📋 Config:`, JSON.stringify(config, null, 2));
    
    return new Promise((resolve, reject) => {
      if (this.isConnecting) {
        console.log('⚠️ Connection already in progress');
        return;
      }

      this.isConnecting = true;
      this.ws = new WebSocket('wss://www.deribit.com/ws/api/v2');
      
      // Set connection timeout
      const connectTimeout = setTimeout(() => {
        if (this.ws.readyState !== WebSocket.OPEN) {
          console.error('❌ Connection timeout');
          this.ws.close();
          reject(new Error('Connection timeout'));
        }
      }, 15000);
      
      this.ws.on('open', async () => {
        clearTimeout(connectTimeout);
        this.isConnecting = false;
        this.connectionAttempts = 0;
        console.log(`✅ Deribit ${this.symbol} connected`);
        
        // Start heartbeat immediately
        this.startHeartbeat();
        
        try {
          // Step 1: Subscribe to perpetual for spot price
          console.log(`📊 Step 1: Subscribing to ${this.symbol}-PERPETUAL for spot price...`);
          this.send({
            jsonrpc: '2.0',
            id: 9929,
            method: 'public/subscribe',
            params: {
              channels: [`ticker.${this.symbol}-PERPETUAL.100ms`]
            }
          });
          
          this.subscribedChannels.push(`ticker.${this.symbol}-PERPETUAL.100ms`);
          
          // Wait for perpetual data
          await this.waitForSpotPrice();
          console.log(`✅ ${this.symbol} spot price received: ${this.spotPrice}`);
          
          // Step 2: Fetch and subscribe to instruments
          await this.subscribeToInstruments({
            isMetadataFetch,
            instrumentType,
            expiry,
            strikeInterval,
            noPrtFolio,
            strategy,
            subscribeAllFutures,
            futureExpiry,
            fut1Expiry,
            fut2Expiry
          });
          
          resolve();
        } catch (error) {
          console.error(`❌ Deribit ${this.symbol} connection error:`, error);
          reject(error);
        }
      });
      
      this.ws.on('message', (data) => {
        this.lastMessageTime = Date.now();
        try {
          const message = JSON.parse(data);
          this.handleMessage(message);
        } catch (error) {
          console.error('❌ Message parse error:', error);
        }
      });
      
      this.ws.on('error', (error) => {
        clearTimeout(connectTimeout);
        console.error(`❌ Deribit ${this.symbol} WebSocket error:`, error);
        this.isConnecting = false;
      });
      
      this.ws.on('close', (code, reason) => {
        clearTimeout(connectTimeout);
        this.isConnecting = false;
        console.log(`❌ Deribit ${this.symbol} disconnected (code: ${code}, reason: ${reason})`);
        this.stopHeartbeat();
        
        // Attempt reconnection if needed
        if (this.shouldReconnect && this.connectionAttempts < this.maxReconnectAttempts) {
          this.scheduleReconnect();
        }
      });
    });
  }

  startHeartbeat() {
    // Clear any existing heartbeat
    this.stopHeartbeat();
    
    // Send heartbeat every 15 seconds (Deribit requires < 60s)
    this.heartbeatInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        // Check if we've received messages recently
        const timeSinceLastMessage = Date.now() - this.lastMessageTime;
        
        if (timeSinceLastMessage > 30000) {
          console.warn(`⚠️ No messages received for ${Math.floor(timeSinceLastMessage / 1000)}s, connection may be dead`);
          
         
          if (timeSinceLastMessage > 10000) {
            console.error('❌ Connection appears dead, forcing reconnect...');
            this.forceReconnect();
            return;
          }
        }
        
        // Send test request to check connection
        this.send({
          jsonrpc: '2.0',
          id: 9999,
          method: 'public/test'
        });
        
        console.log(`💓 Heartbeat sent for ${this.symbol} (last message: ${Math.floor(timeSinceLastMessage / 1000)}s ago)`);
      } else {
        console.warn('⚠️ WebSocket not open during heartbeat');
        this.stopHeartbeat();
      }
    }, 15000);
    
    console.log(`💓 Heartbeat started for ${this.symbol}`);
  }

  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
      console.log(`💔 Heartbeat stopped for ${this.symbol}`);
    }
  }

  scheduleReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    
    this.connectionAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.connectionAttempts - 1), 30000); // Exponential backoff, max 30s
    
    console.log(`🔄 Scheduling reconnect attempt ${this.connectionAttempts}/${this.maxReconnectAttempts} in ${delay}ms...`);
    
    this.reconnectTimer = setTimeout(() => {
      console.log(`🔄 Reconnecting ${this.symbol}...`);
      this.connect(this.config).catch(err => {
        console.error(`❌ Reconnection failed:`, err);
      });
    }, delay);
  }

  forceReconnect() {
    console.log(`🔄 Force reconnecting ${this.symbol}...`);
    this.shouldReconnect = true;
    
    if (this.ws) {
      this.ws.close();
    }
    
    // Reset and reconnect
    setTimeout(() => {
      this.connect(this.config).catch(err => {
        console.error(`❌ Force reconnection failed:`, err);
      });
    }, 1000);
  }

  async subscribeToInstruments(config) {
    const {
      isMetadataFetch,
      instrumentType,
      expiry,
      strikeInterval,
      noPrtFolio,
      strategy,
      subscribeAllFutures = false,
      futureExpiry,
      fut1Expiry,
      fut2Expiry
    } = config;
    
    console.log(`🔔 Subscribing for ${this.symbol} instruments with config:`, JSON.stringify(config, null, 2));
    
    try {
      // Fetch instruments from Deribit
      const response = await this.request({
        jsonrpc: '2.0',
        id: 7617,
        method: 'public/get_instruments',
        params: {
          currency: this.symbol,
          kind: instrumentType === 'future' ? 'future' : (instrumentType === 'option' ? 'option' : undefined),
          expired: false
        }
      });
      
      if (!response || !response.result) {
        console.error(`❌ No instruments response for ${this.symbol}`);
        return;
      }
      
      let instruments = response.result;
      console.log(`📊 Total ${this.symbol} ${instrumentType} instruments fetched: ${instruments.length}`);
      
      // METADATA FETCH MODE - Store all and return
      if (isMetadataFetch) {
        this.storeMetadata(instruments, instrumentType);
        return;
      }
      
      // FUTURE INSTRUMENT HANDLING
      if (instrumentType === 'future') {
        instruments = instruments.filter(i => !i.instrument_name.includes('PERPETUAL'));
        console.log(`📊 ${this.symbol} non-perpetual futures: ${instruments.length}`);
        
        // CASE 1: C-F/F Strategy with ALL EXPIRIES mode
        if (subscribeAllFutures || 
            (strategy && strategy.toLowerCase() === 'c-f/f' && 
             (!fut1Expiry || fut1Expiry === 'all' || !fut2Expiry || fut2Expiry === 'all'))) {
          
          console.log(`🌐 C-F/F ALL MODE: Subscribing to ALL ${this.symbol} futures`);
          
          const futureInstruments = instruments.filter(i => i.instrument_name.startsWith(this.symbol));
          console.log(`🎯 Found ${futureInstruments.length} total futures for ${this.symbol}`);
          
          const channels = futureInstruments.map(inst => `ticker.${inst.instrument_name}.100ms`);
          
          if (channels.length > 0) {
            await this.subscribeInBatches(channels);
            this.subscribedChannels.push(...channels);
            console.log(`✅ Subscribed to ${channels.length} ${this.symbol} future channels`);
          }
          
          return;
        }
        
        // CASE 2: C-F/F with specific expiries
        if (strategy && strategy.toLowerCase() === 'c-f/f') {
          const expiriesToSubscribe = new Set();
          
          if (fut1Expiry && fut1Expiry !== 'all' && fut1Expiry !== 'perpetual') {
            expiriesToSubscribe.add(fut1Expiry);
          }
          if (fut2Expiry && fut2Expiry !== 'all') {
            expiriesToSubscribe.add(fut2Expiry);
          }
          
          if (expiriesToSubscribe.size > 0) {
            console.log(`🎯 C-F/F SPECIFIC MODE: Subscribing to expiries:`, Array.from(expiriesToSubscribe));
            instruments = instruments.filter(i => {
              return Array.from(expiriesToSubscribe).some(exp => i.instrument_name.includes(exp));
            });
            console.log(`🎯 After expiry filter: ${instruments.length} futures`);
          }
        }
        
        // CASE 3: Jelly/Synthetic with specific future expiry
        else if (expiry || futureExpiry) {
          const targetExpiry = expiry || futureExpiry;
          console.log(`🎯 Filtering for specific expiry: ${targetExpiry}`);
          instruments = instruments.filter(i => i.instrument_name.includes(targetExpiry));
          console.log(`🎯 After expiry filter (${targetExpiry}): ${instruments.length} futures`);
        }
        
        // Subscribe to filtered futures
        const channels = instruments.map(inst => `ticker.${inst.instrument_name}.100ms`);
        
        if (channels.length > 0) {
          console.log(`📊 Subscribing to ${channels.length} ${this.symbol} future channels`);
          await this.subscribeInBatches(channels);
          this.subscribedChannels.push(...channels);
          console.log(`✅ Subscribed to ${channels.length} ${this.symbol} future channels`);
        }
        
        return;
      }
      
      // OPTION INSTRUMENT HANDLING
      if (instrumentType === 'option') {
        if (expiry) {
          instruments = instruments.filter(i => i.instrument_name.includes(expiry));
          console.log(`🎯 After expiry filter (${expiry}): ${instruments.length} ${this.symbol} options`);
        }
        
        if (this.spotPrice > 0) {
          const interval = parseInt(strikeInterval) || (this.symbol === 'ETH' ? 50 : 1000);
          const nearestStrike = Math.round(this.spotPrice / interval) * interval;
          const portfolioCount = parseInt(noPrtFolio) || 10;
          const minStrike = nearestStrike - (portfolioCount * interval);
          const maxStrike = nearestStrike + (portfolioCount * interval);
          
          console.log(`🎯 Strike range for ${this.symbol}: ${minStrike} - ${maxStrike}`);
          
          instruments = instruments.filter(i => {
            const match = i.instrument_name.match(/-(\d+)-[CP]$/);
            if (match) {
              const strike = parseInt(match[1]);
              return strike >= minStrike && strike <= maxStrike;
            }
            return false;
          });
          
          console.log(`🎯 After strike filter: ${instruments.length} ${this.symbol} options`);
        }
        
        const channels = instruments.map(inst => `ticker.${inst.instrument_name}.100ms`);
        
        if (channels.length > 0) {
          console.log(`📊 Subscribing to ${channels.length} ${this.symbol} option channels`);
          await this.subscribeInBatches(channels);
          this.subscribedChannels.push(...channels);
          console.log(`✅ Subscribed to ${channels.length} ${this.symbol} option channels`);
        }
      }
      
    } catch (error) {
      console.error(`❌ Subscribe error for ${this.symbol}:`, error);
    }
  }

  storeMetadata(instruments, instrumentType) {
    const expiries = new Set();
    const futureExpiries = new Set();
    const optionExpiries = new Set();
    const strikes = { min: Infinity, max: -Infinity };
    
    instruments.forEach(inst => {
      const name = inst.instrument_name;
      
      const expiryMatch = name.match(/-(\d{1,2}[A-Z]{3}\d{2})/);
      if (expiryMatch && !name.includes('PERPETUAL')) {
        const expiry = expiryMatch[1];
        expiries.add(expiry);
        
        if (instrumentType === 'future' || name.includes('-') && !name.match(/-[CP]$/)) {
          futureExpiries.add(expiry);
        }
        
        if (name.match(/-[CP]$/)) {
          optionExpiries.add(expiry);
        }
      }
      
      const strikeMatch = name.match(/-(\d+)-[CP]$/);
      if (strikeMatch) {
        const strike = parseInt(strikeMatch[1]);
        strikes.min = Math.min(strikes.min, strike);
        strikes.max = Math.max(strikes.max, strike);
      }
    });
    
    const metadata = {
      expiries: Array.from(expiries).sort(),
      futureExpiries: Array.from(futureExpiries).sort(),
      optionExpiries: Array.from(optionExpiries).sort(),
      strikes: strikes.min !== Infinity ? strikes : { min: 0, max: 0 },
      instruments: {
        options: instruments.filter(i => i.instrument_name.match(/-[CP]$/)).length,
        futures: instruments.filter(i => !i.instrument_name.includes('PERPETUAL') && !i.instrument_name.match(/-[CP]$/)).length,
        perpetual: instruments.filter(i => i.instrument_name.includes('PERPETUAL')).length
      }
    };
    
    console.log(`✅ ${this.symbol} metadata:`, {
      optionExpiries: metadata.optionExpiries.length,
      futureExpiries: metadata.futureExpiries.length,
      options: metadata.instruments.options,
      futures: metadata.instruments.futures
    });
    
    if (this.onMetadata) {
      this.onMetadata('deribit', metadata);
    }
  }

  async subscribeInBatches(channels, batchSize = 50) {
    for (let i = 0; i < channels.length; i += batchSize) {
      const batch = channels.slice(i, i + batchSize);
      
      await this.request({
        jsonrpc: '2.0',
        id: this.requestId++,
        method: 'public/subscribe',
        params: { channels: batch }
      });
      
      if (i + batchSize < channels.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
  }

  waitForSpotPrice() {
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        if (this.spotPrice > 0) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 100);
      
      setTimeout(() => {
        clearInterval(checkInterval);
        if (this.spotPrice === 0) {
          console.warn(`⚠️ ${this.symbol} spot price timeout, using default`);
          this.spotPrice = this.symbol === 'ETH' ? 3800 : 100000;
        }
        resolve();
      }, 10000);
    });
  }

  handleMessage(message) {
    // Handle JSON-RPC responses
    if (message.id && this.pendingRequests.has(message.id)) {
      const { resolve } = this.pendingRequests.get(message.id);
      resolve(message);
      this.pendingRequests.delete(message.id);
      return;
    }
    
    // Handle subscription updates
    if (message.params && message.params.channel && message.params.data) {
      const channel = message.params.channel;
      const data = message.params.data;
      
      const instrumentMatch = channel.match(/ticker\.([^.]+)\./);
      if (!instrumentMatch) return;
      
      const instrument = instrumentMatch[1];
      
      // Update spot price from perpetual
      if (instrument.includes('PERPETUAL')) {
        const mid = (parseFloat(data.best_bid_price) + parseFloat(data.best_ask_price)) / 2;
        if (mid > 0) {
          this.spotPrice = mid;
        }
      }
      
      const parts = instrument.split("-");
      const isOption = parts.length === 4;
      const priceFactor = isOption ? (data.underlying_price || 1) : 1;

      // Format and send market data
      const marketData = {
        instrument: instrument,
        last_price: (data.last_price * priceFactor).toFixed(2),
        best_bid_price: (data.best_bid_price * priceFactor).toFixed(2),
        best_ask_price: (data.best_ask_price * priceFactor).toFixed(2),
        mark_price: (data.mark_price * priceFactor).toFixed(2),
        min_price: (data.min_price * priceFactor).toFixed(2),
        max_price: (data.max_price * priceFactor).toFixed(2),
        volume: data.stats?.volume || 0,
        timestamp: data.timestamp
      };
      
      if (this.onData) {
        this.onData(instrument, marketData);
      }
    }
  }

  send(message) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      console.warn(`⚠️ Cannot send message, WebSocket not open (state: ${this.ws?.readyState})`);
    }
  }

  request(message) {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('WebSocket not connected'));
        return;
      }
      
      const id = message.id || this.requestId++;
      message.id = id;
      
      this.pendingRequests.set(id, { resolve, reject });
      
      this.send(message);
      
      // Timeout after 30 seconds and clean up
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error('Request timeout'));
        }
      }, 30000);
    });
  }

  disconnect() {
    console.log(`🛑 Disconnecting ${this.symbol}...`);
    this.shouldReconnect = false;
    this.stopHeartbeat();
    
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    
    this.pendingRequests.clear();
    this.subscribedChannels = [];
  }
}

module.exports = DeribitConnector;
const WebSocket = require('ws');
const axios = require('axios');

class DeribitConnector {
  constructor(onData, onMetadata) {
    this.ws = null;
    this.isConnected = false;
    this.onData = onData;
    this.onMetadata = onMetadata;
    this.subscribedChannels = new Set();
    this.metadataTimer = null;
    this.heartbeatInterval = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.spotPriceReceived = false;
    this.pendingConfig = null;
  }

  async connect(config) {
    return new Promise((resolve, reject) => {
      const wsUrl = 'wss://www.deribit.com/ws/api/v2';
      this.ws = new WebSocket(wsUrl);

      this.ws.on('open', () => {
        this.isConnected = true;
        this.reconnectAttempts = 0;
        console.log('✅ Deribit connected');

        this.authenticate();
        this.startHeartbeat();

        setTimeout(() => {
          if (config.isMetadataFetch) {
            this.fetchMetadata(config);
            resolve();
          } else {
            this.subscribeToSpotFirst(config).then(resolve);
          }
        }, 500);
      });

      this.ws.on('message', (data) => {
        try {
          const message = JSON.parse(data);
          this.handleMessage(message);
        } catch (error) {
          console.error('Deribit parse error:', error);
        }
      });

      this.ws.on('error', (error) => {
        console.error('Deribit error:', error.message);
      });

      this.ws.on('close', () => {
        this.isConnected = false;
        this.cleanup();
        console.log('Deribit disconnected');

        if (this.reconnectAttempts < this.maxReconnectAttempts && !config.isMetadataFetch) {
          this.reconnectAttempts++;
          console.log(`Reconnecting... attempt ${this.reconnectAttempts}`);
          setTimeout(() => this.connect(config), 3000);
        }
      });
    });
  }

  authenticate() {
    this.send({
      jsonrpc: "2.0",
      id: 1,
      method: "public/hello",
      params: { client_name: "trading-dashboard", client_version: "1.0" }
    });
  }

  startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      if (this.isConnected) {
        this.send({ jsonrpc: "2.0", id: 999, method: "public/test" });
      }
    }, 30000);
  }

  async fetchMetadata(config) {
  console.log('📊 Fetching Deribit metadata...', config);

  try {
    const symbol = config.symbol?.toUpperCase() || 'BTC';  // ✅ ADD THIS
    const currencies = [symbol];  // ✅ CHANGE THIS from ['BTC', 'ETH']
    const expiriesSet = new Set();
    const futureExpiriesSet = new Set();
    const optionExpiriesSet = new Set();
    const strikesArr = [];
    const instrumentsObj = { options: [], futures: [], perpetual: [] };

    const { instrumentType = 'all' } = config;

    for (const currency of currencies) {
      console.log(`📡 Fetching instruments for ${currency}...`);

        // ✅ Futures
        const futuresRes = await axios.get('https://www.deribit.com/api/v2/public/get_instruments', {
          params: { currency, kind: 'future', expired: false }
        });
        const futures = futuresRes.data.result || [];

        futures.forEach(fut => {
          instrumentsObj.futures.push(fut.instrument_name);
          if (fut.settlement_period !== 'perpetual') {
            const parts = fut.instrument_name.split('-');
            if (parts.length >= 2) {
              const expiry = parts[1];
              expiriesSet.add(expiry);
              futureExpiriesSet.add(expiry);
            }
          } else {
            instrumentsObj.perpetual.push(fut.instrument_name);
          }
        });

        // ✅ Options
        if (instrumentType === 'option' || instrumentType === 'all') {
          const optionsRes = await axios.get('https://www.deribit.com/api/v2/public/get_instruments', {
            params: { currency, kind: 'option', expired: false }
          });
          const options = optionsRes.data.result || [];

          options.forEach(opt => {
            const date = new Date(opt.expiration_timestamp);
            const day = date.getDate();
            const month = date.toLocaleString('en-US', { month: 'short' }).toUpperCase();
            const year = String(date.getFullYear()).slice(2);
            const dateStr = `${day}${month}${year}`;
            expiriesSet.add(dateStr);
            optionExpiriesSet.add(dateStr);
            strikesArr.push(opt.strike);
            instrumentsObj.options.push(opt.instrument_name);
          });

          console.log(`✅ ${currency} options: ${options.length}`);
        }
      }

      const metadata = {
        expiries: Array.from(expiriesSet).sort(),
        futureExpiries: Array.from(futureExpiriesSet).sort(),
        optionExpiries: Array.from(optionExpiriesSet).sort(),
        strikes: strikesArr.length > 0 ? { min: Math.min(...strikesArr), max: Math.max(...strikesArr) } : { min: 0, max: 0 },
        instruments: instrumentsObj
      };

      this.onMetadata('deribit', metadata);
      console.log(`✅ Metadata fetched for BTC + ETH`);
      return metadata;

    } catch (error) {
      console.error('Deribit metadata fetch failed:', error.message);
      throw error;
    }
  }

  async subscribeToSpotFirst(config) {
    console.log('📊 Step 1: Subscribing to BTC-PERPETUAL for spot price...');
    
    this.pendingConfig = config;
    this.spotPriceReceived = false;

    const base = config.symbol?.toUpperCase() || 'BTC';  // ✅ KEEP THIS
    console.log(`📊 Step 1: Subscribing to ${base}-PERPETUAL for spot price...`);
  
  this.pendingConfig = config;
  this.spotPriceReceived = false;

  const spotSymbol = `${base}-PERPETUAL`;
    
    this.send({
      jsonrpc: "2.0",
      id: 100,
      method: "public/subscribe",
      params: { channels: [`ticker.${spotSymbol}.100ms`] }
    });
    
    if (config.futureExpiry) {
      const futureSymbol = `${base}-${config.futureExpiry}`;
      console.log(`📊 Also subscribing to future: ${futureSymbol}`);
      this.send({
        jsonrpc: "2.0",
        id: 101,
        method: "public/subscribe",
        params: { channels: [`ticker.${futureSymbol}.100ms`] }
      });
    }
    
    const startTime = Date.now();
    while (!this.spotPriceReceived && (Date.now() - startTime) < 3000) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    if (this.spotPriceReceived) {
      console.log('✅ Spot price received, now subscribing to options...');
      await this.subscribeToInstruments(config);
    } else {
      console.log('⚠️ Timeout waiting for spot price, subscribing anyway...');
      await this.subscribeToInstruments(config);
    }
  }

  async subscribeToInstruments(config) {
    const channels = [];
     const { instrumentType, expiry, startStrike, gap, entryCount, symbol = 'BTC' } = config;
     const base = symbol.toUpperCase();

    console.log(`🔔 Subscribing for ${base} instruments with config:`, JSON.stringify(config, null, 2));

     try {
      if (instrumentType === 'future') {
        const res = await axios.get('https://www.deribit.com/api/v2/public/get_instruments', {
          params: { currency: base, kind: 'future', expired: false }
        });
        const futures = res.data?.result || [];
        futures.forEach(f => channels.push(`ticker.${f.instrument_name}.100ms`));
        console.log(`📈 Added ${futures.length} ${base} futures`);
      } 
      else if (instrumentType === 'option') {
        const res = await axios.get('https://www.deribit.com/api/v2/public/get_instruments', {
          params: { currency: base, kind: 'option', expired: false }
        });
        let instruments = res.data?.result || [];
        console.log(`🎯 Total ${base} options fetched: ${instruments.length}`);

        if (expiry && expiry.trim() !== '') {
          let expiryNorm = expiry.trim();
          if (/^0\d[A-Z]{3}\d{2}$/.test(expiryNorm)) {
            expiryNorm = expiryNorm.replace(/^0/, "");
          }
          instruments = instruments.filter(i => i.instrument_name.includes(`-${expiryNorm}-`));
          console.log(`🎯 After expiry filter (${expiryNorm}): ${instruments.length}`);
        }

        const start = parseInt(startStrike);
        const gapNum = parseInt(gap);
        const count = parseInt(entryCount);

        if (!isNaN(start) && !isNaN(gapNum) && !isNaN(count) && gapNum > 0 && count > 0) {
          const allowedStrikes = new Set();
          for (let i = 0; i < count; i++) {
            allowedStrikes.add(start + i * gapNum);
          }

          instruments = instruments.filter(i => {
            const parts = i.instrument_name.split('-');
            if (parts.length >= 3) {
              const strike = parseInt(parts[2]);
              return allowedStrikes.has(strike);
            }
            return false;
          });
          console.log(`🎯 After strike filter: ${instruments.length}`);
        }

        instruments.forEach(i => {
          channels.push(`ticker.${i.instrument_name}.100ms`);
        });
        console.log(`🎯 Final ${base} options subscribed: ${instruments.length}`);
      }

      if (channels.length > 0) {
        console.log(`📊 Total ${base} channels to subscribe: ${channels.length}`);
        this.batchSubscribe(channels);
      } else {
        console.log(`⚠️ No ${base} channels to subscribe!`);
      }

    } catch (error) {
      console.error('❌ Subscribe failed:', error.message);
    }
  }

  batchSubscribe(channels) {
    const CHUNK = 50;
    for (let i = 0; i < channels.length; i += CHUNK) {
      const slice = channels.slice(i, i + CHUNK);
      this.send({
        jsonrpc: "2.0",
        id: 200 + i,
        method: "public/subscribe",
        params: { channels: slice }
      });
      slice.forEach(ch => this.subscribedChannels.add(ch));
    }
    console.log(`✅ Subscribed to ${this.subscribedChannels.size} channels`);
  }

  unsubscribeFromInstrument(instrument) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const channel = `ticker.${instrument}.raw`;
      this.ws.send(JSON.stringify({
        method: 'public/unsubscribe',
        params: {
          channels: [channel]
        },
        jsonrpc: '2.0',
        id: Date.now()
      }));
      console.log(`Unsubscribed from ${channel}`);
    }
  }

  handleMessage(message) {
    if (message.method === "subscription" && message.params?.data) {
      const data = message.params.data;
      const instrument = data.instrument_name;

      if (instrument === 'BTC-PERPETUAL' && !this.spotPriceReceived) {
        this.spotPriceReceived = true;
        console.log(`✅ Spot price received: ${data.last_price}`);
      }

      const parts = instrument.split("-");
      const isOption = parts.length === 4;
      const priceFactor = isOption ? (data.underlying_price || 1) : 1;

      const converted = {
        exchange: "deribit",
        instrument,
        last_price: (data.last_price * priceFactor).toFixed(2),
        best_bid_price: (data.best_bid_price * priceFactor).toFixed(2),
        best_ask_price: (data.best_ask_price * priceFactor).toFixed(2),
        mark_price: (data.mark_price * priceFactor).toFixed(2),
        min_price: (data.min_price * priceFactor).toFixed(2),
        max_price: (data.max_price * priceFactor).toFixed(2),
        volume: data.stats?.volume || 0,
        open_interest: data.open_interest || 0,
      };

      this.onData(`deribit_${instrument}`, converted);
    } else if (message.method === "heartbeat") {
      this.send({ jsonrpc: "2.0", id: 999, method: "public/test" });
    }
  }

  send(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  cleanup() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    if (this.metadataTimer) {
      clearTimeout(this.metadataTimer);
      this.metadataTimer = null;
    }
    this.subscribedChannels.clear();
    this.spotPriceReceived = false;
    this.pendingConfig = null;
  }

  disconnect() {
    this.cleanup();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
  }
}

module.exports = DeribitConnector;
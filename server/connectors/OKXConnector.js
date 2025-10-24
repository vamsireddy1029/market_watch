const WebSocket = require('ws');
const axios = require('axios');
const FALLBACK_INSTRUMENTS = {
  SWAP: [
    'BTC-USDT-SWAP', 'ETH-USDT-SWAP'
  ],
  FUTURES: [
    'BTC-USDT-251024', 'BTC-USDT-251025',
    'BTC-USDT-241227', 'BTC-USDT-250328', 'BTC-USDT-250627',
    'ETH-USDT-251023', 'ETH-USDT-251024', 'ETH-USDT-251025',
    'ETH-USDT-241227', 'ETH-USDT-250328', 'ETH-USDT-250627'
  ],
  SPOT: [
    'BTC-USDT', 'ETH-USDT'
  ],
  OPTION: [
    'BTC-USD-251024-107000-C', 'BTC-USD-251024-108000-C',
    'BTC-USD-251024-108000-P', 'BTC-USD-251024-107000-P',
    'BTC-USD-251024-109000-C', 'BTC-USD-251024-110000-C',
    'BTC-USD-251024-110000-P', 'BTC-USD-251024-109000-P',
    'BTC-USD-251024-111000-C', 'BTC-USD-251024-112000-C',
    'BTC-USD-251024-112000-P', 'BTC-USD-251024-111000-P',
    'BTC-USD-251024-107000-C', 'BTC-USD-251024-108000-C',
    'BTC-USD-251024-108000-P', 'BTC-USD-251024-107000-P',
    'ETH-USD-251024-3500-C', 'ETH-USD-241025-3500-P',
    'ETH-USD-251024-4000-C', 'ETH-USD-241101-4000-P'
  ]
};

class OKXConnector {
  constructor(onData, onMetadata, apiKey = null, secretKey = null, passphrase = null) {
    this.onData = onData;
    this.onMetadata = onMetadata;
    this.apiKey = apiKey;
    this.secretKey = secretKey;
    this.passphrase = passphrase;
    this.ws = null;
    this.reconnectInterval = null;
    this.isIntentionalDisconnect = false;
    this.subscribedChannels = [];
    this.instrumentCache = new Map();
    this.isConnected = false;
    this.config = {};
  }

  async connect(options = {}) {
    const {
      isMetadataFetch = false,
      instrumentType = 'swap',
      symbol = 'BTC',
      expiry = null,
      strikeInterval = null,
      strategy = null,
    } = options;

    this.config = {
      isMetadataFetch,
      instrumentType,
      symbol: symbol.toUpperCase(),
      expiry,
      strikeInterval,
      strategy,
    };

    console.log(`[OKX] Connecting config:`, this.config);

    // ✅ Fetch instruments with fallback
    const instrumentList = await this.fetchInstrumentsFromAPI(symbol, instrumentType, expiry);
    
    if (instrumentList.length === 0) {
      console.warn(`[OKX] No instruments found for ${symbol} ${instrumentType}`);
      return;
    }

    const instrumentObjs = instrumentList.map(instId => ({
      instId,
      instType: this.detectType(instId),
    }));

    this.handleInstrumentsResponse(instrumentObjs);

    if (!isMetadataFetch) {
      await this.connectWebSocket(instrumentList);
    }
  }

  /**
   * ✅ FIXED: Fetch with Axios + Fallback
   */
  async fetchInstrumentsFromAPI(symbol, instrumentType, expiry) {
    console.log(`[OKX] Fetching instruments: ${symbol} ${instrumentType}`);
    
    const instruments = [];
    const instTypes = this.getInstTypesToFetch(instrumentType);
    
    for (const instType of instTypes) {
      let apiSuccess = false;
      
      try {
        console.log(`[OKX] Trying API for ${instType}...`);
        const data = await this.fetchViaAxios(instType);
        
        if (data && data.data && Array.isArray(data.data)) {
          const filtered = data.data
            .filter(inst => {
              const instId = inst.instId.toUpperCase();
              if (!instId.startsWith(symbol.toUpperCase())) return false;
              if (expiry && expiry.trim() && expiry !== 'all') {
                return instId.includes(expiry.trim().toUpperCase());
              }
              return true;
            })
            .map(inst => inst.instId);
          
          instruments.push(...filtered);
          console.log(`[OKX] ✅ API success: ${filtered.length} ${instType}`);
          apiSuccess = true;
        }
      } catch (error) {
        console.warn(`[OKX] ❌ API failed for ${instType}: ${error.message}`);
      }
      
      // ✅ Use fallback if API failed
      if (!apiSuccess) {
        console.log(`[OKX] 📦 Using fallback for ${instType}...`);
        const fallback = FALLBACK_INSTRUMENTS[instType] || [];
        const filtered = fallback.filter(inst => {
          const instId = inst.toUpperCase();
          if (!instId.startsWith(symbol.toUpperCase())) return false;
          if (expiry && expiry.trim() && expiry !== 'all') {
            return instId.includes(expiry.trim().toUpperCase());
          }
          return true;
        });
        instruments.push(...filtered);
        console.log(`[OKX] 📦 Fallback: ${filtered.length} ${instType}`);
      }
    }
    
    console.log(`[OKX] Total instruments: ${instruments.length}`);
    return instruments;
  }

  /**
   * ✅ Fetch using Axios with proper config
   */
  async fetchViaAxios(instType) {
    const response = await axios.get(`https://www.okx.com/api/v5/public/instruments`, {
      params: { instType },
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache'
      },
      timeout: 10000,
      validateStatus: (status) => status === 200
    });
    
    return response.data;
  }

  /**
   * Map user-friendly type to OKX API instType
   */
  getInstTypesToFetch(instrumentType) {
    const typeMap = {
      'swap': ['SWAP'],
      'futures': ['FUTURES'],
      'future': ['FUTURES'],
      'spot': ['SPOT'],
      'option': ['OPTION'],
      'all': ['SWAP', 'FUTURES', 'SPOT', 'OPTION']
    };
    
    return typeMap[instrumentType.toLowerCase()] || ['SWAP'];
  }

  detectType(instId) {
    if (instId.endsWith('-SWAP')) return 'SWAP';
    if (instId.includes('-P') || instId.includes('-C')) return 'OPTION';
    if (/-\d{6}$/.test(instId)) return 'FUTURES';
    if (instId.includes('-USDT') && !instId.endsWith('-SWAP')) return 'SPOT';
    return 'UNKNOWN';
  }

  handleInstrumentsResponse(instruments) {
    const { symbol } = this.config;
    const metadata = {
      expiries: [],
      optionExpiries: [],
      futureExpiries: [],
      strikes: { min: Infinity, max: -Infinity },
      instruments: {},
      total: instruments.length,
      byType: { spot: 0, swap: 0, futures: 0, option: 0 }
    };

    const expirySet = new Set();
    const optionExpirySet = new Set();
    const futureExpirySet = new Set();

    instruments.forEach(inst => {
      const { instId, instType } = inst;
      const type = (instType || '').toLowerCase();

      if (type === 'spot') metadata.byType.spot++;
      if (type === 'swap') metadata.byType.swap++;
      if (type === 'futures') metadata.byType.futures++;
      if (type === 'option') metadata.byType.option++;

      if (type === 'futures') {
        // Format: BTC-USDT-241025
        const parts = instId.split('-');
        if (parts.length >= 3) {
          expirySet.add(parts[2]);
          futureExpirySet.add(parts[2]);
        }
      } else if (type === 'option') {
        // Format: BTC-USD-241025-100000-C
        const parts = instId.split('-');
        if (parts.length >= 5) {
          const expiry = parts[2];
          const strikeMatch = parts[3].match(/\d+/);
          const strike = strikeMatch ? parseInt(strikeMatch[0], 10) : null;
          optionExpirySet.add(expiry);
          expirySet.add(expiry);
          if (!isNaN(strike)) {
            metadata.strikes.min = Math.min(metadata.strikes.min, strike);
            metadata.strikes.max = Math.max(metadata.strikes.max, strike);
          }
        }
      }

      if (!metadata.instruments[type]) metadata.instruments[type] = [];
      metadata.instruments[type].push(instId);
      this.instrumentCache.set(instId, inst);
    });

    metadata.expiries = Array.from(expirySet).sort();
    metadata.optionExpiries = Array.from(optionExpirySet).sort();
    metadata.futureExpiries = Array.from(futureExpirySet).sort();
    if (metadata.strikes.min === Infinity) metadata.strikes = { min: 0, max: 0 };

    console.log(`[OKX] Metadata summary:`, {
      total: metadata.total,
      spot: metadata.byType.spot,
      swap: metadata.byType.swap,
      futures: metadata.byType.futures,
      option: metadata.byType.option,
      expiries: metadata.expiries.length
    });

    if (this.onMetadata) this.onMetadata('okx', metadata);
  }

  async connectWebSocket(instrumentList) {
    console.log('[OKX] Connecting to WebSocket...');
    return new Promise((resolve, reject) => {
      this.isIntentionalDisconnect = false;
      this.ws = new WebSocket('wss://ws.okx.com:8443/ws/v5/public');
      this.subscribedChannels = [];

      this.ws.on('open', async () => {
        console.log('[OKX] WebSocket connected');
        this.isConnected = true;
        try {
          await this.subscribeToMarketData(instrumentList);
          resolve();
        } catch (err) {
          reject(err);
        }
      });

      this.ws.on('message', (msg) => {
        try {
          const message = JSON.parse(msg.toString());
          this.handleMessage(message);
        } catch (err) {
          console.warn('[OKX] Failed to parse message:', err.message);
        }
      });

      this.ws.on('error', (err) => console.error('[OKX] WebSocket error:', err));
      this.ws.on('close', () => {
        console.log('[OKX] WebSocket disconnected');
        this.isConnected = false;
        if (!this.isIntentionalDisconnect) {
          console.log('[OKX] Reconnecting in 5s...');
          this.reconnectInterval = setTimeout(() => this.connectWebSocket(instrumentList), 5000);
        }
      });
    });
  }

  async subscribeToMarketData(instrumentList) {
    if (!instrumentList.length) return console.warn('[OKX] No instruments to subscribe to');
    
    const BATCH_SIZE = 100;
    
    for (let i = 0; i < instrumentList.length; i += BATCH_SIZE) {
      const batch = instrumentList.slice(i, i + BATCH_SIZE);
      const args = batch.map(instId => ({ channel: 'tickers', instId }));
      
      this.ws.send(JSON.stringify({ op: 'subscribe', args }));
      this.subscribedChannels.push(...args);
      
      if (i + BATCH_SIZE < instrumentList.length) {
        await new Promise(r => setTimeout(r, 200));
      }
    }
    
    console.log(`[OKX] Subscribed to ${instrumentList.length} instruments`);
  }

  handleMessage(message) {
    try {
      if (message.event) {
        if (message.event === 'subscribe') {
          console.log('[OKX] Subscribed:', message.arg?.instId);
        } else if (message.event === 'error') {
          console.error('[OKX] Subscription error:', message.msg || message);
        }
        return;
      }

      if (message.arg?.channel === 'tickers') {
        this.handleTickerData(message);
        return;
      }

      if (message === 'pong' || message.op === 'pong') return;
    } catch (err) {
      console.error('[OKX] handleMessage failed:', err.message);
    }
  }

  handleTickerData(message) {
    try {
      if (!message || !Array.isArray(message.data) || message.data.length === 0) {
        return;
      }

      message.data.forEach(ticker => {
        if (!ticker.instId || !ticker.last) return;

        const data = {
          exchange: 'okx',
          instrument: ticker.instId,
          type: this.detectType(ticker.instId).toLowerCase(),
          last_price: parseFloat(ticker.last),
          best_bid_price: parseFloat(ticker.bidPx),
          best_ask_price: parseFloat(ticker.askPx),
          best_bid_qty: parseFloat(ticker.bidSz),
          best_ask_qty: parseFloat(ticker.askSz),
          volume_24h: parseFloat(ticker.vol24h),
          volume_usd_24h: parseFloat(ticker.volCcy24h),
          timestamp: parseInt(ticker.ts, 10)
        };

        if (ticker.markPx) data.mark_price = parseFloat(ticker.markPx);
        if (ticker.idxPx) data.index_price = parseFloat(ticker.idxPx);

        if (typeof this.onData === 'function') {
          try {
            this.onData(ticker.instId, data);
          } catch (err) {
            console.error('[OKX] Error in onData callback:', err.message);
          }
        }
      });
    } catch (err) {
      console.error('[OKX] Failed to parse ticker:', err.message);
    }
  }

  disconnect() {
    console.log('[OKX] Disconnecting...');
    this.isIntentionalDisconnect = true;
    if (this.reconnectInterval) clearTimeout(this.reconnectInterval);
    if (this.ws) {
      if (this.subscribedChannels.length) {
        try { 
          this.ws.send(JSON.stringify({ op: 'unsubscribe', args: this.subscribedChannels })); 
        } catch (err) { 
          console.error('[OKX] Unsubscribe error:', err); 
        }
      }
      this.ws.close();
      this.ws = null;
    }
    this.subscribedChannels = [];
    this.instrumentCache.clear();
    this.isConnected = false;
    console.log('[OKX] Disconnected');
  }
}

module.exports = OKXConnector;
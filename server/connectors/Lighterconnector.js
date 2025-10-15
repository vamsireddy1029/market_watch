const WebSocket = require('ws');
const axios = require('axios');

class LighterConnector {
  constructor(onData, onMetadata) {
    this.ws = null;
    this.isConnected = false;
    this.onData = onData;
    this.onMetadata = onMetadata;
    this.subscribedChannels = new Set();
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.pingInterval = null;
    this.marketDataCache = new Map();
    this.markets = [];
    this.baseUrl = 'https://mainnet.zklighter.elliot.ai';
    this.wsUrl = 'wss://mainnet.zklighter.elliot.ai/stream';
  }

  async connect(config) {
    return new Promise((resolve, reject) => {
      try {
        console.log('🔗 Connecting to Lighter WebSocket...');
        this.ws = new WebSocket(this.wsUrl);

        this.ws.on('open', async () => {
          this.isConnected = true;
          this.reconnectAttempts = 0;
          console.log('✅ Lighter WebSocket connected');

          setTimeout(async () => {
            try {
              if (config.isMetadataFetch) {
                await this.fetchMetadata();
                resolve();
              } else {
                await this.subscribeToMarkets(config);
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
            this.handleMessage(message);
          } catch (error) {
            console.error('❌ Lighter parse error:', error?.message || error);
          }
        });

        this.ws.on('error', (error) => {
          console.error('❌ Lighter WebSocket error:', error?.message || error);
        });

        this.ws.on('close', () => {
          this.isConnected = false;
          this.cleanup();
          console.log('🔌 Lighter WebSocket disconnected');
          
          if (this.reconnectAttempts < this.maxReconnectAttempts && !config?.isMetadataFetch) {
            this.reconnectAttempts++;
            console.log(`🔄 Reconnecting... attempt ${this.reconnectAttempts}`);
            setTimeout(() => {
              this.connect(config).catch(e => console.error('Reconnect failed:', e));
            }, 3000);
          }
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  async fetchMetadata() {
  console.log('📊 Fetching Lighter metadata...');
  
  try {
    const response = await axios.get(`${this.baseUrl}/api/markets`);
    const markets = response.data?.data || [];

    // Sort by market_index just to be consistent
    markets.sort((a, b) => a.market_index - b.market_index);

    // Build clean mapping
    this.markets = markets.map(m => ({
      id: m.market_index,
      symbol: m.symbol,
      base: m.base_token,
      quote: m.quote_token,
    }));

    console.log(`✅ Found ${this.markets.length} Lighter markets`);
    console.table(this.markets);

    const metadata = {
      markets: this.markets,
      perpetuals: this.markets.map(m => m.symbol),
      totalMarkets: this.markets.length,
    };

    if (this.onMetadata) {
      this.onMetadata('lighter', metadata);
    }

    return metadata;

  } catch (error) {
    console.error('❌ Lighter metadata fetch failed:', error?.message || error);

    // Fallback correct order: BTC first, then ETH
    const fallbackMarkets = [
      { id: 1, symbol: 'BTC-USD', base: 'BTC', quote: 'USD' },
      { id: 0, symbol: 'ETH-USD', base: 'ETH', quote: 'USD' },
    ];

    this.markets = fallbackMarkets;

    const metadata = {
      markets: fallbackMarkets,
      perpetuals: fallbackMarkets.map(m => m.symbol),
      totalMarkets: fallbackMarkets.length,
    };

    if (this.onMetadata) {
      this.onMetadata('lighter', metadata);
    }

    return metadata;
  }
}


  async subscribeToMarkets(config = {}) {
    console.log('📡 Lighter subscribeToMarkets config:', config);
    
    try {
      if (this.markets.length === 0) {
        await this.fetchMetadata();
      }
      
      for (const market of this.markets) {
  const marketIndex = Number(market.id);
  this.subscribe('market_stats', marketIndex);
  this.subscribe('order_book', marketIndex);
  console.log(`✅ Subscribed to ${market.symbol} (${marketIndex})`);
}

      
      console.log(`✅ Total subscriptions: ${this.subscribedChannels.size}`);
      
    } catch (error) {
      console.error('❌ Lighter subscribe failed:', error?.message || error);
    }
  }

  subscribe(channel, marketIndex) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('⚠️ WebSocket not ready, cannot subscribe');
      return;
    }
    
    const channelName = `${channel}/${marketIndex}`;
    
    if (this.subscribedChannels.has(channelName)) {
      return;
    }
    
    const subscribeMsg = {
      type: 'subscribe',
      channel: channelName
    };
    
    try {
      this.ws.send(JSON.stringify(subscribeMsg));
      this.subscribedChannels.add(channelName);
      console.log(`✅ Subscribed to: ${channelName}`);
    } catch (error) {
      console.error(`❌ Failed to subscribe to ${channelName}:`, error?.message);
    }
  }

  handleMessage(message) {
    try {
      if (!message || !message.type) return;
      
      const msgType = message.type;
      
      if (msgType === 'update/market_stats' && message.market_stats) {
        this.handleMarketStats(message);
      } else if (msgType === 'update/order_book' && message.order_book) {
        this.handleOrderBook(message);
      }
      
    } catch (error) {
      console.error('❌ Error handling message:', error?.message || error);
    }
  }

  handleMarketStats(message) {
  const stats = message.market_stats;
  const marketId = Number(stats.market_id ?? stats.market_index);

  if (isNaN(marketId)) return;

  // Find correct market
  const market = this.markets.find(m => Number(m.id) === marketId);
  const symbol = market?.symbol || `UNKNOWN_${marketId}`;

    
    let cached = this.marketDataCache.get(marketId) || {};

    cached = {
      ...cached,
      exchange: 'lighter',
      type: 'perpetual',
      instrument: symbol,
      mark_price: parseFloat(stats.mark_price || 0).toFixed(2),
      index_price: parseFloat(stats.index_price || 0).toFixed(2),
      last_price: parseFloat(stats.last_trade_price || stats.mark_price || 0).toFixed(2),
      open_interest: parseFloat(stats.open_interest || 0).toFixed(4),
      funding_rate: parseFloat(stats.funding_rate || 0).toFixed(6),
      volume: parseFloat(stats.daily_base_token_volume || 0).toFixed(2),
      min_price: parseFloat(stats.daily_price_low || 0).toFixed(2),
      max_price: parseFloat(stats.daily_price_high || 0).toFixed(2),
      price_change: parseFloat(stats.daily_price_change || 0).toFixed(2)
    };
    
    this.marketDataCache.set(marketId, cached);
    
    const key = `lighter_${symbol.toLowerCase().replace('-', '')}`;
    if (this.onData) {
      this.onData(key, cached);
    }
  }

  handleOrderBook(message) {
  try {
    const orderBook = message.order_book;
    if (!orderBook) return;

    // Extract marketId properly
    let marketId = orderBook.market_id;
    if (marketId === undefined) {
      // fallback if market_id missing
      const parts = message.channel?.split('/') || [];
      marketId = parseInt(parts[1]);
    }

    // if still invalid, ignore this update
    if (isNaN(marketId)) return;

    // Find market info
    const market = this.markets.find(m => (m.id || m.market_index) === marketId);
    const symbol = market?.symbol || `UNKNOWN_${marketId}`;

    // Create or update cache
    let cached = this.marketDataCache.get(marketId) || {
      exchange: 'lighter',
      type: 'perpetual',
      instrument: symbol,
    };

    const bids = orderBook.bids || [];
    const asks = orderBook.asks || [];

    const bestBid = bids.length > 0 ? parseFloat(bids[0].price || 0) : 0;
    const bestAsk = asks.length > 0 ? parseFloat(asks[0].price || 0) : 0;

    cached.best_bid_price = bestBid.toFixed(2);
    cached.best_ask_price = bestAsk.toFixed(2);

    // Mid price fallback
    if (!cached.last_price || cached.last_price === '0.00') {
      if (bestBid > 0 && bestAsk > 0) {
        cached.last_price = ((bestBid + bestAsk) / 2).toFixed(2);
      }
    }

    this.marketDataCache.set(marketId, cached);

    // Safe key
    const safeSymbol = symbol.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    const key = `lighter_${safeSymbol}`;

    if (this.onData) this.onData(key, cached);

  } catch (err) {
    console.error('❌ Error handling Lighter order book:', err.message);
  }
}


  cleanup() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    this.subscribedChannels.clear();
    this.marketDataCache.clear();
  }

  disconnect() {
    console.log('🛑 Disconnecting Lighter...');
    this.cleanup();
    
    if (this.ws) {
      try {
        if (this.ws.readyState === WebSocket.OPEN) {
          this.ws.close();
        } else if (typeof this.ws.terminate === 'function') {
          this.ws.terminate();
        }
      } catch (e) {
        console.error('Error closing WebSocket:', e?.message);
      }
      this.ws = null;
    }
    
    this.isConnected = false;
    console.log('✅ Lighter disconnected');
  }
}

module.exports = LighterConnector;

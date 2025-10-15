const WebSocket = require("ws");
const axios = require("axios");
const crypto = require("crypto");

class OKXConnector {
  constructor(onData, onMetadata, apiKey = null, secret = null, passphrase = null) {
    this.ws = null;
    this.isConnected = false;
    this.onData = onData;
    this.onMetadata = onMetadata;
    this.subscribed = new Set();
    this.reconnectAttempts = 0;
    this.maxReconnect = 5;
    this.marketCache = new Map();
    this.instruments = [];
    this.apiKey = apiKey;
    this.secret = secret;
    this.passphrase = passphrase;
    this.publicUrl = "wss://ws.okx.com:8443/ws/v5/public";
    this.privateUrl = "wss://ws.okx.com:8443/ws/v5/private";
    this.currentConfig = {};
    this.pingInterval = null;
    this.reconnectTimeout = null;
    const http = require("http");
    const https = require("https");

    this.http = axios.create({
      timeout: 45000, 
      httpAgent: new http.Agent({ 
        keepAlive: true,
        keepAliveMsecs: 60000,
        maxSockets: 2, 
        maxFreeSockets: 1 
      }),
      httpsAgent: new https.Agent({ 
        keepAlive: true,
        keepAliveMsecs: 60000,
        maxSockets: 2, // Reduced from 5
        maxFreeSockets: 1, // Reduced from 2
        rejectUnauthorized: true
      }),
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      },
    });

    // Add response interceptor for better error handling
    this.http.interceptors.response.use(
      response => response,
      error => {
        if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
          console.warn(`⚠️ HTTP ${error.code} - will retry`);
        }
        return Promise.reject(error);
      }
    );
  }

  async connect(config = { subscribePublic: true, subscribePrivate: false, symbol: "BTC", instrumentType: "swap" }) {
    this.currentConfig = config;

    // Clear any existing reconnect timeout
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    return new Promise((resolve, reject) => {
      const wsUrl = config.subscribePrivate && this.apiKey ? this.privateUrl : this.publicUrl;
      
      // ✅ FIXED: Add more WebSocket options
      this.ws = new WebSocket(wsUrl, {
        handshakeTimeout: 15000, // Increased from 10s
        perMessageDeflate: false,
        maxPayload: 100 * 1024 * 1024, // 100MB
        skipUTF8Validation: true
      });

      // ✅ Add connection timeout
      const connectionTimeout = setTimeout(() => {
        if (!this.isConnected) {
          console.error("❌ OKX connection timeout");
          this.ws.terminate();
          reject(new Error("Connection timeout"));
        }
      }, 20000);

      this.ws.on("open", async () => {
        clearTimeout(connectionTimeout);
        this.isConnected = true;
        this.reconnectAttempts = 0;
        console.log(`✅ OKX WebSocket connected (${config.subscribePrivate ? "private" : "public"})`);

        // ✅ Start heartbeat
        this.startHeartbeat();

        try {
          // ✅ Add delay before fetching instruments
          await this.sleep(1000);
          await this.fetchInstruments(config.instrumentType, config.symbol);

          if (config.subscribePrivate && this.apiKey) {
            await this.sleep(500);
            await this.login();
          }

          if (config.subscribePublic) {
            await this.sleep(1000); // Wait before subscribing
            await this.subscribePublicChannels(config);
          }

          resolve();
        } catch (e) {
          console.error("❌ Error during open flow:", e?.message || e);
          reject(e);
        }
      });

      this.ws.on("message", (raw) => {
        try {
          const msg = JSON.parse(raw);
          this.handleMessage(msg);
        } catch (e) {
          console.error("OKX parse error", e);
        }
      });

      this.ws.on("close", (code, reason) => {
        clearTimeout(connectionTimeout);
        this.isConnected = false;
        this.stopHeartbeat();
        console.log("🔌 OKX WebSocket closed", code, reason?.toString?.() || reason);
        this.cleanup();
        
        if (this.reconnectAttempts < this.maxReconnect) {
          this.reconnectAttempts++;
          const delay = Math.min(5000 * Math.pow(2, this.reconnectAttempts - 1), 30000);
          console.log(`🔄 Reconnecting OKX attempt ${this.reconnectAttempts} in ${delay}ms`);
          this.reconnectTimeout = setTimeout(() => {
            this.connect(config).catch(console.error);
          }, delay);
        }
      });

      this.ws.on("error", (err) => {
        console.error("❌ OKX WebSocket error:", err?.message || err);
        if (err.code === 'ECONNRESET') {
          console.error("💡 ECONNRESET - possible causes: rate limiting, network issues, or server rejection");
        }
      });

      this.ws.on("ping", () => {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.pong();
        }
      });
    });
  }

  // ✅ NEW: Heartbeat mechanism
  startHeartbeat() {
    this.stopHeartbeat();
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        try {
          this.ws.ping();
        } catch (e) {
          console.error("❌ Ping error:", e?.message);
        }
      }
    }, 15000); // Ping every 15 seconds
  }

  stopHeartbeat() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  // ✅ FIXED: Correct instrument fetching
  async fetchInstruments(targetType = "SWAP", symbol = "BTC") {
    console.log(`📡 Fetching OKX instrument metadata for ${targetType}...`);
    
    const baseUrl = "https://www.okx.com/api/v5/public/instruments";
    const instTypes = [targetType.toUpperCase()];
    const all = [];

    for (const instType of instTypes) {
      console.log(`🔍 Fetching ${instType} instruments...`);
      
      const params = { instType };
      
      // ✅ FIXED: Correct instrument family format
      if (["FUTURES", "SWAP", "OPTION"].includes(instType)) {
        // OKX uses different formats: BTC-USD for options, BTC-USDT for swaps/futures
        if (instType === "OPTION") {
          params.instFamily = `${symbol.toUpperCase()}-USD`;
        } else {
          // For SWAP and FUTURES, don't use instFamily - fetch all and filter
          // params.instFamily = `${symbol.toUpperCase()}-USDT`;
        }
      }

      let attempt = 0;
      const maxAttempts = 3;
      
      while (attempt < maxAttempts) {
        try {
          // ✅ Longer delays between requests
          if (attempt > 0) {
            const backoffDelay = Math.min(10000 * Math.pow(2, attempt), 60000);
            console.log(`⏳ Waiting ${backoffDelay}ms before retry...`);
            await this.sleep(backoffDelay);
          } else {
            await this.sleep(2000); // Increased from 1000ms
          }

          const resp = await this.http.get(baseUrl, { 
            params,
            validateStatus: (status) => status < 500
          });

          if (resp.status === 429) {
            console.warn(`⚠️ Rate limited on ${instType}, attempt ${attempt + 1}/${maxAttempts}`);
            attempt++;
            continue;
          }

          if (resp.status !== 200) {
            console.warn(`⚠️ HTTP ${resp.status} for ${instType}`);
            attempt++;
            continue;
          }

          let data = resp.data?.data || [];
          
          // ✅ Filter by symbol if we didn't use instFamily
          if (["SWAP", "FUTURES"].includes(instType) && !params.instFamily) {
            data = data.filter(d => d.instId && d.instId.startsWith(`${symbol.toUpperCase()}-`));
          }

          if (data.length === 0) {
            console.warn(`⚠️ No instruments returned for ${instType}`);
          }

          all.push(...data.map((d) => ({
            instId: d.instId,
            instType: instType,
            base: d.baseCcy || null,
            quote: d.quoteCcy || null,
            settleCcy: d.settleCcy || null,
            alias: d.alias || null,
            ctVal: d.ctVal || null,
            ctMult: d.ctMult || null,
            ctValCcy: d.ctValCcy || null,
            expTime: d.expTime || null,
            listTime: d.listTime || null,
            state: d.state || null,
            tickSz: d.tickSz || null,
            lotSz: d.lotSz || null,
            minSz: d.minSz || null,
            lever: d.lever || null,
            raw: d
          })));

          console.log(`✅ Fetched ${data.length} ${instType} instruments`);
          break;

        } catch (error) {
          attempt++;
          const errMsg = error.message || String(error);
          
          if (errMsg.includes("ECONNRESET") || errMsg.includes("ETIMEDOUT") || errMsg.includes("ENOTFOUND")) {
            console.warn(`⚠️ Network error fetching ${instType} (attempt ${attempt}/${maxAttempts}): ${errMsg}`);
          } else {
            console.error(`❌ Error fetching ${instType}:`, errMsg);
          }

          if (attempt >= maxAttempts) {
            console.error(`❌ Failed to fetch ${instType} after ${maxAttempts} attempts`);
          }
        }
      }
    }

    // Deduplicate and process instruments
    const map = new Map();
    all.forEach((i) => {
      if (i && i.instId) map.set(i.instId, i);
    });
    this.instruments = Array.from(map.values());

    // Extract metadata
    const expiries = new Set();
    const strikes = { min: Infinity, max: -Infinity };

    this.instruments.forEach((inst) => {
      if (!inst || !inst.instId) return;
      
      if (inst.instType === "OPTION") {
        const parts = inst.instId.split("-");
        if (parts.length >= 3) {
          const expiryDate = parts[2];
          if (expiryDate && expiryDate.length === 6) {
            const year = "20" + expiryDate.substring(0, 2);
            const month = expiryDate.substring(2, 4);
            const day = expiryDate.substring(4, 6);
            const monthNames = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
            const monthName = monthNames[parseInt(month, 10) - 1] || month;
            const formatted = `${day}${monthName}${year.substring(2)}`;
            expiries.add(formatted);
          }
        }
        if (parts.length >= 4) {
          const strike = parseInt(parts[3], 10);
          if (!isNaN(strike)) {
            strikes.min = Math.min(strikes.min, strike);
            strikes.max = Math.max(strikes.max, strike);
          }
        }
      } else if (inst.instType === "FUTURES") {
        const parts = inst.instId.split("-");
        if (parts.length >= 3) {
          const expiryDate = parts[2];
          if (expiryDate && expiryDate.length === 6) {
            const year = "20" + expiryDate.substring(0, 2);
            const month = expiryDate.substring(2, 4);
            const day = expiryDate.substring(4, 6);
            const monthNames = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
            const monthName = monthNames[parseInt(month, 10) - 1] || month;
            const formatted = `${day}${monthName}${year.substring(2)}`;
            expiries.add(formatted);
          }
        }
      }
    });

    const strikesOut = strikes.min === Infinity ? { min: 0, max: 0 } : strikes;

    if (this.onMetadata) {
      this.onMetadata("okx", {
        instruments: this.instruments,
        total: this.instruments.length,
        expiries: Array.from(expiries).sort(),
        strikes: strikesOut,
      });
    }

    console.log(`✅ OKX instruments loaded: ${this.instruments.length}, expiries: ${expiries.size}`);
    
    if (this.instruments.length === 0) {
      
      console.warn("⚠️ WARNING: No instruments were loaded! Check API connectivity.");
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async login() {
    if (!this.apiKey || !this.secret || !this.passphrase) {
      console.warn("⚠️ OKX login skipped: missing credentials");
      return;
    }

    const timestamp = new Date().toISOString();
    const method = "GET";
    const requestPath = "/users/self/verify";
    const body = "";
    const sign = this._sign(timestamp, method, requestPath, body);

    const loginMsg = {
      op: "login",
      args: [
        {
          apiKey: this.apiKey,
          passphrase: this.passphrase,
          timestamp: timestamp,
          sign: sign,
        },
      ],
    };

    try {
      this.ws.send(JSON.stringify(loginMsg));
      console.log("📤 OKX login message sent");
    } catch (err) {
      console.error("❌ Failed to send OKX login:", err?.message || err);
    }
  }

  // ✅ FIXED: Much more conservative subscription approach
  async subscribePublicChannels(config) {
    const symbol = (config.symbol || "BTC").toUpperCase();
    const instrumentType = (config.instrumentType || "swap").toUpperCase();
    let selectedInstruments = [];

    if (instrumentType === "SWAP") {
      selectedInstruments = this.instruments.filter((inst) => 
        inst.instType === "SWAP" && 
        inst.instId.includes(`${symbol}-`)
      );
    } else if (instrumentType === "FUTURES") {
      selectedInstruments = this.instruments.filter((inst) => 
        inst.instType === "FUTURES" && 
        inst.instId.includes(`${symbol}-`)
      );
    } else if (instrumentType === "SPOT") {
      selectedInstruments = this.instruments.filter((inst) => 
        inst.instType === "SPOT" && 
        inst.instId === `${symbol}-USDT`
      );
    } else if (instrumentType === "OPTION") {
      selectedInstruments = this.instruments.filter((inst) => {
        if (inst.instType !== "OPTION") return false;
        if (!inst.instId.startsWith(`${symbol}-`)) return false;

        if (config.expiry && config.expiry.trim()) {
          const expiryNorm = config.expiry.trim().toUpperCase();
          const parts = inst.instId.split("-");
          if (parts.length < 3) return false;
          const expiryDate = parts[2];
          if (expiryDate && expiryDate.length === 6) {
            const year = "20" + expiryDate.substring(0, 2);
            const month = expiryDate.substring(2, 4);
            const day = expiryDate.substring(4, 6);
            const monthNames = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
            const monthName = monthNames[parseInt(month, 10) - 1] || month;
            const formatted = `${day}${monthName}${year.substring(2)}`;
            if (formatted !== expiryNorm) return false;
          }
        }

        if (config.startStrike && config.gap && config.entryCount) {
          const parts = inst.instId.split("-");
          if (parts.length < 4) return false;
          const strike = parseInt(parts[3], 10);
          if (isNaN(strike)) return false;
          const start = parseInt(config.startStrike, 10);
          const gap = parseInt(config.gap, 10);
          const count = parseInt(config.entryCount, 10);
          const validStrikes = Array.from({ length: count }, (_, i) => start + i * gap);
          if (!validStrikes.includes(strike)) return false;
        }

        return true;
      });

      // ✅ Limit options to prevent overwhelming the connection
      selectedInstruments = selectedInstruments.slice(0, 100); // Reduced from 200
    }

    console.log(`📊 OKX selected ${selectedInstruments.length} instruments for ${symbol} ${instrumentType}`);

    if (selectedInstruments.length === 0) {
      console.warn("⚠️ No instruments selected for subscription!");
      return;
    }

    // ✅ FIXED: Build subscription arguments more conservatively
    const args = [];
    
    // For SWAP/FUTURES, subscribe to fewer channels initially
    if (instrumentType === "SWAP" || instrumentType === "FUTURES") {
      // Limit to first 50 instruments for SWAP/FUTURES
      const limitedInstruments = selectedInstruments.slice(0, 50);
      for (const inst of limitedInstruments) {
        args.push({ channel: "tickers", instId: inst.instId });
        // Only add orderbook for first 20
        if (args.length < 40) {
          args.push({ channel: "books5", instId: inst.instId });
        }
      }
    } else {
      // For OPTIONS and SPOT, use original logic but with limits
      for (const inst of selectedInstruments) {
        args.push({ channel: "tickers", instId: inst.instId });
        
        // Only add books5 for first 50 instruments
        if (args.length < 100) {
          args.push({ channel: "books5", instId: inst.instId });
        }
        
        // Add mark-price only for derivatives and only first 30
        if (inst.instType !== "SPOT" && args.length < 90) {
          args.push({ channel: "mark-price", instId: inst.instId });
        }
      }
    }

    console.log(`📡 Preparing to send ${args.length} subscription requests...`);

    // ✅ FIXED: Much smaller chunks with longer delays
    const chunkSize = 5; // Reduced from 10
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < args.length; i += chunkSize) {
      const chunk = args.slice(i, i + chunkSize);
      const subscribePayload = { op: "subscribe", args: chunk };
      
      try {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
          console.warn("⚠️ WebSocket not open, aborting subscription");
          break;
        }
        
        this.ws.send(JSON.stringify(subscribePayload));
        chunk.forEach((a) => this.subscribed.add(`${a.channel}_${a.instId}`));
        successCount += chunk.length;
        
        // ✅ Much longer delay between chunks to avoid rate limiting
        await this.sleep(800); // Increased from 300ms
        
        // ✅ Log progress
        if ((i + chunkSize) % 25 === 0) {
          console.log(`📊 Progress: ${Math.min(i + chunkSize, args.length)}/${args.length} subscriptions sent`);
        }
        
      } catch (err) {
        failCount += chunk.length;
        console.error("❌ Error sending subscribe chunk:", err?.message || err);
        
        // ✅ If we get an error, wait even longer before continuing
        await this.sleep(2000);
      }
    }

    console.log(`✅ OKX subscription complete: ${successCount} successful, ${failCount} failed`);
  }

  handleMessage(msg) {
    try {
      if (!msg) return;

      if (msg.event === "subscribe") {
        console.log("✅ OKX subscribed:", msg.arg?.channel, msg.arg?.instId);
        return;
      }

      if (msg.event === "unsubscribe") {
        console.log("🔕 OKX unsubscribed:", msg.arg?.channel, msg.arg?.instId);
        return;
      }

      if (msg.event === "login") {
        console.log(msg.code === "0" ? "✅ OKX login successful" : `❌ OKX login failed: ${msg.msg}`);
        return;
      }

      if (msg.event === "error") {
        console.error("❌ OKX error:", msg.msg, msg.code);
        
        // ✅ Handle specific error codes
        if (msg.code === "60012") {
          console.error("💡 Rate limit exceeded - reduce subscription frequency");
        } else if (msg.code === "60009") {
          console.error("💡 Login required for this channel");
        }
        return;
      }

      const arg = msg.arg;
      const data = msg.data;

      if (arg && Array.isArray(data)) {
        data.forEach((entry) => {
          const channel = arg.channel;
          const instId = arg.instId || entry.instId;
          if (channel && instId) {
            this.processData(channel, instId, entry);
          }
        });
      }
    } catch (err) {
      console.error("❌ Error handling OKX message:", err?.message || err);
    }
  }

  processData(channel, instId, data) {
    if (!instId) return;
    
    const inst = this.instruments.find((i) => i.instId === instId);
    const instType = inst ? inst.instType.toLowerCase() : "unknown";

    const safeKey = instId.toLowerCase().replace(/[^a-z0-9-]/g, "");
    const key = `okx_${safeKey}`;

    let obj = {
      exchange: "okx",
      type: instType,
      instrument: instId,
      timestamp: data.ts || Date.now(),
    };

    if (channel === "tickers") {
      obj.last_price = parseFloat(data.last || data.lastPx || 0);
      obj.ask = parseFloat(data.askPx || 0);
      obj.bid = parseFloat(data.bidPx || 0);
      obj.high_24h = parseFloat(data.high24h || 0);
      obj.low_24h = parseFloat(data.low24h || 0);
      obj.vol_24h = parseFloat(data.vol24h || 0);
      obj.volume_24h_ccy = parseFloat(data.volCcy24h || 0);
    } else if (channel === "books" || channel === "books5") {
      const bids = data.bids || [];
      const asks = data.asks || [];
      if (bids.length > 0) {
        obj.best_bid_price = parseFloat(bids[0][0]) || 0;
        obj.best_bid_qty = parseFloat(bids[0][1]) || 0;
      }
      if (asks.length > 0) {
        obj.best_ask_price = parseFloat(asks[0][0]) || 0;
        obj.best_ask_qty = parseFloat(asks[0][1]) || 0;
      }
    } else if (channel === "mark-price") {
      obj.mark_price = parseFloat(data.markPx || 0);
      obj.index_price = parseFloat(data.idxPx || 0);
    }

    const prev = this.marketCache.get(key) || {};
    const merged = { ...prev, ...obj };
    this.marketCache.set(key, merged);

    if (this.onData) {
      try {
        this.onData(key, merged);
      } catch (err) {
        console.error("❌ onData callback error:", err?.message || err);
      }
    }
  }

  cleanup() {
    this.subscribed.clear();
    this.marketCache.clear();
  }

  disconnect() {
    console.log("🔌 Disconnecting OKX...");
    
    // Stop heartbeat
    this.stopHeartbeat();
    
    // Clear reconnect timeout
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    
    // Prevent reconnection
    this.maxReconnect = 0;
    
    this.cleanup();
    
    if (this.ws) {
      try {
        if (this.ws.readyState === WebSocket.OPEN) {
          // ✅ Send unsubscribe before closing
          const unsubArgs = Array.from(this.subscribed).map(sub => {
            const [channel, instId] = sub.split('_');
            return { channel, instId };
          });
          
          if (unsubArgs.length > 0) {
            this.ws.send(JSON.stringify({ op: "unsubscribe", args: unsubArgs }));
          }
          
          // Wait a bit before closing
          setTimeout(() => {
            if (this.ws) {
              this.ws.close();
            }
          }, 500);
        } else if (typeof this.ws.terminate === "function") {
          this.ws.terminate();
        }
      } catch (e) {
        console.error("❌ OKX close error:", e?.message || e);
      }
      this.ws = null;
    }
    this.isConnected = false;
    console.log("✅ OKX disconnected");
  }

  _sign(timestamp, method, requestPath, body) {
    if (!this.secret) return "";
    const prehash = `${timestamp}${method}${requestPath}${body || ""}`;
    return crypto.createHmac("sha256", this.secret).update(prehash).digest("base64");
  }

  // ✅ NEW: Helper method to check connection health
  isHealthy() {
    return this.isConnected && 
           this.ws && 
           this.ws.readyState === WebSocket.OPEN;
  }

  getStats() {
    return {
      connected: this.isConnected,
      subscriptions: this.subscribed.size,
      instruments: this.instruments.length,
      cachedMarkets: this.marketCache.size,
      reconnectAttempts: this.reconnectAttempts
    };
  }
}

module.exports = OKXConnector;
class StrategyCalculator {
  constructor() {
    this.marketData = {};
    this.activeStrategies = new Map();
  }

  updateMarketData(key, data) {
    this.marketData[key] = data;
  }

  addStrategy(tableId, config) {
    this.activeStrategies.set(tableId, config);
  }

  removeStrategy(tableId) {
    this.activeStrategies.delete(tableId);
  }

  // In StrategyCalculator.js - Only the relevant methods

getSpotPrice(exchange) {
  const ex = exchange.toLowerCase();
  
  // ✅ Support all three exchanges
  let perpetualKey;
  if (ex === 'binance') {
    perpetualKey = 'binance_btcusdt';
  } else if (ex === 'deribit') {
    perpetualKey = 'deribit_BTC-PERPETUAL';
  } else if (ex === 'bybit') {
    perpetualKey = 'bybit_btcusdt';  // NEW
  } else {
    console.log(`❌ Unknown exchange: ${ex}`);
    return 0;
  }
  
  const val = this.marketData[perpetualKey];
  console.log(`🔍 getSpotPrice: Looking for ${perpetualKey}`);

  if (val) {
    const bid = parseFloat(val.best_bid_price);
    const ask = parseFloat(val.best_ask_price);
    if (Number.isFinite(bid) && Number.isFinite(ask) && bid > 0 && ask > 0) {
      console.log(`✅ getSpotPrice: Found ${perpetualKey}, bid=${bid}, ask=${ask}`);
      return (bid + ask) / 2;
    }
    const last = parseFloat(val.last_price);
    if (Number.isFinite(last) && last > 0) {
      return last;
    }
  }
  
  console.log(`❌ getSpotPrice: ${perpetualKey} not found or invalid`);
  return 0;
}

getFuturePrice(exchange, futureExpiry) {
  const ex = exchange.toLowerCase();

  // If no futureExpiry, return perpetual
  if (!futureExpiry) {
    let perpetualKey;
    if (ex === 'binance') {
      perpetualKey = 'binance_btcusdt';
    } else if (ex === 'deribit') {
      perpetualKey = 'deribit_BTC-PERPETUAL';
    } else if (ex === 'bybit') {
      perpetualKey = 'bybit_btcusdt';  // NEW
    } else {
      return { bid: 0, ask: 0, mid: 0 };
    }
    
    const val = this.marketData[perpetualKey];
    if (val) {
      const bid = parseFloat(val.best_bid_price);
      const ask = parseFloat(val.best_ask_price);
      if (Number.isFinite(bid) && Number.isFinite(ask) && bid > 0 && ask > 0) {
        return { bid, ask, mid: (bid + ask) / 2 };
      }
    }
    return { bid: 0, ask: 0, mid: 0 };
  }
  
  // ✅ Build correct key for each exchange
  let key;
  if (ex === 'binance') {
    key = `binance_btcusdt_${futureExpiry}`.toLowerCase();
  } else if (ex === 'deribit') {
    key = `deribit_BTC-${futureExpiry}`;
  } else if (ex === 'bybit') {
    key = `bybit_btcusdt-${futureExpiry}`.toLowerCase();  // NEW
  } else {
    return { bid: 0, ask: 0, mid: 0 };
  }
  
  console.log(`🔍 getFuturePrice: Looking for ${key}`);
  
  if (this.marketData[key]) {
    const fut = this.marketData[key];
    const bid = parseFloat(fut.best_bid_price);
    const ask = parseFloat(fut.best_ask_price);
    
    if (Number.isFinite(bid) && Number.isFinite(ask) && bid > 0 && ask > 0) {
      return { bid, ask, mid: (bid + ask) / 2 };
    }
  }
  
  return { bid: 0, ask: 0, mid: 0 };
}

getAllFutureExpiries(exchange) {
  const ex = exchange.toLowerCase();
  const expiries = new Set();
  
  for (const [key, val] of Object.entries(this.marketData)) {
    if (!val || !key.startsWith(`${ex}_`)) continue;
    
    if (ex === 'deribit') {
      const match = key.match(/^deribit_BTC-(\d{1,2}[A-Z]{3}\d{2})$/i);
      if (match && !key.includes('PERPETUAL')) {
        expiries.add(match[1].toUpperCase());
      }
    } else if (ex === 'binance') {
      const match = key.match(/^binance_btcusdt_(\d{6})$/i);
      if (match) {
        expiries.add(match[1]);
      }
    } else if (ex === 'bybit') {  // NEW
      // Bybit format: bybit_btcusdt-27dec24
      const match = key.match(/^bybit_btcusdt-(\d{2}[a-z]{3}\d{2})$/i);
      if (match) {
        expiries.add(match[1].toUpperCase());
      }
    }
  }
  
  return Array.from(expiries).sort();
}
  
  getOptionQuote(exchange, expiry, strike, type){
    const ex = exchange.toLowerCase();
    
    // ✅ Build correct key for each exchange
    let symbol, key;
    
    if (ex === 'bybit') {
      // ✅ FIX: Bybit keys are stored in lowercase after normalization
      symbol = `BTC-${expiry.toUpperCase()}-${strike}-${type.toUpperCase()}-USDT`;
      key = `bybit_${symbol.toLowerCase()}`;
    } else if (ex === 'binance') {
      symbol = `BTC-${expiry}-${strike}-${type}`;
      key = `binance_${symbol}`;
    } else {
      // Deribit format
      symbol = `BTC-${expiry}-${strike}-${type}`;
      key = `deribit_${symbol}`;
    }
    
    const q = this.marketData[key];
    if (!q) {
      console.log(`❌ Option quote not found: ${key}`);
      
      // ✅ Debug: Show available keys for this exchange
      const availableKeys = Object.keys(this.marketData)
        .filter(k => k.startsWith(`${ex}_BTC-${expiry}`))
        .slice(0, 5);
      if (availableKeys.length > 0) {
        console.log(`📊 Available keys for ${ex}_BTC-${expiry}:`,  availableKeys.slice(0, 10));
      }
      return null;
    }
    
    const bid = parseFloat(q.best_bid_price);
    const ask = parseFloat(q.best_ask_price);
    const mark = parseFloat(q.mark_price);
    const last = parseFloat(q.last_price);
    
    const mid = Number.isFinite(bid) && Number.isFinite(ask) 
      ? (bid + ask) / 2 
      : (Number.isFinite(mark) ? mark : last);
    
    return {
      bid: Number.isFinite(bid) ? bid : null,
      ask: Number.isFinite(ask) ? ask : null,
      mark: Number.isFinite(mark) ? mark : null,
      mid: Number.isFinite(mid) ? mid : null,
      last: Number.isFinite(last) ? last : null
    };
  }
  calculateJelly(config, strikes) {
    const { exchange, optionExpiry, futureExpiry } = config;
    const ex = exchange.toLowerCase();
    const fut = this.getFuturePrice(ex, futureExpiry);
    const spotPrice = this.getSpotPrice(ex);
    const nearestStrike = Math.round(spotPrice / 1000) * 1000;
    
    return strikes.map(strike => {
      const ce = this.getOptionQuote(ex, optionExpiry, strike, 'C');
      const pe = this.getOptionQuote(ex, optionExpiry, strike, 'P');
      if (!ce || !pe) return null;
      
      const ce_bid = ce.bid;
      const ce_ask = ce.ask;
      const pe_bid = pe.bid;
      const pe_ask = pe.ask;
      
      let conversion = null;
      let reversal = null;
      
      if ([ce_bid, pe_ask, fut.ask, ce_ask, pe_bid, fut.bid].every(v => v !== null)) {
        conversion = (ce_bid + strike) - (pe_ask + fut.ask);
        reversal = (pe_bid + fut.bid) - (ce_ask + strike);
      }
      return {
        strike,
        conversion: conversion !== null ? conversion.toFixed(2) : null,
        reversal: reversal !== null ? reversal.toFixed(2) : null,
        nearest_strike: nearestStrike,
        ce_ltp: ce.last?.toFixed(2),
        pe_ltp: pe.last?.toFixed(2)
      };
    }).filter(Boolean);
  }

  calculateSynthetic(config, strikes) {
  const { exchange, optionExpiry } = config;
  const ex = exchange.toLowerCase();
  
  // ✅ Try to get future with same expiry
  let fut = this.getFuturePrice(ex, optionExpiry);
  
  const spotPrice = this.getSpotPrice(ex);
  const nearestStrike = Math.round(spotPrice / 1000) * 1000;
  
  // ✅ Check if future exists for this expiry
  const hasFuture = fut.bid && fut.ask && fut.bid > 0 && fut.ask > 0;
  
  if (hasFuture) {
    console.log(`✅ Synthetic: Using future for expiry ${optionExpiry}`);
    console.log(`📊 Future price: bid=${fut.bid}, ask=${fut.ask}`);
  } else {
    console.log(`⚠️ Synthetic: No future for ${optionExpiry}, using CE/PE only`);
  }
  
  return strikes.map(strike => {
    const ce = this.getOptionQuote(ex, optionExpiry, strike, 'C');
    const pe = this.getOptionQuote(ex, optionExpiry, strike, 'P');
    if (!ce || !pe) return null;
    
    const ce_bid = ce.bid;
    const ce_ask = ce.ask;
    const pe_bid = pe.bid;
    const pe_ask = pe.ask;
    
    let conversion = null;
    let reversal = null;
    
    if (hasFuture) {
      // ✅ Original formula with future
      if ([ce_bid, pe_ask, fut.ask, ce_ask, pe_bid, fut.bid].every(v => v !== null && v > 0)) {
        conversion = (ce_bid + strike) - (pe_ask + fut.ask);
        reversal = (pe_bid + fut.bid) - (ce_ask + strike);
      }
    } else {
      // ✅ NEW: Synthetic without future - use CE/PE prices only
      // Formula: Synthetic Long = CE_bid - PE_ask
      //          Synthetic Short = PE_bid - CE_ask
      if ([ce_bid, pe_ask, ce_ask, pe_bid].every(v => v !== null && v > 0)) {
        conversion = ce_bid - pe_ask;
        reversal = pe_bid - ce_ask;
      }
    }
    
    return {
      strike,
      conversion: conversion !== null ? conversion.toFixed(2) : null,
      reversal: reversal !== null ? reversal.toFixed(2) : null,
      nearest_strike: nearestStrike,
      ce_ltp: ce.last?.toFixed(2),
      pe_ltp: pe.last?.toFixed(2)
    };
  }).filter(Boolean);
}
  calculateButterfly(config, strikes) {
    const { exchange, optionExpiry, gap } = config;
    const ex = exchange.toLowerCase();
    const gapNum = parseInt(gap) || 1000;
    const spotPrice = this.getSpotPrice(ex);
    const nearestStrike = Math.round(spotPrice / 1000) * 1000;
    
    const results = [];
    
    ['CE', 'PE'].forEach(type => {
      strikes.forEach(l2 => {
        const l1 = l2 - gapNum;
        const l3 = l2 + gapNum;
        
        if (!strikes.includes(l1) || !strikes.includes(l3)) return;
        
        const optType = type === 'CE' ? 'C' : 'P';
        const q1 = this.getOptionQuote(ex, optionExpiry, l1, optType);
        const q2 = this.getOptionQuote(ex, optionExpiry, l2, optType);
        const q3 = this.getOptionQuote(ex, optionExpiry, l3, optType);
        
        if (!q1 || !q2 || !q3) return;
        
        const bid1 = q1.bid, ask1 = q1.ask;
        const bid2 = q2.bid, ask2 = q2.ask;
        const bid3 = q3.bid, ask3 = q3.ask;
        
        if ([bid1, ask1, bid2, ask2, bid3, ask3].some(v => v === null)) return;
        
        const longValue = (bid2 * 2) - (ask1 + ask3);
        const shortValue = (bid1 + bid3) - (ask2 * 2);
        
        results.push({
          type,
          l2,
          long_value: longValue.toFixed(2),
          short_value: shortValue.toFixed(2),
          l2_ltp: (q2.last || q2.mid).toFixed(2),
          nearest_strike: nearestStrike
        });
      });
    });
    return results;
  }
  calculateCashFuture(config) {
  const { exchange, fut1Expiry, fut2Expiry, noPrtFolio, selectedFutures } = config;
  const ex = exchange.toLowerCase();
  
  const results = [];
  
  // Custom mode (manual selection)
  if (Array.isArray(selectedFutures) && selectedFutures.length > 0) {
    selectedFutures.forEach(item => {
      const [itemExchange, fut1, fut2] = item.split('_');
      
      const fut1Price = this.getFuturePrice(itemExchange.toLowerCase(), fut1 === 'perpetual' ? null : fut1);
      const fut2Price = this.getFuturePrice(itemExchange.toLowerCase(), fut2);
      
      if (fut1Price.bid && fut1Price.ask && fut2Price.bid && fut2Price.ask) {
        const fs = fut2Price.bid - fut1Price.ask;
        const rs = fut1Price.bid - fut2Price.ask;
        
        results.push({
          exchange: itemExchange.toLowerCase(),
          fut1: fut1,
          fut2: fut2,
          fs: fs.toFixed(2),
          rs: rs.toFixed(2)
        });
      }
    });
    
    return results;
  }
  
  // Auto mode
  const fut1List = [];
  const fut2List = [];
  
  // Get Fut1 list
  if (fut1Expiry === '' || fut1Expiry === 'all') {
    // Include perpetual + all futures
    fut1List.push('perpetual');
    fut1List.push(...this.getAllFutureExpiries(exchange));
  } else {
    fut1List.push(fut1Expiry);
  }
  
  // Get Fut2 list
  if (fut2Expiry === '' || fut2Expiry === 'all') {
    fut2List.push(...this.getAllFutureExpiries(exchange));
  } else {
    fut2List.push(fut2Expiry);
  }
  
  // Generate matrix
  fut1List.forEach(f1 => {
    fut2List.forEach(f2 => {
      const fut1Price = this.getFuturePrice(ex, f1 === 'perpetual' ? null : f1);
      const fut2Price = this.getFuturePrice(ex, f2);
      
      if (fut1Price.bid && fut1Price.ask && fut2Price.bid && fut2Price.ask) {
        const fs = fut2Price.bid - fut1Price.ask;
        const rs = fut1Price.bid - fut2Price.ask;
        
        results.push({
          exchange: ex,
          fut1: f1,
          fut2: f2,
          fs: fs.toFixed(2),
          rs: rs.toFixed(2)
        });
      }
    });
  });
  
  // Apply portfolio limit
  const limit = parseInt(noPrtFolio) || 10;
  return results.slice(0, limit);
}

  sortExpiriesByDate(expiries, exchange) {
    const ex = exchange.toLowerCase();
    
    return expiries.sort((a, b) => {
      const dateA = this.parseExpiryDate(a, ex);
      const dateB = this.parseExpiryDate(b, ex);
      return dateA - dateB;
    });
  }

  parseExpiryDate(expiry, exchange) {
    const ex = exchange.toLowerCase();
    
    if (ex === 'binance') {
      if (/^\d{6}$/.test(expiry)) {
        const year = 2000 + parseInt(expiry.substring(0, 2));
        const month = parseInt(expiry.substring(2, 4)) - 1;
        const day = parseInt(expiry.substring(4, 6));
        return new Date(year, month, day);
      }
    } else if (ex === 'deribit') {
      const match = expiry.match(/^(\d{1,2})([A-Z]{3})(\d{2})$/);
      if (match) {
        const day = parseInt(match[1]);
        const monthMap = {
          JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
          JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11
        };
        const month = monthMap[match[2]];
        const year = 2000 + parseInt(match[3]);
        return new Date(year, month, day);
      }
    }
    
    return new Date(0);
  }
  
  calculateStrategy(tableId) {
    const config = this.activeStrategies.get(tableId);
    if (!config) {
      return null;
    }
    
    const { strategy, strikeInterval, noPrtFolio } = config;
    const spotPrice = this.getSpotPrice(config.exchange);
    const nearestStrike = Math.round(spotPrice / (strikeInterval || 1000)) * (strikeInterval || 1000);
    
    const strikes = [];
    const portfolioCount = parseInt(noPrtFolio) || 10;
    for (let i = -portfolioCount; i <= portfolioCount; i++) {
      strikes.push(nearestStrike + (i * (strikeInterval || 1000)));
    }
    
    const strategyLower = strategy.toLowerCase();

    if (strategyLower === 'jelly') {
      return {
        tableId,
        strategy: strategy,
        spotPrice: spotPrice.toFixed(2),
        data: this.calculateJelly(config, strikes),
        timestamp: Date.now()
      };
    } else if (strategyLower === 'synthetic') {
      return {
        tableId,
        strategy: strategy,
        spotPrice: spotPrice.toFixed(2),
        data: this.calculateSynthetic(config, strikes),
        timestamp: Date.now()
      };
    } else if (strategyLower === 'butterfly') {
      return {
        tableId,
        strategy: strategy,
        spotPrice: spotPrice.toFixed(2),
        data: this.calculateButterfly(config, strikes),
        timestamp: Date.now()
      };
    } else if (strategyLower === 'ratio') {
      return {
        tableId,
        strategy: strategy,
        spotPrice: spotPrice.toFixed(2),
        data: this.calculateRatio(config, strikes),
        timestamp: Date.now()
      };
    } else if (strategyLower === 'pulse_butterfly') {
      return {
        tableId,
        strategy: strategy,
        spotPrice: spotPrice.toFixed(2),
        data: this.calculatePulseButterfly(config, strikes),
        timestamp: Date.now()
      };
    } else if (strategyLower === 'c-f/f') {
      const cashFutureData = this.calculateCashFuture(config);
      return {
        tableId,
        strategy: strategy,
        spotPrice: spotPrice.toFixed(2),
        data: cashFutureData,
        timestamp: Date.now()
      };
    }

    return null;
  }

  calculateAllStrategies() {
    const results = [];
    
    for (const [tableId, config] of this.activeStrategies.entries()) {
      const result = this.calculateStrategy(tableId);
      if (result) {
        results.push(result);
      }
    }
    
    return results;
  }

  calculateRatio(config, strikes) {
    const { exchange, optionExpiry, gap, ratio1, ratio2 } = config;
    const ex = exchange.toLowerCase();
    const gapNum = parseInt(gap) || 1000;
    const r1 = parseInt(ratio1) || 1;
    const r2 = parseInt(ratio2) || 2;
    const spotPrice = this.getSpotPrice(ex);
    const nearestStrike = Math.round(spotPrice / 1000) * 1000;
    
    const input1 = 1.0;
    const input2 = r2 / r1;
    
    const results = [];
    
    ['CE', 'PE'].forEach(type => {
      strikes.forEach(l1 => {
        const l2 = type === 'CE' ? l1 + gapNum : l1 - gapNum;
        if (!strikes.includes(l2)) return;
        
        const optType = type === 'CE' ? 'C' : 'P';
        const q1 = this.getOptionQuote(ex, optionExpiry, l1, optType);
        const q2 = this.getOptionQuote(ex, optionExpiry, l2, optType);
        
        if (!q1 || !q2) return;
        
        const bid1 = q1.bid, ask1 = q1.ask;
        const bid2 = q2.bid, ask2 = q2.ask;
        
        if ([bid1, ask1, bid2, ask2].some(v => v === null)) return;
        
        const buyValue = (bid2 * input2) - (ask1 * input1);
        const sellValue = (bid1 * input1) - (ask2 * input2);
        
        results.push({
          type,
          l1,
          l2,
          buy_value: buyValue.toFixed(2),
          sell_value: sellValue.toFixed(2),
          l1_ltp: (q1.last || q1.mid).toFixed(2),
          nearest_strike: nearestStrike
        });
      });
    });
    
    return results;
  }

  calculatePulseButterfly(config, strikes) {
    const { exchange, optionExpiry, gap, strategyLegType } = config;
    const ex = exchange.toLowerCase();
    const gapNum = parseInt(gap) || 1000;
    const spotPrice = this.getSpotPrice(ex);
    const nearestStrike = Math.round(spotPrice / 1000) * 1000;
    
    const results = [];
    
    ['CE', 'PE'].forEach(type => {
      strikes.forEach(l2 => {
        let l1, l3, l4;
        
        if (type === 'CE') {
          l1 = l2 - gapNum;
          l3 = strategyLegType === '1331' ? l2 + gapNum : l2 + 2 * gapNum;
          l4 = l3 + gapNum;
        } else {
          l1 = l2 + gapNum;
          l3 = strategyLegType === '1331' ? l2 - gapNum : l2 - 2 * gapNum;
          l4 = l3 - gapNum;
        }
        
        if (![l1, l3, l4].every(s => strikes.includes(s))) return;
        
        const optType = type === 'CE' ? 'C' : 'P';
        const q1 = this.getOptionQuote(ex, optionExpiry, l1, optType);
        const q2 = this.getOptionQuote(ex, optionExpiry, l2, optType);
        const q3 = this.getOptionQuote(ex, optionExpiry, l3, optType);
        const q4 = this.getOptionQuote(ex, optionExpiry, l4, optType);
        
        if (!q1 || !q2 || !q3 || !q4) return;
        
        const bid1 = q1.bid, ask1 = q1.ask;
        const bid2 = q2.bid, ask2 = q2.ask;
        const bid3 = q3.bid, ask3 = q3.ask;
        const bid4 = q4.bid, ask4 = q4.ask;
        
        if ([bid1, ask1, bid2, ask2, bid3, ask3, bid4, ask4].some(v => v === null)) return;
        
        let longValue, shortValue;
        if (strategyLegType === '1331') {
          longValue = (bid2 * 3 + bid4) - (ask1 + ask3 * 3);
          shortValue = (bid1 + bid3 * 3) - (ask2 * 3 + ask4);
        } else {
          longValue = (bid2 * 2 + bid4) - (ask1 + ask3 * 2);
          shortValue = (bid1 + bid3 * 2) - (ask2 * 2 + ask4);
        }
        
        results.push({
          type,
          l2,
          long_value: longValue.toFixed(2),
          short_value: shortValue.toFixed(2),
          l2_ltp: (q2.last || q2.mid).toFixed(2),
          nearest_strike: nearestStrike
        });
      });
    });
    
    return results;
  }
}

module.exports = StrategyCalculator;
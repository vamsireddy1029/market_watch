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

  getSpotPrice(exchange, symbol = 'BTC') {
    const ex = exchange.toLowerCase();
    const sym = symbol.toLowerCase();
    
    let perpetualKey;
    if (ex === 'binance') {
      perpetualKey = 'binance_BTCUSDT';
    } else if (ex === 'deribit') {
      perpetualKey = `deribit_${sym}_${symbol.toUpperCase()}-PERPETUAL`;
    } else if (ex === 'bybit') {
      perpetualKey = 'bybit_BTCUSDT'; 
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

  getFuturePrice(exchange, futureExpiry, symbol = 'BTC') {
    const ex = exchange.toLowerCase();
    const sym = symbol.toLowerCase();
    
    if (!futureExpiry) {
      let perpetualKey;
      if (ex === 'binance') {
        perpetualKey = 'binance_BTCUSDT';
      } else if (ex === 'deribit') {
        perpetualKey = `deribit_${sym}_${symbol.toUpperCase()}-PERPETUAL`;
      } else if (ex === 'bybit') {
        perpetualKey = 'bybit_BTCUSDT';
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
    
    let key;
    if (ex === 'binance') {
      key = `binance_BTCUSDT_${futureExpiry}`;
    } else if (ex === 'deribit') {
      key = `deribit_${sym}_${symbol.toUpperCase()}-${futureExpiry}`;
    } else if (ex === 'bybit') {
      key = `bybit_BTCUSDT-${futureExpiry}`;
    } else {
      return { bid: 0, ask: 0, mid: 0 };
    }
    
    console.log(`🔍 getFuturePrice: Looking for ${key}`);
    
    if (this.marketData[key]) {
      const fut = this.marketData[key];
      const bid = parseFloat(fut.best_bid_price);
      const ask = parseFloat(fut.best_ask_price);
       const last = parseFloat(fut.last_price);
       
       if (ex === 'binance' && (!Number.isFinite(bid) || bid === 0 || !Number.isFinite(ask) || ask === 0)) {
        if (Number.isFinite(last) && last > 0) {
          console.log(`⚠️ Using last_price as fallback for ${key}: ${last}`);
          return { bid: last, ask: last, mid: last };
        }
      }
      
      if (Number.isFinite(bid) && Number.isFinite(ask) && bid > 0 && ask > 0) {
        return { bid, ask, mid: (bid + ask) / 2 };
      }
    }
    
    return { bid: 0, ask: 0, mid: 0 };
  }

  getAllFutureExpiries(exchange, symbol = 'BTC') {
  const ex = exchange.toLowerCase();
  const sym = symbol.toLowerCase();
  const expiries = new Set();
  
  console.log(`🔍 Searching for ${ex} ${symbol} futures in marketData...`);
  console.log(`📊 Total marketData keys: ${Object.keys(this.marketData).length}`);
  
  for (const [key, val] of Object.entries(this.marketData)) {
    if (!val || !key.startsWith(`${ex}_`)) continue;
    
    if (ex === 'deribit') {
      // Match pattern: deribit_btc_BTC-24OCT25 or deribit_eth_ETH-24OCT25
      const match = key.match(new RegExp(`^deribit_${sym}_${symbol.toUpperCase()}-(\\d{1,2}[A-Z]{3}\\d{2})$`));
      if (match && !key.includes('PERPETUAL')) {
        expiries.add(match[1]);
        console.log(`✅ Found Deribit future: ${match[1]} from key: ${key}`);
      }
    } else if (ex === 'binance') {
      // Match pattern: binance_BTCUSDT_241018
      const match = key.match(/^binance_[A-Z]+USDT_(\d{6})$/);
      if (match) {
        expiries.add(match[1]);
        console.log(`✅ Found Binance future: ${match[1]} from key: ${key}`);
      }
    } else if (ex === 'bybit') {
      // Match pattern: bybit_BTCUSDT-18OCT24
      const match = key.match(/^bybit_[A-Z]+USDT-(\d{2}[A-Z]{3}\d{2})$/i);
      if (match) {
        expiries.add(match[1].toUpperCase());
        console.log(`✅ Found Bybit future: ${match[1]} from key: ${key}`);
      }
    }
  }
  
  const result = Array.from(expiries).sort();
  console.log(`📊 Total expiries found for ${ex} ${symbol}: ${result.length}`, result);
  
  return result;
}
  
  getOptionQuote(exchange, expiry, strike, type, symbol = 'BTC') {
    const ex = exchange.toLowerCase();
    const sym = symbol.toUpperCase();
    let key;
    
    if (ex === 'bybit') {
      key = `bybit_${sym}-${expiry}-${strike}-${type}`;
    } else if (ex === 'binance') {
      key = `binance_${sym}-${expiry}-${strike}-${type}`
    } else if (ex === 'deribit') {
      key = `deribit_${symbol.toLowerCase()}_${sym}-${expiry}-${strike}-${type}`;
    }
    
    const q = this.marketData[key];
    if (!q) {
      console.log(`❌ Option quote not found: ${key}`);
      
      const availableKeys = Object.keys(this.marketData)
        .filter(k => k.startsWith(`${ex}_`) && k.includes(expiry))
        .slice(0, 5);
      if (availableKeys.length > 0) {
        console.log(`📊 Available keys for ${ex}_*_${expiry}:`, availableKeys);
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
    const { exchange, optionExpiry, futureExpiry, symbol = 'BTC' } = config;
    const ex = exchange.toLowerCase();
    const fut = this.getFuturePrice(ex, futureExpiry, symbol);
    const spotPrice = this.getSpotPrice(ex, symbol);
    const strikeInterval = parseInt(config.strikeInterval) || (symbol === 'ETH' ? 50 : 1000);
    const nearestStrike = Math.round(spotPrice / strikeInterval) * strikeInterval;
    
    return strikes.map(strike => {
      const ce = this.getOptionQuote(ex, optionExpiry, strike, 'C', symbol);
      const pe = this.getOptionQuote(ex, optionExpiry, strike, 'P', symbol);
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
    const { exchange, optionExpiry, symbol = 'BTC' } = config;
    const ex = exchange.toLowerCase();
    
    let fut = this.getFuturePrice(ex, optionExpiry, symbol);
    
    const spotPrice = this.getSpotPrice(ex, symbol);
    const strikeInterval = parseInt(config.strikeInterval) || (symbol === 'ETH' ? 50 : 1000);
    const nearestStrike = Math.round(spotPrice / strikeInterval) * strikeInterval;
    
    const hasFuture = fut.bid && fut.ask && fut.bid > 0 && fut.ask > 0;
    
    if (hasFuture) {
      console.log(`✅ Synthetic: Using future for expiry ${optionExpiry}`);
      console.log(`📊 Future price: bid=${fut.bid}, ask=${fut.ask}`);
    } else {
      console.log(`⚠️ Synthetic: No future for ${optionExpiry}, using CE/PE only`);
    }
    
    return strikes.map(strike => {
      const ce = this.getOptionQuote(ex, optionExpiry, strike, 'C', symbol);
      const pe = this.getOptionQuote(ex, optionExpiry, strike, 'P', symbol);
      if (!ce || !pe) return null;
      
      const ce_bid = ce.bid;
      const ce_ask = ce.ask;
      const pe_bid = pe.bid;
      const pe_ask = pe.ask;
      
      let conversion = null;
      let reversal = null;
      
      if (hasFuture) {
        if ([ce_bid, pe_ask, fut.ask, ce_ask, pe_bid, fut.bid].every(v => v !== null && v > 0)) {
          conversion = (ce_bid + strike) - (pe_ask + fut.ask);
          reversal = (pe_bid + fut.bid) - (ce_ask + strike);
        }
      } else {
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
    const { exchange, optionExpiry, gap, symbol = 'BTC' } = config;
    const ex = exchange.toLowerCase();
    const gapNum = parseInt(gap) || (symbol === 'ETH' ? 50 : 1000);
    const spotPrice = this.getSpotPrice(ex, symbol);
    const strikeInterval = parseInt(config.strikeInterval) || (symbol === 'ETH' ? 50 : 1000);
    const nearestStrike = Math.round(spotPrice / strikeInterval) * strikeInterval;
    
    const results = [];
    
    ['CE', 'PE'].forEach(type => {
      strikes.forEach(l2 => {
        const l1 = l2 - gapNum;
        const l3 = l2 + gapNum;
        
        if (!strikes.includes(l1) || !strikes.includes(l3)) return;
        
        const optType = type === 'CE' ? 'C' : 'P';
        const q1 = this.getOptionQuote(ex, optionExpiry, l1, optType, symbol);
        const q2 = this.getOptionQuote(ex, optionExpiry, l2, optType, symbol);
        const q3 = this.getOptionQuote(ex, optionExpiry, l3, optType, symbol);
        
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

  // StrategyCalculator.js - Replace calculateCashFuture() method (around line 180)

calculateCashFuture(config) {
  const { exchange, fut1Expiry, fut2Expiry, noPrtFolio, selectedFutures, symbol = 'BTC' } = config;
  const ex = exchange.toLowerCase();
  
  const results = [];
  
  // ✅ CUSTOM MODE: User has manually selected specific future pairs
  if (Array.isArray(selectedFutures) && selectedFutures.length > 0) {
    console.log('📋 C-F/F Custom Mode - Processing selected futures:', selectedFutures);
    
    selectedFutures.forEach(item => {
      const [itemExchange, fut1, fut2] = item.split('_');
      
      const fut1Price = this.getFuturePrice(itemExchange.toLowerCase(), fut1 === 'perpetual' ? null : fut1, symbol);
      const fut2Price = this.getFuturePrice(itemExchange.toLowerCase(), fut2, symbol);
      
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
    
    console.log(`✅ Custom mode: ${results.length} rows generated`);
    return results;
  }
  
  // ✅ ALL EXPIRIES MODE: Generate combinations
  console.log('📋 C-F/F All Expiries Mode');
  console.log(`📊 Config: fut1Expiry="${fut1Expiry}", fut2Expiry="${fut2Expiry}", symbol="${symbol}"`);
  
  const fut1List = [];
  const fut2List = [];
  
  // ✅ CRITICAL FIX: Handle Fut1 selection properly
  const fut1Lower = (fut1Expiry || '').toLowerCase();
  
  if (!fut1Expiry || fut1Lower === '' || fut1Lower === 'all' || fut1Lower === 'all expiries') {
    console.log('🔄 Fut1: Adding perpetual + all expiries');
    fut1List.push('perpetual');
    const allExpiries = this.getAllFutureExpiries(exchange, symbol);
    fut1List.push(...allExpiries);
  } else if (fut1Lower === 'perpetual') {
    console.log('🔄 Fut1: Perpetual only');
    fut1List.push('perpetual');
  } else {
    console.log(`🔄 Fut1: Specific expiry - ${fut1Expiry}`);
    fut1List.push(fut1Expiry);
  }
  
  // ✅ CRITICAL FIX: Handle Fut2 selection properly
  const fut2Lower = (fut2Expiry || '').toLowerCase();
  
  if (!fut2Expiry || fut2Lower === '' || fut2Lower === 'all' || fut2Lower === 'all expiries') {
    console.log('🔄 Fut2: Adding all expiries (including perpetual for Binance)');
    const allExpiries = this.getAllFutureExpiries(exchange, symbol);
    
    // ✅ For Binance, add perpetual to Fut2 if not already in Fut1
    if (ex === 'binance' && !fut1List.includes('perpetual')) {
      fut2List.push('perpetual');
    }
    
    fut2List.push(...allExpiries);
  } else if (fut2Lower === 'perpetual') {
    console.log('🔄 Fut2: Perpetual only');
    fut2List.push('perpetual');
  } else {
    console.log(`🔄 Fut2: Specific expiry - ${fut2Expiry}`);
    fut2List.push(fut2Expiry);
  }
  
  console.log(`📊 Fut1 list (${fut1List.length}):`, fut1List);
  console.log(`📊 Fut2 list (${fut2List.length}):`, fut2List);
  
  // ✅ Validate we have futures to process
  if (fut1List.length === 0) {
    console.warn('⚠️ No Fut1 expiries available!');
    return [];
  }
  
  if (fut2List.length === 0) {
    console.warn('⚠️ No Fut2 expiries available!');
    return [];
  }
  
  console.log(`🔍 Generating combinations: ${fut1List.length} x ${fut2List.length} = ${fut1List.length * fut2List.length} possible pairs`);
  
  // ✅ Generate all combinations
  let generatedCount = 0;
  fut1List.forEach(f1 => {
    fut2List.forEach(f2 => {
      // ✅ Skip if same expiry
      if (f1 === f2) {
        console.log(`⏭️ Skipping same expiry pair: ${f1} x ${f2}`);
        return;
      }
      
      const fut1Price = this.getFuturePrice(ex, f1 === 'perpetual' ? null : f1, symbol);
      const fut2Price = this.getFuturePrice(ex, f2 === 'perpetual' ? null : f2, symbol);
      
      if (fut1Price.bid && fut1Price.ask && fut2Price.bid && fut2Price.ask &&
          fut1Price.bid > 0 && fut2Price.bid > 0) {
        const fs = fut2Price.bid - fut1Price.ask;
        const rs = fut1Price.bid - fut2Price.ask;
        
        results.push({
          exchange: ex,
          fut1: f1,
          fut2: f2,
          fs: fs.toFixed(2),
          rs: rs.toFixed(2)
        });
        generatedCount++;
      } else {
        console.log(`⚠️ Missing/invalid price for: ${f1} x ${f2}`);
      }
    });
  });
  
  console.log(`✅ Generated ${generatedCount} valid pairs out of ${fut1List.length * fut2List.length} combinations`);
  
  // ✅ Apply portfolio limit
  const limit = parseInt(noPrtFolio) || 10;
  
  if (results.length > limit) {
    console.log(`📊 Limiting from ${results.length} to ${limit} rows`);
    return results.slice(0, limit);
  }
  
  console.log(`📊 Returning ${results.length} rows (no limit applied)`);
  return results;
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
    
    const { strategy, strikeInterval, noPrtFolio, symbol = 'BTC' } = config;
    const spotPrice = this.getSpotPrice(config.exchange, symbol);
    const interval = parseInt(strikeInterval) || (symbol === 'ETH' ? 50 : 1000);
    const nearestStrike = Math.round(spotPrice / interval) * interval;
    
    const strikes = [];
    const portfolioCount = parseInt(noPrtFolio) || 10;
    for (let i = -portfolioCount; i <= portfolioCount; i++) {
      strikes.push(nearestStrike + (i * interval));
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
    const { exchange, optionExpiry, gap, ratio1, ratio2, symbol = 'BTC' } = config;
    const ex = exchange.toLowerCase();
    const gapNum = parseInt(gap) || (symbol === 'ETH' ? 50 : 1000);
    const r1 = parseInt(ratio1) || 1;
    const r2 = parseInt(ratio2) || 2;
    const spotPrice = this.getSpotPrice(ex, symbol);
    const strikeInterval = parseInt(config.strikeInterval) || (symbol === 'ETH' ? 50 : 1000);
    const nearestStrike = Math.round(spotPrice / strikeInterval) * strikeInterval;
    
    const input1 = 1.0;
    const input2 = r2 / r1;
    
    const results = [];
    
    ['CE', 'PE'].forEach(type => {
      strikes.forEach(l1 => {
        const l2 = type === 'CE' ? l1 + gapNum : l1 - gapNum;
        if (!strikes.includes(l2)) return;
        
        const optType = type === 'CE' ? 'C' : 'P';
        const q1 = this.getOptionQuote(ex, optionExpiry, l1, optType, symbol);
        const q2 = this.getOptionQuote(ex, optionExpiry, l2, optType, symbol);
        
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
    const { exchange, optionExpiry, gap, strategyLegType, symbol = 'BTC' } = config;
    const ex = exchange.toLowerCase();
    const gapNum = parseInt(gap) || (symbol === 'ETH' ? 50 : 1000);
    const spotPrice = this.getSpotPrice(ex, symbol);
    const strikeInterval = parseInt(config.strikeInterval) || (symbol === 'ETH' ? 50 : 1000);
    const nearestStrike = Math.round(spotPrice / strikeInterval) * strikeInterval;
    
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
        const q1 = this.getOptionQuote(ex, optionExpiry, l1, optType, symbol);
        const q2 = this.getOptionQuote(ex, optionExpiry, l2, optType, symbol);
        const q3 = this.getOptionQuote(ex, optionExpiry, l3, optType, symbol);
        const q4 = this.getOptionQuote(ex, optionExpiry, l4, optType, symbol);
        
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
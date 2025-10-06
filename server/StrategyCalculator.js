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

  getSpotPrice(exchange) {
    const ex = exchange.toLowerCase();
    
    for (const [key, val] of Object.entries(this.marketData)) {
      if (!val || val.exchange?.toLowerCase() !== ex) continue;
      
      const inst = (val.instrument || '').toUpperCase();
      
      if (ex === 'deribit' && inst === 'BTC-PERPETUAL') {
        const bid = parseFloat(val.best_bid_price);
        const ask = parseFloat(val.best_ask_price);
        if (Number.isFinite(bid) && Number.isFinite(ask)) {
          return (bid + ask) / 2;
        }
        return parseFloat(val.last_price) || 0;
      }
      
      if (ex === 'binance' && inst.includes('BTCUSDT')) {
        const bid = parseFloat(val.best_bid_price);
        const ask = parseFloat(val.best_ask_price);
        if (Number.isFinite(bid) && Number.isFinite(ask)) {
          return (bid + ask) / 2;
        }
        return parseFloat(val.last_price) || 0;
      }
    }
    
    return 0;
  }
  
  getFuturePrice(exchange, futureExpiry){
    const ex = exchange.toLowerCase();
    if (futureExpiry) {
      const futureSymbol = `BTC-${futureExpiry}`;
      const key = `${ex}_${futureSymbol}`;
      if (this.marketData[key]) {
        const fut = this.marketData[key];
        const bid = parseFloat(fut.best_bid_price);
        const ask = parseFloat(fut.best_ask_price);
        if (Number.isFinite(bid) && Number.isFinite(ask)) {
          return { bid, ask, mid: (bid + ask) / 2 };
        }
      }
    }
    const spot = this.getSpotPrice(exchange);
    return { bid: spot, ask: spot, mid: spot };
  }
  
  getOptionQuote(exchange, expiry, strike, type){
    const ex = exchange.toLowerCase();
    const symbol = `BTC-${expiry}-${strike}-${type}`;
    const key = `${ex}_${symbol}`;
    const q = this.marketData[key];
    if (!q) return null;
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
      const updatedConfig = {
      ...config,
      futureExpiry: config.optionExpiry
    };
    return this.calculateJelly(updatedConfig, strikes);
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

  calculateStrategy(tableId) {
    const config = this.activeStrategies.get(tableId);
    if (!config) return null;
    
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
}

module.exports = StrategyCalculator;
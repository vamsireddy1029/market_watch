import React from "react";
import "./ExchangeSelector.css";

const instrumentTypes = [
  { value: "future", label: "Futures", icon: "📈" },
  { value: "option", label: "Options", icon: "🎯" },
  { value: "spot", label: "Spot", icon: "💰" },
  { value: "swap", label: "Perpetual", icon: "🔄" },
];

const ExchangeSelector = ({
  exchanges,
  selectedExchanges,
  onExchangeToggle,
  onExit,
  config,
  onConfigChange,
  availableData,
  onSubmit,
  marketData = {},
  onAddInstance,
}) => {
  const handleStrategyClick = () => {
    const params = new URLSearchParams();
    const selected = selectedExchanges.join(",");
    if (selected) {
      params.set("selected", selected);
      if (selectedExchanges.length > 0) {
        params.set("default", selectedExchanges[0]);
      }
    }
    window.open(`/strategy?${params.toString()}`, "_blank");
  };

  const parseExpiry = (exp) => {
    if (!exp || typeof exp !== "string") return new Date(0);

    const dayMatch = exp.match(/^\d+/);
    const monthMatch = exp.match(/[A-Z]+/);
    const yearMatch = exp.match(/\d+$/);

    if (!dayMatch || !monthMatch || !yearMatch) return new Date(0);

    const day = parseInt(dayMatch[0], 10);
    const monthStr = monthMatch[0];
    const year = parseInt(yearMatch[0], 10);

    const months = {
      JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
      JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
    };

    return new Date(2000 + year, months[monthStr], day);
  };

  const renderExchangeConfig = (exchangeId) => {
    const exchangeConfig = config[exchangeId];
    const exchangeData = availableData[exchangeId];
    const baseExchange = exchangeId.split("_")[0];

    if (!exchangeConfig) return null;

    // Lighter block (perpetuals only)
    if (baseExchange === "lighter") {
      return (
        <div className="exchange-config-card" key={exchangeId}>
          <div className="config-header">
            <div className="config-title-row">
              <h3>LIGHTER</h3>
              <span className="expiry-badge">Perpetuals</span>
            </div>
          </div>
          <div style={{ padding: "16px" }}>
            <p style={{ marginBottom: "12px", color: "#666" }}>
              Perpetuals + Futures
            </p>
            <div className="action-buttons">
              <button className="submit-btnn" onClick={() => onSubmit(exchangeId)}>
                Submit
              </button>
              <button className="exit-btnn" onClick={() => onExit(exchangeId)}>
                Exit
              </button>
            </div>
          </div>
        </div>
      );
    }

    if (!exchangeData) {
      return (
        <div className="exchange-config-card" key={exchangeId}>
          <div className="config-header">
            <h3>{exchangeId.toUpperCase()}</h3>
          </div>
          <p style={{ padding: "16px", textAlign: "center", color: "#666" }}>
            Loading metadata...
          </p>
        </div>
      );
    }

    const symbol = (exchangeConfig.symbol || "BTC").toUpperCase();

    // Determine spot price key based on exchange
    let spotKey;
    if (baseExchange === "deribit") {
      spotKey = `${exchangeId}_${symbol}-PERPETUAL`;
    } else if (baseExchange === "binance") {
      spotKey = "binance_btcusdt";
    } else if (baseExchange === "okx") {
      spotKey = `okx_${symbol.toLowerCase()}-usdt-swap`; 
    } else {
      spotKey = "bybit_btcusdt";
    }

    const spotData = marketData?.[spotKey];
    const spotPrice = spotData
      ? ((parseFloat(spotData.best_bid_price) + parseFloat(spotData.best_ask_price)) / 2).toFixed(2)
      : "N/A";

    return (
      <div className="exchange-config-card" key={exchangeId}>
        <div className="config-header">
          <div className="config-title-row">
            <h3>
              {baseExchange.toUpperCase()}
              {["deribit", "okx"].includes(baseExchange) && symbol && ` (${symbol})`}
            </h3>
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <span className="expiry-badge">
                {exchangeData.expiries?.length || 0} expiries
              </span>

              {baseExchange === "deribit" && onAddInstance && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onAddInstance(exchangeId);
                  }}
                  style={{
                    background: "#4caf50",
                    color: "white",
                    border: "none",
                    borderRadius: "50%",
                    width: "24px",
                    height: "24px",
                    cursor: "pointer",
                    fontSize: "16px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontWeight: "bold",
                  }}
                  title="Add another Deribit instance"
                >
                  +
                </button>
              )}
            </div>
          </div>
        
        </div>

        <div className="config-grid">
          {/* Symbol selector for OKX + Deribit */}
          {["deribit", "okx"].includes(baseExchange) && (
            <div className="form-group">
              <label>Symbol</label>
              <select
                value={exchangeConfig.symbol || "BTC"}
                onChange={(e) => {
                  const newSymbol = e.target.value;
                  onConfigChange(exchangeId, "symbol", newSymbol);

                  const defaultGap = newSymbol === "ETH" ? 100 : 1000;
                  if (exchangeConfig.gap === 1000 || exchangeConfig.gap === 100) {
                    onConfigChange(exchangeId, "gap", defaultGap);
                  }
                }}
              >
                <option value="BTC">🟠 BTC</option>
                <option value="ETH">🔷 ETH</option>
              </select>
            </div>
          )}

          <div className="form-group">
            <label>Instrument Type</label>
            <select
              value={exchangeConfig.instrumentType}
              onChange={(e) =>
                onConfigChange(exchangeId, "instrumentType", e.target.value)
              }
            >
              {baseExchange === "okx" ? (
                <>
                  <option value="swap">🔄 Perpetual</option>
                  <option value="futures">📈 Futures</option>
                  <option value="spot">💰 Spot</option>
                  <option value="option">🎯 Options</option>
                </>
              ) : (
                instrumentTypes
                  .filter(t => {
                    if (baseExchange === "deribit") return t.value !== "spot";
                    return t.value === "future" || t.value === "option";
                  })
                  .map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.icon} {type.label}
                    </option>
                  ))
              )}
            </select>
          </div>

          {exchangeConfig.instrumentType === "option" && (
            <div className="form-group">
              <label>Expiry Date</label>
              <select
                value={exchangeConfig.expiry || ""}
                onChange={(e) =>
                  onConfigChange(exchangeId, "expiry", e.target.value)
                }
              >
                <option value="">All Expiries</option>
                {exchangeData.expiries
                  ?.slice()
                  .sort((a, b) => parseExpiry(a) - parseExpiry(b))
                  .map((expiry) => (
                    <option key={expiry} value={expiry}>
                      {expiry}
                    </option>
                  ))}
              </select>
            </div>
          )}
        </div>

        {/* Options Section */}
        {exchangeConfig.instrumentType === "option" && (
          <>
            <div className="config-grid">
              <div className="form-group">
                <label>Entry Count</label>
                <input
                  type="number"
                  value={exchangeConfig.entryCount ?? ""}
                  inputMode="numeric"
                  step="1"
                  min="1"
                  max="50"
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === "") {
                      onConfigChange(exchangeId, "entryCount", "");
                    } else {
                      const num = parseInt(val, 10);
                      onConfigChange(exchangeId, "entryCount", Number.isFinite(num) ? num : "");
                    }
                  }}
                  onBlur={(e) => {
                    const val = e.target.value;
                    let num = parseInt(val, 10);
                    if (!Number.isFinite(num) || num < 1) num = 10;
                    if (num > 50) num = 50;
                    onConfigChange(exchangeId, "entryCount", num);
                  }}
                />
              </div>

              <div className="form-group">
                <label>Start Strike</label>
                <input
                  type="number"
                  value={exchangeConfig.startStrike ?? ""}
                  onChange={(e) =>
                    onConfigChange(exchangeId, "startStrike", e.target.value)
                  }
                  placeholder={`e.g., ${exchangeData.strikes?.min || 80000}`}
                />
              </div>
            </div>

            <div className="options-config">
              <div className="options-row">
                <div className="form-group">
                  <label>Strike Gap</label>
                  <select
                    value={exchangeConfig.gap || (exchangeConfig.symbol === "ETH" ? 100 : 1000)}
                    onChange={(e) =>
                      onConfigChange(exchangeId, "gap", parseInt(e.target.value))
                    }
                  >
                    {exchangeConfig.symbol === "ETH" ? (
                      <>
                        <option value={50}>50</option>
                        <option value={100}>100</option>
                        <option value={200}>200</option>
                        <option value={500}>500</option>
                      </>
                    ) : (
                      <>
                        <option value={500}>500</option>
                        <option value={1000}>1000</option>
                        <option value={2000}>2000</option>
                        <option value={5000}>5000</option>
                      </>
                    )}
                  </select>
                </div>

                <button
                  className="btn btn-start submit-btn"
                  onClick={() => onSubmit(exchangeId)}
                >
                  Submit
                </button>
                <button
                  className="btn btn-stop exit-btn"
                  onClick={() => onExit(exchangeId)}
                >
                  Exit
                </button>
              </div>
            </div>
          </>
        )}

        {/* Futures/Spot/Swap Section */}
        {["future", "swap", "spot", "futures"].includes(exchangeConfig.instrumentType) && (
          <div className="action-buttons">
            <button className="submit-btnn" onClick={() => onSubmit(exchangeId)}>
              Submit
            </button>
            <button className="exit-btnn" onClick={() => onExit(exchangeId)}>
              Exit
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="exchange-selector">
      <div className="selector-card">
        <div className="selector-header">
          <h2>Select Exchanges</h2>
        </div>

        <div className="exchange-row">
          {exchanges.map((exchange) => (
            <button
              key={exchange.id}
              onClick={() => onExchangeToggle(exchange.id)}
              className={`exchange-button ${
                selectedExchanges.includes(exchange.id) ? "selected" : ""
              }`}
              disabled={!exchange.available}
            >
              <div className={`exchange-dot ${exchange.color}`}></div>
              <div className="exchange-name">{exchange.name}</div>
              <div className="exchange-type">{exchange.type}</div>
              {!exchange.available && <span className="soon-badge">Soon</span>}
              {selectedExchanges.includes(exchange.id) && (
                <div className="check-badge">✓</div>
              )}
            </button>
          ))}

          <button
            className="exchange-button strategy-global-button"
            onClick={handleStrategyClick}
          >
            <div className="exchange-dot bg-purple-500"></div>
            <div className="exchange-name">Strategy Dashboard</div>
            <div className="exchange-type">analysis</div>
          </button>
        </div>
      </div>

      {selectedExchanges.length > 0 && (
        <div className="config-row">
          {selectedExchanges.map((exchange) => {
            const cfg = config[exchange];
            if (!cfg) return null;
            return renderExchangeConfig(exchange);
          })}
        </div>
      )}
    </div>
  );
};

export default ExchangeSelector;
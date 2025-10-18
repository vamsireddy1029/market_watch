import React, { useState, useMemo, useRef, useEffect } from "react";
import { Search } from "lucide-react";
import "./DataGrid.css";

const DataGrid = ({ marketData, appliedConfig, selectedExchanges = [] }) => {
  const [sortConfig, setSortConfig] = useState({});
  const [filterText, setFilterText] = useState("");
  const previousDataRef = useRef({});

  const dataEntries = Object.values(marketData || {});

  // ✅ Group by exchange instance (supports deribit_btc, deribit_eth, okx_btc, etc.)
  const grouped = useMemo(() => {
    const g = {};
    Object.entries(marketData || {}).forEach(([key, row]) => {
      const keyParts = key.split("_");
      let exchangeKey;

      if (keyParts[0] === "deribit" && keyParts.length >= 2) {
        exchangeKey = `${keyParts[0]}_${keyParts[1]}`;
      } else if (keyParts[0] === "okx" && keyParts.length >= 2) {
        exchangeKey = `${keyParts[0]}_${keyParts[1]}`;
      } else {
        exchangeKey = keyParts[0];
      }

      if (!g[exchangeKey]) g[exchangeKey] = [];
      g[exchangeKey].push(row);
    });
    return g;
  }, [marketData]);

  // ✅ Dynamically determine columns per exchange
  const columnsByExchange = useMemo(() => {
    const colMap = {};
    Object.entries(grouped).forEach(([ex, rows]) => {
      if (rows.length === 0) {
        colMap[ex] = [
          "instrument",
          "last_price",
          "mark_price",
          "best_bid_price",
          "best_ask_price",
        ];
        return;
      }
      colMap[ex] = Object.keys(rows[0]).filter(
        (k) => k !== "exchange" && k !== "type"
      );
    });
    return colMap;
  }, [grouped]);

  // ✅ Highlight changed cells on update
  useEffect(() => {
    const newData = marketData || {};
    const oldData = previousDataRef.current;

    Object.keys(newData).forEach((key) => {
      const newRow = newData[key];
      const oldRow = oldData[key];

      if (oldRow) {
        Object.keys(newRow).forEach((col) => {
          if (newRow[col] !== oldRow[col]) {
            const cell = document.querySelector(
              `[data-key="${key}"][data-col="${col}"]`
            );
            if (cell) {
              cell.classList.add("cell-changed");
              setTimeout(() => {
                cell.classList.remove("cell-changed");
              }, 500);
            }
          }
        });
      }
    });
    previousDataRef.current = { ...newData };
  }, [marketData]);

  // ✅ Get user-friendly exchange display name
  const getExchangeDisplayName = (exchangeKey) => {
    const parts = exchangeKey.split("_");
    const baseExchange = parts[0];

    // Deribit multi-symbol
    if (baseExchange === "deribit" && parts.length > 1) {
      const symbolSuffix = parts[1].toUpperCase();
      if (["BTC", "ETH"].includes(symbolSuffix)) {
        return `Deribit ${symbolSuffix}`;
      }
    }

    // OKX multi-symbol
    if (baseExchange === "okx" && parts.length > 1) {
      const symbolSuffix = parts[1].toUpperCase();
      return `OKX ${symbolSuffix}`;
    }

    // Fallback config
    const config = appliedConfig?.[exchangeKey];
    if (baseExchange === "deribit" && config?.symbol) {
      return `Deribit ${config.symbol}`;
    }
    if (baseExchange === "okx" && config?.symbol) {
      return `OKX ${config.symbol}`;
    }

    const names = {
      binance: "Binance",
      bybit: "Bybit",
      okx: "OKX",
    };

    return names[baseExchange] || baseExchange.toUpperCase();
  };

  const getSpotPrice = (rows, exchangeKey) => {
  if (!rows || rows.length === 0) return null;

  const baseExchange = exchangeKey.split("_")[0].toLowerCase();
  const config = appliedConfig?.[exchangeKey];
  const symbol = (config?.symbol || "BTC").toUpperCase();

  // Deribit perpetual
  if (baseExchange === "deribit") {
    const perpInstrument = `${symbol}-PERPETUAL`;
    const perp = rows.find(
      (r) => (r.instrument || "").toUpperCase() === perpInstrument
    );
    if (perp) {
      const val = parseFloat(perp.mark_price ?? perp.last_price);
      return Number.isFinite(val) ? val.toFixed(2) : null;
    }
    return null;
  }

  // Binance / Bybit
  if (baseExchange === "binance") {
    const match = (r, t) =>
      (r?.type || "").toLowerCase() === t &&
      (r.instrument || "").toUpperCase() === 'BTCUSDT';
    const spot = rows.find((r) => match(r, "spot"));
    const fut = rows.find(
      (r) => (r?.type || "").toLowerCase() === "future" &&
             (r.instrument || "").toUpperCase() === 'BTCUSDT'
    );
    const val = spot
      ? parseFloat(spot.mark_price ?? spot.last_price)
      : fut
      ? parseFloat(fut.mark_price ?? fut.last_price)
      : null;
    return Number.isFinite(val) ? val.toFixed(2) : null;
  }
  
  if (baseExchange === "bybit") {
    // Bybit only has futures (perpetual), not spot
    const fut = rows.find(
      (r) => (r?.type || "").toLowerCase() === "future" &&
             (r.instrument || "").toUpperCase() === 'BTCUSDT'
    );
    if (fut) {
      const val = parseFloat(fut.mark_price ?? fut.last_price);
      return Number.isFinite(val) ? val.toFixed(2) : null;
    }
    return null;
  }

  if (baseExchange === 'okx') {
    // Perpetual (BTC-USDT-SWAP or BTC-USD-SWAP)
    const perp = rows.find((r) =>
      (r.instrument || '').toUpperCase() === `${symbol}-USDT-SWAP` ||
      (r.instrument || '').toUpperCase() === `${symbol}-USD-SWAP`
    );
    if (perp) {
      const val = parseFloat(perp.mark_price ?? perp.last_price);
      return Number.isFinite(val) ? val.toFixed(2) : null;
    }
    
    // Spot (BTC-USDT, not BTC-USDT-SWAP)
    const spot = rows.find(
      (r) => (r.instrument || '').toUpperCase() === `${symbol}-USDT` &&
             (r?.type || '').toLowerCase() === 'spot'
    );
    if (spot) {
      const val = parseFloat(spot.last_price);
      return Number.isFinite(val) ? val.toFixed(2) : null;
    }

    return null;
  }

  return null;
};

  // Sorting controls
  const handleSort = (exchange, key) => {
    setSortConfig((prevConfig) => ({
      ...prevConfig,
      [exchange]: {
        key,
        direction:
          prevConfig[exchange]?.direction === "asc" ? "desc" : "asc",
      },
    }));
  };

  const getSortIcon = (exchange, columnKey) => {
    if (sortConfig[exchange]?.key === columnKey) {
      return sortConfig[exchange].direction === "asc" ? "↑" : "↓";
    }
    return "↕";
  };

  const getChangeColor = (price, markPrice) => {
    const diff = parseFloat(price) - parseFloat(markPrice);
    if (diff > 0) return "price-up";
    if (diff < 0) return "price-down";
    return "";
  };

  // ✅ Empty state
  if (dataEntries.length === 0) {
    return (
      <div className="datagrid-empty">
        <h3>No Market Data</h3>
        <p>Start streaming from exchanges to see real-time market data here.</p>
      </div>
    );
  }

  return (
    <div className="datagrid-container">
      <div className="datagrid-header">
        <div className="header-left">
          <h2>Market Data</h2>
          <span className="instrument-count">
            {dataEntries.length} instruments
          </span>
        </div>

        <div className="search-box">
          <Search className="search-icon" />
          <input
            type="text"
            placeholder="Search instruments..."
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
          />
        </div>
      </div>

      <div className="tables-grid">
        {Object.entries(grouped).map(([exchangeKey, rows]) => {
          const columns = columnsByExchange[exchangeKey] || [];

          // Filter rows by search
          const filtered = rows.filter((r) =>
            r.instrument?.toLowerCase().includes(filterText.toLowerCase())
          );

          // ✅ Sort by expiry date first
          filtered.sort((a, b) => {
            const parseExpiry = (instrument) => {
              const match = instrument.match(/(\d{2}[A-Z]{3}\d{2})/);
              if (!match) return Infinity;
              const [_, expiry] = match;
              const day = expiry.slice(0, 2);
              const mon = expiry.slice(2, 5);
              const year = "20" + expiry.slice(5, 7);
              const months = {
                JAN: 0,
                FEB: 1,
                MAR: 2,
                APR: 3,
                MAY: 4,
                JUN: 5,
                JUL: 6,
                AUG: 7,
                SEP: 8,
                OCT: 9,
                NOV: 10,
                DEC: 11,
              };
              const month = months[mon] ?? 0;
              return new Date(year, month, day).getTime();
            };

            const aExpiry = parseExpiry(a.instrument || "");
            const bExpiry = parseExpiry(b.instrument || "");
            if (aExpiry === bExpiry) {
              return String(a.instrument).localeCompare(
                String(b.instrument),
                "en",
                { numeric: true }
              );
            }
            return aExpiry - bExpiry;
          });

          // ✅ Apply manual column sorting if selected
          const config = sortConfig[exchangeKey];
          const sorted = [...filtered];
          if (config?.key && columns.includes(config.key)) {
            sorted.sort((a, b) => {
              const aValue = a[config.key];
              const bValue = b[config.key];
              const aNum = parseFloat(aValue);
              const bNum = parseFloat(bValue);
              if (!isNaN(aNum) && !isNaN(bNum)) {
                return config.direction === "asc"
                  ? aNum - bNum
                  : bNum - aNum;
              }
              return config.direction === "asc"
                ? String(aValue).localeCompare(String(bValue))
                : String(bValue).localeCompare(String(aValue));
            });
          }

          const displayName = getExchangeDisplayName(exchangeKey);
          const spotPrice = getSpotPrice(rows, exchangeKey);

          const baseExchange = exchangeKey.split("_")[0].toLowerCase();
          let spotType = "P";
          let spotLabel = "Perpetual";

          if (baseExchange === "binance") {
            spotType = "S";
            spotLabel = "Spot";
          } else if (baseExchange === "okx") {
            spotType = "M";
            spotLabel = "Main (Spot/Perp)";
          }

          return (
            <div key={exchangeKey} className="exchange-table">
              <div className="exchange-table-header">
                <h3 className="exchange-table-title">{displayName}</h3>
                {spotPrice && (
                  <span className="spot-value">
                    {spotLabel} ({spotType}): ${spotPrice}
                  </span>
                )}
              </div>

              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      {columns.map((col) => (
                        <th
                          key={col}
                          onClick={() => handleSort(exchangeKey, col)}
                        >
                          {col.replace(/_/g, " ")}{" "}
                          {getSortIcon(exchangeKey, col)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((row) => {
                      const rowKey = `${exchangeKey}_${row.instrument}`;
                      return (
                        <tr key={rowKey}>
                          {columns.map((col) => (
                            <td
                              key={col}
                              data-key={rowKey}
                              data-col={col}
                              className={
                                col === "last_price" || col === "mark_price"
                                  ? getChangeColor(
                                      row.last_price,
                                      row.mark_price
                                    )
                                  : ""
                              }
                            >
                              {row[col]}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default DataGrid;

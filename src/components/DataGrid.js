
import React, { useState, useMemo, useRef, useEffect } from "react";
import { Search } from "lucide-react";
import "./DataGrid.css";

const DataGrid = ({ marketData, appliedConfig, selectedExchanges = [] }) => {
  const [sortConfig, setSortConfig] = useState({});
  const [filterText, setFilterText] = useState("");
  const previousDataRef = useRef({});

  const dataEntries = Object.values(marketData || {});

  // Group by exchange instance
  // Group by exchange instance
const grouped = useMemo(() => {
  const g = {};
  
  console.log('📊 DataGrid grouping', Object.keys(marketData).length, 'keys');
  
  Object.entries(marketData || {}).forEach(([key, row]) => {
    const keyParts = key.split('_');
    let exchangeKey;
    
    if (keyParts[0] === 'deribit' && keyParts.length >= 2) {
      exchangeKey = `${keyParts[0]}_${keyParts[1]}`;
    } else {
      exchangeKey = keyParts[0];
    }
    
    if (!g[exchangeKey]) g[exchangeKey] = [];
    g[exchangeKey].push(row);
  });
  
  console.log('📊 Grouped exchanges:', Object.keys(g));
  return g;
}, [marketData]);

  // Determine columns dynamically
    const columnsByExchange = useMemo(() => {
    const colMap = {};
    Object.entries(grouped).forEach(([ex, rows]) => {
      if (rows.length === 0) {
        colMap[ex] = ['instrument', 'last_price', 'mark_price', 'best_bid_price', 'best_ask_price'];
        return;
      }
      colMap[ex] = Object.keys(rows[0]).filter((k) => k !== "exchange" && k !== "type");
    });
    return colMap;
  }, [grouped]);

  // Highlight changed cells
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
              cell.classList.add('cell-changed');
              setTimeout(() => {
                cell.classList.remove('cell-changed');
              }, 500);
            }
          }
        });
      }
    });
    previousDataRef.current = { ...newData };
  }, [marketData]);

  // Get friendly exchange name
  // ✅ CHANGE THIS:
const getExchangeDisplayName = (exchangeKey) => {
  const parts = exchangeKey.split('_');
  const baseExchange = parts[0];
  
  // Check if exchangeKey has symbol suffix (e.g., deribit_btc, deribit_eth)
  if (baseExchange === 'deribit' && parts.length > 1) {
    const symbolSuffix = parts[1].toUpperCase();
    if (symbolSuffix === 'BTC' || symbolSuffix === 'ETH') {
      return `Deribit ${symbolSuffix}`;
    }
  }
  
  // Fallback: check config
  const config = appliedConfig?.[exchangeKey];
  if (baseExchange === 'deribit' && config?.symbol) {
    return `Deribit ${config.symbol}`;
  }
    
  const names = {
    'binance': 'Binance',
    'bybit': 'Bybit'
  };
    
  return names[baseExchange] || baseExchange;
};

  // Spot price detection with symbol support
  const getSpotPrice = (rows, exchangeKey) => {
    if (!rows || rows.length === 0) return null;
    
    const baseExchange = exchangeKey.split('_')[0].toLowerCase();
    const config = appliedConfig?.[exchangeKey];
    const symbol = (config?.symbol || 'BTC').toUpperCase();

    if (baseExchange === 'deribit') {
      const perpInstrument = `${symbol}-PERPETUAL`;
      const perp = rows.find((r) => (r.instrument || '').toUpperCase() === perpInstrument);
      if (perp) {
        const val = parseFloat(perp.mark_price ?? perp.last_price);
        return Number.isFinite(val) ? val.toFixed(2) : null;
      }
      return null;
    }

    if (baseExchange === 'binance' || baseExchange === 'bybit') {
      // Spot first
      const spot = rows.find((r) =>
        (r?.type || '').toLowerCase() === 'spot' && (r.instrument || '').toLowerCase().startsWith('btcusdt')
      );
      if (spot) {
        const val = parseFloat(spot.mark_price ?? spot.last_price);
        return Number.isFinite(val) ? val.toFixed(2) : null;
      }

      // Futures fallback
      const fut = rows.find((r) =>
        (r?.type || '').toLowerCase() === 'future' && (r.instrument || '').toLowerCase().startsWith('btcusdt')
      );
      if (fut) {
        const val = parseFloat(fut.mark_price ?? fut.last_price);
        return Number.isFinite(val) ? val.toFixed(2) : null;
      }
    }

    return null;
  };

  const handleSort = (exchange, key) => {
    setSortConfig((prevConfig) => ({
      ...prevConfig,
      [exchange]: {
        key,
        direction: prevConfig[exchange]?.direction === "asc" ? "desc" : "asc",
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

          // Filter by search text
          const filtered = rows.filter((r) =>
            r.instrument?.toLowerCase().includes(filterText.toLowerCase())
          );

          // Default sort by instrument
          filtered.sort((a, b) =>
            String(a.instrument).localeCompare(String(b.instrument), "en", { numeric: true })
          );

          // Apply configured column sorting
          const config = sortConfig[exchangeKey];
          const sorted = [...filtered];
          if (config?.key && columns.includes(config.key)) {
            sorted.sort((a, b) => {
              const aValue = a[config.key];
              const bValue = b[config.key];
              const aNum = parseFloat(aValue);
              const bNum = parseFloat(bValue);
              if (!isNaN(aNum) && !isNaN(bNum)) {
                return config.direction === "asc" ? aNum - bNum : bNum - aNum;
              }
              return config.direction === "asc"
                ? String(aValue).localeCompare(String(bValue))
                : String(bValue).localeCompare(String(aValue));
            });
          }

          const displayName = getExchangeDisplayName(exchangeKey);
          const spotPrice = getSpotPrice(rows, exchangeKey);
          
          // ✅ Determine if using Spot or Perpetual
          const baseExchange = exchangeKey.split('_')[0].toLowerCase();
          const spotType = baseExchange === 'binance' ? 'S' : 'P';
          const spotLabel = baseExchange === 'binance' ? 'Spot' : 'Perpetual';

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
                          {col.replace(/_/g, " ")} {getSortIcon(exchangeKey, col)}
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
                                  ? getChangeColor(row.last_price, row.mark_price)
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
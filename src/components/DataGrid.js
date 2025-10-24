import React, { useState, useMemo, useRef, useEffect } from "react";
import { Search, Settings } from "lucide-react";
import "./DataGrid.css";

const DataGrid = ({ marketData, appliedConfig, selectedExchanges = [] }) => {
  const [sortConfig, setSortConfig] = useState({});
  const [filterText, setFilterText] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const previousDataRef = useRef({});
  
  // All available columns
  const allColumns = [
    "instrument",
    "last_price",
    "best_bid_price",
    "best_ask_price",
    "mark_price",
    "index_price",
    "volume",
    "timestamp"
  ];
  
  // Default visible columns
  const [visibleColumns, setVisibleColumns] = useState([
    "instrument",
    "last_price",
    "best_bid_price",
    "best_ask_price",
    "mark_price",
    "volume",
    "timestamp"
  ]);

  const dataEntries = Object.values(marketData || {});

  const toggleColumn = (column) => {
    setVisibleColumns(prev => {
      if (prev.includes(column)) {
        return prev.filter(col => col !== column);
      } else {
        return [...prev, column];
      }
    });
  };
  
  const toggleAllColumns = () => {
    if (visibleColumns.length === allColumns.length) {
      setVisibleColumns(["instrument"]);
    } else {
      setVisibleColumns([...allColumns]);
    }
  };

  const grouped = useMemo(() => {
    const g = {};
    Object.entries(marketData || {}).forEach(([key, row]) => {
      const keyParts = key.split("_");
      let exchangeKey;

      if (keyParts[0] === "deribit" && keyParts.length >= 2) {
        exchangeKey = `${keyParts[0]}_${keyParts[1]}`;
      } else if (keyParts[0] === "okx" && keyParts.length >= 2) {
        exchangeKey = keyParts[0];
      } else {
        exchangeKey = keyParts[0];
      }

      if (!g[exchangeKey]) g[exchangeKey] = [];
     
      const normalizedRow = { ...row };
      if (!normalizedRow.volume && normalizedRow.volume_24h) {
        normalizedRow.volume = normalizedRow.volume_24h;
      }
      
      g[exchangeKey].push(normalizedRow);
    });
    return g;
  }, [marketData]);

  const columnsByExchange = useMemo(() => {
    const colMap = {};
    Object.entries(grouped).forEach(([ex, rows]) => {
      if (rows.length === 0) {
        colMap[ex] = visibleColumns;
        return;
      }
      const availableColumns = Object.keys(rows[0]).filter(
        (k) => k !== "exchange" && k !== "type" && k !== "volume_24h" && k !== "volume_usd_24h"
      );
      colMap[ex] = visibleColumns.filter(col => availableColumns.includes(col));
    });
    return colMap;
  }, [grouped, visibleColumns]);

  const formatTime = (timestamp) => {
    if (!timestamp) return '-';
    if (typeof timestamp === 'string' && timestamp.includes(':')) return timestamp;
    
    let dateValue = parseInt(timestamp);
    if (dateValue < 10000000000) dateValue = dateValue * 1000;
    
    const date = new Date(dateValue);
    if (isNaN(date.getTime())) return '-';
    
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    
    return `${hours}:${minutes}:${seconds}`;
  };

  const formatVolume = (volume) => {
    if (!volume || volume === '-') return '-';
    const num = parseFloat(volume);
    if (isNaN(num)) return '-';
    
    if (num >= 1000000) return (num / 1000000).toFixed(2) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(2) + 'K';
    return num.toFixed(2);
  };

  const formatPrice = (price) => {
    if (!price || price === '-') return '-';
    const num = parseFloat(price);
    if (isNaN(num)) return '-';
 
    if (num < 0.01) return num.toFixed(6);
    if (num < 1) return num.toFixed(4);
    return num.toFixed(2);
  };

  useEffect(() => {
    const newData = marketData || {};
    const oldData = previousDataRef.current;

    Object.keys(newData).forEach((key) => {
      const newRow = newData[key];
      const oldRow = oldData[key];

      if (oldRow) {
        Object.keys(newRow).forEach((col) => {
          if (newRow[col] !== oldRow[col]) {
            const cell = document.querySelector(`[data-key="${key}"][data-col="${col}"]`);
            if (cell) {
              cell.classList.add("cell-changed");
              setTimeout(() => cell.classList.remove("cell-changed"), 500);
            }
          }
        });
      }
    });
    previousDataRef.current = { ...newData };
  }, [marketData]);

  const getExchangeDisplayName = (exchangeKey) => {
    const parts = exchangeKey.split("_");
    const baseExchange = parts[0];

    if (baseExchange === "deribit" && parts.length > 1) {
      const symbolSuffix = parts[1].toUpperCase();
      if (["BTC", "ETH"].includes(symbolSuffix)) return `Deribit ${symbolSuffix}`;
    }

    if (baseExchange === "okx" && parts.length > 1) {
      const symbolSuffix = parts[1].toUpperCase();
      return `OKX ${symbolSuffix}`;
    }

    const config = appliedConfig?.[exchangeKey];
    if (baseExchange === "deribit" && config?.symbol) return `Deribit ${config.symbol}`;
    if (baseExchange === "okx" && config?.symbol) return `OKX ${config.symbol}`;

    const names = { binance: "Binance", bybit: "Bybit", okx: "OKX" };
    return names[baseExchange] || baseExchange.toUpperCase();
  };

  const getSpotPrice = (rows, exchangeKey) => {
    if (!rows || rows.length === 0) return null;

    const baseExchange = exchangeKey.split("_")[0].toLowerCase();
    const config = appliedConfig?.[exchangeKey];
    const symbol = (config?.symbol || "BTC").toUpperCase();

    if (baseExchange === "deribit") {
      const perpInstrument = `${symbol}-PERPETUAL`;
      const perp = rows.find((r) => (r.instrument || "").toUpperCase() === perpInstrument);
      if (perp) {
        const val = parseFloat(perp.mark_price ?? perp.last_price);
        return Number.isFinite(val) ? val.toFixed(2) : null;
      }
      return null;
    }

    if (baseExchange === "binance") {
      const match = (r, t) => (r?.type || "").toLowerCase() === t && (r.instrument || "").toUpperCase() === 'BTCUSDT';
      const spot = rows.find((r) => match(r, "spot"));
      const fut = rows.find((r) => (r?.type || "").toLowerCase() === "future" && (r.instrument || "").toUpperCase() === 'BTCUSDT');
      const val = spot ? parseFloat(spot.mark_price ?? spot.last_price) : fut ? parseFloat(fut.mark_price ?? fut.last_price) : null;
      return Number.isFinite(val) ? val.toFixed(2) : null;
    }
    
    if (baseExchange === "bybit") {
      const fut = rows.find((r) => (r?.type || "").toLowerCase() === "future" && (r.instrument || "").toUpperCase() === 'BTCUSDT');
      if (fut) {
        const val = parseFloat(fut.mark_price ?? fut.last_price);
        return Number.isFinite(val) ? val.toFixed(2) : null;
      }
      return null;
    }

    if (baseExchange === 'okx') {
      const perp = rows.find((r) =>
        (r.instrument || '').toUpperCase() === `${symbol}-USDT-SWAP` ||
        (r.instrument || '').toUpperCase() === `${symbol}-USD-SWAP`
      );
      if (perp) {
        const val = parseFloat(perp.mark_price ?? perp.last_price);
        return Number.isFinite(val) ? val.toFixed(2) : null;
      }
      
      const spot = rows.find((r) => (r.instrument || '').toUpperCase() === `${symbol}-USDT` && (r?.type || '').toLowerCase() === 'spot');
      if (spot) {
        const val = parseFloat(spot.last_price);
        return Number.isFinite(val) ? val.toFixed(2) : null;
      }

      return null;
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
          <span className="instrument-count">{dataEntries.length} instruments</span>
        </div>

        <div className="header-right">
          <div className="search-box">
            <Search className="search-icon" />
            <input
              type="text"
              placeholder="Search instruments..."
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
            />
          </div>
          
          <button 
            className="settings-button"
            onClick={() => setShowSettings(!showSettings)}
            title="Column Settings"
          >
            <Settings size={20} />
          </button>
        </div>
      </div>
      
      {showSettings && (
        <>
          <div className="modal-overlay" onClick={() => setShowSettings(false)}></div>
          <div className="settings-modal">
            <div className="modal-header">
              <h3>Show Columns</h3>
              <button className="close-button" onClick={() => setShowSettings(false)}>×</button>
            </div>
            
            <div className="modal-body">
              <button className="toggle-all-button" onClick={toggleAllColumns}>
                {visibleColumns.length === allColumns.length ? "Hide All" : "Show All"}
              </button>
              
              <div className="column-checkboxes">
                {allColumns.map(column => (
                  <label key={column} className="column-checkbox-label">
                    <input
                      type="checkbox"
                      checked={visibleColumns.includes(column)}
                      onChange={() => toggleColumn(column)}
                    />
                    <span>{column.replace(/_/g, " ")}</span>
                  </label>
                ))}
              </div>
            </div>
            
            <div className="modal-footer">
              <button className="cancel-button" onClick={() => setShowSettings(false)}>Cancel</button>
              <button className="apply-button" onClick={() => setShowSettings(false)}>Apply</button>
            </div>
          </div>
        </>
      )}

      <div className="tables-grid">
        {Object.entries(grouped).map(([exchangeKey, rows]) => {
          const columns = columnsByExchange[exchangeKey] || [];
          const filtered = rows.filter((r) => r.instrument?.toLowerCase().includes(filterText.toLowerCase()));

          // ✅ FIX: Enhanced expiry parsing for OKX (YYMMDD format)
          filtered.sort((a, b) => {
            const parseExpiry = (instrument) => {
              // OKX format: BTC-USD-241023 or BTC-USDT-241025
              const okxMatch = instrument.match(/-(\d{6})-/);
              if (okxMatch) {
                const yymmdd = okxMatch[1];
                const year = 2000 + parseInt(yymmdd.slice(0, 2));
                const month = parseInt(yymmdd.slice(2, 4)) - 1;
                const day = parseInt(yymmdd.slice(4, 6));
                return new Date(year, month, day).getTime();
              }
              
              // Deribit/Binance/Bybit format: 29NOV24
              const match = instrument.match(/(\d{1,2}[A-Z]{3}\d{2})/);
              if (!match) return Infinity;
              
              const expiry = match[1];
              const dayMatch = expiry.match(/^(\d{1,2})/);
              const monthMatch = expiry.match(/([A-Z]{3})/);
              const yearMatch = expiry.match(/(\d{2})$/);
              
              if (!dayMatch || !monthMatch || !yearMatch) return Infinity;
              
              const day = parseInt(dayMatch[1]);
              const monthStr = monthMatch[1];
              const year = 2000 + parseInt(yearMatch[1]);
              
              const months = {
                JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
                JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
              };
              
              return new Date(year, months[monthStr], day).getTime();
            };

            const aExpiry = parseExpiry(a.instrument || "");
            const bExpiry = parseExpiry(b.instrument || "");
            if (aExpiry === bExpiry) {
              return String(a.instrument).localeCompare(String(b.instrument), "en", { numeric: true });
            }
            return aExpiry - bExpiry;
          });

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
                        <th key={col} onClick={() => handleSort(exchangeKey, col)}>
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
                          {columns.map((col) => {
                            let cellValue = row[col];
                            
                            if (col === 'timestamp' || col === 'last_traded_time' || col.toLowerCase().includes('time')) {
                              cellValue = formatTime(cellValue);
                            } else if (col === 'volume' || col === 'total_volume' || col.toLowerCase().includes('volume')) {
                              cellValue = formatVolume(cellValue);
                            } else if (col.includes('price') || col === 'last_price' || col === 'mark_price' || 
                                     col === 'best_bid_price' || col === 'best_ask_price' || 
                                     col === 'min_price' || col === 'max_price' || col === 'index_price') {
                              cellValue = formatPrice(cellValue);
                            }
                            
                            return (
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
                                {cellValue ?? '-'}
                              </td>
                            );
                          })}
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
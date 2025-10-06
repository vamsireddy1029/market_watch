import React, { useState, useMemo, useRef, useEffect } from "react";
import { Search } from "lucide-react";
import "./DataGrid.css";

const DataGrid = ({ marketData }) => {
  const [sortConfig, setSortConfig] = useState({
    deribit: { key: null, direction: "asc" },
    binance: { key: null, direction: "asc" },
  });
  const [filterText, setFilterText] = useState("");
  const previousDataRef = useRef({});

  const dataEntries = Object.values(marketData || {});
  const grouped = useMemo(() => {
    const g = {};
    dataEntries.forEach((row) => {
      if (!g[row.exchange]) g[row.exchange] = [];
      g[row.exchange].push(row);
    });
    return g;
  }, [dataEntries]);

  const columnsByExchange = useMemo(() => {
    const colMap = {};
    Object.entries(grouped).forEach(([ex, rows]) => {
      if (rows.length === 0) return;
      colMap[ex] = Object.keys(rows[0]).filter((k) => k !== "exchange" && k !== "type");
    });
    return colMap;
  }, [grouped]);

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

  const getSpotPrice = (rows, exchange) => {
    if (!rows || rows.length === 0) return null;
    const ex = (exchange || '').toLowerCase();

    if (ex === 'deribit') {
      const perp = rows.find((r) => (r.instrument || '').toUpperCase() === 'BTC-PERPETUAL');
      if (perp) {
        const val = parseFloat(perp.mark_price ?? perp.last_price);
        return Number.isFinite(val) ? val.toFixed(2) : null;
      }
      return null;
    }

    if (ex === 'binance') {
      const spotBtc = rows.find(
        (r) => (r?.type || '').toLowerCase() === 'spot' && (r.instrument || '').toLowerCase().startsWith('btcusdt')
      );
      if (spotBtc) {
        const val = parseFloat(spotBtc.mark_price ?? spotBtc.last_price);
        return Number.isFinite(val) ? val.toFixed(2) : null;
      }
      
      const futureBtc = rows.find(
        (r) => (r?.type || '').toLowerCase() === 'future' && (r.instrument || '').toLowerCase() === 'btcusdt'
      );
      if (futureBtc) {
        const val = parseFloat(futureBtc.mark_price ?? futureBtc.last_price);
        return Number.isFinite(val) ? val.toFixed(2) : null;
      }
      
      const btcusdt = rows.find((r) => (r.instrument || '').toLowerCase().startsWith('btcusdt'));
      if (btcusdt) {
        const val = parseFloat(btcusdt.mark_price ?? btcusdt.last_price);
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
        direction: prevConfig[exchange].direction === "asc" ? "desc" : "asc",
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
        {Object.entries(grouped).map(([exchange, rows]) => {
          const columns = columnsByExchange[exchange] || [];
          const filtered = rows.filter((r) =>
            r.instrument?.toLowerCase().includes(filterText.toLowerCase())
          );

          filtered.sort((a, b) =>
            String(a.instrument).localeCompare(String(b.instrument), "en", {
              numeric: true,
            })
          );

          const config = sortConfig[exchange];
          const sorted = [...filtered];
          if (config.key && columns.includes(config.key)) {
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

          return (
            <div key={exchange} className="exchange-table">
              <div className="exchange-table-header">
                <h3 className="exchange-table-title">{exchange}</h3>
                {getSpotPrice(rows, exchange) && (
                  <span className="spot-value">
                    Spot: ${getSpotPrice(rows, exchange)}
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
                          onClick={() => handleSort(exchange, col)}
                        >
                          {col.replace(/_/g, " ")} {getSortIcon(exchange, col)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((row, i) => {
                      const rowKey = `${exchange}_${row.instrument}`;
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
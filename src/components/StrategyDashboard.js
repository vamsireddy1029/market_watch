import React, { useState, useEffect, useRef } from 'react';

const StrategyDashboard = () => {
  const [tables, setTables] = useState([]);
  const [tableCounter, setTableCounter] = useState(0);
  const [showModal, setShowModal] = useState(false);
  const [activeTableIndex, setActiveTableIndex] = useState(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [savedConfigs, setSavedConfigs] = useState({});
  const [selectedConfig, setSelectedConfig] = useState('');
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [configName, setConfigName] = useState('');
  const [storageMode, setStorageMode] = useState('browser');
  const wsRef = useRef(null);
  
  const [tableFilters, setTableFilters] = useState({});
  const [showFilterMenu, setShowFilterMenu] = useState({ tableId: null, column: null, position: null });
  
  const [showCFFDialog, setShowCFFDialog] = useState(false);
  const [cffDialogData, setCffDialogData] = useState({ tableId: null, rowIndex: null, exchange: '', fut1Expiry: '',fut2Expiry: ''});
  
  const params = new URLSearchParams(window.location.search);
  const selectedExList = (params.get('selected') || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const defaultEx = (params.get('default') || '').trim().toLowerCase();
  const initialExchange = defaultEx || selectedExList[0] || '';
  
  const [modalForm, setModalForm] = useState({
    exchange: initialExchange,
    strategy: '',
    symbol: 'BTC',
    optionExpiry: '',
    futureExpiry: '',
    fut1Expiry: 'all',  
    fut2Expiry: 'all',  
    strikeInterval: '1000',  // This will be overridden dynamically
    gap: '1000',              // This will be overridden dynamically
    noPrtFolio: '10',
    ratio1: '1',
    ratio2: '2',
    strategyLegType: '1331',
    strikeMode: 'auto',
    nearestStrike: ''
  });

  const [availableData, setAvailableData] = useState({
    deribit: { expiries: [], strikes: { min: 0, max: 0 }, instruments: [] },
    binance: { expiries: [], strikes: { min: 0, max: 0 }, instruments: [] },
    bybit: { expiries: [], strikes: { min: 0, max: 0 }, instruments: {} }
  });
  const [limitExchanges] = useState(selectedExList);
  const [isLoadingExpiries, setIsLoadingExpiries] = useState(false);

  // Parse expiry date to sortable format
  const parseExpiryDate = (expiry) => {
    if (!expiry) return new Date(0);
    
    // Handle Binance format: YYMMDD (e.g., 241227)
    if (/^\d{6}$/.test(expiry)) {
      const year = 2000 + parseInt(expiry.substring(0, 2));
      const month = parseInt(expiry.substring(2, 4)) - 1;
      const day = parseInt(expiry.substring(4, 6));
      return new Date(year, month, day);
    }
    
    // Handle Deribit format: DDMMMYY (e.g., 10OCT25)
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
    
    return new Date(0);
  };

  // Sort data by expiry date
  const sortByExpiry = (data) => {
    return [...data].sort((a, b) => {
      const dateA = parseExpiryDate(a.expiry);
      const dateB = parseExpiryDate(b.expiry);
      return dateA - dateB;
    });
  };

  const getUniqueValues = (data, column) => {
    const values = new Set();
    data.forEach(row => {
      const val = row[column];
      if (val !== undefined && val !== null && val !== '') {
        values.add(val);
      }
    });
    return Array.from(values).sort((a, b) => {
      if (typeof a === 'number' && typeof b === 'number') return a - b;
      return String(a).localeCompare(String(b));
    });
  };

  const toggleFilter = (tableId, column, value) => {
    setTableFilters(prev => {
      const key = `${tableId}_${column}`;
      const current = prev[key] || { selectAll: true, values: new Set() };
      const newValues = new Set(current.values);
      
      if (newValues.has(value)) {
        newValues.delete(value);
      } else {
        newValues.add(value);
      }
      
      return {
        ...prev,
        [key]: {
          selectAll: false,
          values: newValues
        }
      };
    });
  };

  const toggleSelectAll = (tableId, column, allValues) => {
    setTableFilters(prev => {
      const key = `${tableId}_${column}`;
      const current = prev[key] || { selectAll: true, values: new Set() };
      
      if (current.selectAll || current.values.size === allValues.length) {
        return {
          ...prev,
          [key]: { selectAll: false, values: new Set() }
        };
      } else {
        return {
          ...prev,
          [key]: { selectAll: true, values: new Set(allValues) }
        };
      }
    });
  };

  const clearFilter = (tableId, column) => {
    setTableFilters(prev => {
      const newFilters = { ...prev };
      delete newFilters[`${tableId}_${column}`];
      return newFilters;
    });
    setShowFilterMenu({ tableId: null, column: null, position: null });
  };

  const applyFilters = (data, tableId) => {
    let filtered = [...data];
    
    Object.keys(tableFilters).forEach(key => {
      if (!key.startsWith(`${tableId}_`)) return;
      
      const column = key.replace(`${tableId}_`, '');
      const filter = tableFilters[key];
      
      if (!filter.selectAll && filter.values.size > 0) {
        filtered = filtered.filter(row => filter.values.has(row[column]));
      }
    });
    
    return filtered;
  };

  const FilterDropdown = ({ tableId, column, data, position }) => {
    const uniqueValues = getUniqueValues(data, column);
    const key = `${tableId}_${column}`;
    const currentFilter = tableFilters[key] || { selectAll: true, values: new Set(uniqueValues) };
    
    return (
      <div 
        onClick={e => e.stopPropagation()}
        style={{
          position: 'fixed',
          top: position.top,
          left: position.left,
          background: 'white',
          border: '1px solid #ddd',
          borderRadius: '4px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          minWidth: '200px',
          maxHeight: '400px',
          overflowY: 'auto',
          zIndex: 10000,
          fontSize: '12px'
        }}
      >
        <div style={{ padding: '8px', borderBottom: '1px solid #eee', background: '#f8f9fa', fontWeight: 'bold' }}>
          Filter: {column}
        </div>
        
        <div style={{ padding: '8px' }}>
          <label style={{ display: 'flex', alignItems: 'center', padding: '4px', cursor: 'pointer', userSelect: 'none' }}>
            <input 
              type="checkbox" 
              checked={currentFilter.selectAll || currentFilter.values.size === uniqueValues.length}
              onChange={() => toggleSelectAll(tableId, column, uniqueValues)}
              style={{ marginRight: '8px' }}
            />
            <strong>(Select All)</strong>
          </label>
          
          <div style={{ maxHeight: '250px', overflowY: 'auto', marginTop: '4px' }}>
            {uniqueValues.map(value => (
              <label 
                key={value} 
                style={{ display: 'flex', alignItems: 'center', padding: '4px', cursor: 'pointer', userSelect: 'none' }}
              >
                <input 
                  type="checkbox" 
                  checked={currentFilter.values.has(value)}
                  onChange={() => toggleFilter(tableId, column, value)}
                  style={{ marginRight: '8px' }}
                />
                {value}
              </label>
            ))}
          </div>
        </div>
        
        <div style={{ padding: '8px', borderTop: '1px solid #eee', display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button
            onClick={() => clearFilter(tableId, column)}
            style={{ padding: '6px 12px', background: '#e0e0e0', border: 'none', borderRadius: '3px', cursor: 'pointer', fontSize: '11px' }}
          >
            Clear
          </button>
          <button
            onClick={() => setShowFilterMenu({ tableId: null, column: null, position: null })}
            style={{ padding: '6px 12px', background: '#3498db', color: 'white', border: 'none', borderRadius: '3px', cursor: 'pointer', fontSize: '11px' }}
          >
            OK
          </button>
        </div>
      </div>
    );
  };

  const removeRow = async (tableId, rowData) => {
  try {
    console.log('🗑️ Remove row called:', { tableId, rowData });
    const response = await fetch('http://localhost:8080/api/strategy/cff/remove-row', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tableId,
        exchange: rowData.exchange,
        fut1Expiry: rowData.fut1, 
        fut2Expiry: rowData.fut2   
      })
    });
    
    const result = await response.json();
    
    if (result.success) {
      setTables(prevTables => {
        const newTables = [...prevTables];
        const tableIndex = newTables.findIndex(t => t.id === tableId);
        if (tableIndex !== -1) {
          newTables[tableIndex] = { 
            ...newTables[tableIndex], 
            data: result.data || [],
            config: {
              ...newTables[tableIndex].config,
              selectedFutures: result.selectedFutures || []
            }
          };
        }
        return newTables;
      });
      
      console.log('✅ Row removed successfully');
    } else {
      alert('Failed to remove row: ' + (result.error || 'Unknown error'));
    }
    
    return result;
  } catch (error) {
    console.error('Remove row error:', error);
    alert('Failed to remove row: ' + error.message);
    return { success: false, error: error.message };
  }
};

  
const handleAddCFFRow = async () => {
  const { tableId, exchange, fut1Expiry, fut2Expiry } = cffDialogData;
  
  if (!exchange || !fut1Expiry || !fut2Expiry) {
    alert('Please select exchange, fut1, and fut2 expiries');
    return;
  }
  
  setShowCFFDialog(false);
  
  try {
    const response = await fetch('http://localhost:8080/api/strategy/cff/add-row', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        tableId, 
        exchange: exchange.toLowerCase(), 
        fut1Expiry,  // ✅ Send both expiries
        fut2Expiry,
        insertAfterIndex: cffDialogData.rowIndex
      })
    });

    const result = await response.json();
    
    if (result.success) {
      setTables(prevTables => {
        const newTables = [...prevTables];
        const tableIndex = newTables.findIndex(t => t.id === tableId);
        if (tableIndex !== -1) {
          newTables[tableIndex] = {
            ...newTables[tableIndex],
            config: {
              ...newTables[tableIndex].config,
              selectedFutures: result.selectedFutures || []
            },
            data: result.data || []
          };
        }
        return newTables;
      });
    }
  } catch (error) {
    console.error('Add C-F/F row error:', error);
    alert('Failed to add row: ' + error.message);
  }
};
  const renderTable = (table) => {
  if (table.isLoading) {
    return <div style={{ padding: '20px', textAlign: 'center', color: '#666' }}>Loading strategy data...</div>;
  }

  if (!table.data || table.data.length === 0) {
    return <div style={{ padding: '20px', textAlign: 'center', color: '#666' }}>No data available. Configure strategy settings.</div>;
  }

  const { config, data } = table;
  const strategy = config.strategy?.toLowerCase() || '';
  const isCFF = strategy === 'c-f/f';
  
  // Apply filters
  let displayData = data;
  const filteredData = applyFilters(displayData, table.id);

  // ================================
  // JELLY / SYNTHETIC STRATEGY
  // ================================
  if (strategy === 'jelly' || strategy === 'synthetic') {
    return (
      <div style={{ position: 'relative' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
          <thead>
            <tr style={{ background: '#f8f9fa' }}>
              <th style={{ padding: '8px 4px', border: '1px solid #dee2e6', fontWeight: '600', fontSize: '10px', textTransform: 'uppercase', position: 'sticky', top: 0, background: '#f8f9fa', zIndex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '4px' }}>
                  <span>Strike</span>
                  <button
                    onClick={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      setShowFilterMenu({ 
                        tableId: table.id, 
                        column: 'strike',
                        position: { top: rect.bottom + 5, left: rect.left }
                      });
                    }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '10px', padding: '2px', color: '#666' }}
                  >
                    ▼
                  </button>
                </div>
              </th>
              <th style={{ padding: '8px 4px', border: '1px solid #dee2e6', fontWeight: '600', fontSize: '10px', textTransform: 'uppercase', position: 'sticky', top: 0, background: '#f8f9fa', zIndex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '4px' }}>
                  <span>Conversion</span>
                  <button
                    onClick={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      setShowFilterMenu({ 
                        tableId: table.id, 
                        column: 'conversion',
                        position: { top: rect.bottom + 5, left: rect.left }
                      });
                    }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '10px', padding: '2px', color: '#666' }}
                  >
                    ▼
                  </button>
                </div>
              </th>
              <th style={{ padding: '8px 4px', border: '1px solid #dee2e6', fontWeight: '600', fontSize: '10px', textTransform: 'uppercase', position: 'sticky', top: 0, background: '#f8f9fa', zIndex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '4px' }}>
                  <span>Reversal</span>
                  <button
                    onClick={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      setShowFilterMenu({ 
                        tableId: table.id, 
                        column: 'reversal',
                        position: { top: rect.bottom + 5, left: rect.left }
                      });
                    }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '10px', padding: '2px', color: '#666' }}
                  >
                    ▼
                  </button>
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredData.map((row, idx) => {
              const convNum = row.conversion != null ? parseFloat(row.conversion) : null;
              const revNum = row.reversal != null ? parseFloat(row.reversal) : null;
              const isNearestStrike = row.strike === row.nearest_strike;
              
              return (
                <tr key={idx} style={{ background: isNearestStrike ? '#ffff99' : (idx % 2 === 0 ? 'white' : '#f9f9f9') }}>
                  <td style={{ 
                    padding: '6px 4px', 
                    textAlign: 'center', 
                    border: '1px solid #dee2e6',
                    fontWeight: isNearestStrike ? 'bold' : 'normal'
                  }}>
                    {row.strike}
                  </td>
                  <td style={{ 
                    padding: '6px 4px', 
                    textAlign: 'center', 
                    border: '1px solid #dee2e6',
                    color: convNum != null ? (convNum >= 0 ? '#27ae60' : '#e74c3c') : 'inherit'
                  }}>
                    {row.conversion != null ? row.conversion : '-'}
                  </td>
                  <td style={{ 
                    padding: '6px 4px', 
                    textAlign: 'center', 
                    border: '1px solid #dee2e6',
                    color: revNum != null ? (revNum >= 0 ? '#27ae60' : '#e74c3c') : 'inherit'
                  }}>
                    {row.reversal != null ? row.reversal : '-'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  // ================================
  // BUTTERFLY / PULSE BUTTERFLY
  // ================================
  if (strategy === 'butterfly' || strategy === 'pulse_butterfly') {
    const ceData = filteredData.filter(d => d.type === 'CE');
    const peData = filteredData.filter(d => d.type === 'PE');
    
    return (
      <div style={{ position: 'relative' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
          <thead>
            <tr style={{ background: '#f8f9fa' }}>
              <th colSpan="3" style={{ background: '#ffe8e8', padding: '8px 4px', border: '1px solid #dee2e6', fontWeight: '600', fontSize: '10px' }}>
                PE Data
              </th>
              <th colSpan="3" style={{ background: '#e8f5e8', padding: '8px 4px', border: '1px solid #dee2e6', fontWeight: '600', fontSize: '10px' }}>
                CE Data
              </th>
            </tr>
            <tr style={{ background: '#f8f9fa' }}>
              {['Long', 'Short', 'Strike', 'Strike', 'Long', 'Short'].map((h, i) => (
                <th key={i} style={{ padding: '8px 4px', border: '1px solid #dee2e6', fontWeight: '600', fontSize: '10px', position: 'sticky', top: 0, background: '#f8f9fa', zIndex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '4px' }}>
                    <span>{h}</span>
                    <button
                      onClick={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        const colMap = { 'Long': 'long_value', 'Short': 'short_value', 'Strike': 'l2' };
                        setShowFilterMenu({ 
                          tableId: table.id, 
                          column: colMap[h] || h.toLowerCase(),
                          position: { top: rect.bottom + 5, left: rect.left }
                        });
                      }}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '10px', padding: '2px', color: '#666' }}
                    >
                      ▼
                    </button>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: Math.max(ceData.length, peData.length) }).map((_, idx) => {
              const ce = ceData[idx];
              const pe = peData[idx];
              
              return (
                <tr key={idx} style={{ background: idx % 2 === 0 ? 'white' : '#f9f9f9' }}>
                  <td style={{ padding: '6px 4px', textAlign: 'center', border: '1px solid #dee2e6' }}>
                    {pe?.long_value || '-'}
                  </td>
                  <td style={{ padding: '6px 4px', textAlign: 'center', border: '1px solid #dee2e6' }}>
                    {pe?.short_value || '-'}
                  </td>
                  <td style={{ 
                    padding: '6px 4px', 
                    textAlign: 'center', 
                    border: '1px solid #dee2e6',
                    background: pe?.l2 === pe?.nearest_strike ? '#ffff99' : 'transparent',
                    fontWeight: pe?.l2 === pe?.nearest_strike ? 'bold' : 'normal'
                  }}>
                    {pe?.l2 || '-'}
                  </td>
                  <td style={{ 
                    padding: '6px 4px', 
                    textAlign: 'center', 
                    border: '1px solid #dee2e6',
                    background: ce?.l2 === ce?.nearest_strike ? '#ffff99' : 'transparent',
                    fontWeight: ce?.l2 === ce?.nearest_strike ? 'bold' : 'normal'
                  }}>
                    {ce?.l2 || '-'}
                  </td>
                  <td style={{ padding: '6px 4px', textAlign: 'center', border: '1px solid #dee2e6' }}>
                    {ce?.long_value || '-'}
                  </td>
                  <td style={{ padding: '6px 4px', textAlign: 'center', border: '1px solid #dee2e6' }}>
                    {ce?.short_value || '-'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  // ================================
  // RATIO STRATEGY
  // ================================
  if (strategy === 'ratio') {
    const ceData = filteredData.filter(d => d.type === 'CE');
    const peData = filteredData.filter(d => d.type === 'PE');
    
    return (
      <div style={{ position: 'relative' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
          <thead>
            <tr style={{ background: '#f8f9fa' }}>
              <th colSpan="2" style={{ background: '#ffe8e8', padding: '8px 4px', border: '1px solid #dee2e6', fontWeight: '600', fontSize: '10px' }}>
                PE Data
              </th>
              <th rowSpan="2" style={{ padding: '8px 4px', border: '1px solid #dee2e6', fontWeight: '600', fontSize: '10px', verticalAlign: 'middle' }}>
                Strike
              </th>
              <th colSpan="2" style={{ background: '#e8f5e8', padding: '8px 4px', border: '1px solid #dee2e6', fontWeight: '600', fontSize: '10px' }}>
                CE Data
              </th>
            </tr>
            <tr style={{ background: '#f8f9fa' }}>
              {['Buy', 'Sell', 'Buy', 'Sell'].map((h, i) => (
                <th key={i} style={{ padding: '8px 4px', border: '1px solid #dee2e6', fontWeight: '600', fontSize: '10px', position: 'sticky', top: 0, background: '#f8f9fa', zIndex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '4px' }}>
                    <span>{h}</span>
                    <button
                      onClick={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        const colMap = { 'Buy': 'buy_value', 'Sell': 'sell_value' };
                        setShowFilterMenu({ 
                          tableId: table.id, 
                          column: colMap[h] || h.toLowerCase(),
                          position: { top: rect.bottom + 5, left: rect.left }
                        });
                      }}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '10px', padding: '2px', color: '#666' }}
                    >
                      ▼
                    </button>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: Math.max(ceData.length, peData.length) }).map((_, idx) => {
              const ce = ceData[idx];
              const pe = peData[idx];
              const strike = ce?.l1 || pe?.l1;
              const isNearestStrike = strike === ce?.nearest_strike || strike === pe?.nearest_strike;
              
              return (
                <tr key={idx} style={{ background: idx % 2 === 0 ? 'white' : '#f9f9f9' }}>
                  <td style={{ padding: '6px 4px', textAlign: 'center', border: '1px solid #dee2e6' }}>
                    {pe?.buy_value || '-'}
                  </td>
                  <td style={{ padding: '6px 4px', textAlign: 'center', border: '1px solid #dee2e6' }}>
                    {pe?.sell_value || '-'}
                  </td>
                  <td style={{ 
                    padding: '6px 4px', 
                    textAlign: 'center', 
                    border: '1px solid #dee2e6',
                    background: isNearestStrike ? '#ffff99' : 'transparent',
                    fontWeight: isNearestStrike ? 'bold' : 'normal'
                  }}>
                    {strike || '-'}
                  </td>
                  <td style={{ padding: '6px 4px', textAlign: 'center', border: '1px solid #dee2e6' }}>
                    {ce?.buy_value || '-'}
                  </td>
                  <td style={{ padding: '6px 4px', textAlign: 'center', border: '1px solid #dee2e6' }}>
                    {ce?.sell_value || '-'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  // ================================
  // C-F/F STRATEGY (GENERIC TABLE)
  // ================================
 if (isCFF) {
    const headers = filteredData.length > 0 && !Object.keys(filteredData[0]).includes('exchange')
      ? ['exchange', ...Object.keys(filteredData[0])]
      : Object.keys(filteredData[0] || {});

    // Sort data by fut1 and fut2 expiry dates
    const sortedData = [...filteredData].sort((a, b) => {
      const dateA1 = parseExpiryDate(a.fut1);
      const dateB1 = parseExpiryDate(b.fut1);
      
      if (dateA1.getTime() !== dateB1.getTime()) {
        return dateA1 - dateB1;
      }
      
      const dateA2 = parseExpiryDate(a.fut2);
      const dateB2 = parseExpiryDate(b.fut2);
      return dateA2 - dateB2;
    });

    return (
      <div style={{ position: 'relative' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
          <thead>
            <tr style={{ background: '#f8f9fa' }}>
              {headers.map(header => (
                <th key={header} style={{ padding: '8px 4px', border: '1px solid #dee2e6', fontWeight: '600', fontSize: '10px', textTransform: 'uppercase', position: 'sticky', top: 0, background: '#f8f9fa', zIndex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '4px' }}>
                    <span>{header}</span>
                    <button
                      onClick={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        setShowFilterMenu({ 
                          tableId: table.id, 
                          column: header,
                          position: { top: rect.bottom + 5, left: rect.left }
                        });
                      }}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '10px', padding: '2px', color: '#666' }}
                    >
                      ▼
                    </button>
                  </div>
                </th>
              ))}
              <th style={{ padding: '8px 4px', border: '1px solid #dee2e6', fontWeight: '600', fontSize: '10px', width: '100px' }}>
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedData.map((row, idx) => (
              <tr key={idx} style={{ background: idx % 2 === 0 ? 'white' : '#f9f9f9' }}>
                {headers.map(header => {
                  let val = row[header];
                  let style = { padding: '6px 4px', textAlign: 'center', border: '1px solid #dee2e6' };
                  
                  if (typeof val === 'number') {
                    val = val.toFixed(2);
                    if (parseFloat(val) > 0) style.color = '#27ae60';
                    else if (parseFloat(val) < 0) style.color = '#e74c3c';
                  }
                  
                  return <td key={header} style={style}>{val || '-'}</td>;
                })}
                <td style={{ padding: '6px 4px', textAlign: 'center', border: '1px solid #dee2e6' }}>
                  <div style={{ display: 'flex', gap: '4px', justifyContent: 'center' }}>
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        if (window.confirm(`Remove row for ${row.expiry}?`)) {
                          removeRow(table.id, row);
                        }
                      }}
                      style={{
                        padding: '3px 6px',
                        background: '#e74c3c',
                        color: 'white',
                        border: 'none',
                        borderRadius: '3px',
                        cursor: 'pointer',
                        fontSize: '10px'
                      }}
                      title="Remove this row"
                    >
                      ❌
                    </button>
                    <button 
                      onClick={() => {
                        setActiveTableIndex(tables.findIndex(t => t.id === table.id));
                        setCffDialogData({
                          tableId: table.id,
                          exchange: table.config.exchange || initialExchange,
                          futureExpiry: ''
                        });
                        setShowCFFDialog(true);
                      }}
                      style={{
                        padding: '3px 6px',
                        background: '#27ae60',
                        color: 'white',
                        border: 'none',
                        borderRadius: '3px',
                        cursor: 'pointer',
                        fontSize: '10px'
                      }}
                      title="Add row after this"
                    >
                      ➕
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  const headers = Object.keys(filteredData[0] || {});
  return (
    <div style={{ position: 'relative' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
        <thead>
          <tr style={{ background: '#f8f9fa' }}>
            {headers.map(header => (
              <th key={header} style={{ padding: '8px 4px', border: '1px solid #dee2e6', fontWeight: '600', fontSize: '10px', textTransform: 'uppercase', position: 'sticky', top: 0, background: '#f8f9fa', zIndex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '4px' }}>
                  <span>{header}</span>
                  <button
                    onClick={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      setShowFilterMenu({ 
                        tableId: table.id, 
                        column: header,
                        position: { top: rect.bottom + 5, left: rect.left }
                      });
                    }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '10px', padding: '2px', color: '#666' }}
                  >
                    ▼
                  </button>
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filteredData.map((row, idx) => (
            <tr key={idx} style={{ background: idx % 2 === 0 ? 'white' : '#f9f9f9' }}>
              {headers.map(header => {
                let val = row[header];
                let style = { padding: '6px 4px', textAlign: 'center', border: '1px solid #dee2e6' };
                
                if (typeof val === 'number') {
                  val = val.toFixed(2);
                  if (parseFloat(val) > 0) style.color = '#27ae60';
                  else if (parseFloat(val) < 0) style.color = '#e74c3c';
                }
                
                return <td key={header} style={style}>{val || '-'}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

  const loadSavedConfigs = async () => {
    try {
      if (storageMode === 'backend') {
        const response = await fetch('http://localhost:8080/api/configs');
        const result = await response.json();
        if (result.success) {
          setSavedConfigs(result.configs || {});
        }
      } else {
        // Load from browser storage
        const stored = window.localStorage.getItem('strategy-configs');
        if (stored) {
          setSavedConfigs(JSON.parse(stored));
        }
      }
    } catch (error) {
      console.error('Failed to load configs:', error);
    }
  };

  useEffect(() => {
    loadSavedConfigs();
  }, [storageMode]);

  const saveCurrentConfig = async () => {
    if (!configName.trim()) {
      alert('Please enter a configuration name');
      return;
    }

    const configToSave = tables.map(t => ({
      id: t.id,
      config: t.config
    }));

    try {
      if (storageMode === 'backend') {
        const response = await fetch('http://localhost:8080/api/configs/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: configName.trim(),
            config: configToSave
          })
        });

        const result = await response.json();
        if (result.success) {
          await loadSavedConfigs();
          setShowSaveDialog(false);
          setConfigName('');
          alert(`Configuration "${configName.trim()}" saved successfully!`);
        }
      } else {
        // Save to browser storage
        const configs = { ...savedConfigs };
        configs[configName.trim()] = configToSave;
        window.localStorage.setItem('strategy-configs', JSON.stringify(configs));
        setSavedConfigs(configs);
        setShowSaveDialog(false);
        setConfigName('');
        alert(`Configuration "${configName.trim()}" saved to browser!`);
      }
    } catch (error) {
      console.error('Failed to save configuration:', error);
      alert('Failed to save configuration: ' + error.message);
    }
  };

  const loadConfig = (name) => {
  if (!name) return;
  
  const config = savedConfigs[name];
  if (!config) return;

  const loadedTables = config.map(c => ({
    ...c,
    data: [],
    liveData: null,
    isLoading: true 
  }));
  
  setTables(loadedTables);
  setTableCounter(config.length);
  setSelectedConfig(name);
  
  setTimeout(async () => {
    for (let i = 0; i < config.length; i++) {
      const table = loadedTables[i];
      
      try {
        const response = await fetch('http://localhost:8080/api/strategy/add', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            tableId: table.id, 
            config: table.config 
          })
        });

        const result = await response.json();
        
        if (result.success) {
          setTables(prevTables => {
            const newTables = [...prevTables];
            const tableIndex = newTables.findIndex(t => t.id === table.id);
            if (tableIndex !== -1) {
              const data = result.data?.data || [];
              
              // ✅ FIX: Only sort if C-F/F in "All Expiries" mode
              const isCFF = table.config.strategy === 'C-F/F';
              const isCustomMode = table.config.selectedFutures !== undefined;
              const processedData = (isCFF && !isCustomMode) ? sortByExpiry(data) : data;
              
              newTables[tableIndex] = {
                ...newTables[tableIndex],
                data: processedData,
                liveData: result.data ? {
                  ltp: parseFloat(result.data.spotPrice),
                  timestamp: new Date().toLocaleTimeString()
                } : null,
                isLoading: false
              };
            }
            return newTables;
          });
        }
      } catch (error) {
        console.error(`Error loading ${table.id}:`, error);
      }
      if (i < config.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    alert(`Configuration "${name}" loaded successfully!`);
  }, 100);
};

  const deleteConfig = async () => {
    if (!selectedConfig) {
      alert('Please select a configuration to delete');
      return;
    }

    if (!window.confirm(`Are you sure you want to delete configuration "${selectedConfig}"?`)) {
      return;
    }

    try {
      if (storageMode === 'backend') {
        const response = await fetch('http://localhost:8080/api/configs/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: selectedConfig })
        });

        const result = await response.json();
        if (result.success) {
          await loadSavedConfigs();
          setSelectedConfig('');
          alert(`Configuration "${selectedConfig}" deleted successfully!`);
        }
      } else {
        // Delete from browser storage
        const configs = { ...savedConfigs };
        delete configs[selectedConfig];
        window.localStorage.setItem('strategy-configs', JSON.stringify(configs));
        setSavedConfigs(configs);
        setSelectedConfig('');
        alert(`Configuration "${selectedConfig}" deleted from browser!`);
      }
    } catch (error) {
      console.error('Failed to delete configuration:', error);
    }
  };
  useEffect(() => {
  if (modalForm.symbol === 'ETH') {
    setModalForm(prev => ({
      ...prev,
      strikeInterval: prev.strikeInterval === '1000' ? '50' : prev.strikeInterval,
      gap: prev.gap === '1000' ? '50' : prev.gap
    }));
  } else if (modalForm.symbol === 'BTC') {
    setModalForm(prev => ({
      ...prev,
      strikeInterval: prev.strikeInterval === '50' ? '1000' : prev.strikeInterval,
      gap: prev.gap === '50' ? '1000' : prev.gap
    }));
  }
}, [modalForm.symbol]);
  useEffect(() => {
    let reconnectTimer = null;

    const connect = () => {
      try {
        const ws = new WebSocket("ws://localhost:8080");
        wsRef.current = ws;

        ws.onopen = () => {
          setWsConnected(true);
        };

        ws.onmessage = (event) => {
  try {
    const message = JSON.parse(event.data);
    
    if (message.type === 'strategyUpdate' && message.data) {
      setTables(prevTables => {
        const updatedTables = [...prevTables];
        
        message.data.forEach(strategyData => {
          const tableIndex = updatedTables.findIndex(t => t.id === strategyData.tableId);
          if (tableIndex !== -1) {
            const data = strategyData.data || [];
            const table = updatedTables[tableIndex];
            const isCFF = table.config.strategy === 'C-F/F';
            const isCustomMode = table.config.selectedFutures !== undefined;
            
            // ✅ FIX: Only sort if in "All Expiries" mode, otherwise maintain order
            const processedData = (isCFF && !isCustomMode) ? sortByExpiry(data) : data;
            
            updatedTables[tableIndex] = {
              ...updatedTables[tableIndex],
              data: processedData,
              liveData: {
                ltp: parseFloat(strategyData.spotPrice),
                timestamp: new Date(strategyData.timestamp).toLocaleTimeString()
              }
            };
          }
        });
        
        return updatedTables;
      });
    }
  } catch (err) {
    console.error("Failed to parse message:", err);
  }
};

        ws.onerror = (err) => {
          console.error("WebSocket error", err);
        };

        ws.onclose = () => {
          setWsConnected(false);
          reconnectTimer = setTimeout(connect, 2000);
        };
      } catch (err) {
        reconnectTimer = setTimeout(connect, 2000);
      }
    };

    connect();

    return () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      try {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.close();
        }
      } catch {}
    };
  }, []);

  const fetchBinanceInstruments = async (type = 'option') => {
  try {
    setIsLoadingExpiries(true);
    const response = await fetch('http://localhost:8080/api/fetch-metadata', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ exchange: 'binance', instrumentType: type })
    });
    
    const result = await response.json();
    
    if (result.success && result.metadata) {
      setAvailableData(prev => ({
        ...prev,
        binance: {
          ...prev.binance,
          ...result.metadata
        }
      }));
      
      console.log('✅ Binance metadata loaded:', result.metadata);
      console.log('📊 Future expiries:', result.metadata.futureExpiries);
      console.log('📊 Option expiries:', result.metadata.optionExpiries);
      
      // Set default expiry based on type
      if (type === 'future' && result.metadata.futureExpiries && result.metadata.futureExpiries.length > 0) {
        setModalForm(prev => ({ 
          ...prev, 
          futureExpiry: prev.futureExpiry || result.metadata.futureExpiries[0]
        }));
      } else if (type === 'option' && result.metadata.optionExpiries && result.metadata.optionExpiries.length > 0) {
        setModalForm(prev => ({ 
          ...prev, 
          optionExpiry: prev.optionExpiry || result.metadata.optionExpiries[0]
        }));
      }
    }
  } catch (error) {
    console.error('Failed to fetch Deribit instruments:', error);
  } finally {
    setIsLoadingExpiries(false);
  }
};
const fetchBybitInstruments = async (type = 'option') => {
  try {
    setIsLoadingExpiries(true);
    const response = await fetch('http://localhost:8080/api/fetch-metadata', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ exchange: 'bybit', instrumentType: type })
    });
    
    const result = await response.json();
    
    if (result.success && result.metadata) {
      setAvailableData(prev => ({
        ...prev,
        bybit: {
          ...prev.bybit,
          ...result.metadata
        }
      }));
      
      console.log('✅ Bybit metadata loaded:', result.metadata);
      
      if (type === 'future' && result.metadata.futureExpiries && result.metadata.futureExpiries.length > 0) {
        setModalForm(prev => ({ 
          ...prev, 
          futureExpiry: prev.futureExpiry || result.metadata.futureExpiries[0]
        }));
      } else if (type === 'option' && result.metadata.optionExpiries && result.metadata.optionExpiries.length > 0) {
        setModalForm(prev => ({ 
          ...prev, 
          optionExpiry: prev.optionExpiry || result.metadata.optionExpiries[0]
        }));
      }
    }
  } catch (error) {
    console.error('Failed to fetch Deribit instruments:', error);
  } finally {
    setIsLoadingExpiries(false);
  }
};
// Update around line 847-888
const fetchDeribitInstruments = async (type = 'option') => {
  try {
    setIsLoadingExpiries(true);
    const response = await fetch('http://localhost:8080/api/fetch-metadata', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        exchange: 'deribit', 
        instrumentType: type,
        symbol: modalForm.symbol || 'BTC'  // ✅ ADD THIS
      })
    });
    
    const result = await response.json();
    
    if (result.success && result.metadata) {
      setAvailableData(prev => ({
        ...prev,
        deribit: {
          ...prev.deribit,
          ...result.metadata
        }
      }));
      
      console.log(`✅ Deribit ${modalForm.symbol} metadata loaded:`, result.metadata);
      console.log('📊 Future expiries:', result.metadata.futureExpiries);
      console.log('📊 Option expiries:', result.metadata.optionExpiries);
      
      // Set default expiry based on type
      if (type === 'future' && result.metadata.futureExpiries && result.metadata.futureExpiries.length > 0) {
        setModalForm(prev => ({ 
          ...prev, 
          futureExpiry: prev.futureExpiry || result.metadata.futureExpiries[0]
        }));
      } else if (type === 'option' && result.metadata.optionExpiries && result.metadata.optionExpiries.length > 0) {
        setModalForm(prev => ({ 
          ...prev, 
          optionExpiry: prev.optionExpiry || result.metadata.optionExpiries[0]
        }));
      }
    }
  } catch (error) {
    console.error('Failed to fetch Deribit instruments:', error);
  } finally {
    setIsLoadingExpiries(false);
  }
};

  // Add this useEffect after the existing useEffect around line 765
// Fetch metadata when exchange or strategy changes
useEffect(() => {
  if (!modalForm.exchange || !showModal) return;
  
  const fetchMetadata = async () => {
    const isCFF = modalForm.strategy === 'C-F/F';
    const isJelly = modalForm.strategy === 'Jelly';
    const isSynthetic = modalForm.strategy === 'Synthetic';
    
    if (modalForm.exchange === 'deribit') {
      if (isJelly || isSynthetic) {
        await fetchDeribitInstruments('option');
        await new Promise(resolve => setTimeout(resolve, 500));
        await fetchDeribitInstruments('future');
      } else if (isCFF) {
        await fetchDeribitInstruments('future');
      } else if (modalForm.strategy) {
        await fetchDeribitInstruments('option');
      }
    } else if (modalForm.exchange === 'binance') {
      // ... similar pattern
    }
  };
  
  fetchMetadata();
}, [modalForm.exchange, modalForm.strategy, showModal]);

// ✅ WITH THIS:
useEffect(() => {
  if (!modalForm.exchange || !showModal || !modalForm.strategy) return;
  
  const fetchMetadata = async () => {
    const isCFF = modalForm.strategy === 'C-F/F';
    const isJelly = modalForm.strategy === 'Jelly';
    const isSynthetic = modalForm.strategy === 'Synthetic';
    
    // ✅ For Deribit, symbol matters
    if (modalForm.exchange === 'deribit') {
      // Jelly & Synthetic need both options and futures
      if (isJelly || isSynthetic) {
        await fetchDeribitInstruments('option');
        await new Promise(resolve => setTimeout(resolve, 500));
        await fetchDeribitInstruments('future');
      } 
      // C-F/F only needs futures
      else if (isCFF) {
        await fetchDeribitInstruments('future');
      } 
      // Other strategies (Butterfly, Ratio, etc.) only need options
      else {
        await fetchDeribitInstruments('option');
      }
    } 
    // ✅ For Binance
    else if (modalForm.exchange === 'binance') {
      if (isJelly || isSynthetic) {
        await fetchBinanceInstruments('option');
        await new Promise(resolve => setTimeout(resolve, 500));
        await fetchBinanceInstruments('future');
      } else if (isCFF) {
        await fetchBinanceInstruments('future');
      } else {
        await fetchBinanceInstruments('option');
      }
    } 
    // ✅ For Bybit
    else if (modalForm.exchange === 'bybit') {
      if (isJelly || isSynthetic) {
        await fetchBybitInstruments('option');
        await new Promise(resolve => setTimeout(resolve, 500));
        await fetchBybitInstruments('future');
      } else if (isCFF) {
        await fetchBybitInstruments('future');
      } else {
        await fetchBybitInstruments('option');
      }
    }
  };
  
  fetchMetadata();
}, [modalForm.exchange, modalForm.strategy, modalForm.symbol, showModal]);

  const addTable = () => {
    const newTable = {
      id: `table_${tableCounter}`,
      config: { 
        exchange: initialExchange, 
        strategy: '', 
        symbol: 'BTC', 
        optionExpiry: '', 
        fut1Expiry: 'all',  
        fut2Expiry: 'all',  
        strikeInterval: 1000, 
        gap: 1000, 
        noPrtFolio: 10, 
        strikeMode: 'auto',
        ratio1: 1,
        ratio2: 2,
        strategyLegType: '1331',
        nearestStrike: ''
      },
      data: [],
      liveData: null,
      isLoading: false
    };
    setTables([...tables, newTable]);
    setTableCounter(tableCounter + 1);
    setActiveTableIndex(tables.length);
    setModalForm({
      exchange: initialExchange,
      strategy: '',
      symbol: 'BTC',
      optionExpiry: '',
      fut1Expiry: 'all',  
      fut2Expiry: 'all',
      strikeInterval: '1000',
      gap: '1000',
      noPrtFolio: '10',
      ratio1: '1',
      ratio2: '2',
      strategyLegType: '1331',
      strikeMode: 'auto',
      nearestStrike: ''
    });
    
    setShowModal(true);
  };

  const openSettings = (index) => {
    setActiveTableIndex(index);
    const config = tables[index].config;

    setModalForm({
      exchange: config.exchange || initialExchange,
      strategy: config.strategy || '',
      symbol: config.symbol || 'BTC',
      optionExpiry: config.optionExpiry || '',
      futureExpiry: config.futureExpiry || '', // ✅ ADD THIS
      fut1Expiry: config.fut1Expiry || 'all',  
      fut2Expiry: config.fut2Expiry || 'all',  
      strikeInterval: String(config.strikeInterval || 1000),
      gap: String(config.gap || 1000),
      noPrtFolio: String(config.noPrtFolio || 10),
      ratio1: String(config.ratio1 || 1),
      ratio2: String(config.ratio2 || 2),
      strategyLegType: config.strategyLegType || '1331',
      strikeMode: config.strikeMode || 'auto',
      nearestStrike: String(config.nearestStrike || '')
    });
    
    setShowModal(true);
  };

const applyStrategy = async () => {
  if (activeTableIndex === null) return;
  if (!modalForm.exchange || !modalForm.strategy) {
    alert('Please fill in required fields: Exchange and Strategy');
    return;
  }

  // ✅ NEW: Validation for different strategies
  if (modalForm.strategy === 'Jelly') {
    if (!modalForm.optionExpiry || !modalForm.futureExpiry) {
      alert('Please select both Option Expiry and Future Expiry for Jelly strategy');
      return;
    }
  } else if (modalForm.strategy === 'Synthetic') {
    if (!modalForm.optionExpiry) {
      alert('Please select Expiry for Synthetic strategy');
      return;
    }
  } else if (modalForm.strategy !== 'C-F/F' && !modalForm.optionExpiry) {
    alert('Please select Option Expiry');
    return;
  }

  // ✅ NEW: Set futureExpiry based on strategy
  let futureExpiry = modalForm.futureExpiry;
  if (modalForm.strategy === 'Synthetic') {
    futureExpiry = modalForm.optionExpiry; // Use same expiry for Synthetic
  }

  const config = {
    exchange: modalForm.exchange,
    strategy: modalForm.strategy,
    symbol: modalForm.symbol,
    optionExpiry: modalForm.optionExpiry,
    futureExpiry: futureExpiry, // ✅ ADD THIS
    fut1Expiry: modalForm.fut1Expiry || 'all',
    fut2Expiry: modalForm.fut2Expiry || 'all',
    strikeInterval: parseInt(modalForm.strikeInterval) || 1000,
    gap: parseInt(modalForm.gap) || 1000,
    noPrtFolio: parseInt(modalForm.noPrtFolio) || 10,
    ratio1: parseInt(modalForm.ratio1) || 1,
    ratio2: parseInt(modalForm.ratio2) || 2,
    strategyLegType: modalForm.strategyLegType || '1331',
    strikeMode: modalForm.strikeMode || 'auto',
    nearestStrike: modalForm.nearestStrike ? parseInt(modalForm.nearestStrike) : ''
  };

  try {
    const tableId = tables[activeTableIndex].id;
    
    const response = await fetch('http://localhost:8080/api/strategy/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tableId, config })
    });

    const result = await response.json();
    
    if (result.success) {
      setTables(prevTables => {
        const newTables = [...prevTables];
        const data = result.data?.data || [];
        
        newTables[activeTableIndex] = { 
          ...newTables[activeTableIndex], 
          config, 
          data: data,  // ✅ No sorting needed for C-F/F anymore
          liveData: result.data ? {
            ltp: parseFloat(result.data.spotPrice),
            timestamp: new Date().toLocaleTimeString()
          } : null
        };
        return newTables;
      });
      
      setShowModal(false);
    } else {
      alert('Failed to apply strategy: ' + (result.error || 'Unknown error'));
    }
  } catch (error) {
    console.error('Apply strategy error:', error);
    alert('Failed to apply strategy: ' + error.message);
  }
};
  const removeTable = async (id) => {
    try {
      await fetch('http://localhost:8080/api/strategy/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tableId: id })
      });
      
      setTables(tables.filter(table => table.id !== id));
    } catch (error) {
      console.error('Remove table error:', error);
    }
  };

  return (
    <div style={{ padding: '20px', background: '#f5f5f5', minHeight: '100vh', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', background: 'white', padding: '15px', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)', flexWrap: 'wrap', gap: '10px' }}>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', padding: '6px 12px', background: '#f8f9fa', borderRadius: '4px' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: wsConnected ? '#27ae60' : '#e74c3c' }}></span>
            {wsConnected ? 'Connected' : 'Disconnected'}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 12px', background: '#f0f0f0', borderRadius: '4px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '13px', cursor: 'pointer' }}>
              <input 
                type="radio" 
                name="storageMode" 
                value="browser" 
                checked={storageMode === 'browser'} 
                onChange={(e) => setStorageMode(e.target.value)}
              />
              Browser
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '13px', cursor: 'pointer' }}>
              <input 
                type="radio" 
                name="storageMode" 
                value="backend" 
                checked={storageMode === 'backend'} 
                onChange={(e) => setStorageMode(e.target.value)}
              />
              Backend
            </label>
          </div>
          
          <select 
            value={selectedConfig} 
            onChange={(e) => loadConfig(e.target.value)}
            style={{ padding: '8px 12px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '13px', minWidth: '220px' }}
          >
            <option value="">-- Select Saved Configuration --</option>
            {Object.keys(savedConfigs).map(name => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>

          <button 
            onClick={() => setShowSaveDialog(true)} 
            style={{ padding: '8px 15px', background: '#27ae60', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', fontSize: '13px' }}
          >
            Save Current
          </button>

          <button 
            onClick={deleteConfig} 
            style={{ padding: '8px 15px', background: '#e74c3c', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', fontSize: '13px', opacity: selectedConfig ? 1 : 0.5 }}
            disabled={!selectedConfig}
          >
            Delete
          </button>
        </div>
        
        <button onClick={addTable} style={{ padding: '8px 15px', background: '#3498db', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', fontSize: '13px' }}>
          + Add Strategy Table
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(400px, 1fr))', gap: '20px' }}>
        
{tables.map((table, index) => (
  <div key={table.id} style={{ 
    background: 'white', 
    borderRadius: '8px', 
    boxShadow: '0 2px 8px rgba(0,0,0,0.1)', 
    overflow: 'hidden' 
  }}>
    {/* Single Header Row with Exchange, Strategy, Symbol, Spot Value */}
    <div style={{ 
      display: 'flex', 
      justifyContent: 'space-between', 
      alignItems: 'center', 
      padding: '12px 15px', 
      background: '#f8f9fa', 
      borderBottom: '1px solid #dee2e6' 
    }}>
      {/* Left Section - Exchange, Strategy, Symbol, Spot */}
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        gap: '12px',
        flex: 1 
      }}>
        {/* Exchange */}
        <span style={{ 
          color: '#3b82f6', 
          fontWeight: 700,
          fontSize: '14px'
        }}>
          {table.config.exchange?.toUpperCase() || 'N/A'}
        </span>
        
        {/* Divider */}
        <span style={{ color: '#dee2e6' }}>|</span>
        
        {/* Strategy */}
        <span style={{ 
          fontWeight: 600,
          fontSize: '14px',
          color: '#374151'
        }}>
          {table.config.strategy || 'Strategy'}
        </span>
        
        {/* Divider */}
        <span style={{ color: '#dee2e6' }}>|</span>
        
        {/* Symbol Badge */}
        <span style={{ 
          background: '#e0e7ff',
          color: '#4f46e5',
          padding: '4px 10px',
          borderRadius: '4px',
          fontSize: '12px',
          fontWeight: 600
        }}>
          {table.config.symbol || 'BTC'}
        </span>
        
        {/* Spot Value */}
        {/* Spot Value with S/P Badge */}
        {table.liveData && (
          <>
            <span style={{ color: '#dee2e6' }}>|</span>
            <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '6px',
              background: '#f0fdf4',
              padding: '4px 10px',
              borderRadius: '4px'
            }}>
              <span style={{ 
                background: table.config.exchange === 'binance' ? '#27ae60' : '#3498db',
                color: 'white',
                padding: '2px 5px',
                borderRadius: '3px',
                fontSize: '9px',
                fontWeight: 'bold'
              }}>
                {table.config.exchange === 'binance' ? 'S' : 'P'}
              </span>
              <span style={{ 
                fontSize: '13px', 
                fontWeight: 700,
                color: '#16a34a'
              }}>
                ${table.liveData.ltp?.toFixed(2) || '0.00'}
              </span>
            </div>
          </>
        )}
        
        {/* Expiry Info (if needed) */}
        {(table.config.optionExpiry || table.config.futureExpiry) && (
          <span style={{ 
            fontSize: '11px', 
            color: '#6b7280',
            marginLeft: '4px'
          }}>
            {table.config.optionExpiry && `${table.config.optionExpiry} (O)`}
            {table.config.futureExpiry && table.config.strategy === 'Jelly' && ` ${table.config.futureExpiry} (F)`}
          </span>
        )}
      </div>
      
      {/* Right Section - Action Buttons */}
      <div style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
        <button 
          onClick={() => openSettings(index)} 
          style={{ 
            background: 'transparent', 
            border: 'none', 
            cursor: 'pointer', 
            padding: '4px 8px', 
            fontSize: '14px',
            transition: 'transform 0.2s'
          }}
          onMouseEnter={(e) => e.target.style.transform = 'scale(1.1)'}
          onMouseLeave={(e) => e.target.style.transform = 'scale(1)'}
        >
          ⚙️
        </button>
        <button onClick={() => removeTable(table.id)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px 8px', fontSize: '14px', color: '#e74c3c' }}>
                  ✕
                </button>
      </div>
    </div>
    
    {/* Table Content */}
    <div style={{ 
      padding: '10px', 
      maxHeight: '400px', 
      overflowY: 'auto' 
    }}>
      {table.isLoading ? (
        <div style={{ 
          textAlign: 'center', 
          padding: '40px', 
          color: '#6b7280',
          fontSize: '14px'
        }}>
          Loading strategy data...
        </div>
      ) : (
        renderTable(table)
      )}
    </div>
  </div>
))}
      </div>

      {showSaveDialog && (
        <div onClick={() => setShowSaveDialog(false)} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1001 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'white', borderRadius: '8px', padding: '30px', width: '90%', maxWidth: '500px', boxShadow: '0 4px 20px rgba(0,0,0,0.3)' }}>
            <h3 style={{ margin: '0 0 10px 0', fontSize: '16px', fontWeight: '600' }}>Save Configuration</h3>
            <p style={{ margin: '0 0 20px 0', fontSize: '14px', color: '#333' }}>
              Enter a name for this configuration (Storage: <strong>{storageMode === 'backend' ? 'Backend Server' : 'Browser Local'}</strong>):
            </p>
            <input
              type="text"
              value={configName}
              onChange={(e) => setConfigName(e.target.value)}
              style={{ width: '100%', padding: '10px', border: '1px solid #ccc', borderRadius: '2px', fontSize: '14px', marginBottom: '20px', boxSizing: 'border-box' }}
              onKeyPress={(e) => e.key === 'Enter' && saveCurrentConfig()}
              autoFocus
            />
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowSaveDialog(false)}
                style={{ padding: '8px 24px', background: '#e0e0e0', color: '#333', border: 'none', borderRadius: '2px', cursor: 'pointer', fontSize: '13px' }}
              >
                Cancel
              </button>
              <button
                onClick={saveCurrentConfig}
                style={{ padding: '8px 24px', background: '#4285f4', color: 'white', border: 'none', borderRadius: '2px', cursor: 'pointer', fontSize: '13px' }}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {showModal && (
        <div onClick={() => setShowModal(false)} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'white', borderRadius: '8px', width: '90%', maxWidth: '800px', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 4px 20px rgba(0,0,0,0.3)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px', borderBottom: '1px solid #dee2e6' }}>
              <h3 style={{ margin: 0, fontSize: '18px' }}>Strategy Settings</h3>
              <button onClick={() => setShowModal(false)} style={{ background: 'none', border: 'none', fontSize: '24px', cursor: 'pointer', color: '#999' }}>×</button>
            </div>
            <div style={{ padding: '20px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '15px', marginBottom: '20px' }}>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
  <label style={{ fontWeight: 'bold', marginBottom: '5px', fontSize: '12px' }}>Exchange</label>
  <select value={modalForm.exchange} onChange={(e) => setModalForm({...modalForm, exchange: e.target.value})} style={{ padding: '8px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '13px' }}>
    <option value="">--Select--</option>
    <option value="binance">Binance</option>
    <option value="deribit">Deribit</option>
    <option value="bybit">Bybit</option>
    <option value="lighter">no</option>
    <option value="okx">OKX</option>
  </select>
</div>

                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <label style={{ fontWeight: 'bold', marginBottom: '5px', fontSize: '12px' }}>Strategy</label>
                  <select value={modalForm.strategy} onChange={(e) => setModalForm({...modalForm, strategy: e.target.value})} style={{ padding: '8px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '13px' }}>
                    <option value="">--Select--</option>
                    <option value="Jelly">Jelly</option>
                    <option value="Synthetic">Synthetic</option>
                    <option value="Butterfly">Butterfly</option>
                    <option value="Ratio">Ratio</option>
                    <option value="Pulse_Butterfly">Pulse Butterfly</option>
                    <option value="C-F/F">C-F/F (Cash-Future/Future)</option>
                  </select>
                </div>
<div style={{ display: 'flex', flexDirection: 'column' }}>
  <label style={{ fontWeight: 'bold', marginBottom: '5px', fontSize: '12px' }}>Symbol</label>
  {modalForm.exchange === 'deribit' ? (
    <select 
      value={modalForm.symbol} 
      onChange={(e) => setModalForm({...modalForm, symbol: e.target.value})}
      style={{ padding: '8px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '13px' }}
    >
      <option value="BTC">BTC</option>
      <option value="ETH">ETH</option>
    </select>
  ) : (
    <input 
      type="text" 
      value={modalForm.symbol} 
      onChange={(e) => setModalForm({...modalForm, symbol: e.target.value})} 
      style={{ padding: '8px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '13px' }} 
    />
  )}
</div>

                {modalForm.strategy === 'Jelly' && (
  <>
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <label style={{ fontWeight: 'bold', marginBottom: '5px', fontSize: '12px' }}>Option Expiry</label>
      <select 
        value={modalForm.optionExpiry} 
        onChange={(e) => setModalForm({ ...modalForm, optionExpiry: e.target.value })} 
        disabled={!modalForm.exchange || isLoadingExpiries} 
        style={{ padding: '8px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '13px' }}
      >
        <option value="">{!modalForm.exchange ? 'Select exchange first' : (isLoadingExpiries ? 'Loading...' : '--Select--')}</option>
        {(availableData[modalForm.exchange]?.optionExpiries || []).map(exp => (
          <option key={exp} value={exp}>{exp}</option>
        ))}
      </select>
    </div>
    
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <label style={{ fontWeight: 'bold', marginBottom: '5px', fontSize: '12px' }}>Future Expiry</label>
      <select 
        value={modalForm.futureExpiry} 
        onChange={(e) => setModalForm({ ...modalForm, futureExpiry: e.target.value })} 
        disabled={!modalForm.exchange || isLoadingExpiries} 
        style={{ padding: '8px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '13px' }}
      >
        <option value="">{!modalForm.exchange ? 'Select exchange first' : (isLoadingExpiries ? 'Loading...' : '--Select--')}</option>
        {(availableData[modalForm.exchange]?.futureExpiries || []).map(exp => (
          <option key={exp} value={exp}>{exp}</option>
        ))}
      </select>
    </div>
  </>
)}

{modalForm.strategy === 'Synthetic' && (
  <div style={{ display: 'flex', flexDirection: 'column' }}>
    <label style={{ fontWeight: 'bold', marginBottom: '5px', fontSize: '12px' }}>Expiry (Option & Future)</label>
    <select 
      value={modalForm.optionExpiry} 
      onChange={(e) => setModalForm({ ...modalForm, optionExpiry: e.target.value })} 
      disabled={!modalForm.exchange || isLoadingExpiries} 
      style={{ padding: '8px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '13px' }}
    >
      <option value="">{!modalForm.exchange ? 'Select exchange first' : (isLoadingExpiries ? 'Loading...' : '--Select--')}</option>
      {(availableData[modalForm.exchange]?.optionExpiries || []).map(exp => (
        <option key={exp} value={exp}>{exp}</option>
      ))}
    </select>
  </div>
)}

{!['C-F/F', 'Jelly', 'Synthetic'].includes(modalForm.strategy) && modalForm.strategy !== '' && (
  <div style={{ display: 'flex', flexDirection: 'column' }}>
    <label style={{ fontWeight: 'bold', marginBottom: '5px', fontSize: '12px' }}>Option Expiry</label>
    <select 
      value={modalForm.optionExpiry} 
      onChange={(e) => setModalForm({ ...modalForm, optionExpiry: e.target.value })} 
      disabled={!modalForm.exchange || isLoadingExpiries} 
      style={{ padding: '8px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '13px' }}
    >
      <option value="">{!modalForm.exchange ? 'Select exchange first' : (isLoadingExpiries ? 'Loading...' : '--Select--')}</option>
      {(availableData[modalForm.exchange]?.optionExpiries || []).map(exp => (
        <option key={exp} value={exp}>{exp}</option>
      ))}
    </select>
  </div>
)}
  

                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <label style={{ fontWeight: 'bold', marginBottom: '5px', fontSize: '12px' }}>No. Portfolio</label>
                  <input type="number" value={modalForm.noPrtFolio} onChange={(e) => setModalForm({...modalForm, noPrtFolio: e.target.value})} min="1" style={{ padding: '8px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '13px' }} />
                </div>

                {['Butterfly', 'Ratio', 'Pulse_Butterfly'].includes(modalForm.strategy) && (
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <label style={{ fontWeight: 'bold', marginBottom: '5px', fontSize: '12px' }}>Gap</label>
                    <input type="number" value={modalForm.gap} onChange={(e) => setModalForm({...modalForm, gap: e.target.value})} style={{ padding: '8px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '13px' }} />
                  </div>
                )}

                {modalForm.strategy === 'Ratio' && (
                  <>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <label style={{ fontWeight: 'bold', marginBottom: '5px', fontSize: '12px' }}>Ratio 1</label>
                      <input type="number" value={modalForm.ratio1} onChange={(e) => setModalForm({...modalForm, ratio1: e.target.value})} style={{ padding: '8px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '13px' }} />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <label style={{ fontWeight: 'bold', marginBottom: '5px', fontSize: '12px' }}>Ratio 2</label>
                      <input type="number" value={modalForm.ratio2} onChange={(e) => setModalForm({...modalForm, ratio2: e.target.value})} style={{ padding: '8px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '13px' }} />
                    </div>
                  </>
                )}

                {modalForm.strategy === 'Pulse_Butterfly' && (
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <label style={{ fontWeight: 'bold', marginBottom: '5px', fontSize: '12px' }}>Strategy Leg Type</label>
                    <select value={modalForm.strategyLegType} onChange={(e) => setModalForm({...modalForm, strategyLegType: e.target.value})} style={{ padding: '8px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '13px' }}>
                      <option value="1331">1331</option>
                      <option value="1221">1221</option>
                    </select>
                  </div>
                )}

                {modalForm.strategy === 'C-F/F' && (
  <>
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <label style={{ fontWeight: 'bold', marginBottom: '5px', fontSize: '12px' }}>
        Fut1 Expiry
      </label>
      <select 
        value={modalForm.fut1Expiry} 
        onChange={(e) => setModalForm({ ...modalForm, fut1Expiry: e.target.value })} 
        disabled={isLoadingExpiries || !modalForm.exchange}
        style={{ padding: '8px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '13px' }}
      >
        <option value="all">All Expiries</option>
        <option value="perpetual">Perpetual</option>
        {(availableData[modalForm.exchange]?.futureExpiries || []).map(exp => (
          <option key={exp} value={exp}>{exp}</option>
        ))}
      </select>
    </div>

    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <label style={{ fontWeight: 'bold', marginBottom: '5px', fontSize: '12px' }}>
        Fut2 Expiry
      </label>
      <select 
        value={modalForm.fut2Expiry} 
        onChange={(e) => setModalForm({ ...modalForm, fut2Expiry: e.target.value })} 
        disabled={isLoadingExpiries || !modalForm.exchange}
        style={{ padding: '8px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '13px' }}
      >
        <option value="all">All Futures</option>
        {(availableData[modalForm.exchange]?.futureExpiries || []).map(exp => (
          <option key={exp} value={exp}>{exp}</option>
        ))}
      </select>
    </div>
  </>
)}
              </div>

              <button onClick={applyStrategy} style={{ width: '100%', padding: '12px', background: '#3498db', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', fontSize: '13px', transition: 'background 0.2s' }}>
                Apply Settings
              </button>
            </div>
          </div>
        </div>
      )}

      {showCFFDialog && (
  <div onClick={() => setShowCFFDialog(false)} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1002 }}>
    <div onClick={e => e.stopPropagation()} style={{ background: 'white', borderRadius: '8px', padding: '30px', width: '90%', maxWidth: '500px', boxShadow: '0 4px 20px rgba(0,0,0,0.3)' }}>
      <h3 style={{ margin: '0 0 20px 0', fontSize: '16px', fontWeight: '600' }}>
        Add C-F/F Row
      </h3>
      
      
<div style={{ marginBottom: '15px' }}>
  <label style={{ fontWeight: 'bold', marginBottom: '5px', fontSize: '12px', display: 'block' }}>Exchange</label>
  <select 
    value={cffDialogData.exchange} 
    onChange={(e) => {
      const selectedEx = e.target.value;
      setCffDialogData({...cffDialogData, exchange: selectedEx, fut1Expiry: '', fut2Expiry: ''});
      
      if (selectedEx === 'deribit' && (!availableData.deribit.futureExpiries || availableData.deribit.futureExpiries.length === 0)) {
        fetchDeribitInstruments('future');
      } else if (selectedEx === 'binance' && (!availableData.binance.futureExpiries || availableData.binance.futureExpiries.length === 0)) {
        fetchBinanceInstruments('future');
      }
      else if (selectedEx === 'bybit' && (!availableData.bybit.futureExpiries || availableData.bybit.futureExpiries.length === 0)) {
        fetchBybitInstruments('future');
      }
    }}
    style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '13px' }}
  >
    <option value="">--Select--</option>
    <option value="binance">Binance</option>
    <option value="deribit">Deribit</option>
    <option value="bybit">Bybit</option>
    <option value="lighter">Lighter</option>
    <option value="okx">OKX</option>
  </select>
</div>
      
      <div style={{ marginBottom: '15px' }}>
        <label style={{ fontWeight: 'bold', marginBottom: '5px', fontSize: '12px', display: 'block' }}>Fut1 Expiry</label>
        <select 
          value={cffDialogData.fut1Expiry} 
          onChange={(e) => setCffDialogData({...cffDialogData, fut1Expiry: e.target.value})}
          disabled={!cffDialogData.exchange || isLoadingExpiries}
          style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '13px' }}
        >
          <option value="">--Select--</option>
          <option value="perpetual">Perpetual</option>
          {(availableData[cffDialogData.exchange]?.futureExpiries || []).map(exp => (
            <option key={exp} value={exp}>{exp}</option>
          ))}
        </select>
      </div>
      
      <div style={{ marginBottom: '20px' }}>
        <label style={{ fontWeight: 'bold', marginBottom: '5px', fontSize: '12px', display: 'block' }}>Fut2 Expiry</label>
        <select 
          value={cffDialogData.fut2Expiry} 
          onChange={(e) => setCffDialogData({...cffDialogData, fut2Expiry: e.target.value})}
          disabled={!cffDialogData.exchange || isLoadingExpiries}
          style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '13px' }}
        >
          <option value="">--Select--</option>
          {(availableData[cffDialogData.exchange]?.futureExpiries || []).map(exp => (
            <option key={exp} value={exp}>{exp}</option>
          ))}
        </select>
      </div>
      
      <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
        <button
          onClick={() => setShowCFFDialog(false)}
          style={{ padding: '8px 24px', background: '#e0e0e0', color: '#333', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '13px' }}
        >
          Cancel
        </button>
        <button
          onClick={handleAddCFFRow}
          style={{ padding: '8px 24px', background: '#27ae60', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '13px' }}
        >
          Add Row
        </button>
      </div>
    </div>
  </div>
)}
      {showFilterMenu.tableId && showFilterMenu.column && (
        <>
          <div 
            onClick={() => setShowFilterMenu({ tableId: null, column: null, position: null })}
            style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999 }}
          />
          <FilterDropdown 
            tableId={showFilterMenu.tableId}
            column={showFilterMenu.column}
            data={tables.find(t => t.id === showFilterMenu.tableId)?.data || []}
            position={showFilterMenu.position}
          />
        </>
      )}
    </div>
  );
};

export default StrategyDashboard;
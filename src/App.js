import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Dashboard from './components/Dashboard';
import StrategyDashboard from './components/StrategyDashboard';
import './App.css';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/strategy" element={<StrategyDashboard />} />
      </Routes>
    </Router>
  );
}

export default App;
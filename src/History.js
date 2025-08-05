import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './History.css';

const History = ({ onClose, lightningAddress, speedApiKey }) => {
  const [gameHistory, setGameHistory] = useState([]);
  const [totalProfit, setTotalProfit] = useState(0);
  const [totalGames, setTotalGames] = useState(0);
  const [winRate, setWinRate] = useState(0);
  const [selectedTab, setSelectedTab] = useState('all'); // 'all', 'won', 'lost'

  // Load game history from localStorage
  useEffect(() => {
    const loadHistory = () => {
      const storageKey = `gameHistory_${lightningAddress || 'anonymous'}`;
      const savedHistory = localStorage.getItem(storageKey);
      if (savedHistory) {
        const history = JSON.parse(savedHistory);
        setGameHistory(history);
        calculateStats(history);
      }
    };
    loadHistory();
  }, [lightningAddress, speedApiKey]);

  useEffect(() => {
    async function fetchTransactionHistory() {
      try {
        const response = await axios.post('https://api.tryspeed.com/transaction-history', {
          lightningAddress,
        }, {
          headers: { 'Authorization': `Bearer ${speedApiKey}` },
        });

        setGameHistory(response.data.history);
        calculateStats(response.data.history);
      } catch (error) {
        console.error('Failed to fetch transaction history:', error);
      }
    }

    fetchTransactionHistory();
  }, [lightningAddress, speedApiKey]);

  const calculateStats = (history) => {
    const total = history.length;
    const wins = history.filter(game => game.result === 'won').length;
    const profit = history.reduce((acc, game) => acc + game.profit, 0);
    
    setTotalGames(total);
    setWinRate(total > 0 ? ((wins / total) * 100).toFixed(1) : 0);
    setTotalProfit(profit);
  };

  const filteredHistory = gameHistory.filter(game => {
    if (selectedTab === 'all') return true;
    if (selectedTab === 'won') return game.result === 'won';
    if (selectedTab === 'lost') return game.result === 'lost';
    return true;
  });

  const formatDate = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className="history-container">
      <div className="history-header">
        <button className="close-history" onClick={onClose}>×</button>
        <h2>⚓ Battle History ⚓</h2>
        <div className="history-subtitle">Your Naval Campaign Records</div>
      </div>

      {/* Stats Overview */}
      <div className="stats-overview">
        <div className="stat-card">
          <div className="stat-icon">🎯</div>
          <div className="stat-value">{totalGames}</div>
          <div className="stat-label">Total Battles</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">⚡</div>
          <div className="stat-value">{winRate}%</div>
          <div className="stat-label">Victory Rate</div>
        </div>
        <div className="stat-card profit">
          <div className="stat-icon">💰</div>
          <div className={`stat-value ${totalProfit >= 0 ? 'positive' : 'negative'}`}>
            {totalProfit >= 0 ? '+' : ''}{totalProfit} SATS
          </div>
          <div className="stat-label">Total Profit</div>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="history-tabs">
        <button 
          className={`tab-btn ${selectedTab === 'all' ? 'active' : ''}`}
          onClick={() => setSelectedTab('all')}
        >
          All Games
        </button>
        <button 
          className={`tab-btn ${selectedTab === 'won' ? 'active' : ''}`}
          onClick={() => setSelectedTab('won')}
        >
          Victories ⚓
        </button>
        <button 
          className={`tab-btn ${selectedTab === 'lost' ? 'active' : ''}`}
          onClick={() => setSelectedTab('lost')}
        >
          Defeats 💀
        </button>
      </div>

      {/* Game History List */}
      <div className="history-list-container">
        {filteredHistory.length === 0 ? (
          <div className="no-history">
            <div className="ship-icon">🚢</div>
            <p>No battles fought yet!</p>
            <p className="sub-text">Start your naval campaign</p>
          </div>
        ) : (
          <ul className="history-list">
            {filteredHistory.map((game, index) => (
              <li key={index} className={`history-item ${game.result}`}>
                <div className="game-header">
                  <span className="game-number">Battle #{filteredHistory.length - index}</span>
                  <span className="game-date">{formatDate(game.timestamp)}</span>
                </div>
                
                <div className="game-details">
                  <div className="detail-row">
                    <span className="detail-label">⚡ Bet Amount:</span>
                    <span className="detail-value">{game.betAmount} SATS</span>
                  </div>
                  
                  <div className="detail-row">
                    <span className="detail-label">🎯 Result:</span>
                    <span className={`detail-value result-${game.result}`}>
                      {game.result === 'won' ? '✅ Victory!' : '❌ Defeat'}
                    </span>
                  </div>
                  
                  <div className="detail-row">
                    <span className="detail-label">💰 Profit/Loss:</span>
                    <span className={`detail-value ${game.profit >= 0 ? 'profit' : 'loss'}`}>
                      {game.profit >= 0 ? '+' : ''}{game.profit} SATS
                    </span>
                  </div>

                  {game.enemyShipsSunk !== undefined && (
                    <div className="detail-row">
                      <span className="detail-label">🚢 Enemy Ships Sunk:</span>
                      <span className="detail-value">{game.enemyShipsSunk}/5</span>
                    </div>
                  )}

                  {game.duration && (
                    <div className="detail-row">
                      <span className="detail-label">⏱️ Battle Duration:</span>
                      <span className="detail-value">{game.duration}</span>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default History;


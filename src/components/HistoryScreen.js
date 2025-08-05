import React, { useState, useEffect, useMemo } from 'react';
import './HistoryScreen.css';

const HistoryScreen = ({ onClose, lightningAddress, gameHistory = [] }) => {
  const [selectedTab, setSelectedTab] = useState('all');
  const [sortBy, setSortBy] = useState('recent');
  const [isLoading, setIsLoading] = useState(false);
  const [speedWalletData, setSpeedWalletData] = useState([]);
  const [activeView, setActiveView] = useState('stats'); // 'stats' or 'transactions'

  // Swipe handling for mobile
  const [touchStart, setTouchStart] = useState(null);
  const [touchEnd, setTouchEnd] = useState(null);

  // Calculate comprehensive statistics
  const stats = useMemo(() => {
    const totalGames = gameHistory.length;
    const wins = gameHistory.filter(game => game.result === 'won').length;
    const losses = totalGames - wins;
    const totalBet = gameHistory.reduce((sum, game) => sum + (game.betAmount || 0), 0);
    const totalWinnings = gameHistory.filter(game => game.result === 'won')
      .reduce((sum, game) => sum + (game.winnings || 0), 0);
    const totalLost = gameHistory.filter(game => game.result === 'lost')
      .reduce((sum, game) => sum + (game.betAmount || 0), 0);
    const netProfit = totalWinnings - totalLost;
    const winRate = totalGames > 0 ? ((wins / totalGames) * 100).toFixed(1) : 0;
    const avgBet = totalGames > 0 ? Math.round(totalBet / totalGames) : 0;
    const biggestWin = gameHistory.length > 0 ? Math.max(...gameHistory.map(g => g.winnings || 0)) : 0;
    const longestStreak = calculateWinStreak(gameHistory);

    return {
      totalGames,
      wins,
      losses,
      totalBet,
      totalWinnings,
      totalLost,
      netProfit,
      winRate,
      avgBet,
      biggestWin,
      longestStreak
    };
  }, [gameHistory]);

  // Calculate win streak
  const calculateWinStreak = (history) => {
    let maxStreak = 0;
    let currentStreak = 0;
    
    for (const game of history) {
      if (game.result === 'won') {
        currentStreak++;
        maxStreak = Math.max(maxStreak, currentStreak);
      } else {
        currentStreak = 0;
      }
    }
    return maxStreak;
  };

  // Fetch player history and Speed Wallet transaction history
  useEffect(() => {
    const fetchPlayerData = async () => {
      if (!lightningAddress) return;
      
      setIsLoading(true);
      try {
        // Fetch player history from our backend API
        const historyResponse = await fetch(`/api/history/${encodeURIComponent(lightningAddress)}`);
        if (historyResponse.ok) {
          const historyData = await historyResponse.json();
          console.log('Player history data:', historyData);
          // The history data would be used to supplement local gameHistory
          // For now, we'll log it and continue using the existing local data
        }
        
        // Fetch Speed Wallet transactions via our backend proxy
        const speedResponse = await fetch(`/api/speed-transactions/${encodeURIComponent(lightningAddress)}`);
        if (speedResponse.ok) {
          const speedData = await speedResponse.json();
          setSpeedWalletData(speedData.transactions || []);
          console.log('Speed Wallet transactions:', speedData.transactions);
        }
      } catch (error) {
        console.log('Backend APIs not available, using local data:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchPlayerData();
  }, [lightningAddress]);

  // Filter and sort game history
  const filteredHistory = useMemo(() => {
    let filtered = [...gameHistory];
    
    if (selectedTab === 'wins') {
      filtered = filtered.filter(game => game.result === 'won');
    } else if (selectedTab === 'losses') {
      filtered = filtered.filter(game => game.result === 'lost');
    }
    
    if (sortBy === 'recent') {
      filtered.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    } else if (sortBy === 'oldest') {
      filtered.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    } else if (sortBy === 'amount') {
      filtered.sort((a, b) => (b.winnings || 0) - (a.winnings || 0));
    }
    
    return filtered;
  }, [gameHistory, selectedTab, sortBy]);

  // Handle swipe navigation
  const handleTouchStart = (e) => {
    setTouchEnd(null);
    setTouchStart(e.targetTouches[0].clientX);
  };

  const handleTouchMove = (e) => {
    setTouchEnd(e.targetTouches[0].clientX);
  };

  const handleTouchEnd = () => {
    if (!touchStart || !touchEnd) return;
    
    const distance = touchStart - touchEnd;
    const isLeftSwipe = distance > 50;
    const isRightSwipe = distance < -50;

    if (isRightSwipe && activeView === 'transactions') {
      setActiveView('stats');
    } else if (isLeftSwipe && activeView === 'stats') {
      setActiveView('transactions');
    } else if (isRightSwipe && activeView === 'stats') {
      onClose(); // Swipe right to go back to main menu
    }
  };

  const formatDate = (timestamp) => {
    if (!timestamp) return 'Unknown';
    const date = new Date(timestamp);
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatSats = (amount) => {
    if (!amount) return '0';
    return amount.toLocaleString();
  };

  return (
    <div 
      className="history-screen"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Header */}
      <div className="history-header">
        <button className="history-back-btn" onClick={onClose}>
          <span>←</span>
        </button>
        <div className="history-title-section">
          <h1 className="history-title">⚡ Battle History ⚡</h1>
          <p className="history-subtitle">Your Naval Command Records</p>
        </div>
        <div className="history-nav-indicator">
          <div className={`nav-dot ${activeView === 'stats' ? 'active' : ''}`} 
               onClick={() => setActiveView('stats')} />
          <div className={`nav-dot ${activeView === 'transactions' ? 'active' : ''}`} 
               onClick={() => setActiveView('transactions')} />
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="view-tabs">
        <button 
          className={`view-tab ${activeView === 'stats' ? 'active' : ''}`}
          onClick={() => setActiveView('stats')}
        >
          <span className="tab-icon">📊</span>
          <span>Statistics</span>
        </button>
        <button 
          className={`view-tab ${activeView === 'transactions' ? 'active' : ''}`}
          onClick={() => setActiveView('transactions')}
        >
          <span className="tab-icon">🏛️</span>
          <span>Transactions</span>
        </button>
      </div>

      {/* Content Area */}
      <div className="history-content">
        {activeView === 'stats' ? (
          <div className="stats-view">
            {/* Overview Stats */}
            <div className="stats-overview">
              <div className="stat-card primary">
                <div className="stat-icon">🎯</div>
                <div className="stat-value">{stats.totalGames}</div>
                <div className="stat-label">Total Battles</div>
              </div>
              <div className="stat-card success">
                <div className="stat-icon">🏆</div>
                <div className="stat-value">{stats.winRate}%</div>
                <div className="stat-label">Victory Rate</div>
              </div>
              <div className={`stat-card ${stats.netProfit >= 0 ? 'profit' : 'loss'}`}>
                <div className="stat-icon">💰</div>
                <div className="stat-value">
                  {stats.netProfit >= 0 ? '+' : ''}{formatSats(stats.netProfit)}
                </div>
                <div className="stat-label">Net Profit (SATS)</div>
              </div>
            </div>

            {/* Detailed Stats Grid */}
            <div className="detailed-stats">
              <div className="stats-section">
                <h3>Combat Performance</h3>
                <div className="stats-grid">
                  <div className="stat-item">
                    <span className="stat-name">Victories</span>
                    <span className="stat-value win">{stats.wins}</span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-name">Defeats</span>
                    <span className="stat-value loss">{stats.losses}</span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-name">Win Streak</span>
                    <span className="stat-value">{stats.longestStreak}</span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-name">Biggest Win</span>
                    <span className="stat-value profit">{formatSats(stats.biggestWin)} SATS</span>
                  </div>
                </div>
              </div>

              <div className="stats-section">
                <h3>Financial Summary</h3>
                <div className="stats-grid">
                  <div className="stat-item">
                    <span className="stat-name">Total Wagered</span>
                    <span className="stat-value">{formatSats(stats.totalBet)} SATS</span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-name">Total Won</span>
                    <span className="stat-value win">{formatSats(stats.totalWinnings)} SATS</span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-name">Average Bet</span>
                    <span className="stat-value">{formatSats(stats.avgBet)} SATS</span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-name">Total Lost</span>
                    <span className="stat-value loss">{formatSats(stats.totalLost)} SATS</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="transactions-view">
            {/* Filter Controls */}
            <div className="filter-controls">
              <div className="filter-tabs">
                <button 
                  className={`filter-tab ${selectedTab === 'all' ? 'active' : ''}`}
                  onClick={() => setSelectedTab('all')}
                >
                  All Games
                </button>
                <button 
                  className={`filter-tab ${selectedTab === 'wins' ? 'active' : ''}`}
                  onClick={() => setSelectedTab('wins')}
                >
                  Victories
                </button>
                <button 
                  className={`filter-tab ${selectedTab === 'losses' ? 'active' : ''}`}
                  onClick={() => setSelectedTab('losses')}
                >
                  Defeats
                </button>
              </div>
              <select 
                className="sort-select"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
              >
                <option value="recent">Most Recent</option>
                <option value="oldest">Oldest First</option>
                <option value="amount">Highest Winnings</option>
              </select>
            </div>

            {/* Transaction List */}
            <div className="transaction-list">
              {isLoading ? (
                <div className="loading-state">
                  <div className="loading-spinner"></div>
                  <p>Loading transaction history...</p>
                </div>
              ) : filteredHistory.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon">🌊</div>
                  <h3>No Naval Battles Yet!</h3>
                  <p>Start your first battle to see your combat history here</p>
                  <button className="start-battle-btn" onClick={onClose}>
                    Begin Your Campaign
                  </button>
                </div>
              ) : (
                <div className="history-items">
                  {filteredHistory.map((game, index) => (
                    <div key={game.gameId || index} className={`history-item ${game.result}`}>
                      <div className="history-item-header">
                        <div className="battle-info">
                          <span className="battle-number">Battle #{filteredHistory.length - index}</span>
                          <span className="battle-date">{formatDate(game.timestamp)}</span>
                        </div>
                        <div className={`result-badge ${game.result}`}>
                          {game.result === 'won' ? '🏆 Victory' : '💥 Defeat'}
                        </div>
                      </div>
                      
                      <div className="history-item-details">
                        <div className="detail-row">
                          <span className="detail-label">⚡ Bet Amount</span>
                          <span className="detail-value bet">{formatSats(game.betAmount)} SATS</span>
                        </div>
                        <div className="detail-row">
                          <span className="detail-label">💰 {game.result === 'won' ? 'Winnings' : 'Loss'}</span>
                          <span className={`detail-value ${game.result}`}>
                            {game.result === 'won' ? '+' : '-'}{formatSats(game.winnings || game.betAmount)} SATS
                          </span>
                        </div>
                        {game.shotsFired && (
                          <div className="detail-row">
                            <span className="detail-label">🎯 Combat Stats</span>
                            <span className="detail-value">
                              {game.hits}/{game.shotsFired} hits ({game.accuracy}% accuracy)
                            </span>
                          </div>
                        )}
                        {game.duration && (
                          <div className="detail-row">
                            <span className="detail-label">⏱️ Battle Duration</span>
                            <span className="detail-value">{game.duration}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Swipe Indicator */}
      <div className="swipe-indicator">
        <span>← Swipe to navigate →</span>
      </div>
    </div>
  );
};

export default HistoryScreen;

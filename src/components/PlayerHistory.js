import React, { useState, useMemo } from 'react';
import './PlayerHistory.css';

const PlayerHistory = ({ history = [], onClose, speedApiKey }) => {
  const [filter, setFilter] = useState('all'); // all, wins, losses
  const [sortBy, setSortBy] = useState('recent'); // recent, oldest, amount

  // Calculate statistics
  const stats = useMemo(() => {
    const totalGames = history.length;
    const wins = history.filter(entry => entry.outcome === 'win').length;
    const losses = history.filter(entry => entry.outcome === 'loss').length;
    const totalBet = history.reduce((sum, entry) => sum + (entry.bet || 0), 0);
    const totalWon = history.filter(entry => entry.outcome === 'win')
      .reduce((sum, entry) => sum + (entry.amount || 0), 0);
    const totalLost = history.filter(entry => entry.outcome === 'loss')
      .reduce((sum, entry) => sum + (entry.amount || 0), 0);
    const netProfit = totalWon - totalLost;
    const winRate = totalGames > 0 ? ((wins / totalGames) * 100).toFixed(1) : 0;

    return {
      totalGames,
      wins,
      losses,
      totalBet,
      totalWon,
      totalLost,
      netProfit,
      winRate
    };
  }, [history]);

  // Filter and sort history
  const filteredHistory = useMemo(() => {
    let filtered = [...history];
    
    // Apply filter
    if (filter === 'wins') {
      filtered = filtered.filter(entry => entry.outcome === 'win');
    } else if (filter === 'losses') {
      filtered = filtered.filter(entry => entry.outcome === 'loss');
    }
    
    // Apply sorting
    if (sortBy === 'recent') {
      filtered = filtered.reverse(); // Most recent first
    } else if (sortBy === 'oldest') {
      // Keep original order (oldest first)
    } else if (sortBy === 'amount') {
      filtered.sort((a, b) => (b.amount || 0) - (a.amount || 0));
    }
    
    return filtered;
  }, [history, filter, sortBy]);

  const formatDate = (timestamp) => {
    if (!timestamp) return 'Unknown';
    const date = new Date(timestamp);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
  };

  return (
    <div className="player-history-free">
      {/* Header with close button */}
      <div className="history-header">
        <h2>⚡ Player History ⚡</h2>
      </div>

        {/* Statistics Panel */}
        <div className="stats-panel">
          <div className="stat-card games">
            <div className="stat-value">{stats.totalGames}</div>
            <div className="stat-label">Games</div>
          </div>
          <div className="stat-card wins">
            <div className="stat-value">{stats.wins}</div>
            <div className="stat-label">Wins</div>
          </div>
          <div className="stat-card losses">
            <div className="stat-value">{stats.losses}</div>
            <div className="stat-label">Losses</div>
          </div>
          <div className="stat-card win-rate">
            <div className="stat-value">{stats.winRate}%</div>
            <div className="stat-label">Win Rate</div>
          </div>
          <div className={`stat-card profit ${stats.netProfit >= 0 ? 'positive' : 'negative'}`}>
            <div className="stat-value">
              {stats.netProfit >= 0 ? '+' : ''}{stats.netProfit}
            </div>
            <div className="stat-label">Net SATS</div>
          </div>
        </div>

        {/* Filters and Sorting */}
        <div className="controls">
          <div className="filter-buttons">
            <button
              className={`filter-btn ${filter === 'all' ? 'active' : ''}`}
              onClick={() => setFilter('all')}
            >
              All
            </button>
            <button
              className={`filter-btn ${filter === 'wins' ? 'active' : ''}`}
              onClick={() => setFilter('wins')}
            >
              Wins
            </button>
            <button
              className={`filter-btn ${filter === 'losses' ? 'active' : ''}`}
              onClick={() => setFilter('losses')}
            >
              Losses
            </button>
          </div>
          <select
            className="sort-select"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
          >
            <option value="recent">Most Recent</option>
            <option value="oldest">Oldest First</option>
            <option value="amount">Highest Amount</option>
          </select>
        </div>

        {/* History List */}
        <div className="history-content">
          {filteredHistory.length === 0 ? (
            <div className="empty-history">
              {filter === 'all' ? (
                <>
                  <div className="empty-icon">🎯</div>
                  <div className="empty-title">No Games Yet</div>
                  <div className="empty-message">Start playing to build your battle history!</div>
                </>
              ) : (
                <>
                  <div className="empty-icon">🔍</div>
                  <div className="empty-title">No {filter} Found</div>
                  <div className="empty-message">Try changing the filter to see more results.</div>
                </>
              )}
            </div>
          ) : (
            <ul className="history-list">
              {filteredHistory.map((entry, index) => {
                const isRecent = index < 3 && sortBy === 'recent';
                return (
                  <li key={`${entry.timestamp || Date.now()}-${index}`} 
                      className={`history-item ${entry.outcome} ${isRecent ? 'recent' : ''}`}>
                    <div className="item-header">
                      <div className="game-info">
                        <span className="game-number">Game #{filteredHistory.length - index}</span>
                        <span className="game-date">{formatDate(entry.timestamp)}</span>
                      </div>
                      <div className={`outcome-badge ${entry.outcome}`}>
                        {entry.outcome === 'win' ? '🏆 WIN' : '💥 LOSS'}
                      </div>
                    </div>
                    <div className="item-details">
                      <div className="detail-row">
                        <span className="detail-label">Bet Amount:</span>
                        <span className="bet-amount">{entry.bet || 0} SATS</span>
                      </div>
                      <div className="detail-row">
                        <span className="detail-label">
                          {entry.outcome === 'win' ? 'Won:' : 'Lost:'}
                        </span>
                        <span className={`amount ${entry.outcome}`}>
                          {entry.outcome === 'win' ? '+' : '-'}{entry.amount || 0} SATS
                        </span>
                      </div>
                      {entry.opponent && (
                        <div className="detail-row">
                          <span className="detail-label">Opponent:</span>
                          <span className="opponent">{entry.opponent}</span>
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
    </div>
  );
};

export default PlayerHistory;

import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

const HistoryTab = ({ acctId }) => {
  const [history, setHistory] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchHistory = useCallback(async (isManualRefresh = false) => {
    if (!acctId) {
      setError('No account ID provided. Please connect your wallet first.');
      return;
    }
    
    if (isManualRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError('');
    
    try {
      console.log(`Fetching history for account: ${acctId}`);
      const response = await axios.get(`/api/history/account/${acctId}`);
      
      if (response.data) {
        setHistory(response.data.history || []);
        setStats(response.data.stats || null);
        setLastUpdated(new Date());
        
        console.log(`Loaded ${response.data.history?.length || 0} games for account ${acctId}`);
      }
    } catch (err) {
      console.error('Error fetching history:', err);
      
      if (err.response && err.response.status === 404) {
        setError('No Lightning address connected to this account. Please connect your wallet first.');
        setHistory([]);
        setStats(null);
      } else if (err.response && err.response.status === 400) {
        setError('Invalid account ID provided.');
      } else {
        setError('Failed to fetch history. Please try again later.');
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [acctId]);

  useEffect(() => {
    fetchHistory();
    
    // Refresh history every 30 seconds
    const interval = setInterval(() => {
      fetchHistory();
    }, 30000);
    
    return () => clearInterval(interval);
  }, [fetchHistory]);

  const handleManualRefresh = () => {
    fetchHistory(true);
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const formatSats = (amount) => {
    return new Intl.NumberFormat().format(amount);
  };

  if (loading) {
    return (
      <div className="history-tab">
        <div className="loading-container">
          <div className="loading-spinner"></div>
          <p>Loading your game history...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="history-tab">
      <div className="history-header">
        <h2>🎯 Game History</h2>
        <div className="history-controls">
          <button 
            onClick={handleManualRefresh} 
            disabled={refreshing}
            className="refresh-button"
          >
            {refreshing ? '🔄 Refreshing...' : '🔄 Refresh'}
          </button>
          {lastUpdated && (
            <span className="last-updated">
              Last updated: {lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>
      </div>

      {error && (
        <div className="error-message">
          <p>⚠️ {error}</p>
          <button onClick={handleManualRefresh} className="retry-button">
            Try Again
          </button>
        </div>
      )}

      {stats && (
        <div className="stats-summary">
          <h3>📊 Your Stats</h3>
          <div className="stats-grid">
            <div className="stat-item">
              <span className="stat-label">Total Games:</span>
              <span className="stat-value">{stats.totalGames || 0}</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Wins:</span>
              <span className="stat-value">{stats.wins || 0}</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Win Rate:</span>
              <span className="stat-value">{stats.winRate || 0}%</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Total Profit:</span>
              <span className={`stat-value ${(stats.totalProfit || 0) >= 0 ? 'profit' : 'loss'}`}>
                {(stats.totalProfit || 0) >= 0 ? '+' : ''}{formatSats(stats.totalProfit || 0)} SATS
              </span>
            </div>
          </div>
        </div>
      )}

      {history.length === 0 && !error ? (
        <div className="no-history">
          <p>🎮 No games played yet!</p>
          <p>Start your first battle to see your history here.</p>
        </div>
      ) : history.length > 0 ? (
        <div className="history-table-container">
          <table className="history-table">
            <thead>
              <tr>
                <th>📅 Date & Time</th>
                <th>💰 Bet Amount</th>
                <th>🎯 Result</th>
                <th>📈 Profit/Loss</th>
                <th>⏱️ Duration</th>
                <th>🎯 Accuracy</th>
              </tr>
            </thead>
            <tbody>
              {history.map((entry, index) => (
                <tr key={entry.gameId || index} className={`result-${entry.result.toLowerCase()}`}>
                  <td>{formatDate(entry.date)}</td>
                  <td>{formatSats(entry.betAmount)} SATS</td>
                  <td className={`result ${entry.result.toLowerCase()}`}>
                    {entry.result === 'Win' ? '🏆' : entry.result === 'Loss' ? '💥' : '🔌'} {entry.result}
                  </td>
                  <td className={`profit-loss ${entry.profitOrLoss >= 0 ? 'profit' : 'loss'}`}>
                    {entry.profitOrLoss >= 0 ? '+' : ''}{formatSats(entry.profitOrLoss)} SATS
                  </td>
                  <td>{entry.duration || 'N/A'}</td>
                  <td>{entry.accuracy}% ({entry.hits}/{entry.shotsFired})</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
};

export default HistoryTab;


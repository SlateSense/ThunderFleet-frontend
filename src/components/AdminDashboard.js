import React, { useState, useEffect } from 'react';
import './AdminDashboard.css';

const AdminDashboard = ({ onClose }) => {
  const [tournaments, setTournaments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adminKey, setAdminKey] = useState('');
  const [authenticated, setAuthenticated] = useState(false);
  const [newTournamentFee, setNewTournamentFee] = useState(300);
  const [customPayouts, setCustomPayouts] = useState(['', '', '']);

  const backendUrl = process.env.REACT_APP_BACKEND_URL || 'https://thunderfleet-backend.onrender.com';

  const authenticate = () => {
    if (adminKey === 'admin_thunder_fleet_2025') {
      setAuthenticated(true);
      fetchTournaments();
    } else {
      alert('Invalid admin key');
    }
  };

  const fetchTournaments = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${backendUrl}/api/admin/tournaments?adminKey=${adminKey}`);
      const data = await response.json();
      
      if (data.activeTournaments) {
        setTournaments(data.activeTournaments);
      } else {
        console.error('Failed to fetch tournaments:', data.error);
      }
    } catch (error) {
      console.error('Error fetching tournaments:', error);
    } finally {
      setLoading(false);
    }
  };

  const createTournament = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${backendUrl}/api/admin/tournaments/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          entryFee: newTournamentFee,
          adminKey 
        }),
      });

      const data = await response.json();
      
      if (data.success) {
        alert(`Tournament created! Entry fee: ${newTournamentFee} SATS`);
        fetchTournaments();
      } else {
        alert(`Error: ${data.error}`);
      }
    } catch (error) {
      console.error('Error creating tournament:', error);
      alert('Error creating tournament');
    } finally {
      setLoading(false);
    }
  };

  const startTournament = async (tournamentId) => {
    try {
      setLoading(true);
      
      // Prepare payouts - use custom if all filled, otherwise default
      const payouts = customPayouts.every(p => p && !isNaN(p)) 
        ? customPayouts.map(p => parseInt(p))
        : undefined;
      
      const response = await fetch(`${backendUrl}/api/admin/tournaments/${tournamentId}/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          adminKey,
          payouts 
        }),
      });

      const data = await response.json();
      
      if (data.success) {
        alert('Tournament started successfully!');
        fetchTournaments();
      } else {
        alert(`Error: ${data.error}`);
      }
    } catch (error) {
      console.error('Error starting tournament:', error);
      alert('Error starting tournament');
    } finally {
      setLoading(false);
    }
  };

  if (!authenticated) {
    return (
      <div className="admin-dashboard-overlay">
        <div className="admin-dashboard-modal">
          <div className="admin-header">
            <h2>🔐 Admin Dashboard</h2>
            <button className="close-button" onClick={onClose}>×</button>
          </div>
          <div className="admin-login">
            <h3>Enter Admin Key</h3>
            <input
              type="password"
              value={adminKey}
              onChange={(e) => setAdminKey(e.target.value)}
              placeholder="Admin key..."
              onKeyPress={(e) => e.key === 'Enter' && authenticate()}
            />
            <button onClick={authenticate} className="auth-button">
              Authenticate
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-dashboard-overlay">
      <div className="admin-dashboard-modal">
        <div className="admin-header">
          <h2>🔐 Admin Tournament Dashboard</h2>
          <button className="close-button" onClick={onClose}>×</button>
        </div>

        <div className="admin-content">
          {/* Tournament Creation */}
          <div className="admin-section">
            <h3>Create New Tournament</h3>
            <div className="create-tournament-form">
              <div className="form-group">
                <label>Entry Fee (SATS):</label>
                <input
                  type="number"
                  value={newTournamentFee}
                  onChange={(e) => setNewTournamentFee(parseInt(e.target.value) || 300)}
                  min="50"
                  step="50"
                />
              </div>
              <div className="form-group">
                <label>Custom Payouts (optional):</label>
                <div className="payouts-inputs">
                  <input
                    type="number"
                    placeholder="1st place"
                    value={customPayouts[0]}
                    onChange={(e) => setCustomPayouts([e.target.value, customPayouts[1], customPayouts[2]])}
                  />
                  <input
                    type="number"
                    placeholder="2nd place"
                    value={customPayouts[1]}
                    onChange={(e) => setCustomPayouts([customPayouts[0], e.target.value, customPayouts[2]])}
                  />
                  <input
                    type="number"
                    placeholder="3rd place"
                    value={customPayouts[2]}
                    onChange={(e) => setCustomPayouts([customPayouts[0], customPayouts[1], e.target.value])}
                  />
                </div>
                <small>Leave empty for default distribution (60%, 25%, 15%)</small>
              </div>
              <button 
                onClick={createTournament}
                disabled={loading}
                className="create-btn"
              >
                Create Tournament
              </button>
            </div>
          </div>

          {/* Active Tournaments */}
          <div className="admin-section">
            <h3>Manage Tournaments</h3>
            {loading ? (
              <div className="loading">Loading tournaments...</div>
            ) : (
              <div className="tournaments-list">
                {tournaments.length === 0 ? (
                  <p>No tournaments created yet.</p>
                ) : (
                  tournaments.map(tournament => (
                    <div key={tournament.id} className="admin-tournament-card">
                      <div className="tournament-info">
                        <h4>Tournament #{tournament.id.slice(-4)}</h4>
                        <p><strong>Entry Fee:</strong> {tournament.entryFee} SATS</p>
                        <p><strong>Prize Pool:</strong> {tournament.prizePool || 0} SATS</p>
                        <p><strong>Players:</strong> {tournament.players?.length || 0}/8</p>
                        <p><strong>Status:</strong> {tournament.status}</p>
                        {tournament.payouts && (
                          <div className="payout-display">
                            <strong>Payouts:</strong> 
                            1st: {tournament.payouts.first}, 
                            2nd: {tournament.payouts.second}, 
                            3rd: {tournament.payouts.third}
                          </div>
                        )}
                      </div>
                      
                      <div className="tournament-actions">
                        {tournament.status === 'registration' && tournament.players?.length === 8 && (
                          <button
                            onClick={() => startTournament(tournament.id)}
                            disabled={loading}
                            className="start-tournament-btn"
                          >
                            Start Tournament
                          </button>
                        )}
                        {tournament.status === 'registration' && tournament.players?.length < 8 && (
                          <div className="waiting-status">
                            Waiting for {8 - (tournament.players?.length || 0)} more players
                          </div>
                        )}
                      </div>

                      {/* Players List */}
                      {tournament.players?.length > 0 && (
                        <div className="players-list">
                          <h5>Registered Players:</h5>
                          <ul>
                            {tournament.players.map((player, index) => (
                              <li key={index}>
                                {player.playerName} ({player.lightningAddress})
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminDashboard;

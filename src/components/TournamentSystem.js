import React, { useState, useEffect } from 'react';
import './TournamentSystem.css';

const TournamentSystem = ({ lightningAddress, onClose }) => {
  const [activeTournaments, setActiveTournaments] = useState([]);
  const [selectedTournament, setSelectedTournament] = useState(null);
  const [loading, setLoading] = useState(false);
  const [registrationStatus, setRegistrationStatus] = useState({});
  const [communityGoals, setCommunityGoals] = useState([]);

  useEffect(() => {
    fetchActiveTournaments();
    fetchCommunityGoals();
    
    // Refresh data every 30 seconds
    const interval = setInterval(() => {
      fetchActiveTournaments();
      fetchCommunityGoals();
    }, 30000);

    return () => clearInterval(interval);
  }, []);

  const fetchActiveTournaments = async () => {
    try {
      const backendUrl = process.env.REACT_APP_BACKEND_URL || 'https://thunderfleet-backend.onrender.com';
      const response = await fetch(`${backendUrl}/api/tournaments/active`);
      const data = await response.json();
      setActiveTournaments(data.tournaments || []);
    } catch (error) {
      console.error('Error fetching tournaments:', error);
    }
  };

  const fetchCommunityGoals = async () => {
    try {
      const backendUrl = process.env.REACT_APP_BACKEND_URL || 'https://thunderfleet-backend.onrender.com';
      const response = await fetch(`${backendUrl}/api/community-goals`);
      const data = await response.json();
      setCommunityGoals(data.goals || []);
    } catch (error) {
      console.error('Error fetching community goals:', error);
    }
  };

  const registerForTournament = async (tournamentId) => {
    if (!lightningAddress) {
      alert('Please enter your Lightning address first');
      return;
    }

    setLoading(true);
    try {
      const backendUrl = process.env.REACT_APP_BACKEND_URL || 'https://thunderfleet-backend.onrender.com';
      const response = await fetch(`${backendUrl}/api/tournaments/${tournamentId}/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          lightningAddress,
          playerName: lightningAddress.split('@')[0]
        }),
      });

      const data = await response.json();
      
      if (data.success) {
        setRegistrationStatus(prev => ({ 
          ...prev, 
          [tournamentId]: 'registered' 
        }));
        fetchActiveTournaments(); // Refresh tournament data
        alert(`Successfully registered for tournament! ${data.playersRegistered}/8 players registered.`);
      } else {
        alert(`Registration failed: ${data.error}`);
      }
    } catch (error) {
      console.error('Error registering for tournament:', error);
      alert('Error registering for tournament');
    } finally {
      setLoading(false);
    }
  };

  const formatTimeUntil = (dateString) => {
    const target = new Date(dateString);
    const now = new Date();
    const diff = target.getTime() - now.getTime();
    
    if (diff <= 0) return 'Started';
    
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    } else {
      return `${minutes}m`;
    }
  };

  const formatGoalProgress = (current, target) => {
    const percentage = Math.min((current / target) * 100, 100);
    return {
      percentage,
      display: `${current.toLocaleString()} / ${target.toLocaleString()}`
    };
  };

  const getGoalTimeRemaining = (endDate) => {
    const target = new Date(endDate);
    const now = new Date();
    const diff = target.getTime() - now.getTime();
    
    if (diff <= 0) return 'Expired';
    
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    
    if (days > 0) {
      return `${days}d ${hours}h remaining`;
    } else {
      return `${hours}h remaining`;
    }
  };

  return (
    <div className="tournament-system-overlay">
      <div className="tournament-system-modal">
        <div className="tournament-header">
          <h2>🏆 Tournaments & Community Goals</h2>
          <button className="close-button" onClick={onClose}>×</button>
        </div>

        <div className="tournament-content">
          {/* Community Goals Section */}
          <div className="community-goals-section">
            <h3>🎯 Community Goals</h3>
            <div className="goals-grid">
              {communityGoals.map(goal => {
                const progress = formatGoalProgress(goal.current, goal.target);
                return (
                  <div key={goal.id} className="goal-card">
                    <div className="goal-header">
                      <h4>{goal.title}</h4>
                      <span className="goal-reward">+{goal.reward} sats</span>
                    </div>
                    <p className="goal-description">{goal.description}</p>
                    <div className="goal-progress">
                      <div className="progress-bar">
                        <div 
                          className="progress-fill" 
                          style={{ width: `${progress.percentage}%` }}
                        ></div>
                      </div>
                      <div className="progress-text">
                        <span>{progress.display}</span>
                        <span className="time-remaining">
                          {getGoalTimeRemaining(goal.endDate)}
                        </span>
                      </div>
                    </div>
                    <div className="goal-participants">
                      👥 {goal.participants.length} participants
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Tournament Section */}
          <div className="tournaments-section">
            <div className="tournaments-header">
              <h3>⚔️ Tournaments</h3>
            </div>

            <div className="tournaments-grid">
              {activeTournaments.length === 0 ? (
                <div className="no-tournaments">
                  <p>No tournaments going on, check back later!</p>
                </div>
              ) : (
                activeTournaments.map(tournament => (
                  <div key={tournament.id} className="tournament-card">
                    <div className="tournament-card-header">
                      <h4>🏆 Tournament #{tournament.id.slice(-4)}</h4>
                      <div className="tournament-status">
                        <span className={`status-badge ${tournament.status}`}>
                          {tournament.status === 'registration' ? 'Open' : tournament.status}
                        </span>
                      </div>
                    </div>

                    <div className="tournament-details">
                      <div className="detail-row">
                        <span>Entry Fee:</span>
                        <span className="highlight">{tournament.entryFee} sats</span>
                      </div>
                      <div className="detail-row">
                        <span>Prize Pool:</span>
                        <span className="highlight">{tournament.prizePool} sats</span>
                      </div>
                      <div className="detail-row">
                        <span>Players:</span>
                        <span>{tournament.players.length}/{tournament.maxPlayers}</span>
                      </div>
                      <div className="detail-row">
                        <span>Starts in:</span>
                        <span>{formatTimeUntil(tournament.startTime)}</span>
                      </div>
                    </div>

                    <div className="prize-breakdown">
                      <h5>💰 Prize Distribution:</h5>
                      <div className="prizes">
                        <div className="prize">🥇 {Math.floor(tournament.prizePool * 0.6)} sats</div>
                        <div className="prize">🥈 {Math.floor(tournament.prizePool * 0.25)} sats</div>
                        <div className="prize">🥉 {Math.floor(tournament.prizePool * 0.075)} sats each</div>
                      </div>
                    </div>

                    <div className="tournament-players">
                      <h5>👥 Registered Players:</h5>
                      <div className="players-list">
                        {tournament.players.map((player, index) => (
                          <div key={index} className="player-item">
                            {player.playerName}
                          </div>
                        ))}
                        {Array.from({ length: tournament.maxPlayers - tournament.players.length }).map((_, index) => (
                          <div key={`empty-${index}`} className="player-item empty">
                            Empty Slot
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="tournament-actions">
                      {registrationStatus[tournament.id] === 'registered' ? (
                        <button className="registered-btn" disabled>
                          ✅ Registered
                        </button>
                      ) : tournament.players.some(p => p.lightningAddress === lightningAddress) ? (
                        <button className="registered-btn" disabled>
                          ✅ Already Registered
                        </button>
                      ) : tournament.players.length >= tournament.maxPlayers ? (
                        <button className="full-btn" disabled>
                          Tournament Full
                        </button>
                      ) : (
                        <button 
                          className="register-btn"
                          onClick={() => registerForTournament(tournament.id)}
                          disabled={loading || !lightningAddress}
                        >
                          {loading ? 'Registering...' : `Register (${tournament.entryFee} sats)`}
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="tournament-footer">
          <p className="info-text">
            💡 Tournaments start automatically when 4+ players register. 
            Entry fees are collected via Lightning payments when the tournament begins.
          </p>
        </div>
      </div>
    </div>
  );
};

export default TournamentSystem;

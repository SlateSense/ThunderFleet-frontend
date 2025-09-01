import React, { useState, useEffect, useCallback } from 'react';
import './DailyChallenges.css';

const DailyChallenges = ({ lightningAddress, isVisible, onClose }) => {
  const [challenges, setChallenges] = useState([]);
  const [achievements, setAchievements] = useState([]);
  const [playerStats, setPlayerStats] = useState({});
  const [leaderboard, setLeaderboard] = useState([]);
  const [loading, setLoading] = useState(true);
  const [claimingReward, setClaimingReward] = useState(null);
  const [activeTab, setActiveTab] = useState('challenges');
  const [message, setMessage] = useState('');

  const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || 'https://thunderfleet-backend.onrender.com';

  const fetchChallenges = useCallback(async () => {
    try {
      setLoading(true);
      // Use stored address if prop is empty
      const addressToUse = lightningAddress || localStorage.getItem('lightningAddress') || localStorage.getItem('lastLightningAddress');
      
      console.log('Fetching challenges for:', addressToUse);
      console.log('Backend URL:', BACKEND_URL);
      
      if (!addressToUse) {
        setLoading(false);
        setMessage('Please enter your Lightning address first to view challenges.');
        return;
      }
      
      const response = await fetch(`${BACKEND_URL}/api/challenges/${addressToUse}`);
      console.log('Response status:', response.status);
      
      const data = await response.json();
      console.log('Response data:', data);
      
      if (response.ok) {
        setChallenges(data.challenges || []);
        setPlayerStats(data.playerStats || {});
        setMessage('');
      } else {
        console.error('Failed to fetch challenges:', data.error);
        setMessage('Failed to load challenges. Please try again.');
      }
    } catch (error) {
      console.error('Error fetching challenges:', error);
      setMessage('Failed to connect to server. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [BACKEND_URL, lightningAddress]);

  const fetchAchievements = useCallback(async () => {
    try {
      const addressToUse = lightningAddress || localStorage.getItem('lightningAddress') || localStorage.getItem('lastLightningAddress') || 'guest';
      
      console.log('Fetching achievements for:', addressToUse);
      console.log('Backend URL:', BACKEND_URL);
      
      const response = await fetch(`${BACKEND_URL}/api/achievements/${addressToUse}`);
      const data = await response.json();
      
      console.log('Achievements response:', data);
      
      if (response.ok) {
        setAchievements(data.achievements || []);
        console.log('Set achievements:', data.achievements);
      } else {
        console.error('Failed to fetch achievements:', data.error);
      }
    } catch (error) {
      console.error('Error fetching achievements:', error);
    }
  }, [BACKEND_URL, lightningAddress]);

  const fetchLeaderboard = useCallback(async () => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/leaderboard?limit=10`);
      const data = await response.json();
      
      if (response.ok) {
        setLeaderboard(data.leaderboard || []);
      } else {
        console.error('Failed to fetch leaderboard:', data.error);
      }
    } catch (error) {
      console.error('Error fetching leaderboard:', error);
    }
  }, [BACKEND_URL]);

  const claimReward = async (challengeId) => {
    try {
      setClaimingReward(challengeId);
      
      // Use stored address if prop is empty
      const addressToUse = lightningAddress || localStorage.getItem('lightningAddress') || localStorage.getItem('lastLightningAddress');
      
      const response = await fetch(`${BACKEND_URL}/api/challenges/${addressToUse}/claim`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ challengeId })
      });
      
      const data = await response.json();
      
      if (response.ok && data.success) {
        setMessage(`🎉 ${data.message}`);
        // Refresh challenges to update the claimed status
        await fetchChallenges();
      } else {
        setMessage(data.error || 'Failed to claim reward. Please try again.');
      }
    } catch (error) {
      console.error('Error claiming reward:', error);
      setMessage('Failed to claim reward. Please check your connection.');
    } finally {
      setClaimingReward(null);
    }
  };

  const claimAchievement = async (achievementId) => {
    try {
      setClaimingReward(achievementId);
      
      const addressToUse = lightningAddress || localStorage.getItem('lightningAddress') || localStorage.getItem('lastLightningAddress');
      
      const response = await fetch(`${BACKEND_URL}/api/achievements/${addressToUse}/claim`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ achievementId })
      });
      
      const data = await response.json();
      
      if (response.ok && data.success) {
        setMessage(`🏆 ${data.message}`);
        await fetchAchievements();
      } else {
        setMessage(data.error || 'Failed to claim achievement. Please try again.');
      }
    } catch (error) {
      console.error('Error claiming achievement:', error);
      setMessage('Failed to claim achievement. Please check your connection.');
    } finally {
      setClaimingReward(null);
    }
  };

  useEffect(() => {
    if (isVisible) {
      // Try to get lightning address from props or localStorage
      const addressToUse = lightningAddress || localStorage.getItem('lightningAddress') || localStorage.getItem('lastLightningAddress');
      
      if (addressToUse && addressToUse.trim()) {
        console.log('Using lightning address:', addressToUse);
        fetchChallenges();
        fetchAchievements();
        fetchLeaderboard();
      } else {
        setLoading(false);
        setMessage('Please enter your Lightning address first to view challenges.');
        // Still fetch achievements to show what's available
        fetchAchievements();
      }
    }
  }, [isVisible, lightningAddress, fetchChallenges, fetchAchievements, fetchLeaderboard]);

  const getDifficultyColor = (difficulty) => {
    switch (difficulty) {
      case 'easy': return '#4CAF50';
      case 'medium': return '#FF9800';
      case 'hard': return '#f44336';
      default: return '#2196F3';
    }
  };

  const getChallengeIcon = (type) => {
    switch (type) {
      case 'accuracy': return '🎯';
      case 'speed': return '⚡';
      case 'streak': return '🔥';
      case 'volume': return '⚔️';
      case 'precision': return '🏹';
      case 'endurance': return '💪';
      case 'bet_amount': return '💰';
      default: return '🏆';
    }
  };

  const formatProgress = (challenge) => {
    const { progress, target, type } = challenge;
    
    switch (type) {
      case 'accuracy':
        return `${progress}% / ${target}%`;
      case 'speed':
        const minutes = Math.floor(progress / 60);
        const seconds = progress % 60;
        const targetMinutes = Math.floor(target / 60);
        const targetSeconds = target % 60;
        return `${minutes}:${seconds.toString().padStart(2, '0')} / ${targetMinutes}:${targetSeconds.toString().padStart(2, '0')}`;
      case 'endurance':
        const totalMinutes = Math.floor(progress / 60);
        const targetTotalMinutes = Math.floor(target / 60);
        return `${totalMinutes}min / ${targetTotalMinutes}min`;
      case 'bet_amount':
        return progress >= target ? `${target} sats ✓` : `${target} sats required`;
      default:
        return `${progress} / ${target}`;
    }
  };

  const formatAchievementTarget = (achievement) => {
    const { target, type } = achievement;
    
    switch (type) {
      case 'bet_amount':
        return `${target} sats bet`;
      case 'volume':
        return `${target} games`;
      case 'streak':
        return `${target} wins`;
      default:
        return target;
    }
  };

  const getProgressPercentage = (challenge) => {
    return Math.min((challenge.progress / challenge.target) * 100, 100);
  };

  if (!isVisible) return null;

  return (
    <div className="daily-challenges-overlay">
      <div className="daily-challenges-modal">
        <div className="challenges-header">
          <h2>⚡ Daily Challenges</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        <div className="challenges-tabs">
          <button 
            className={`tab-btn ${activeTab === 'challenges' ? 'active' : ''}`}
            onClick={() => setActiveTab('challenges')}
          >
            🏆 Challenges
          </button>
          <button 
            className={`tab-btn ${activeTab === 'achievements' ? 'active' : ''}`}
            onClick={() => setActiveTab('achievements')}
          >
            🏆 Achievements
          </button>
          <button 
            className={`tab-btn ${activeTab === 'leaderboard' ? 'active' : ''}`}
            onClick={() => setActiveTab('leaderboard')}
          >
            🏅 Leaderboard
          </button>
        </div>

        {message && (
          <div className="challenge-message">
            {message}
          </div>
        )}

        <div className="challenges-content">
          {loading ? (
            <div className="loading-spinner">
              <div className="spinner"></div>
              <p>Loading challenges...</p>
            </div>
          ) : (
            <>
              {activeTab === 'challenges' && (
                <div className="challenges-tab">
                  <div className="challenges-grid">
                    {challenges.map((challenge) => (
                      <div key={challenge.id} className={`challenge-card ${challenge.completed ? 'completed' : ''}`}>
                        <div className="challenge-header">
                          <div className="challenge-icon">
                            {getChallengeIcon(challenge.type)}
                          </div>
                          <div className="challenge-info">
                            <h3>{challenge.title}</h3>
                            <p className="challenge-description">{challenge.description}</p>
                          </div>
                          <div 
                            className="difficulty-badge"
                            style={{ backgroundColor: getDifficultyColor(challenge.difficulty) }}
                          >
                            {challenge.difficulty}
                          </div>
                        </div>
                        
                        <div className="challenge-progress">
                          <div className="progress-bar">
                            <div 
                              className="progress-fill"
                              style={{ width: `${getProgressPercentage(challenge)}%` }}
                            ></div>
                          </div>
                          <div className="progress-text">
                            {formatProgress(challenge)}
                          </div>
                        </div>

                        <div className="challenge-footer">
                          <div className="reward-info">
                            <span className="reward-amount">⚡ {challenge.reward} sats</span>
                          </div>
                          {challenge.completed && !challenge.rewardClaimed ? (
                            <button 
                              className="claim-btn"
                              onClick={() => claimReward(challenge.id)}
                              disabled={claimingReward === challenge.id}
                            >
                              {claimingReward === challenge.id ? 'Claiming...' : 'Claim Reward'}
                            </button>
                          ) : challenge.rewardClaimed ? (
                            <span className="claimed-badge">✅ Claimed</span>
                          ) : (
                            <span className="incomplete-badge">In Progress</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  
                  {challenges.length === 0 && (
                    <div className="no-challenges">
                      <p>No challenges available today. Check back tomorrow!</p>
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'achievements' && (
                <div className="challenges-tab">
                  <div className="challenges-grid">
                    {achievements.map((achievement) => (
                      <div key={achievement.id} className={`challenge-card ${achievement.unlocked ? 'completed' : ''}`}>
                        <div className="challenge-header">
                          <div className="challenge-icon">
                            {achievement.unlocked ? getChallengeIcon(achievement.type) : getChallengeIcon(achievement.type)}
                          </div>
                          <div className="challenge-info">
                            <h3>{achievement.title}</h3>
                            <p className="challenge-description">{achievement.description}</p>
                          </div>
                          <div 
                            className="difficulty-badge"
                            style={{ backgroundColor: getDifficultyColor(achievement.difficulty) }}
                          >
                            {achievement.difficulty}
                          </div>
                        </div>
                        
                        <div className="challenge-progress">
                          <div className="progress-bar">
                            <div 
                              className="progress-fill"
                              style={{ width: achievement.unlocked ? '100%' : '0%' }}
                            ></div>
                          </div>
                          <div className="progress-text">
                            {achievement.unlocked ? `${achievement.target} ✓` : `Target: ${formatAchievementTarget(achievement)}`}
                          </div>
                        </div>

                        <div className="challenge-footer">
                          <div className="reward-info">
                            <span className="reward-amount">⚡ {achievement.reward} sats</span>
                          </div>
                          {achievement.unlocked && !achievement.claimed ? (
                            <button 
                              className="claim-btn"
                              onClick={() => claimAchievement(achievement.id)}
                              disabled={claimingReward === achievement.id}
                            >
                              {claimingReward === achievement.id ? 'Claiming...' : 'Claim Reward'}
                            </button>
                          ) : achievement.claimed ? (
                            <span className="claimed-badge">✅ Claimed</span>
                          ) : (
                            <span className="incomplete-badge">🔒 Locked</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  
                  {achievements.length === 0 && (
                    <div className="no-challenges">
                      <p>Loading achievements...</p>
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'stats' && (
                <div className="stats-tab">
                  <div className="stats-grid">
                    <div className="stat-card">
                      <div className="stat-icon">🎮</div>
                      <div className="stat-info">
                        <h4>Games Played Today</h4>
                        <p className="stat-value">{playerStats.gamesPlayed || 0}</p>
                      </div>
                    </div>
                    <div className="stat-card">
                      <div className="stat-icon">🏆</div>
                      <div className="stat-info">
                        <h4>Games Won Today</h4>
                        <p className="stat-value">{playerStats.gamesWon || 0}</p>
                      </div>
                    </div>
                    <div className="stat-card">
                      <div className="stat-icon">🔥</div>
                      <div className="stat-info">
                        <h4>Current Streak</h4>
                        <p className="stat-value">{playerStats.currentStreak || 0}</p>
                      </div>
                    </div>
                    <div className="stat-card">
                      <div className="stat-icon">⏱️</div>
                      <div className="stat-info">
                        <h4>Total Play Time</h4>
                        <p className="stat-value">{Math.floor((playerStats.totalPlayTime || 0) / 60)}min</p>
                      </div>
                    </div>
                    <div className="stat-card">
                      <div className="stat-icon">🎯</div>
                      <div className="stat-info">
                        <h4>Best Accuracy</h4>
                        <p className="stat-value">{playerStats.bestAccuracy || 0}%</p>
                      </div>
                    </div>
                    <div className="stat-card">
                      <div className="stat-icon">⚡</div>
                      <div className="stat-info">
                        <h4>Fastest Win</h4>
                        <p className="stat-value">
                          {playerStats.fastestWin ? 
                            `${Math.floor(playerStats.fastestWin / 60)}:${(playerStats.fastestWin % 60).toString().padStart(2, '0')}` : 
                            'N/A'
                          }
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'leaderboard' && (
                <div className="leaderboard-tab">
                  <div className="leaderboard-header">
                    <h3>🏅 Today's Top Players</h3>
                  </div>
                  <div className="leaderboard-list">
                    {leaderboard.map((player, index) => (
                      <div key={player.lightningAddress} className={`leaderboard-item ${index < 3 ? 'top-three' : ''}`}>
                        <div className="rank">
                          {index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `#${index + 1}`}
                        </div>
                        <div className="player-info">
                          <div className="player-name">{player.lightningAddress}</div>
                          <div className="player-stats">
                            {player.gamesWon}W / {player.gamesPlayed}G ({player.winRate}%)
                          </div>
                        </div>
                        <div className="player-streak">
                          🔥 {player.currentStreak}
                        </div>
                      </div>
                    ))}
                  </div>
                  
                  {leaderboard.length === 0 && (
                    <div className="no-leaderboard">
                      <p>No players on the leaderboard yet today. Be the first!</p>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default DailyChallenges;

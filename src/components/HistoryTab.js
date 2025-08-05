import React, { useState, useEffect } from 'react';
import axios from 'axios';

const HistoryTab = ({ acctId }) => {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchHistory = async () => {
      setLoading(true);
      try {
        const response = await axios.get(`/api/history/${acctId}`);
        setHistory(response.data);
      } catch (err) {
        setError('Failed to fetch history');
      } finally {
        setLoading(false);
      }
    };

    fetchHistory();
  }, [acctId]);

  if (loading) return <div>Loading...</div>;
  if (error) return <div>{error}</div>;

  return (
    <div className="history-tab">
      <h2>Game History</h2>
      {history.length === 0 ? (
        <p>No history available.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Bet</th>
              <th>Result</th>
              <th>Profit/Loss</th>
            </tr>
          </thead>
          <tbody>
            {history.map((entry, index) => (
              <tr key={index}>
                <td>{new Date(entry.date).toLocaleDateString()}</td>
                <td>{entry.betAmount} SATS</td>
                <td>{entry.result}</td>
                <td>{entry.profitOrLoss} SATS</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

export default HistoryTab;


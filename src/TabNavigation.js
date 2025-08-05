import React, { useState } from 'react';

const TabNavigation = ({ activeTab, setActiveTab }) => {
  return (
    <div className="tab-navigation">
      <button 
        className={activeTab === 'home' ? 'active' : ''}
        onClick={() => setActiveTab('home')}
      >
        🏠 Home
      </button>
      <button 
        className={activeTab === 'history' ? 'active' : ''}
        onClick={() => setActiveTab('history')}
      >
        📊 History
      </button>
      <button 
        className={activeTab === 'howToPlay' ? 'active' : ''}
        onClick={() => setActiveTab('howToPlay')}
      >
        ❓ How to Play
      </button>
      <button 
        className={activeTab === 'support' ? 'active' : ''}
        onClick={() => setActiveTab('support')}
      >
        📞 Support
      </button>
    </div>
  );
};

export default TabNavigation;

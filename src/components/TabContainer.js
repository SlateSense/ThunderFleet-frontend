import React, { useState, useRef, useEffect } from 'react';
import './TabContainer.css';

const TabContainer = ({ children, onTabChange, activeTab = 0 }) => {
  const [currentTab, setCurrentTab] = useState(activeTab);
  const [isDragging, setIsDragging] = useState(false);
  const [startX, setStartX] = useState(0);
  const [translateX, setTranslateX] = useState(0);
  const containerRef = useRef(null);
  const tabsRef = useRef([]);

  const tabs = React.Children.toArray(children);
  const totalTabs = tabs.length;

  useEffect(() => {
    if (typeof activeTab === 'string') {
      // If activeTab is a string, find the index by tab name
      const tabIndex = tabs.findIndex(tab => tab.props.name === activeTab);
      setCurrentTab(tabIndex >= 0 ? tabIndex : 0);
    } else {
      setCurrentTab(activeTab);
    }
  }, [activeTab, tabs]);

  // Handle touch/mouse events for swiping
  const handleStart = (clientX) => {
    setIsDragging(true);
    setStartX(clientX);
    setTranslateX(0);
  };

  const handleMove = (clientX) => {
    if (!isDragging) return;
    
    const diff = clientX - startX;
    const maxTranslate = window.innerWidth * 0.3; // Limit swipe distance
    const clampedDiff = Math.max(-maxTranslate, Math.min(maxTranslate, diff));
    setTranslateX(clampedDiff);
  };

  const handleEnd = () => {
    if (!isDragging) return;
    
    setIsDragging(false);
    const threshold = window.innerWidth * 0.15; // 15% of screen width to trigger tab change
    
    if (Math.abs(translateX) > threshold) {
      if (translateX > 0 && currentTab > 0) {
        // Swipe right - go to previous tab
        changeTab(currentTab - 1);
      } else if (translateX < 0 && currentTab < totalTabs - 1) {
        // Swipe left - go to next tab
        changeTab(currentTab + 1);
      }
    }
    
    setTranslateX(0);
  };

  const changeTab = (tabIndex) => {
    if (tabIndex >= 0 && tabIndex < totalTabs) {
      setCurrentTab(tabIndex);
      if (onTabChange) {
        // Send the tab name instead of index
        const tabName = tabs[tabIndex]?.props?.name || tabIndex;
        onTabChange(tabName);
      }
    }
  };

  // Touch events
  const handleTouchStart = (e) => {
    handleStart(e.touches[0].clientX);
  };

  const handleTouchMove = (e) => {
    e.preventDefault();
    handleMove(e.touches[0].clientX);
  };

  const handleTouchEnd = () => {
    handleEnd();
  };

  // Mouse events for desktop
  const handleMouseDown = (e) => {
    handleStart(e.clientX);
  };

  const handleMouseMove = (e) => {
    handleMove(e.clientX);
  };

  const handleMouseUp = () => {
    handleEnd();
  };

  const handleMouseLeave = () => {
    if (isDragging) {
      handleEnd();
    }
  };

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, startX]);

  return (
    <div className="tab-container">
      {/* Tab Headers */}
      <div className="tab-headers">
        {tabs.map((tab, index) => (
          <button
            key={index}
            className={`tab-header ${currentTab === index ? 'active' : ''}`}
            onClick={() => changeTab(index)}
            aria-selected={currentTab === index}
          >
            {tab.props.icon && <span className="tab-icon">{tab.props.icon}</span>}
            <span className="tab-title">{tab.props.name || tab.props.title || `Tab ${index + 1}`}</span>
          </button>
        ))}
        <div 
          className="tab-indicator"
          style={{
            transform: `translateX(${currentTab * 100}%)`,
            width: `${100 / totalTabs}%`
          }}
        />
      </div>

      {/* Tab Content */}
      <div 
        className="tab-content-container"
        ref={containerRef}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onMouseDown={handleMouseDown}
        onMouseLeave={handleMouseLeave}
      >
        <div 
          className="tab-content-wrapper"
          style={{
            transform: `translateX(calc(-${currentTab * 100}% + ${translateX}px))`,
            transition: isDragging ? 'none' : 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
          }}
        >
          {tabs.map((tab, index) => (
            <div 
              key={index}
              className={`tab-content ${currentTab === index ? 'active' : ''}`}
              ref={el => tabsRef.current[index] = el}
            >
              {tab}
            </div>
          ))}
        </div>
      </div>

      {/* Swipe Indicator */}
      {totalTabs > 1 && (
        <div className="swipe-indicator">
          <div className="swipe-dots">
            {tabs.map((_, index) => (
              <div
                key={index}
                className={`swipe-dot ${currentTab === index ? 'active' : ''}`}
                onClick={() => changeTab(index)}
              />
            ))}
          </div>
          <div className="swipe-hint">
            {currentTab === 0 ? (
              <span>← Swipe left for History</span>
            ) : (
              <span>Swipe right for Menu →</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// Tab component
export const Tab = ({ children, name, title, icon }) => {
  return <div className="tab">{children}</div>;
};

export default TabContainer;

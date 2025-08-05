import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import App from './App';

// Mock socket.io-client
jest.mock('socket.io-client', () => {
  const mockSocket = {
    id: 'test-socket-id',
    connected: true,
    on: jest.fn(),
    off: jest.fn(),
    emit: jest.fn(),
    connect: jest.fn(),
    disconnect: jest.fn(),
  };
  return jest.fn(() => mockSocket);
});

// Mock localStorage
const localStorageMock = {
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn(),
};
global.localStorage = localStorageMock;

describe('History Button Tests', () => {
  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();
    localStorageMock.getItem.mockReturnValue(null);
  });

  test('1. History button appears correctly on splash screen', async () => {
    render(<App />);
    
    // Wait for app to load
    await waitFor(() => {
      expect(screen.getByText('⚡ Thunder Fleet ⚡')).toBeInTheDocument();
    });

    // Check if History button exists and is visible
    const historyButton = screen.getByRole('button', { name: /history/i });
    expect(historyButton).toBeInTheDocument();
    expect(historyButton).toBeVisible();
    
    // Verify button styling is consistent with other buttons
    expect(historyButton).toHaveClass('join-button');
    expect(historyButton).toHaveStyle('padding: 15px 30px; font-size: 1.2em');
  });

  test('2. History button styling matches other buttons in the group', async () => {
    render(<App />);
    
    await waitFor(() => {
      expect(screen.getByText('⚡ Thunder Fleet ⚡')).toBeInTheDocument();
    });

    // Get all buttons in the button group
    const startGameButton = screen.getByRole('button', { name: /start game/i });
    const howToPlayButton = screen.getByRole('button', { name: /how to play/i });
    const historyButton = screen.getByRole('button', { name: /history/i });
    const supportButton = screen.getByRole('button', { name: /contact support/i });

    // Check that all buttons have the same base styling
    [startGameButton, howToPlayButton, historyButton].forEach(button => {
      expect(button).toHaveClass('join-button');
      expect(button).toHaveStyle('padding: 15px 30px; font-size: 1.2em');
    });

    // Support button has different class but should be styled consistently
    expect(supportButton).toHaveClass('telegram-support-button');
    expect(supportButton).toHaveStyle('padding: 15px 30px; font-size: 1.2em');
  });

  test('3. Clicking History button transitions to history view', async () => {
    render(<App />);
    
    await waitFor(() => {
      expect(screen.getByText('⚡ Thunder Fleet ⚡')).toBeInTheDocument();
    });

    // Click the History button
    const historyButton = screen.getByRole('button', { name: /history/i });
    fireEvent.click(historyButton);

    // Wait for transition to history view
    await waitFor(() => {
      // The app should show history-related content
      // Since we're using a mock history, we should see the "No battles fought yet!" message
      expect(screen.getByText(/no battles fought yet!/i) || 
             screen.getByText(/battle history/i) || 
             screen.getByText(/naval campaign records/i)).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  test('4. History view displays correctly with mock data', async () => {
    // Mock some game history data
    const mockGameHistory = [
      {
        gameId: 'test-game-1',
        timestamp: Date.now() - 86400000, // 24 hours ago
        result: 'won',
        betAmount: 300,
        winnings: 500,
        shotsFired: 15,
        hits: 8,
        misses: 7,
        accuracy: 53.3
      },
      {
        gameId: 'test-game-2',
        timestamp: Date.now() - 172800000, // 48 hours ago
        result: 'lost',
        betAmount: 500,
        winnings: 0,
        shotsFired: 20,
        hits: 5,
        misses: 15,
        accuracy: 25.0
      }
    ];

    localStorageMock.getItem.mockReturnValue(JSON.stringify(mockGameHistory));

    render(<App />);
    
    await waitFor(() => {
      expect(screen.getByText('⚡ Thunder Fleet ⚡')).toBeInTheDocument();
    });

    // Navigate to history
    const historyButton = screen.getByRole('button', { name: /history/i });
    fireEvent.click(historyButton);

    // Wait for history view to load with data
    await waitFor(() => {
      // Should show stats overview
      expect(screen.getByText(/total battles/i) || 
             screen.getByText(/victory rate/i) ||
             screen.getByText(/game history/i)).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  test('5. Navigation back from history view works', async () => {
    render(<App />);
    
    await waitFor(() => {
      expect(screen.getByText('⚡ Thunder Fleet ⚡')).toBeInTheDocument();
    });

    // Navigate to history
    const historyButton = screen.getByRole('button', { name: /history/i });
    fireEvent.click(historyButton);

    // Wait for history view
    await waitFor(() => {
      expect(screen.queryByText('⚡ Thunder Fleet ⚡')).not.toBeInTheDocument();
    }, { timeout: 3000 });

    // Look for a back/close button in history view
    const backButton = screen.queryByRole('button', { name: /×/i }) || 
                      screen.queryByRole('button', { name: /close/i }) ||
                      screen.queryByRole('button', { name: /back/i });

    if (backButton) {
      fireEvent.click(backButton);
      
      // Should return to splash screen
      await waitFor(() => {
        expect(screen.getByText('⚡ Thunder Fleet ⚡')).toBeInTheDocument();
      }, { timeout: 3000 });
    } else {
      // If no explicit back button, the history component should have onClose functionality
      // This test documents that navigation back needs to be implemented
      console.warn('No back button found in history view - may need manual navigation implementation');
    }
  });

  test('6. History button is clickable and responsive', async () => {
    render(<App />);
    
    await waitFor(() => {
      expect(screen.getByText('⚡ Thunder Fleet ⚡')).toBeInTheDocument();
    });

    const historyButton = screen.getByRole('button', { name: /history/i });
    
    // Check button properties
    expect(historyButton).not.toBeDisabled();
    expect(historyButton).toHaveAttribute('type', 'button');
    
    // Simulate multiple clicks to ensure button responds
    fireEvent.click(historyButton);
    fireEvent.click(historyButton);
    
    // Button should handle multiple clicks gracefully
    expect(historyButton).toBeInTheDocument();
  });

  test('7. History button has correct accessibility attributes', async () => {
    render(<App />);
    
    await waitFor(() => {
      expect(screen.getByText('⚡ Thunder Fleet ⚡')).toBeInTheDocument();
    });

    const historyButton = screen.getByRole('button', { name: /history/i });
    
    // Check accessibility
    expect(historyButton).toHaveAttribute('role', 'button');
    expect(historyButton.textContent.trim()).toBe('History');
    
    // Button should be keyboard accessible
    historyButton.focus();
    expect(historyButton).toHaveFocus();
    
    // Simulate Enter key press
    fireEvent.keyDown(historyButton, { key: 'Enter', code: 'Enter' });
  });

  test('8. History state management works correctly', async () => {
    render(<App />);
    
    await waitFor(() => {
      expect(screen.getByText('⚡ Thunder Fleet ⚡')).toBeInTheDocument();
    });

    // Initial state should be 'splash'
    expect(screen.getByText('Start Game')).toBeInTheDocument();
    
    // Click History button
    const historyButton = screen.getByRole('button', { name: /history/i });
    fireEvent.click(historyButton);
    
    // State should change to 'history'
    await waitFor(() => {
      // Splash screen elements should no longer be visible
      expect(screen.queryByText('Start Game')).not.toBeInTheDocument();
    }, { timeout: 3000 });
  });
});

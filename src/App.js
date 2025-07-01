import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import io from 'socket.io-client';
import { QRCodeSVG } from 'qrcode.react';
import './Cargo.css';

// Ship images for horizontal and vertical orientations
import carrierHorizontal from './assets/ships/horizontal/carrier.png';
import battleshipHorizontal from './assets/ships/horizontal/battleship.png';
import submarineHorizontal from './assets/ships/horizontal/submarine.png';
import cruiserHorizontal from './assets/ships/horizontal/cruiser.png';
import patrolHorizontal from './assets/ships/horizontal/patrol.png';
import carrierVertical from './assets/ships/vertical/carrier.png';
import battleshipVertical from './assets/ships/vertical/battleship.png';
import submarineVertical from './assets/ships/vertical/submarine.png';
import cruiserVertical from './assets/ships/vertical/cruiser.png';
import patrolVertical from './assets/ships/vertical/patrol.png';

// Game constants defining the grid size and timing constraints
const GRID_COLS = 9;
const GRID_ROWS = 7;
const GRID_SIZE = GRID_COLS * GRID_ROWS;
const PLACEMENT_TIME = 45;
const PAYMENT_TIMEOUT = 300;
const JOIN_GAME_TIMEOUT = 20000;
const CONFETTI_COUNT = 50;

// Bet options aligned with server.js for consistency
const BET_OPTIONS = [
  { amount: 300, winnings: 500 },
  { amount: 500, winnings: 800 },
  { amount: 1000, winnings: 1700 },
  { amount: 5000, winnings: 8000 },
  { amount: 10000, winnings: 17000 },
];

// Ship configuration defining each ship's name, size, and images
const SHIP_CONFIG = [
  { name: 'Aircraft Carrier', size: 5, horizontalImg: carrierHorizontal, verticalImg: carrierVertical },
  { name: 'Battleship', size: 4, horizontalImg: battleshipHorizontal, verticalImg: battleshipVertical },
  { name: 'Submarine', size: 3, horizontalImg: submarineHorizontal, verticalImg: submarineVertical },
  { name: 'Destroyer', size: 3, horizontalImg: cruiserHorizontal, verticalImg: cruiserVertical },
  { name: 'Patrol Boat', size: 2, horizontalImg: patrolHorizontal, verticalImg: patrolVertical },
];

// Seeded random number generator for consistent randomization
const mulberry32 = (a) => {
  return function() {
    let t = a += 0x6D2B79F5;
    t = Math.imul((t ^ (t >>> 15)), (t | 1));
    t ^= (t + Math.imul((t ^ (t >>> 7)), (t | 61)));
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296);
  };
};

// Sound effects hook to play audio files for game events
const useSound = (src, isSoundEnabled) => {
  const [audio] = useState(() => {
    const audio = new Audio(src);
    audio.addEventListener('loadedmetadata', () => {
      console.log(`Audio file ${src} loaded with duration: ${audio.duration} seconds`);
    });
    return audio;
  });
  return useCallback(() => {
    if (isSoundEnabled) {
      audio.play().catch(err => console.error(`Error playing audio ${src}:`, err.message));
    }
  }, [isSoundEnabled, audio, src]);
};

const App = () => {
  console.log(`App component rendered at ${new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })}`);

  // State variables for managing game state and UI
  const [gameState, setGameState] = useState('splash');
  const [gameId, setGameId] = useState(null);
  const [playerId, setPlayerId] = useState(null);
  const [lightningAddress, setLightningAddress] = useState('');
  const [betAmount, setBetAmount] = useState('300');
  const [payoutAmount, setPayoutAmount] = useState('500');
  const [myBoard, setMyBoard] = useState(Array(GRID_SIZE).fill('water'));
  const [enemyBoard, setEnemyBoard] = useState(Array(GRID_SIZE).fill('water'));
  const [ships, setShips] = useState(() =>
    SHIP_CONFIG.map((ship, index) => ({
      ...ship,
      id: index,
      positions: [],
      horizontal: true,
      placed: false,
    }))
  );
  const [shipCount, setShipCount] = useState(0);
  const [turn, setTurn] = useState(null);
  const [message, setMessage] = useState('');
  const [transactionMessage, setTransactionMessage] = useState('');
  const [cannonFire, setCannonFire] = useState(null);
  const [isPlacementConfirmed, setIsPlacementConfirmed] = useState(false);
  const [isDragging, setIsDragging] = useState(null);
  const [dragPosition, setDragPosition] = useState({ x: 0, y: 0 }); // Track drag position
  const [cellSize, setCellSize] = useState(40);
  const [timeLeft, setTimeLeft] = useState(PLACEMENT_TIME);
  const [timerActive, setTimerActive] = useState(false);
  const [lightningInvoice, setLightningInvoice] = useState(null);
  const [hostedInvoiceUrl, setHostedInvoiceUrl] = useState(null);
  const [placementSaved, setPlacementSaved] = useState(false);
  const [isWaitingForPayment, setIsWaitingForPayment] = useState(false);
  const [isOpponentThinking, setIsOpponentThinking] = useState(false);
  const [paymentTimer, setPaymentTimer] = useState(PAYMENT_TIMEOUT);
  const [isSocketConnected, setIsSocketConnected] = useState(false);
  const [showTermsModal, setShowTermsModal] = useState(false);
  const [showPrivacyModal, setShowPrivacyModal] = useState(false);
  const [showHowToPlayModal, setShowHowToPlayModal] = useState(false);
  const [isSoundEnabled, setIsSoundEnabled] = useState(true);
  const [payButtonLoading, setPayButtonLoading] = useState(false);
  const [gameStats, setGameStats] = useState({ shotsFired: 0, hits: 0, misses: 0 });
  const [showConfetti, setShowConfetti] = useState(false);
  const [socket, setSocket] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isAppLoaded, setIsAppLoaded] = useState(false);

  // References for managing timers and DOM elements
  const timerRef = useRef(null);
  const paymentTimerRef = useRef(null);
  const joinGameTimeoutRef = useRef(null);
  const seededRandom = useRef(null);
  const gridRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);

  // Sound effects for various game events
  const playHitSound = useSound('/sounds/explosion.mp3', isSoundEnabled);
  const playMissSound = useSound('/sounds/splash.mp3', isSoundEnabled);
  const playWinSound = useSound('/sounds/victory.mp3', isSoundEnabled);
  const playLoseSound = useSound('/sounds/lose.mp3', isSoundEnabled);
  const playPlaceSound = useSound('/sounds/place.mp3', isSoundEnabled);
  const playTimerSound = useSound('/sounds/timer.mp3', isSoundEnabled);
  const playErrorSound = useSound('/sounds/error.mp3', isSoundEnabled);

  // Function to prevent touch propagation
  const preventTouchPropagation = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };

  // Log gameState changes for debugging
  useEffect(() => {
    console.log('Current gameState:', gameState);
  }, [gameState]);

  // Simulate app loading
  useEffect(() => {
    console.log('App useEffect: Simulating app loading');
    const timer = setTimeout(() => {
      setIsAppLoaded(true);
      console.log('App loaded, setting isAppLoaded to true');
    }, 1000);
    return () => clearTimeout(timer);
  }, []);

  // Initialize Socket.IO connection
  useEffect(() => {
    const newSocket = io('https://thunderfleet-backend.onrender.com', {
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });
    setSocket(newSocket);

    console.log('Setting up socket listeners');
    const timeout = setTimeout(() => {
      if (!newSocket.connected) {
        setIsSocketConnected(false);
        setMessage("Failed to connect to the server. Please try again.");
      }
    }, 5000);

    const handlers = {
      connect: () => {
        clearTimeout(timeout);
        reconnectAttemptsRef.current = 0;
        console.log('[Frontend] Connected:', newSocket.id);
        setIsSocketConnected(true);
        setPlayerId(newSocket.id);
        setMessage('');
      },
      connect_error: (error) => {
        clearTimeout(timeout);
        console.log('[Frontend] Socket connection error:', error.message);
        setIsSocketConnected(false);
        setMessage(`Failed to connect to server: ${error.message}. Click Retry to try again.`);
        setIsWaitingForPayment(false);
        setPayButtonLoading(false);
        setIsLoading(false);
        setLightningInvoice(null);
        setHostedInvoiceUrl(null);
      },
      disconnect: () => {
        clearTimeout(timeout);
        console.log('[Frontend] Disconnected from server');
        setIsSocketConnected(false);
        setMessage('Disconnected from server. Click Retry to try again.');
        setIsWaitingForPayment(false);
        setPayButtonLoading(false);
        setIsLoading(false);
        setLightningInvoice(null);
        setHostedInvoiceUrl(null);
      },
      joined: ({ gameId, playerId }) => {
        console.log(`Joined game ${gameId} as player ${playerId}`);
        setGameId(gameId);
        setPlayerId(playerId);
        setGameState('waiting');
        setMessage('Processing payment...');
      },
      paymentRequest: ({ lightningInvoice, hostedInvoiceUrl }) => {
        console.log('Received payment request:', { lightningInvoice, hostedInvoiceUrl });
        clearTimeout(joinGameTimeoutRef.current);
        setLightningInvoice(lightningInvoice);
        setHostedInvoiceUrl(hostedInvoiceUrl || null);
        setIsWaitingForPayment(true);
        setPayButtonLoading(false);
        setPaymentTimer(PAYMENT_TIMEOUT);
        setMessage(`Scan to pay ${betAmount} SATS`);
      },
      paymentVerified: () => {
        console.log('Payment verified successfully');
        setIsWaitingForPayment(false);
        setPayButtonLoading(false);
        setPaymentTimer(PAYMENT_TIMEOUT);
        setLightningInvoice(null);
        setHostedInvoiceUrl(null);
        setMessage('Payment verified! Connecting to game...');
        setTimeout(() => {
          setGameState('waitingForOpponent');
          setMessage('Waiting for opponent to join... Estimated wait time: 10-25 seconds');
        }, 2000); // 2-second delay
      },
      error: ({ message }) => {
        console.log('Received error from server:', message);
        if (message.includes('Invalid webhook signature')) {
          setMessage('Payment verification failed: Invalid webhook signature. Please try again or contact support.');
        } else {
          setMessage(`Error: ${message}. Click Retry to try again.`);
        }
        clearTimeout(joinGameTimeoutRef.current);
        setIsWaitingForPayment(false);
        setPayButtonLoading(false);
        setIsLoading(false);
        setPaymentTimer(PAYMENT_TIMEOUT);
        setLightningInvoice(null);
        setHostedInvoiceUrl(null);
      },
      waitingForOpponent: ({ message }) => {
        console.log('Received waitingForOpponent event:', message);
        setGameState('waitingForOpponent');
        setMessage(message);
      },
      matchmakingTimer: ({ message }) => {
        console.log('Received matchmaking timer update:', message);
        setMessage(message);
      },
      startPlacing: () => {
        console.log('Starting ship placement phase');
        setGameState('placing');
        setMessage('Place your ships! Tap to rotate, drag to position.');
        setIsPlacementConfirmed(false);
        setPlacementSaved(false);
        setMyBoard(Array(GRID_SIZE).fill('water'));
        setShips(prev =>
          prev.map(ship => ({
            ...ship,
            positions: [],
            horizontal: true,
            placed: false,
          }))
        );
        setShipCount(0);
        setGameStats({ shotsFired: 0, hits: 0, misses: 0 });
      },
      placementSaved: () => {
        console.log('Placement saved on server');
        setIsPlacementConfirmed(true);
        setPlacementSaved(true);
        setMessage('Placement saved! Waiting for opponent... You can still reposition your ships until the game starts.');
      },
      placementAutoSaved: () => {
        console.log('Placement auto-saved due to timeout');
        setIsPlacementConfirmed(true);
        setPlacementSaved(true);
        setMessage('Time up! Ships auto-placed. Waiting for opponent...');
      },
      games: ({ count, grid, ships: serverShips }) => {
        console.log(`Received games update: count=${count}, grid=${grid}, ships=`, serverShips);
        setShipCount(count);
        if (grid && serverShips) {
          setMyBoard(grid);
          setShips(prev => {
            const updated = [...prev];
            serverShips.forEach(serverShip => {
              const shipIndex = updated.findIndex(s => s.name === serverShip.name);
              if (shipIndex !== -1) {
                updated[shipIndex] = {
                  ...updated[shipIndex],
                  positions: serverShip.positions,
                  horizontal: serverShip.horizontal,
                  placed: serverShip.positions.length > 0,
                };
              }
            });
            return updated;
          });
          playPlaceSound();
        }
      },
      startGame: ({ turn, message }) => {
        console.log(`Starting game, turn: ${turn}, message: ${message}`);
        setGameState('playing');
        setTurn(turn);
        setMessage(message);
        setIsOpponentThinking(turn !== newSocket.id);
        setPlacementSaved(false);
        setEnemyBoard(Array(GRID_SIZE).fill('water'));
      },
      fireResult: ({ player, position, hit }) => {
        console.log(`Fire result: player=${player}, position=${position}, hit=${hit}`);
        const row = Math.floor(position / GRID_COLS);
        const col = position % GRID_COLS;
        hit ? playHitSound() : playMissSound();
        setGameStats(prev => ({
          ...prev,
          shotsFired: player === newSocket.id ? prev.shotsFired + 1 : prev.shotsFired,
          hits: player === newSocket.id && hit ? prev.hits + 1 : prev.hits,
          misses: player === newSocket.id && !hit ? prev.misses + 1 : prev.misses,
        }));
        if (player === newSocket.id) {
          setCannonFire({ row, col, hit });
          setTimeout(() => setCannonFire(null), 1000);
          setEnemyBoard(prev => {
            const newBoard = [...prev];
            newBoard[position] = hit ? 'hit' : 'miss';
            return newBoard;
          });
          setMessage(hit ? 'Hit! You get another turn!' : 'Miss!');
        } else {
          setMyBoard(prev => {
            const newBoard = [...prev];
            newBoard[position] = hit ? 'hit' : 'miss';
            return newBoard;
          });
          setMessage(hit ? 'Opponent hit your ship!' : 'Opponent missed!');
          // Ensure opponent thinking state resets if bot is stuck
          if (this.players && this.players[player] && this.players[player].isBot && !hit) {
            setIsOpponentThinking(false);
          }
        }
        // Force a turn update if the bot is stuck
        if (player !== newSocket.id && this.players && this.players[player] && this.players[player].isBot && !hit) {
          setTurn(newSocket.id); // Assume turn switches back if bot fails to fire
          setMessage('Your turn to fire!');
        }
      },
      nextTurn: ({ turn }) => {
        console.log(`Next turn: ${turn}`);
        setTurn(turn);
        setMessage(turn === newSocket.id ? 'Your turn to fire!' : 'Opponent\'s turn');
        setIsOpponentThinking(turn !== newSocket.id);
      },
      gameEnd: ({ message }) => {
        console.log('Game ended:', message);
        setGameState('finished');
        setIsOpponentThinking(false);
        setMessage(message);
        playLoseSound(); // Bot always wins, so player always loses
      },
      transaction: ({ message }) => {
        console.log('Transaction message:', message);
        setTransactionMessage(message);
      },
      updateBoard: ({ success }) => {
        if (success) {
          console.log('Board update confirmed by server');
        } else {
          setMessage('Failed to save board changes. Reverting to previous state.');
          console.log('Server failed to update board, reverting state');
          setMyBoard(prev => [...prev]); // Revert board
          setShips(prev => [...prev]);   // Revert ships
        }
      },
    };

    Object.entries(handlers).forEach(([event, handler]) => {
      newSocket.on(event, handler);
    });

    newSocket.connect();

    return () => {
      clearTimeout(timeout);
      Object.entries(handlers).forEach(([event, handler]) => {
        newSocket.off(event, handler);
      });
      newSocket.disconnect();
    };
  }, [playHitSound, playMissSound, playPlaceSound, playWinSound, playLoseSound, betAmount]);

  // Function to calculate ship positions based on drop location
  const calculateShipPositions = useCallback((ship, destinationId) => {
    console.log(`Calculating positions for ship ${ship.name} at destination ${destinationId}`);
    const position = parseInt(destinationId);
    let row = Math.floor(position / GRID_COLS);
    let col = position % GRID_COLS;

    if (!ship.horizontal) {
      const maxRow = GRID_ROWS - ship.size;
      if (row > maxRow) {
        console.log(`Adjusting row from ${row} to ${maxRow} for vertical ship`);
        row = maxRow;
      }
    } else {
      const maxCol = GRID_COLS - ship.size;
      if (col > maxCol) {
        console.log(`Adjusting col from ${col} to ${maxCol} for horizontal ship`);
        col = maxCol;
      }
    }

    const positions = [];
    for (let i = 0; i < ship.size; i++) {
      const pos = ship.horizontal ? row * GRID_COLS + col + i : (row + i) * GRID_COLS + col;
      if (pos >= GRID_SIZE) {
        console.log(`Position ${pos} exceeds grid size ${GRID_SIZE}`);
        return null;
      }
      if (ship.horizontal && col + i >= GRID_COLS) {
        console.log(`Horizontal ship exceeds column boundary at col ${col + i}`);
        return null;
      }
      if (!ship.horizontal && row + i >= GRID_ROWS) {
        console.log(`Vertical ship exceeds row boundary at row ${row + i}`);
        return null;
      }
      if (myBoard[pos] === 'ship' && !ship.positions.includes(pos)) {
        console.log(`Position ${pos} is already occupied by another ship`);
        return null;
      }
      positions.push(pos);
    }
    console.log(`Calculated positions for ${ship.name}:`, positions);
    return positions;
  }, [myBoard]);

  // Function to update the server with the current board state
  const updateServerBoard = useCallback((updatedShips) => {
    if (gameState !== 'placing' || isPlacementConfirmed || !socket) {
      console.log('Cannot update server board: Invalid game state, placement confirmed, or no socket');
      return;
    }
    console.log('Updating server with current board state');
    const placements = (updatedShips || ships).map(ship => ({
      name: ship.name,
      positions: ship.positions.filter(pos => pos >= 0 && pos < GRID_SIZE),
      horizontal: ship.horizontal,
    }));
    socket.emit('updateBoard', { gameId, playerId: socket?.id, placements }, (response) => {
      if (!response || !response.success) {
        setMessage('Failed to save board changes. Reverting to previous state.');
        console.log('Server failed to update board, reverting state');
        setMyBoard(prev => [...prev]); // Revert board
        setShips(prev => [...prev]);   // Revert ships
      } else {
        console.log('Board update confirmed by server');
      }
    });
  }, [gameState, isPlacementConfirmed, ships, socket, gameId]);

  // Function to randomize unplaced ships on the board
  const randomizeUnplacedShips = useCallback(() => {
    if (isPlacementConfirmed) {
      console.log('Cannot randomize ships: Placement already confirmed');
      return;
    }

    const unplacedShips = ships.filter(ship => !ship.placed);
    console.log(`Found ${unplacedShips.length} unplaced ships to randomize`);
    if (unplacedShips.length === 0) {
      console.log('No unplaced ships to randomize');
      return;
    }

    const newBoard = [...myBoard];
    const newShips = [...ships];
    let successfulPlacements = 0;

    unplacedShips.forEach((ship) => {
      let placed = false;
      let attempts = 0;
      const shipSize = ship.size;
      const shipId = ship.id;

      console.log(`Attempting to place ship ${ship.name} (size: ${shipSize})`);
      while (!placed && attempts < 100) {
        attempts++;
        const horizontal = seededRandom.current() > 0.5;
        const row = Math.floor(seededRandom.current() * GRID_ROWS);
        const col = Math.floor(seededRandom.current() * GRID_COLS);
        const positions = [];
        let valid = true;

        for (let i = 0; i < shipSize; i++) {
          const pos = horizontal ? row * GRID_COLS + col + i : (row + i) * GRID_COLS + col;
          if (
            pos >= GRID_SIZE ||
            (horizontal && col + shipSize > GRID_COLS) ||
            (!horizontal && row + shipSize > GRID_ROWS) ||
            newBoard[pos] === 'ship'
          ) {
            valid = false;
            console.log(`Attempt ${attempts}: Invalid position for ${ship.name} at pos ${pos}`);
            break;
          }
          positions.push(pos);
        }

        if (valid) {
          positions.forEach(pos => (newBoard[pos] = 'ship'));
          const shipIndex = newShips.findIndex(s => s.id === shipId);
          if (shipIndex !== -1) {
            newShips[shipIndex] = {
              ...newShips[shipIndex],
              positions,
              horizontal,
              placed: true,
            };
            successfulPlacements++;
            console.log(`Successfully placed ${ship.name} at positions:`, positions);
          }
          placed = true;
        }
      }

      if (!placed) {
        console.log(`Failed to place ship ${ship.name} after 100 attempts`);
      }
    });

    // Set temporary state and wait for server confirmation
    setMyBoard(newBoard);
    setShips(newShips);
    const placedCount = newShips.filter(s => s.placed).length;
    setShipCount(placedCount);

    // Update server and wait for confirmation
    if (socket) {
      socket.emit('updateBoard', { gameId, playerId: socket?.id, placements: newShips.map(ship => ({
        name: ship.name,
        positions: ship.positions,
        horizontal: ship.horizontal,
      })) }, (response) => {
        if (response && response.success) {
          setMessage(`${successfulPlacements} ship(s) randomized! ${placedCount}/5 placed. You can still reposition ships.`);
          console.log(`${successfulPlacements} ships randomized, total placed: ${placedCount}`);
        } else {
          setMessage('Failed to save randomized ships. Please try again.');
          console.log('Server failed to update board');
          // Revert to previous state if server fails
          setMyBoard(prev => [...prev]);
          setShips(prev => [...prev]);
        }
      });
    }

    playPlaceSound();
  }, [isPlacementConfirmed, ships, myBoard, playPlaceSound, socket, gameId]);

  // Function to randomize all ships on the board
  const randomizeShips = useCallback(() => {
    if (isPlacementConfirmed) {
      console.log('Cannot randomize ships: Placement already confirmed');
      return;
    }

    console.log('Randomizing all ships');
    const newBoard = Array(GRID_SIZE).fill('water');
    const newShips = ships.map(ship => ({
      ...ship,
      positions: [],
      horizontal: true,
      placed: false,
    }));
    let successfulPlacements = 0;

    SHIP_CONFIG.forEach((shipConfig, index) => {
      let placed = false;
      let attempts = 0;

      console.log(`Attempting to place ${shipConfig.name} (size: ${shipConfig.size})`);
      while (!placed && attempts < 100) {
        attempts++;
        const horizontal = seededRandom.current() > 0.5;
        const row = Math.floor(seededRandom.current() * GRID_ROWS);
        const col = Math.floor(seededRandom.current() * GRID_COLS);
        const positions = [];
        let valid = true;

        for (let i = 0; i < shipConfig.size; i++) {
          const pos = horizontal ? row * GRID_COLS + col + i : (row + i) * GRID_COLS + col;
          if (
            pos >= GRID_SIZE ||
            (horizontal && col + shipConfig.size > GRID_COLS) ||
            (!horizontal && row + shipConfig.size > GRID_ROWS) ||
            newBoard[pos] === 'ship'
          ) {
            valid = false;
            console.log(`Attempt ${attempts}: Invalid position for ${shipConfig.name} at pos ${pos}`);
            break;
          }
          positions.push(pos);
        }

        if (valid) {
          positions.forEach(pos => (newBoard[pos] = 'ship'));
          newShips[index] = {
            ...newShips[index],
            positions,
            horizontal,
            placed: true,
          };
          successfulPlacements++;
          console.log(`Successfully placed ${shipConfig.name} at positions:`, positions);
          placed = true;
        }
      }

      if (!placed) {
        console.log(`Failed to place ship ${shipConfig.name} after 100 attempts`);
      }
    });

    // Set temporary state and wait for server confirmation
    setMyBoard(newBoard);
    setShips(newShips);
    const placedCount = newShips.filter(s => s.placed).length;
    setShipCount(placedCount);

    // Update server and wait for confirmation
    if (socket) {
      socket.emit('updateBoard', { gameId, playerId: socket?.id, placements: newShips.map(ship => ({
        name: ship.name,
        positions: ship.positions,
        horizontal: ship.horizontal,
      })) }, (response) => {
        if (response && response.success) {
          if (successfulPlacements < SHIP_CONFIG.length) {
            setMessage('Some ships couldn’t be placed. Adjust manually or try again.');
            console.log(`Randomized ${successfulPlacements} out of ${SHIP_CONFIG.length} ships`);
          } else {
            setMessage('Ships randomized! Drag to reposition or Save Placement.');
            console.log('All ships successfully randomized');
          }
        } else {
          setMessage('Failed to save randomized ships. Please try again.');
          console.log('Server failed to update board');
          // Revert to previous state if server fails
          setMyBoard(prev => [...prev]);
          setShips(prev => [...prev]);
        }
      });
    }

    playPlaceSound();
  }, [isPlacementConfirmed, ships, playPlaceSound, socket, gameId]);

  // Function to save ship placement to the server
  const saveShipPlacement = useCallback(() => {
    if (placementSaved || !socket) return;

    // Validate all ship placements
    const invalidShips = ships.filter(ship => {
      return !ship.positions || 
             ship.positions.length === 0 || 
             ship.positions.some(pos => pos < 0 || pos >= GRID_SIZE);
    });

    if (invalidShips.length > 0) {
      setMessage('Invalid ship placement. Please check all ships are properly placed.');
      return;
    }

    const unplacedShips = ships.filter(ship => !ship.placed);
    if (unplacedShips.length > 0) {
      randomizeUnplacedShips();
    }

    setPlacementSaved(true);
    setIsPlacementConfirmed(true);
    setMessage('Placement saved! Waiting for opponent... You can still reposition your ships until the game starts.');

    const placements = ships.map(ship => ({
      name: ship.name,
      positions: ship.positions,
      horizontal: ship.horizontal,
    }));

    socket.emit('savePlacement', { gameId, placements });
    playPlaceSound();
  }, [placementSaved, ships, gameId, socket, playPlaceSound, randomizeUnplacedShips]);

  // Function to auto-save placement when time runs out
  const autoSavePlacement = useCallback(() => {
    console.log('Auto-saving placement due to time running out');
    randomizeUnplacedShips();
    saveShipPlacement();
  }, [randomizeUnplacedShips, saveShipPlacement]);

  // Effect to adjust cell size based on screen width for mobile optimization
  const handleResize = useCallback(() => {
    const width = window.innerWidth;
    console.log(`Window resized to width: ${width}px`);
    if (width < 480) {
      setCellSize(30);
      console.log('Set cell size to 30px for small phones');
    } else if (width < 768) {
      setCellSize(35);
      console.log('Set cell size to 35px for tablets');
    } else {
      setCellSize(40);
      console.log('Set cell size to 40px for desktop');
    }
  }, []);

  useEffect(() => {
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [handleResize]);

  // Effect to initialize seeded random number generator based on playerId
  useEffect(() => {
    if (playerId) {
      const seed = playerId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) + Date.now();
      seededRandom.current = mulberry32(seed);
      console.log(`Initialized seeded random generator with seed: ${seed}`);
    }
  }, [playerId]);

  // Effect to manage the placement timer
  useEffect(() => {
    if (timerActive && timeLeft > 0) {
      console.log(`Placement timer active, time left: ${timeLeft} seconds`);
      timerRef.current = setTimeout(() => {
        setTimeLeft(timeLeft - 1);
        if ([10, 5, 4, 3, 2, 1].includes(timeLeft)) {
          console.log(`Playing timer sound at ${timeLeft} seconds remaining`);
          playTimerSound();
        }
      }, 1000);
    } else if (timerActive && timeLeft === 0) {
      console.log('Placement time up, auto-saving placement');
      setTimerActive(false);
      setMessage('Time up! Saving placement...');
      autoSavePlacement();
    }
    return () => {
      if (timerRef.current) {
        console.log('Clearing placement timer');
        clearTimeout(timerRef.current);
      }
    };
  }, [timerActive, timeLeft, autoSavePlacement, playTimerSound]);

  // Effect to manage the payment verification timer
  useEffect(() => {
    if (isWaitingForPayment && paymentTimer > 0) {
      console.log(`Payment timer active, time left: ${paymentTimer} seconds`);
      paymentTimerRef.current = setTimeout(() => {
        setPaymentTimer(paymentTimer - 1);
      }, 1000);
    } else if (isWaitingForPayment && paymentTimer === 0) {
      console.log('Payment timed out after 5 minutes');
      setIsWaitingForPayment(false);
      setPayButtonLoading(false);
      setIsLoading(false);
      setMessage('Payment timed out after 5 minutes. Click Retry to try again.');
      setLightningInvoice(null);
      setHostedInvoiceUrl(null);
      socket?.emit('cancelGame', { gameId, playerId });
      console.log('Emitted cancelGame due to payment timeout');
    }
    return () => {
      if (paymentTimerRef.current) {
        console.log('Clearing payment timer');
        clearTimeout(paymentTimerRef.current);
      }
    };
  }, [isWaitingForPayment, paymentTimer, gameId, playerId, socket]);

  // Effect to start the placement timer when entering the placing state
  useEffect(() => {
    if (gameState === 'placing') {
      console.log('Entering placing state, starting timer');
      setTimerActive(true);
      setTimeLeft(PLACEMENT_TIME);
      setPlacementSaved(false);
      setIsPlacementConfirmed(false);
    } else {
      console.log('Exiting placing state, stopping timer');
      setTimerActive(false);
    }
  }, [gameState]);

  // Effect to update myBoard when ships change during placing phase
  useEffect(() => {
    if (gameState === 'placing') {
      console.log('Updating myBoard based on ship positions');
      const newBoard = Array(GRID_SIZE).fill('water');
      ships.forEach(ship => {
        ship.positions.forEach(pos => {
          if (pos >= 0 && pos < GRID_SIZE) {
            newBoard[pos] = 'ship';
          }
        });
      });
      setMyBoard(newBoard);
    }
  }, [gameState, ships]);

  // Function to handle reconnection attempts
  const handleReconnect = useCallback(() => {
    if (reconnectAttemptsRef.current >= 3) {
      setMessage('Max reconnection attempts reached. Please refresh the page.');
      return;
    }
    reconnectAttemptsRef.current += 1;
    console.log(`Reconnection attempt ${reconnectAttemptsRef.current}`);
    socket?.connect();
    setMessage('Attempting to reconnect...');
  }, [socket]);

  // Function to select a bet amount and update payout
  const selectBet = useCallback((event) => {
    const selectedAmount = event.target.value;
    console.log('Selecting bet:', selectedAmount);
    setBetAmount(selectedAmount);
    const selectedOption = BET_OPTIONS.find(option => option.amount === parseInt(selectedAmount));
    setPayoutAmount(selectedOption ? selectedOption.winnings : null);
  }, []);

  // Function to handle joining the game
  const handleJoinGame = useCallback(() => {
    if (!socket) {
      setMessage('Cannot join game: No socket connection.');
      return;
    }
    console.log('Attempting to join game:', { lightningAddress, betAmount, socketId: socket.id });
    if (!lightningAddress) {
      setMessage('Please enter a Lightning address');
      console.log('Validation failed: No Lightning address');
      return;
    }

    if (!betAmount) {
      setMessage('Please select a bet amount');
      console.log('Validation failed: No bet amount selected');
      return;
    }

    const sanitizedAddress = lightningAddress.trim().toLowerCase() + '@speed.app';
    if (!sanitizedAddress.includes('@')) {
      setMessage('Invalid Lightning address format');
      console.log('Validation failed: Invalid Lightning address format');
      return;
    }

    setIsLoading(true);
    socket.emit('joinGame', { lightningAddress: sanitizedAddress, betAmount: parseInt(betAmount) }, () => {
      console.log('Join game callback triggered');
    });

    joinGameTimeoutRef.current = setTimeout(() => {
      console.error('joinGame timed out');
      setMessage('Failed to join game: Server did not respond. Click Retry to try again.');
      setIsLoading(false);
    }, JOIN_GAME_TIMEOUT);

    setGameState('waiting');
    setMessage('Joining game...');
    console.log('Emitted joinGame event to server');
  }, [socket, lightningAddress, betAmount]);

  // Function to handle payment button click
  const handlePay = useCallback(() => {
    if (hostedInvoiceUrl) {
      setPayButtonLoading(true);
      console.log('Opening hosted invoice URL:', hostedInvoiceUrl);
      window.open(hostedInvoiceUrl, '_blank');
    } else {
      setMessage('No payment URL available. Please scan the QR code to pay.');
    }
  }, [hostedInvoiceUrl]);

  // Function to cancel the game during payment phase
  const handleCancelGame = useCallback(() => {
    if (!socket) return;
    console.log('Cancelling game:', { gameId, playerId });
    socket.emit('cancelGame', { gameId, playerId });
    setGameState('join');
    setMessage('Game canceled.');
    setLightningInvoice(null);
    setHostedInvoiceUrl(null);
    setIsWaitingForPayment(false);
    setPayButtonLoading(false);
    setIsLoading(false);
    setPaymentTimer(PAYMENT_TIMEOUT);
  }, [socket, gameId, playerId]);

  // Function to toggle ship orientation
  const toggleOrientation = useCallback((shipIndex) => {
    if (isPlacementConfirmed) return;

    setShips(prev => {
      const updated = [...prev];
      const ship = updated[shipIndex];
      const newHorizontal = !ship.horizontal;
      const startPos = ship.positions[0];

      if (startPos === undefined) {
        setMessage('Cannot rotate: Ship not placed yet.');
        return prev;
      }

      const newPositions = calculateShipPositions(
        { ...ship, horizontal: newHorizontal },
        startPos.toString()
      );

      if (!newPositions || newPositions.some(pos => pos < 0 || pos >= GRID_SIZE)) {
        setMessage('Cannot rotate: Overlaps or out of bounds.');
        return prev;
      }

      const otherShipsPositions = updated
        .filter((_, idx) => idx !== shipIndex)
      updated[shipIndex] = {
        ...ship,
        horizontal: newHorizontal,
        positions: newPositions,
        placed: true
      };
      playPlaceSound();
      updateServerBoard(updated);
      return updated;
    });
  }, [isPlacementConfirmed, calculateShipPositions, playPlaceSound, updateServerBoard]);

  // Function to clear the board
  const clearBoard = useCallback(() => {
    if (isPlacementConfirmed) {
      console.log('Cannot clear board: Placement already confirmed');
      return;
    }
    console.log('Clearing the board');
    setMyBoard(Array(GRID_SIZE).fill('water'));
    setShips(prev => prev.map(ship => ({ ...ship, positions: [], placed: false })));
    setShipCount(0);
    setMessage('Board cleared. Place your ships!');
    updateServerBoard();
  }, [isPlacementConfirmed, updateServerBoard]);

  // Function to handle firing a shot
  const handleFire = useCallback((position) => {
    if (gameState !== 'playing' || turn !== socket?.id || enemyBoard[position] !== 'water') {
      console.log(`Cannot fire at position ${position}: Invalid state, turn, or cell`);
      return;
    }
    console.log(`Firing at position ${position}`);
    socket?.emit('fire', { gameId, position });
    const row = Math.floor(position / GRID_COLS);
    const col = position % GRID_COLS;
    setCannonFire({ row, col, hit: false });
    setTimeout(() => setCannonFire(null), 1000);
  }, [gameState, turn, enemyBoard, socket, gameId]);

  // Function to handle drag over events on the grid
  const handleGridDragOver = useCallback((e) => {
    e.preventDefault();
    if (isDragging !== null && !isPlacementConfirmed) {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      setDragPosition({ x, y });
      console.log(`Drag over at x:${x}, y:${y}`);
    }
  }, [isDragging, isPlacementConfirmed, setDragPosition]);

  // Function to handle touch move
  const handleTouchMove = useCallback((e) => {
    if (isDragging === null || isPlacementConfirmed) return;
    e.preventDefault();
    const touch = e.touches[0];
    const rect = gridRef.current.getBoundingClientRect();
    const x = touch.clientX - rect.left;
    const y = touch.clientY - rect.top;
    setDragPosition({ x, y });
    const data = JSON.parse(sessionStorage.getItem('dragData'));
    if (data) {
      data.startX = touch.clientX;
      data.startY = touch.clientY;
      sessionStorage.setItem('dragData', JSON.stringify(data));
    }
    console.log(`Touch moving for ship ${isDragging}`);
  }, [isDragging, isPlacementConfirmed, gridRef, setDragPosition]);

  // Function to handle dropping a ship on the grid
  const handleGridDrop = useCallback((e) => {
    let shipIndex, x, y;
    if (e.dataTransfer) {
      e.preventDefault();
      if (isPlacementConfirmed) {
        console.log('Cannot drop ship: Placement confirmed');
        return;
      }
      shipIndex = parseInt(e.dataTransfer.getData('text/plain'));
      const rect = e.currentTarget.getBoundingClientRect();
      x = e.clientX - rect.left;
      y = e.clientY - rect.top;
      console.log(`Desktop drop at x:${x}, y:${y}, shipIndex:${shipIndex}`);
    } else {
      shipIndex = e.shipIndex;
      x = e.x;
      y = e.y;
      console.log(`Mobile drop at x:${x}, y:${y}, shipIndex:${shipIndex}`);
    }

    if (isPlacementConfirmed) {
      console.log('Cannot drop ship: Placement confirmed');
      return;
    }

    const ship = ships[shipIndex];
    const col = Math.floor(x / cellSize);
    const row = Math.floor(y / cellSize);
    const position = row * GRID_COLS + col;

    if (row >= GRID_ROWS || col >= GRID_COLS || position >= GRID_SIZE) {
      setMessage('Invalid drop position!');
      console.log(`Invalid drop position: row=${row}, col=${col}, position=${position}`);
      return;
    }

    const newPositions = calculateShipPositions(ship, position.toString());
    if (!newPositions) {
      setMessage('Invalid placement!');
      console.log('Invalid placement: Ship cannot be placed here');
      return;
    }

    let updatedShips;
    setMyBoard((prev) => {
      const newBoard = [...prev];
      if (ship.positions.length > 0) {
        ship.positions.forEach((pos) => (newBoard[pos] = 'water'));
      }
      newPositions.forEach((pos) => (newBoard[pos] = 'ship'));
      console.log(`Placed ${ship.name} on board at positions:`, newPositions);
      return newBoard;
    });

    setShips((prev) => {
      const updated = [...prev];
      updated[shipIndex] = {
        ...updated[shipIndex],
        positions: newPositions,
        placed: true,
      };
      updatedShips = updated;

      // Calculate the new ship count based on placed ships
      const placedCount = updated.filter(s => s.positions.length > 0).length;
      setShipCount(placedCount);
      setMessage(
        placedCount === 5
          ? 'All ships placed! Click "Save Placement". You can still reposition ships.'
          : `${placedCount} of 5 ships placed. You can still reposition ships.`
      );
      console.log(`Ship count updated to ${placedCount}`);

      return updated;
    });

    playPlaceSound();
    setIsDragging(null);
    if (updatedShips) updateServerBoard(updatedShips);
  }, [isPlacementConfirmed, ships, cellSize, calculateShipPositions, playPlaceSound, updateServerBoard]);

  // Function to handle touch end
  const handleTouchEnd = useCallback((e) => {
    if (isDragging === null || isPlacementConfirmed) return;
    e.preventDefault();
    setIsDragging(null);
    const data = JSON.parse(sessionStorage.getItem('dragData'));
    if (!data) return;
    const { shipIndex, startX, startY } = data;
    const touch = e.changedTouches[0];
    const gridRect = gridRef.current.getBoundingClientRect();
    const x = touch.clientX - gridRect.left + (startX - touch.clientX); // Adjust for movement
    const y = touch.clientY - gridRect.top + (startY - touch.clientY);
    console.log(`Touch ended for ship ${shipIndex}, dropping at x:${x}, y:${y}`);
    handleGridDrop({ x, y, shipIndex: parseInt(shipIndex) });
    sessionStorage.removeItem('dragData');
  }, [isDragging, isPlacementConfirmed, handleGridDrop, gridRef]);

  // Function to handle drag start
  const handleDragStart = useCallback((e, shipIndex) => {
    if (isPlacementConfirmed) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.setData('text/plain', shipIndex.toString());
    setIsDragging(shipIndex);
    console.log(`Started dragging ship ${shipIndex}`);
  }, [isPlacementConfirmed, setIsDragging]);

  // Function to handle touch start
  const handleTouchStart = useCallback((e, shipIndex) => {
    if (isPlacementConfirmed) {
      e.preventDefault();
      return;
    }
    e.preventDefault();
    setIsDragging(shipIndex);
    const touch = e.touches[0];
    const rect = gridRef.current.getBoundingClientRect();
    const x = touch.clientX - rect.left;
    const y = touch.clientY - rect.top;
    setDragPosition({ x, y });
    const data = { shipIndex, startX: touch.clientX, startY: touch.clientY };
    sessionStorage.setItem('dragData', JSON.stringify(data));
    console.log(`Touch drag started for ship ${shipIndex}`);
  }, [isPlacementConfirmed, setIsDragging, gridRef, setDragPosition]);

  // Function to render the game grid
  const renderGrid = useCallback((board, isEnemy) => {
    console.log(`Rendering ${isEnemy ? 'enemy' : 'player'} grid`);
    return (
      <div
        ref={isEnemy ? null : gridRef}
        className="grid-container"
        style={{
          width: GRID_COLS * cellSize + 4,
          height: GRID_ROWS * cellSize + 4,
          position: 'relative',
        }}
        onDragOver={handleGridDragOver}
        onTouchMove={handleTouchMove}
      >
        <div
          className="grid"
          style={{
            gridTemplateColumns: `repeat(${GRID_COLS}, ${cellSize}px)`,
            gridTemplateRows: `repeat(${GRID_ROWS}, ${cellSize}px)`,
          }}
        >
          {board.map((cell, index) => {
            const row = Math.floor(index / GRID_COLS);
            const col = index % GRID_COLS;
            const isHit = cell === 'hit';
            const isHovered = isDragging !== null && !isPlacementConfirmed;
            const hoverPos = Math.floor(dragPosition.y / cellSize) * GRID_COLS + Math.floor(dragPosition.x / cellSize);
            const isUnderShip = isHovered && calculateShipPositions(ships[isDragging], hoverPos.toString())?.includes(index);

            return (
              <div
                key={index}
                className={`cell ${cell} ${isUnderShip ? 'hovered' : ''} ${isDragging !== null ? 'drag-active' : ''}`}
                onClick={() => isEnemy && handleFire(index)}
                onTouchStart={(e) => {
                  e.preventDefault();
                  if (isEnemy) handleFire(index);
                }}
                style={{
                  cursor:
                    isEnemy && cell === 'water' && gameState === 'playing' && turn === socket?.id
                      ? 'crosshair'
                      : 'default',
                  width: cellSize,
                  height: cellSize,
                  touchAction: 'none',
                  backgroundColor: isHit ? '#ff4500' : cell === 'water' ? '#1e90ff' : cell === 'ship' ? '#888' : '#333',
                }}
                data-grid-index={index}
              >
                {isEnemy && cannonFire && cannonFire.row === row && cannonFire.col === col && (
                  <div className={`cannonball-effect ${cannonFire.hit ? 'hit' : 'miss'}`}></div>
                )}
              </div>
            );
          })}
        </div>
        {!isEnemy &&
          ships.map((ship) => {
            return (
              ship.placed && (
                <div
                  key={`ship-${ship.id}`}
                  className="ship-on-grid"
                  draggable={!isPlacementConfirmed}
                  onDragStart={(e) => handleDragStart(e, ship.id)}
                  onDragEnd={() => setIsDragging(null)}
                  onTouchStart={(e) => handleTouchStart(e, ship.id)}
                  style={{
                    position: 'absolute',
                    top: Math.floor(ship.positions[0] / GRID_COLS) * cellSize + 2,
                    left: (ship.positions[0] % GRID_COLS) * cellSize + 2,
                    width: ship.horizontal ? ship.size * cellSize - 4 : cellSize - 4,
                    height: ship.horizontal ? cellSize - 4 : ship.size * cellSize - 4,
                    backgroundImage: `url(${ship.horizontal ? ship.horizontalImg : ship.verticalImg})`,
                    backgroundSize: 'cover',
                    backgroundPosition: "center",
                    opacity: isPlacementConfirmed ? 1 : 0.8,
                    cursor: !isPlacementConfirmed ? 'grab' : 'default',
                    border: '2px solid #333',
                    borderRadius: '4px',
                    marginBottom: '10px',
                    touchAction: 'none'
                  }}
                  onClick={() => !isPlacementConfirmed && toggleOrientation(ship.id)}
                />
              )
            );
          })}
        {/* Dragging ship preview */}
        {isDragging !== null && !isPlacementConfirmed && (
          <div
            className="dragging-ship"
            style={{
              position: 'absolute',
              top: Math.floor(dragPosition.y / cellSize) * cellSize + 2,
              left: Math.floor(dragPosition.x / cellSize) * cellSize + 2,
              width: ships[isDragging].horizontal ? ships[isDragging].size * cellSize - 4 : cellSize - 4,
              height: ships[isDragging].horizontal ? cellSize - 4 : ships[isDragging].size * cellSize - 4,
              backgroundImage: `url(${ships[isDragging].horizontal ? ships[isDragging].horizontalImg : ships[isDragging].verticalImg})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              opacity: 0.7,
              pointerEvents: 'none',
              zIndex: 10,
            }}
          />
        )}
      </div>
    );
  }, [cellSize, ships, isDragging, dragPosition, gameState, turn, cannonFire, isPlacementConfirmed, handleFire, toggleOrientation, socket, calculateShipPositions, handleDragStart, handleTouchStart, handleGridDragOver, handleTouchMove]);

  // Function to render the list of ships for placement
  const renderShipList = useCallback(() => {
    if (isPlacementConfirmed) {
      console.log('Not rendering ship list: Placement confirmed');
      return null;
    }
    console.log('Rendering ship list for placement');
    return (
      <div className="unplaced-ships">
        {ships.map((ship, i) => (
          !ship.placed && (
            <div key={i} className="ship-container">
              <div className="ship-info">
                <span style={{ color: '#ffffff' }}>{ship.name}</span>
                <span className="ship-status" style={{ color: '#ffffff' }}>{'❌ Not placed'}</span>
              </div>
              <div
                className="ship"
                draggable={!isPlacementConfirmed}
                onDragStart={(e) => handleDragStart(e, i)}
                onDragEnd={() => setIsDragging(null)}
                onTouchStart={(e) => handleTouchStart(e, i)}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                style={{
                  backgroundImage: `url(${ship.horizontal ? ship.horizontalImg : ship.verticalImg})`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                  width: isDragging === i ? (ship.horizontal ? `${ship.size * cellSize}px` : `${cellSize}px`) : (ship.horizontal ? `${ship.size * (cellSize * 0.6)}px` : `${cellSize * 0.8}px`),
                  height: isDragging === i ? (ship.horizontal ? `${cellSize}px` : `${ship.size * cellSize}px`) : (ship.horizontal ? `${cellSize * 0.8}px` : `${ship.size * (cellSize * 0.6)}px`),
                  opacity: 1,
                  cursor: isPlacementConfirmed ? 'default' : 'grab',
                  border: '2px solid #333',
                  borderRadius: '4px',
                  marginBottom: '10px',
                  touchAction: 'none'
                }}
              >
                <span className="ship-label" style={{ color: '#ffffff' }}>{ship.name}</span>
              </div>
            </div>
          )
        ))}
      </div>
    );
  }, [isPlacementConfirmed, ships, cellSize, isDragging, handleDragStart, handleTouchStart, handleTouchMove, handleTouchEnd]);

  // Component to render the splash screen
  const SplashScreen = useMemo(() => {
    console.log('Rendering SplashScreen with logo path: ./logo.png');
    return (
      <div className="splash-screen">
        <div
          className="game-logo"
          style={{
            backgroundImage: `url(./logo.png)`,
            backgroundSize: 'contain',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
          }}
        />
        <h1 className="game-title">
          ⚡ Thunder Fleet ⚡
        </h1>
        <button
          onClick={() => {
            console.log('Start Game button clicked');
            setGameState('join');
          }}
          onTouchStart={() => {
            console.log('Start Game button touched');
            setGameState('join');
          }}
          className="join-button"
        >
          Start Game
        </button>
        <div className="button-group">
          <button
            onClick={() => {
              console.log('How to Play button clicked');
              setShowHowToPlayModal(true);
            }}
            onTouchStart={() => {
              console.log('How to Play button touched');
              setShowHowToPlayModal(true);
            }}
            className="join-button"
          >
            How to Play
          </button>
          <button
            onClick={() => {
              console.log('Sound toggle button clicked');
              setIsSoundEnabled(!isSoundEnabled);
            }}
            onTouchStart={() => {
              console.log('Sound toggle button touched');
              setIsSoundEnabled(!isSoundEnabled);
            }}
            className="join-button sound-toggle"
          >
            {isSoundEnabled ? '🔇 Mute Sound' : '🔊 Enable Sound'}
          </button>
        </div>
      </div>
    );
  }, [isSoundEnabled]);

  // Component to render the terms and conditions modal
  const TermsModal = useMemo(() => {
    console.log('Rendering TermsModal');
    return (
      <div className="modal">
        <div className="modal-content">
          <h2>Terms and Conditions</h2>
          <p>
            Welcome to Lightning Sea Battle! By using this application, you agree to the following terms:
          </p>
          <ul>
            <li>All payments are made in Bitcoin SATS via the Lightning Network.</li>
            <li>Winnings are subject to platform fees as displayed during bet selection.</li>
            <li>We are not responsible for any losses due to network issues or payment failures.</li>
            <li>Game results are final and determined by the server.</li>
            <li>Users must be 18+ to participate.</li>
          </ul>
          <p>Please contact support@thunderfleet.com for any inquiries.</p>
          <button
            onClick={() => setShowTermsModal(false)}
            onTouchStart={() => setShowTermsModal(false)}
            className="join-button"
          >
            Close
          </button>
        </div>
      </div>
    );
  }, []);

  // Component to render the privacy policy modal
  const PrivacyModal = useMemo(() => {
    console.log('Rendering PrivacyModal');
    return (
      <div className="modal">
        <div className="modal-content">
          <h2>Privacy Policy</h2>
          <p>
            At Lightning Sea Battle, we value your privacy:
          </p>
          <ul>
            <li>We collect your Lightning address solely for payment processing.</li>
            <li>Game data (e.g., board state, game results) is stored temporarily to facilitate gameplay.</li>
            <li>We do not share your data with third parties, except as required for payment processing.</li>
            <li>Payment logs are stored securely and used for transparency and dispute resolution.</li>
          </ul>
          <p>Contact support@thunderfleet.com for privacy-related concerns.</p>
          <button
            onClick={() => setShowPrivacyModal(false)}
            onTouchStart={() => setShowPrivacyModal(false)}
            className="join-button"
          >
            Close
          </button>
        </div>
      </div>
    );
  }, []);

  // Component to render the how-to-play modal
  const HowToPlayModal = useMemo(() => {
    console.log('Rendering HowToPlayModal');
    return (
      <div className="modal">
        <div className="modal-content">
          <h2>How to Play Lightning Sea Battle</h2>
          <p>
            Lightning Sea Battle is a classic Battleship game with a Bitcoin twist! Here's how to play:
          </p>
          <ul>
            <li><strong>Join the Game:</strong> Enter your Lightning address and select a bet to start.</li>
            <li><strong>Pay to Play:</strong> Scan the QR code or click "Pay Now" to pay the bet amount in SATS via the Lightning Network.</li>
            <li><strong>Place Your Ships:</strong> Drag your ships onto the grid. Tap or click to rotate them. Place all 5 ships within the time limit.</li>
            <li><strong>Battle Phase:</strong> Take turns firing at your opponent's grid. A red marker indicates a hit, a gray marker indicates a miss.</li>
            <li><strong>Win or Lose:</strong> Sink all your opponent's ships to win! Winnings are paid out automatically to your Lightning address, minus the platform fee.</li>
          </ul>
          <p>Good luck, Captain!</p>
          <button
            onClick={() => setShowHowToPlayModal(false)}
            onTouchStart={() => setShowHowToPlayModal(false)}
            className="join-button"
          >
            Close
          </button>
        </div>
      </div>
    );
  }, []);

  // Component to render the payment modal
  const PaymentModal = useMemo(() => {
    console.log('Rendering PaymentModal');
    return (
      <div className="payment-modal">
        <h3>⚡ Pay {betAmount} SATS to join ⚡</h3>
        <p className="winnings-info">
          Win {payoutAmount} SATS!
        </p>
        {lightningInvoice ? (
          <div className="qr-container">
            <QRCodeSVG value={lightningInvoice} size={window.innerWidth < 320 ? 150 : 200} level="H" includeMargin={true} />
          </div>
        ) : (
          <p>Generating invoice...</p>
        )}
        <div className="invoice-controls">
          <button
            onClick={(e) => { preventTouchPropagation(e); handlePay(); }}
            className={`pay-button ${payButtonLoading ? 'loading' : ''}`}
            disabled={!hostedInvoiceUrl || payButtonLoading}
          >
            {payButtonLoading ? 'Loading...' : 'Pay Now'}
          </button>
          <button onClick={(e) => { preventTouchPropagation(e); handleCancelGame(); }} className="cancel-button">
            Cancel
          </button>
        </div>
        {isWaitingForPayment && (
          <div className="payment-status">
            <p>Waiting for payment confirmation...</p>
            <div className="timer-container">
              <div className="timer-bar">
                <div
                  className="timer-progress"
                  style={{ width: `${(paymentTimer / PAYMENT_TIMEOUT) * 100}%` }}
                ></div>
              </div>
              <div className="timer-text">
                Time left:{' '}
                <span className={paymentTimer <= 30 ? 'time-warning' : ''}>
                  {paymentTimer} seconds
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }, [betAmount, payoutAmount, lightningInvoice, hostedInvoiceUrl, payButtonLoading, isWaitingForPayment, paymentTimer, handlePay, handleCancelGame]);

  // Component to render confetti for winning
  const Confetti = useMemo(() => {
    if (!showConfetti) return null;
    console.log('Rendering Confetti');
    const confettiPieces = Array.from({ length: CONFETTI_COUNT }).map((_, i) => {
      const left = Math.random() * 100;
      const animationDelay = Math.random() * 2;
      const colors = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff'];
      const backgroundColor = colors[Math.floor(Math.random() * colors.length)];
      return (
        <div
          key={i}
          className="confetti-piece"
          style={{
            left: `${left}%`,
            animationDelay: `${animationDelay}s`,
            backgroundColor,
          }}
        ></div>
      );
    });
    return <div className="confetti-container">{confettiPieces}</div>;
  }, [showConfetti]);

  // Component to render the default fallback UI when disconnected
  const DefaultFallbackUI = useMemo(() => {
    console.log('Rendering DefaultFallbackUI');
    return (
      <div className="fallback-ui">
        <h2>
          {isSocketConnected ? 'Loading Game...' : 'Disconnected from Server'}
        </h2>
        <p>
          {isSocketConnected
            ? 'Please wait while we set up your game.'
            : 'Attempting to reconnect...'}
        </p>
        {!isSocketConnected && (
          <button
            onClick={(e) => { preventTouchPropagation(e); handleReconnect(); }}
            onTouchStart={(e) => { preventTouchPropagation(e); handleReconnect(); }}
            className="join-button"
          >
            Retry Connection
          </button>
        )}
      </div>
    );
  }, [isSocketConnected, handleReconnect]);

  // Error handling function
  const handleError = useCallback((error) => {
    console.error('Game error:', error);
    setMessage(error.message || 'An error occurred. Please try again.');
    playErrorSound();
  }, [playErrorSound]);

  // Register error handler with socket
  useEffect(() => {
    if (socket) {
      socket.on('error', handleError);
      return () => socket.off('error', handleError);
    }
  }, [socket, handleError]);

  // Render the main app UI
  return (
    <div
      className="App"
      style={{
        backgroundImage: `url(./background.png)`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
      }}
    >
      {/* Show loading screen until app is fully loaded */}
      {!isAppLoaded && (
        <div className="loading-screen">
          <h2>Loading...</h2>
        </div>
      )}

      {/* Main App Content */}
      {isAppLoaded && (
        <>
          {/* Splash Screen */}
          {gameState === 'splash' && SplashScreen}

          {/* Default Fallback UI when disconnected or loading */}
          {(gameState !== 'splash' && !socket) && DefaultFallbackUI}

          {/* Join Game Screen */}
          {gameState === 'join' && socket && (
            <div className="join-screen">
              <h2>Join the Battle ⚡</h2>
              <p>
                Enter your Lightning address and select a bet to start.
              </p>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <input
                  type="text"
                  placeholder="Lightning Address (e.g., user)"
                  value={lightningAddress}
                  onChange={(e) => {
                    setLightningAddress(e.target.value);
                    console.log('Lightning address updated:', e.target.value);
                  }}
                  style={{ flex: 1 }}
                />
                <span style={{ marginLeft: '5px', color: '#fff' }}>
                  @speed.app
                </span>
              </div>
              <div className="bet-selection">
                <label htmlFor="bet-amount">Select Bet Amount (Sats): </label>
                <select id="bet-amount" value={betAmount} onChange={selectBet}>
                  {BET_OPTIONS.map((option, index) => (
                    <option key={index} value={option.amount}>
                      {option.amount} SATS (Win {option.winnings} SATS)
                    </option>
                  ))}
                </select>
              </div>
              <button
                onClick={(e) => { preventTouchPropagation(e); handleJoinGame(); }}
                onTouchStart={(e) => { preventTouchPropagation(e); handleJoinGame(); }}
                className="join-button"
                disabled={isLoading}
              >
                {isLoading ? 'Joining...' : 'Join Game'}
              </button>
              <div className="legal-notice">
                By playing game you agree to our 
                <button
                  onClick={() => setShowTermsModal(true)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#00f',
                    textDecoration: 'underline',
                    cursor: 'pointer',
                  }}
                >
                  Terms and Conditions
                </button>
                and 
                <button
                  onClick={() => setShowPrivacyModal(true)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#00f',
                    textDecoration: 'underline',
                    cursor: 'pointer',
                  }}
                >
                  Privacy Policy
                </button>.
              </div>
              <p>{message}</p>
            </div>
          )}

          {/* Waiting for Payment Screen */}
          {gameState === 'waiting' && (
            <div className="waiting-screen">
              {PaymentModal}
              {!isLoading && (
                <button
                  onClick={(e) => { preventTouchPropagation(e); handleJoinGame(); }}
                  onTouchStart={(e) => { preventTouchPropagation(e); handleJoinGame(); }}
                  className="join-button"
                >
                  Retry
                </button>
              )}
              <p>{message}</p>
            </div>
          )}

          {/* Waiting for Opponent Screen */}
          {gameState === 'waitingForOpponent' && (
            <div className="waiting-screen">
              <h2>Waiting for Opponent</h2>
              <p>{message}</p>
              <div className="loading-spinner"></div>
              <button onClick={(e) => { preventTouchPropagation(e); handleCancelGame(); }} className="cancel-button">
                Cancel
              </button>
            </div>
          )}

          {/* Ship Placement Screen */}
          {gameState === 'placing' && (
            <div className="placing-screen">
              <h3>
                Place Your Ships ({shipCount}/5)
              </h3>
              <p>{message}</p>
              <div className="timer-container">
                <div className="timer-bar">
                  <div
                    className="timer-progress"
                    style={{ width: `${(timeLeft / PLACEMENT_TIME) * 100}%` }}
                  ></div>
                </div>
                <div className="timer-text">
                  Time left:{' '}
                  <span className={timeLeft <= 10 ? 'time-warning' : ''}>
                    {timeLeft} seconds
                  </span>
                </div>
              </div>
              <div className="fleet-container">
                {renderShipList()}
                <div
                  onDrop={handleGridDrop}
                  onDragOver={handleGridDragOver}
                  onTouchEnd={handleTouchEnd}
                >
                  {renderGrid(myBoard, false)}
                </div>
              </div>
              <div className="action-buttons">
                <button
                  onClick={(e) => { preventTouchPropagation(e); randomizeShips(); }}
                  onTouchStart={(e) => { preventTouchPropagation(e); randomizeShips(); }}
                  className="action-button"
                  disabled={isPlacementConfirmed}
                >
                  Randomize
                </button>
                <button
                  onClick={(e) => { preventTouchPropagation(e); randomizeUnplacedShips(); }}
                  onTouchStart={(e) => { preventTouchPropagation(e); randomizeUnplacedShips(); }}
                  className="action-button place-remaining"
                  disabled={isPlacementConfirmed}
                >
                  Place Remaining
                </button>
                <button
                  onClick={(e) => { preventTouchPropagation(e); clearBoard(); }}
                  onTouchStart={(e) => { preventTouchPropagation(e); clearBoard(); }}
                  className="action-button clear-board"
                  disabled={isPlacementConfirmed}
                >
                  Clear Board
                </button>
                <button
                  onClick={(e) => { preventTouchPropagation(e); saveShipPlacement(); }}
                  onTouchStart={(e) => { preventTouchPropagation(e); saveShipPlacement(); }}
                  className="action-button save-placement"
                  disabled={shipCount < 5 || isPlacementConfirmed}
                >
                  Save Placement
                </button>
              </div>
            </div>
          )}

          {/* Playing Game Screen */}
          {gameState === 'playing' && socket && (
            <div className="playing-screen">
              <h3
                className={turn === socket.id ? 'your-turn' : 'opponent-turn'}
              >
                {turn === socket.id ? 'Your Turn to Fire!' : "Opponent's Turn"}
              </h3>
              <p>{message}</p>
              {isOpponentThinking && (
                <div className="opponent-thinking">
                  <div className="loading-spinner"></div>
                  <p>Opponent is thinking...</p>
                </div>
              )}
              <div className="game-boards">
                <div>
                  <h4>Your Fleet</h4>
                  {renderGrid(myBoard, false)}
                </div>
                <div>
                  <h4>Enemy Waters</h4>
                  {renderGrid(enemyBoard, true)}
                </div>
              </div>
              <div className="game-stats">
                <h4>Game Stats</h4>
                <p>Shots Fired: {gameStats.shotsFired}</p>
                <p>Hits: {gameStats.hits}</p>
                <p>Misses: {gameStats.misses}</p>
              </div>
            </div>
          )}

          {/* Finished Game Screen */}
          {gameState === 'finished' && (
            <div className="finished-screen">
              <h2>{message}</h2>
              {transactionMessage && (
                <p>{transactionMessage}</p>
              )}
              <div className="game-stats">
                <h4>Final Game Stats</h4>
                <p>Shots Fired: {gameStats.shotsFired}</p>
                <p>Hits: {gameStats.hits}</p>
                <p>Misses: {gameStats.misses}</p>
              </div>
              <button
                onClick={(e) => {
                  preventTouchPropagation(e);
                  console.log('Play Again button clicked');
                  setGameState('join');
                  setMessage('');
                  setTransactionMessage('');
                  setMyBoard(Array(GRID_SIZE).fill('water'));
                  setEnemyBoard(Array(GRID_SIZE).fill('water'));
                  setShips(prev =>
                    prev.map(ship => ({
                      ...ship,
                      positions: [],
                      horizontal: true,
                      placed: false,
                    }))
                  );
                  setShipCount(0);
                  setGameStats({ shotsFired: 0, hits: 0, misses: 0 });
                  setShowConfetti(false);
                }}
                onTouchStart={(e) => {
                  preventTouchPropagation(e);
                  console.log('Play Again button touched');
                  setGameState('join');
                  setMessage('');
                  setTransactionMessage('');
                  setMyBoard(Array(GRID_SIZE).fill('water'));
                  setEnemyBoard(Array(GRID_SIZE).fill('water'));
                  setShips(prev =>
                    prev.map(ship => ({
                      ...ship,
                      positions: [],
                      horizontal: true,
                      placed: false,
                    }))
                  );
                  setShipCount(0);
                  setGameStats({ shotsFired: 0, hits: 0, misses: 0 });
                  setShowConfetti(false);
                }}
                className="join-button"
              >
                Play Again
              </button>
              {Confetti}
            </div>
          )}

          {/* Modals */}
          {showTermsModal && TermsModal}
          {showPrivacyModal && PrivacyModal}
          {showHowToPlayModal && HowToPlayModal}
        </>
      )}
    </div>
  );
};

export default App;
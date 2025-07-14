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
const JOIN_GAME_TIMEOUT = 5000;
const CONFETTI_COUNT = 50;
const FIRE_TIMEOUT = 15;

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
  const [cellSize, setCellSize] = useState(40); // Reduced base cell size for better fit
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
  const [fireTimeLeft, setFireTimeLeft] = useState(FIRE_TIMEOUT);
  const [fireTimerActive, setFireTimerActive] = useState(false);

  // References for managing timers and DOM elements
  const timerRef = useRef(null);
  const paymentTimerRef = useRef(null);
  const joinGameTimeoutRef = useRef(null);
  const seededRandom = useRef(null);
  const gridRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const touchStartRef = useRef(null);
  const fireTimerRef = useRef(null);

  // Sound effects for various game events
  const playHitSound = useSound('/sounds/explosion.mp3', isSoundEnabled);
  const playMissSound = useSound('/sounds/splash.mp3', isSoundEnabled);
  const playWinSound = useSound('/sounds/victory.mp3', isSoundEnabled);
  const playLoseSound = useSound('/sounds/lose.mp3', isSoundEnabled);
  const playPlaceSound = useSound('/sounds/place.mp3', isSoundEnabled);
  const playTimerSound = useSound('/sounds/timer.mp3', isSoundEnabled);
  const playErrorSound = useSound('/sounds/error.mp3', isSoundEnabled);

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
        setGameState('waitingForOpponent');
        setMessage('Waiting for opponent...');
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
        setIsLoading(false); // Reset loading after transition
      },
      paymentVerified: () => {
        console.log('Payment verified successfully');
        setIsWaitingForPayment(false);
        setPayButtonLoading(false);
        setPaymentTimer(PAYMENT_TIMEOUT);
        setLightningInvoice(null);
        setHostedInvoiceUrl(null);
        setMessage('Payment verified! Preparing game...');
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
        setTimerActive(true);
        setTimeLeft(PLACEMENT_TIME);
      },
      waitingForOpponent: ({ message, countdown, timeLeft }) => {
        console.log('Received waitingForOpponent event:', { message, countdown, timeLeft });
        setGameState('waitingForOpponent');
        setMessage(message);
        if (countdown && timeLeft !== undefined) {
          console.log(`Countdown update: ${timeLeft} seconds remaining`);
        }
      },
      matchmakingTimer: ({ message }) => {
        console.log('Received matchmaking timer update:', message);
        setMessage(message);
      },
      startGame: ({ turn, message }) => {
        console.log(`Starting game, turn: ${turn}, message: ${message}`);
        setGameState('playing');
        setTurn(turn);
        setMessage(message);
        setIsOpponentThinking(turn !== newSocket.id);
        setPlacementSaved(false);
        setEnemyBoard(Array(GRID_SIZE).fill('water'));
        
        // Start fire timer if it's player's turn
        if (turn === newSocket.id) {
          setFireTimeLeft(FIRE_TIMEOUT);
          setFireTimerActive(true);
        }
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
          // Reset opponent thinking state for opponent moves
          setIsOpponentThinking(false);
        }
      },
      nextTurn: ({ turn }) => {
        console.log(`Next turn: ${turn}`);
        setTurn(turn);
        setMessage(turn === newSocket.id ? 'Your turn to fire!' : 'Opponent\'s turn');
        setIsOpponentThinking(turn !== newSocket.id);
        
        // Start fire timer if it's player's turn
        if (turn === newSocket.id) {
          setFireTimeLeft(FIRE_TIMEOUT);
          setFireTimerActive(true);
        } else {
          setFireTimerActive(false);
        }
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
      placementAutoSaved: () => {
        console.log('Received placementAutoSaved event');
        setMessage('Ships auto-placed due to time limit. Starting game...');
        setPlacementSaved(true);
        setIsPlacementConfirmed(true);
      },
      shipsAutoPlaced: ({ newShips, allShips, grid }) => {
        console.log('Received shipsAutoPlaced event:', { newShips, allShips });
        // Update the board with auto-placed ships
        setMyBoard(grid);
        // Update ships state with all ships including auto-placed ones
        setShips(prev => {
          return SHIP_CONFIG.map((config, index) => {
            const placedShip = allShips.find(s => s.name === config.name);
            if (placedShip) {
              return {
                ...config,
                id: index,
                positions: placedShip.positions,
                horizontal: placedShip.horizontal,
                placed: true,
              };
            }
            return {
              ...config,
              id: index,
              positions: [],
              horizontal: true,
              placed: false,
            };
          });
        });
        setShipCount(allShips.length);
        setMessage(`${newShips.length} ship(s) were auto-placed. Game starting soon...`);
      },
      games: ({ count, grid, ships: serverShips }) => {
        console.log('Received games event:', { count, grid, serverShips });
        if (grid && serverShips) {
          // Update board
          setMyBoard(grid);
          // Update ships with server data
          setShips(prev => {
            return SHIP_CONFIG.map((config, index) => {
              const serverShip = serverShips.find(s => s.name === config.name);
              if (serverShip) {
                return {
                  ...config,
                  id: index,
                  positions: serverShip.positions,
                  horizontal: serverShip.horizontal,
                  placed: true,
                };
              }
              return {
                ...config,
                id: index,
                positions: [],
                horizontal: true,
                placed: false,
              };
            });
          });
          setShipCount(serverShips.length);
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
positions: ship.positions.length > 0 ? ship.positions : calculateShipPositions(ship, ship.positions[0]),
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
  }, [gameState, isPlacementConfirmed, ships, socket, gameId, calculateShipPositions]);

  // Function to randomize unplaced ships
  const randomizeUnplacedShips = useCallback((callback) => {
    if (isPlacementConfirmed) {
      console.log('Cannot randomize ships: Placement already confirmed');
      if (callback) callback(false);
      return;
    }

    const unplacedShips = ships.filter(ship => !ship.placed);
    if (unplacedShips.length === 0) {
      console.log('No unplaced ships to randomize');
      if (callback) callback(true);
      return;
    }

    // Create a fresh random generator for this placement session
    const freshSeed = Date.now() + Math.random() * 1000;
    console.log(`Randomizing ${unplacedShips.length} unplaced ships with fresh seed: ${freshSeed}`);
    
    const newBoard = [...myBoard];
    const newShips = [...ships];
    let successfulPlacements = 0;

    unplacedShips.forEach(ship => {
      const shipSize = SHIP_CONFIG.find(config => config.name === ship.name)?.size || 1;
      const shipId = ship.id;
      let placed = false;
      let attempts = 0;

      console.log(`Attempting to place ${ship.name} (size: ${shipSize})`);
      while (!placed && attempts < 100) {
        attempts++;
        const horizontal = Math.random() > 0.5;
        let row, col;
        
        // Ensure starting position allows the entire ship to fit
        if (horizontal) {
          row = Math.floor(Math.random() * GRID_ROWS);
          col = Math.floor(Math.random() * Math.max(1, GRID_COLS - shipSize + 1));
        } else {
          row = Math.floor(Math.random() * Math.max(1, GRID_ROWS - shipSize + 1));
          col = Math.floor(Math.random() * GRID_COLS);
        }
        
        
        const positions = [];
        let valid = true;

        for (let i = 0; i < shipSize; i++) {
          const pos = horizontal ? row * GRID_COLS + col + i : (row + i) * GRID_COLS + col;
          
          // Additional check to ensure we don't go out of bounds
          if (pos >= GRID_SIZE || newBoard[pos] === 'ship') {
            valid = false;
            console.log(`Attempt ${attempts}: Invalid position for ${ship.name} at pos ${pos}`);
            break;
          }
          
          // For horizontal ships, ensure we don't wrap to next row
          if (horizontal) {
            const currentRow = Math.floor(pos / GRID_COLS);
            if (currentRow !== row) {
              valid = false;
              console.log(`Attempt ${attempts}: Ship ${ship.name} would wrap to next row`);
              break;
            }
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
          setMessage(`${successfulPlacements} ship(s) randomized! ${placedCount}/5 placed. Drag to reposition.`);
          console.log(`${successfulPlacements} ships randomized, total placed: ${placedCount}`);
          // Ensure ships remain draggable by not setting placement as confirmed
setIsPlacementConfirmed(false);
setPlacementSaved(false);
          if (callback) callback(true);
        } else {
          setMessage('Failed to save randomized ships. Please try again.');
          console.log('Server failed to update board');
          // Revert to previous state if server fails
          setMyBoard(prev => [...prev]);
          setShips(prev => [...prev]);
          if (callback) callback(false);
        }
      });
    } else {
      if (callback) callback(false);
    }

    playPlaceSound();
  }, [isPlacementConfirmed, ships, myBoard, playPlaceSound, socket, gameId]);

  // Function to randomize all ships on the board
  const randomizeShips = useCallback(() => {
    if (isPlacementConfirmed) {
      console.log('Cannot randomize ships: Placement already confirmed');
      return;
    }

    // Create a fresh random generator for this placement session
    const freshSeed = Date.now() + Math.random() * 1000;
    console.log(`Randomizing all ships with fresh seed: ${freshSeed}`);
    
    const newBoard = Array(GRID_SIZE).fill('water');
    const newShips = [...ships];
    let successfulPlacements = 0;

    SHIP_CONFIG.forEach((shipConfig, index) => {
      let placed = false;
      let attempts = 0;

      console.log(`Attempting to place ${shipConfig.name} (size: ${shipConfig.size})`);
      while (!placed && attempts < 100) {
        attempts++;
        const horizontal = Math.random() > 0.5;
        let row, col;
        
        // Ensure starting position allows the entire ship to fit
        if (horizontal) {
          row = Math.floor(Math.random() * GRID_ROWS);
          col = Math.floor(Math.random() * Math.max(1, GRID_COLS - shipConfig.size + 1));
        } else {
          row = Math.floor(Math.random() * Math.max(1, GRID_ROWS - shipConfig.size + 1));
          col = Math.floor(Math.random() * GRID_COLS);
        }
        
        
        const positions = [];
        let valid = true;

        for (let i = 0; i < shipConfig.size; i++) {
          const pos = horizontal ? row * GRID_COLS + col + i : (row + i) * GRID_COLS + col;
          
          // Additional check to ensure we don't go out of bounds
          if (pos >= GRID_SIZE || newBoard[pos] === 'ship') {
            valid = false;
            console.log(`Attempt ${attempts}: Invalid position for ${shipConfig.name} at pos ${pos}`);
            break;
          }
          
          // For horizontal ships, ensure we don't wrap to next row
          if (horizontal) {
            const currentRow = Math.floor(pos / GRID_COLS);
            if (currentRow !== row) {
              valid = false;
              console.log(`Attempt ${attempts}: Ship ${shipConfig.name} would wrap to next row`);
              break;
            }
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
            setMessage('Some ships could not be placed. Adjust manually or try again.');
            console.log(`Randomized ${successfulPlacements} out of ${SHIP_CONFIG.length} ships`);
          } else {
            setMessage('Ships randomized! Drag to reposition or Save Placement.');
            console.log('All ships successfully randomized');
          }
          // Ensure ships remain draggable by not setting placement as confirmed
          setIsPlacementConfirmed(false);
          setPlacementSaved(false);
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
  const saveShipPlacement = useCallback(async () => {
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
      // Wait for randomizeUnplacedShips to complete before proceeding
      await new Promise((resolve) => {
        randomizeUnplacedShips((success) => {
          if (success) {
            console.log('Auto-placement completed successfully');
          } else {
            console.log('Auto-placement failed');
          }
          resolve();
        });
      });
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
    // Delay setting placement confirmed to allow UI to update with auto-placed ships
    setTimeout(() => {
      saveShipPlacement();
    }, 500);
  }, [randomizeUnplacedShips, saveShipPlacement]);

  // Effect to adjust cell size based on screen width for mobile optimization
  const handleResize = useCallback(() => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const maxDimension = Math.min(width, height);
    console.log(`Window resized to width: ${width}px, height: ${height}px`);
    const newCellSize = Math.min(40, Math.floor((maxDimension - 20) / Math.max(GRID_COLS, GRID_ROWS))); // Cap at 40px
    setCellSize(newCellSize);
    console.log(`Set cell size to ${newCellSize}px to fit screen`);
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

  // Effect to manage the fire timer during player's turn
  useEffect(() => {
    if (fireTimerActive && fireTimeLeft > 0) {
      console.log(`Fire timer active, time left: ${fireTimeLeft} seconds`);
      fireTimerRef.current = setTimeout(() => {
        setFireTimeLeft(fireTimeLeft - 1);
      }, 1000);
    } else if (fireTimerActive && fireTimeLeft === 0) {
      console.log('Fire time up, auto-firing with reduced accuracy');
      setFireTimerActive(false);
      
      // Auto-fire at a random position with reduced hit chance
      const availablePositions = enemyBoard.map((cell, index) => cell === 'water' ? index : null).filter(pos => pos !== null);
      if (availablePositions.length > 0) {
        const randomIndex = Math.floor(Math.random() * availablePositions.length);
        const randomPosition = availablePositions[randomIndex];
        console.log(`Auto-firing at position ${randomPosition}`);
        
        // Make sure to emit the fire event properly so turn switches
        if (socket && gameId) {
          socket.emit('fire', { gameId, position: randomPosition, autoFire: true });
          
          // Show visual feedback
          const row = Math.floor(randomPosition / GRID_COLS);
          const col = randomPosition % GRID_COLS;
          setCannonFire({ row, col, hit: false });
          setTimeout(() => setCannonFire(null), 1000);
        }
      }
    }
    return () => {
      if (fireTimerRef.current) {
        console.log('Clearing fire timer');
        clearTimeout(fireTimerRef.current);
      }
    };
  }, [fireTimerActive, fireTimeLeft, enemyBoard, socket, gameId]);

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

    // Clean and validate the Lightning address - only send the username part
    const cleanedAddress = lightningAddress.trim().toLowerCase();
    
    // Validate that it's a valid username (no @ symbol should be entered by user)
    if (cleanedAddress.includes('@')) {
      setMessage('Please enter only the username part (before @speed.app)');
      console.log('Validation failed: User entered @ symbol');
      return;
    }
    
    // Validate username format (basic alphanumeric check)
    if (!/^[a-z0-9._-]+$/.test(cleanedAddress)) {
      setMessage('Invalid username format. Use only letters, numbers, dots, hyphens, and underscores.');
      console.log('Validation failed: Invalid username format');
      return;
    }

    setIsLoading(true); // Start loading to disable button
    // Send only the username part - backend will add @speed.app
    socket.emit('joinGame', { lightningAddress: cleanedAddress, betAmount: parseInt(betAmount) }, () => {
      console.log('Join game callback triggered');
    });

    joinGameTimeoutRef.current = setTimeout(() => {
      console.error('joinGame timed out');
      setMessage('Failed to join game: Server did not respond. Click Retry to try again.');
      setIsLoading(false); // Reset loading on timeout
    }, JOIN_GAME_TIMEOUT);

    setGameState('waiting');
    setMessage("Joining game...");
    console.log('Emitted joinGame event to server with username:', cleanedAddress);
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
    if (!socket || !gameId || !playerId) return;
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

      if (!startPos) {
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
    
    // Stop the fire timer when player fires manually
    setFireTimerActive(false);
    
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
    if (!touchStartRef.current || isPlacementConfirmed) return;
    e.preventDefault();

    const { x: startX, y: startY, shipIndex } = touchStartRef.current;
    const touch = e.touches[0];
    const deltaX = Math.abs(touch.clientX - startX);
    const deltaY = Math.abs(touch.clientY - startY);

    if (!touchStartRef.current.isDragging && (deltaX > 10 || deltaY > 10)) {
      console.log(`Starting drag for ship ${shipIndex} after ${deltaX}px/${deltaY}px movement`);
      touchStartRef.current.isDragging = true;
      setIsDragging(shipIndex);
    }

    if (touchStartRef.current.isDragging) {
      const gridRect = gridRef.current.getBoundingClientRect();
      const dragX = touch.clientX - gridRect.left;
      const dragY = touch.clientY - gridRect.top;
      setDragPosition({ x: dragX, y: dragY });
    }
  }, [isPlacementConfirmed, gridRef, setIsDragging, setDragPosition]);

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
    updateServerBoard();
  }, [isPlacementConfirmed, ships, cellSize, calculateShipPositions, playPlaceSound, updateServerBoard]);

  // Function to handle touch end
  const handleTouchEnd = useCallback((e) => {
    if (!touchStartRef.current || isPlacementConfirmed) return;
    e.preventDefault();

    const { shipIndex, isDragging, x: startX, y: startY, time: startTime } = touchStartRef.current;
    const touch = e.changedTouches[0];
    const deltaX = Math.abs(touch.clientX - startX);
    const deltaY = Math.abs(touch.clientY - startY);
    const duration = (Date.now() - startTime) / 1000; // Time in seconds

    if (isDragging) {
      const gridRect = gridRef.current.getBoundingClientRect();
      const x = touch.clientX - gridRect.left;
      const y = touch.clientY - gridRect.top;
      console.log(`Touch ended for ship ${shipIndex}, dropping at x:${x}, y:${y}`);
      handleGridDrop({ x, y, shipIndex });
    } else if (deltaX < 10 && deltaY < 10 && duration < 0.3) { // Tap detected (minimal movement, short duration)
      console.log(`Tapped on ship ${shipIndex}, rotating.`);
      toggleOrientation(shipIndex);
    }

    touchStartRef.current = null;
    setIsDragging(null);
  }, [isPlacementConfirmed, handleGridDrop, toggleOrientation, setIsDragging]);

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
    if (isPlacementConfirmed) return;
    e.preventDefault();
    touchStartRef.current = {
      shipIndex,
      time: Date.now(),
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
      isDragging: false
    };
  }, [isPlacementConfirmed]);

  // Function to render the game grid
  const renderGrid = useCallback((board, isEnemy) => {
    console.log(`Rendering ${isEnemy ? 'enemy' : 'player'} grid`);
    return (
      <div
        ref={isEnemy ? null : gridRef}
        className="grid-container"
        style={{
          width: `${GRID_COLS * cellSize}px`,
          height: `${GRID_ROWS * cellSize}px`,
          maxWidth: '360px', // Cap grid width for mobile
          position: 'relative',
          margin: '0 auto',
          padding: 0,
        }}
        onDragOver={handleGridDragOver}
        onDrop={handleGridDrop}
        onTouchMove={handleTouchMove}
      >
        <div
          className="grid"
          style={{
            gridTemplateColumns: `repeat(${GRID_COLS}, ${cellSize}px)`,
            gridTemplateRows: `repeat(${GRID_ROWS}, ${cellSize}px)`,
            width: '100%',
            height: '100%',
            border: '2px solid #333',
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
            // Only render ships that have valid positions (regardless of placed status)
            // During playing phase, show all ships with positions
            if (!ship.positions || ship.positions.length === 0 || ship.positions[0] === undefined) {
              console.log(`Ship ${ship.name} not rendered: positions=${ship.positions}`);
              return null;
            }
            
            // Log ship rendering for debugging
            console.log(`Ship ${ship.name}: placed=${ship.placed}, positions=${ship.positions}, gameState=${gameState}`);
            
            
            const topPosition = Math.floor(ship.positions[0] / GRID_COLS) * cellSize;
            const leftPosition = (ship.positions[0] % GRID_COLS) * cellSize;
            
            console.log(`Rendering ship ${ship.name} at top=${topPosition}, left=${leftPosition}, size=${ship.size}`);
            
            return (
              <div
                key={`ship-${ship.id}`}
                className="ship-on-grid"
                draggable={!isPlacementConfirmed}
                onDragStart={(e) => handleDragStart(e, ship.id)}
                onDragEnd={() => setIsDragging(null)}
                onTouchStart={(e) => handleTouchStart(e, ship.id)}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                style={{
                  position: 'absolute',
                  top: topPosition,
                  left: leftPosition,
                  width: ship.horizontal ? ship.size * cellSize : cellSize,
                  height: ship.horizontal ? cellSize : ship.size * cellSize,
                  backgroundImage: `url(${ship.horizontal ? ship.horizontalImg : ship.verticalImg})`,
                  backgroundSize: 'cover',
                  backgroundPosition: "center",
                  backgroundRepeat: 'no-repeat',
                  opacity: (gameState === 'playing' || isPlacementConfirmed) ? 1 : 0.8,
                  cursor: (!isPlacementConfirmed && gameState !== 'playing') ? 'grab' : 'default',
                  pointerEvents: (isPlacementConfirmed || gameState === 'playing') ? 'none' : 'auto',
                  touchAction: 'none',
                  // Add border for debugging visibility
                  border: '1px solid rgba(255, 255, 255, 0.3)',
                }}
                onClick={() => !isPlacementConfirmed && toggleOrientation(ship.id)}
              />
            );
          })}
        {/* Dragging ship preview */}
        {isDragging !== null && !isPlacementConfirmed && (
          <div
            className="dragging-ship"
            style={{
              position: 'absolute',
              top: Math.floor(dragPosition.y / cellSize) * cellSize,
              left: Math.floor(dragPosition.x / cellSize) * cellSize,
              width: ships[isDragging].horizontal ? ships[isDragging].size * cellSize : cellSize,
              height: ships[isDragging].horizontal ? cellSize : ships[isDragging].size * cellSize,
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
  }, [cellSize, ships, isDragging, dragPosition, gameState, turn, cannonFire, isPlacementConfirmed, handleFire, toggleOrientation, socket, calculateShipPositions, handleDragStart, handleTouchStart, handleGridDragOver, handleGridDrop, handleTouchMove, handleTouchEnd]);

  // Function to render the list of ships for placement
  const renderShipList = useCallback(() => {
    if (isPlacementConfirmed) {
      console.log('Not rendering ship list: Placement confirmed');
      return null;
    }
    console.log('Rendering ship list for placement');

    // Filter unplaced ships
    const unplacedShips = ships.filter(ship => !ship.placed);

    // Split into two columns: first two ships in column 1, next three in column 2
    const column1Ships = unplacedShips.slice(0, 2);
    const column2Ships = unplacedShips.slice(2, 5);

    return (
      <div className="unplaced-ships">
        <div className="ship-column">
          {column1Ships.map((ship, i) => (
            <div key={i} className="ship-container">
              <div
                className="ship"
                draggable={!isPlacementConfirmed}
                onDragStart={(e) => handleDragStart(e, ships.indexOf(ship))}
                onDragEnd={() => setIsDragging(null)}
                onTouchStart={(e) => handleTouchStart(e, ships.indexOf(ship))}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                style={{
                  backgroundImage: `url(${ship.horizontal ? ship.horizontalImg : ship.verticalImg})`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                  width: ship.horizontal ? `${ship.size * (cellSize * 0.6)}px` : `${cellSize * 0.8}px`,
                  height: ship.horizontal ? `${cellSize * 0.8}px` : `${ship.size * (cellSize * 0.6)}px`,
                  opacity: 1,
                  cursor: isPlacementConfirmed ? 'default' : 'grab',
                  border: '2px solid #333',
                  borderRadius: '4px',
                  marginBottom: '8px',
                  touchAction: 'none'
                }}
              >
                <span className="ship-label" style={{ color: '#ffffff' }}>{ship.name}</span>
              </div>
            </div>
          ))}
        </div>
        <div className="ship-column">
          {column2Ships.map((ship, i) => (
            <div key={i} className="ship-container">
              <div
                className="ship"
                draggable={!isPlacementConfirmed}
                onDragStart={(e) => handleDragStart(e, ships.indexOf(ship))}
                onDragEnd={() => setIsDragging(null)}
                onTouchStart={(e) => handleTouchStart(e, ships.indexOf(ship))}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                style={{
                  backgroundImage: `url(${ship.horizontal ? ship.horizontalImg : ship.verticalImg})`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                  width: ship.horizontal ? `${ship.size * (cellSize * 0.6)}px` : `${cellSize * 0.8}px`,
                  height: ship.horizontal ? `${cellSize * 0.8}px` : `${ship.size * (cellSize * 0.6)}px`,
                  opacity: 1,
                  cursor: isPlacementConfirmed ? 'default' : 'grab',
                  border: '2px solid #333',
                  borderRadius: '4px',
                  marginBottom: '8px',
                  touchAction: 'none'
                }}
              >
                <span className="ship-label" style={{ color: '#ffffff' }}>{ship.name}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }, [isPlacementConfirmed, ships, cellSize, handleDragStart, handleTouchStart, handleTouchMove, handleTouchEnd]);

  // Component to render the splash screen
  const SplashScreen = useMemo(() => {
    console.log('Rendering SplashScreen with logo path: ./logo.png');
    return (
      <div className="splash-screen" style={{ height: '100vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
        {/* Sound Toggle in top right corner */}
        <button
          onClick={() => {
            console.log('Sound toggle button clicked');
            setIsSoundEnabled(!isSoundEnabled);
          }}
          className="sound-toggle-corner"
          title={isSoundEnabled ? 'Mute Sound' : 'Enable Sound'}
        >
          {isSoundEnabled ? '🔊' : '🔇'}
        </button>
        
        <div
          className="game-logo"
          style={{
            backgroundImage: `url(./logo.png)`,
            backgroundSize: 'contain',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
            width: '50%', // Larger logo
            height: 'auto',
            minHeight: '200px',
            marginBottom: '20px',
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
          className="join-button"
          style={{ padding: '15px 30px', fontSize: '1.2em' }} // Match other button sizes
        >
          Start Game
        </button>
        <div className="button-group" style={{ marginTop: '20px' }}>
          <button
            onClick={() => {
              console.log('How to Play button clicked');
              setShowHowToPlayModal(true);
            }}
            className="join-button"
            style={{ padding: '15px 30px', fontSize: '1.2em' }}
          >
            How to Play
          </button>
          <button
            onClick={() => {
              console.log('Telegram support button clicked');
              // TODO: Replace with your actual Telegram channel/group URL
              window.open('https://t.me/thunderfleet_support', '_blank');
            }}
            className="telegram-support-button"
            style={{ padding: '15px 30px', fontSize: '1.2em' }}
          >
            <span className="telegram-icon">📢</span>
            Contact Support
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
          <h2>Terms and Conditions for Thunder Fleet</h2>
          <p>Welcome to Thunder Fleet!</p>
          <p>
            By accessing, downloading, installing, or using the Thunder Fleet platform, application, or associated services (collectively, the "Service"), you agree to be bound by these Terms and Conditions ("Terms"). These Terms constitute a legally binding agreement between you ("User" or "you") and Thunder Fleet ("we," "us," or "our"). Please read them carefully. If you do not agree with any part of these Terms, you must refrain from using the Service. Your continued use of the Service after any updates to these Terms will constitute acceptance of the revised Terms.
          </p>
          <h3>1. Acceptance of Terms</h3>
          <p>
            By creating an account, participating in gameplay, making payments, or engaging with any features of the Service, you acknowledge that you have read, understood, and agreed to be bound by these Terms, our Privacy Policy, and any additional guidelines or rules posted on the Service. You represent that you are at least 18 years of age or have obtained parental consent to use the Service. Minors are prohibited from participating without verifiable parental approval.
          </p>
          <h3>2. User Eligibility and Account Responsibilities</h3>
          <ul>
            <li><strong>Eligibility:</strong> You must be a resident of a jurisdiction where the use of the Service is legal and not prohibited by local laws.</li>
            <li><strong>Account Creation:</strong> You are required to ...(truncated 473 characters)...nauthorized access to our systems or other users' accounts.</li>
            <li><strong>Account Security:</strong> Notify us immediately at slatexsense@gmail.com if you suspect unauthorized use of your account. We are not liable for losses resulting from compromised accounts due to your negligence.</li>
          </ul>
          <h3>3. Payment Terms and Transactions</h3>
          <ul>
            <li><strong>Currency and Payment Method:</strong> All transactions are conducted exclusively in Bitcoin SATS via the Lightning Network. We do not accept other forms of payment.</li>
            <li><strong>Betting and Winnings:</strong> Winnings are calculated based on bet amounts and are subject to a platform fee, which will be clearly displayed during the bet selection process (e.g., a 300 SATS bet yields 500 SATS, with a 100 SATS fee). Winnings are credited to your Lightning address upon game completion, subject to verification.</li>
            <li><strong>Payment Processing:</strong> Payments are processed through third-party Lightning Network providers. We are not responsible for delays, failures, or errors caused by these providers, including network congestion or payment disputes.</li>
            <li><strong>Refunds and Cancellations:</strong> Refunds are not available for payments made, except in cases of service outages lasting more than 24 hours, at our sole discretion. You may cancel a game before payment verification by notifying us, but no partial refunds will be issued for initiated games.</li>
            <li><strong>Tax Obligations:</strong> You are solely responsible for any taxes, duties, or levies applicable to your winnings or use of the Service in your jurisdiction.</li>
          </ul>
          <h3>4. Intellectual Property and User Content</h3>
          <ul>
            <li><strong>Ownership:</strong> All content within the Service, including game design, graphics, sound effects, code, logos, and trademarks (e.g., "Thunder Fleet"), is the property of Thunder Fleet or its licensors and is protected by international copyright, trademark, and intellectual property laws.</li>
            <li><strong>License:</strong> We grant you a limited, non-exclusive, non-transferable, revocable license to use the Service for personal, non-commercial entertainment purposes, subject to these Terms.</li>
            <li><strong>User-Generated Data:</strong> Any data you generate during gameplay (e.g., ship placements, game logs) may be stored temporarily for operational purposes, dispute resolution, or analytics, as outlined in our Privacy Policy. You retain no ownership rights over such data.</li>
            <li><strong>Restrictions:</strong> You may not reproduce, modify, distribute, perform, display, create derivative works, or otherwise exploit any part of the Service without our prior written consent. Unauthorized use may result in legal action and account termination.</li>
          </ul>
          <h3>5. Gameplay Rules and Conduct</h3>
          <ul>
            <li><strong>Game Integrity:</strong> All game outcomes are determined by our servers using secure, randomized algorithms. Any attempt to manipulate game results will result in immediate account suspension and potential legal action.</li>
            <li><strong>Fair Play:</strong> You agree to play fairly, avoiding collusion with other players, using external aids (e.g., bots, calculators), or sharing account access.</li>
            <li><strong>Ship Placement and Strategy:</strong> You are responsible for placing your ships within the allotted time (45 seconds). If you partially place ships but do not complete all placements, your positioned ships will remain intact and only unplaced ships will be automatically positioned. Failure to place any ships may result in automatic placement or game forfeiture.</li>
            <li><strong>Turn Time Limits:</strong> Each player has 15 seconds to fire during their turn. If you fail to fire within this time limit, an automatic shot will be fired on your behalf with reduced accuracy (approximately 20% hit chance). This ensures smooth gameplay flow and prevents delays.</li>
            <li><strong>Bot Matchmaking and Behavior:</strong> You acknowledge that due to the nature of the Service, you may be matched against automated players (bots) instead of human opponents, especially during periods of low player activity or for testing purposes. Bots take approximately 3 seconds to place their ships to simulate realistic gameplay. The use of bots is designed to ensure a consistent gaming experience, and their behavior is governed by our algorithms. You agree that matching with bots does not constitute a breach of these Terms or entitle you to refunds or compensation.</li>
            <li><strong>Disconnection and Reconnection:</strong> If you disconnect during gameplay, you have a 10-second grace period to reconnect before your opponent is awarded the win. This policy balances fair play with maintaining game flow. We are not responsible for connection issues caused by your internet service provider or device.</li>
            <li><strong>Customer Support Access:</strong> Support is available through our integrated Telegram support channel, accessible via the "Contact Support" button in the game interface. Response times may vary based on volume and time of day.</li>
            <li><strong>Disputes:</strong> Any disputes regarding game results must be reported within 24 hours of the game's conclusion, supported by evidence (e.g., screenshots), to slatexsense@gmail.com.</li>
          </ul>
          <h3>6. Limitation on Legal Action</h3>
          <ul>
            <li><strong>No Liability for Suits:</strong> You expressly agree not to initiate any legal action, lawsuit, or claim against Thunder Fleet, its affiliates, officers, employees, or agents for any reason, including but not limited to losses of currency, winnings, data, or any other damages arising from your use of the Service.</li>
            <li><strong>Automatic Case Closure:</strong> In the event that any legal action is brought against Thunder Fleet despite this agreement, such case shall be automatically deemed closed and dismissed with prejudice, with all associated costs borne by the initiating party. This clause is intended to protect Thunder Fleet from frivolous or unjustified litigation and is a fundamental condition of your use of the Service.</li>
          </ul>
          <h3>7. Liability and Disclaimers</h3>
          <ul>
            <li><strong>Service Availability:</strong> The Service is provided "as is" and "as available" without warranties of any kind, express or implied, including but not limited to merchantability, fitness for a particular purpose, or non-infringement.</li>
            <li><strong>Network Issues:</strong> We are not liable for losses, delays, or damages caused by internet disruptions, Lightning Network failures, or server outages beyond our reasonable control.</li>
            <li><strong>Limitation of Liability:</strong> In no event shall Thunder Fleet, its affiliates, officers, employees, or agents be liable for indirect, incidental, special, consequential, or punitive damages, including lost profits, arising from your use of the Service, even if advised of the possibility of such damages. Our total liability shall not exceed the amount you paid us in the last 12 months.</li>
            <li><strong>Third-Party Links:</strong> The Service may contain links to third-party websites or services (e.g., payment processors). We are not responsible for their content, privacy practices, or reliability.</li>
          </ul>
          <h3>8. Termination and Suspension</h3>
          <ul>
            <li><strong>Our Rights:</strong> We reserve the right to suspend or terminate your account at our discretion for violations of these Terms, including but not limited to fraud, abuse, or inactivity for 180 consecutive days.</li>
            <li><strong>Effects of Termination:</strong> Upon termination, you will lose access to the Service, and any pending winnings or balances may be forfeited. Terminated accounts cannot be reactivated.</li>
            <li><strong>User Termination:</strong> You may terminate your account by submitting a written request to slatexsense@gmail.com. Termination does not entitle you to a refund of any payments made.</li>
            <li><strong>Post-Termination:</strong> Sections 4 (Intellectual Property), 5 (Gameplay Rules), 6 (Limitation on Legal Action), 7 (Liability), 8 (Termination), 10 (Governing Law), 14 (Technical Requirements and Compatibility), 15 (Limitation on Refunds and Chargebacks), 16 (Intellectual Property Indemnification), 17 (Force Majeure Expansion), 18 (User Feedback and Suggestions), 20 (Third-Party Services and Liability), and 22 (Severability and Survival Clause Enhancement) will survive termination.</li>
          </ul>
          <h3>9. Privacy and Data Protection</h3>
          <ul>
            <li><strong>Data Collection:</strong> We collect personal data (e.g., Lightning address, gameplay statistics) as described in our Privacy Policy. By using the Service, you consent to such collection and processing.</li>
            <li><strong>Data Security:</strong> We implement reasonable security measures to protect your data, but no method is 100% secure. You acknowledge this risk.</li>
            <li><strong>Data Sharing:</strong> We may share your data with third parties (e.g., payment processors, legal authorities) only as required by law or to provide the Service.</li>
          </ul>
          <h3>10. Governing Law and Dispute Resolution</h3>
          <ul>
            <li><strong>Applicable Law:</strong> These Terms are governed by the laws of India, without regard to conflict of law principles.</li>
            <li><strong>Dispute Resolution:</strong> Any disputes arising from these Terms or your use of the Service shall be resolved through binding arbitration in Mumbai, India, conducted by a single arbitrator under the rules of the Indian Arbitration and Conciliation Act, 1996. Each party shall bear its own costs unless otherwise ordered.</li>
            <li><strong>Class Action Waiver:</strong> You agree to waive any right to participate in a class action lawsuit or class-wide arbitration against us.</li>
            <li><strong>Jurisdiction:</strong> If arbitration is unavailable, you consent to the exclusive jurisdiction of the courts in Mumbai, India.</li>
          </ul>
          <h3>11. Changes to Terms</h3>
          <ul>
            <li><strong>Updates:</strong> We may modify these Terms at any time to reflect changes in law, technology, or business practices. The updated Terms will be posted on the Service with an effective date.</li>
            <li><strong>Notification:</strong> Significant changes will be communicated via email, in-game notifications, or other reasonable means at least 30 days in advance, unless immediate action is required for security reasons.</li>
            <li><strong>Acceptance:</strong> Continued use of the Service after the effective date of the revised Terms constitutes your acceptance of the changes.</li>
          </ul>
          <h3>12. Technical Requirements and Compatibility</h3>
          <ul>
            <li>The Service requires a compatible device (e.g., smartphone or computer), a stable internet connection, and a Lightning Network-compatible wallet. Minimum requirements include Android 8.0+, iOS 13+, or a modern web browser.</li>
            <li>We are not liable for issues arising from outdated devices, unsupported browsers, or inadequate internet connectivity. You are responsible for ensuring your equipment meets these standards.</li>
          </ul>
          <h3>13. Limitation on Refunds and Chargebacks</h3>
          <ul>
            <li>All payments are final upon successful transaction verification. No refunds or chargebacks will be issued except as explicitly stated in Section 3 (Payment Terms and Transactions).</li>
            <li>Any attempt to reverse a payment through your wallet provider or third-party services will be considered a breach of these Terms, potentially leading to account termination and legal action to recover funds.</li>
          </ul>
          <h3>14. Intellectual Property Indemnification</h3>
          <ul>
            <li>You agree to indemnify, defend, and hold harmless Thunder Fleet, its affiliates, and agents from any claims, damages, or liabilities arising from your assertion that the Service infringes on your intellectual property rights. You waive any such claims and agree to bear all costs associated with defending against them.</li>
          </ul>
          <h3>15. Force Majeure Expansion</h3>
          <ul>
            <li>In addition to the events listed in Section 21 (Miscellaneous Provisions), force majeure includes blockchain network outages, Lightning Network disruptions, or government-imposed restrictions on cryptocurrency use. We are not liable for delays or failures caused by these events, and no compensation will be provided.</li>
          </ul>
          <h3>16. User Feedback and Suggestions</h3>
          <ul>
            <li>Any feedback, suggestions, or ideas you provide regarding the Service become the property of Thunder Fleet. You assign all rights to such submissions to us and waive any claims to compensation or ownership. We may use this input to enhance the Service without obligation to you.</li>
          </ul>
          <h3>17. Third-Party Services and Liability</h3>
          <ul>
            <li>The Service may integrate with third-party services (e.g., app stores, Lightning Network providers). We are not responsible for their performance, security, or availability. Any disputes with third parties must be resolved directly with them, and we disclaim all liability for their actions or omissions.</li>
          </ul>
          <h3>18. Severability and Survival Clause Enhancement</h3>
          <ul>
            <li>If any provision of these Terms is deemed invalid or unenforceable by a court or arbitrator in India, the remaining provisions will continue in full force and effect. The invalid provision will be replaced with a valid one that most closely approximates the original intent. Sections 4, 5, 6, 7, 8, 10, 13, 14, 15, 16, 17, and 18 will survive termination or expiration of these Terms.</li>
          </ul>
          <h3>19. Contact Information</h3>
          <p>For questions, support, or to report violations, please contact us at:</p>
          <ul>
            <li>Email: slatexsense@gmail.com</li>
            <li>Effective Date: July 5, 2025</li>
            <li>Last Updated: July 5, 2025</li>
          </ul>
          <button
            onClick={() => setShowTermsModal(false)}
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
          <h2>Privacy Policy for Thunder Fleet</h2>
          <p>Effective Date: July 5, 2025</p>
          <p>Last Updated: July 5, 2025</p>
          <p>
            At Thunder Fleet, we are deeply committed to safeguarding your privacy and ensuring the utmost protection of your personal information. This Privacy Policy provides a detailed, transparent explanation of how we collect, use, disclose, store, process, transfer, and protect your data when you access, download, install, or use our Service (the "Service"), which includes the Thunder Fleet game platform, available on a variety of compatible devices such as smartphones, tablets, and computers. By engaging with the Service—whether by creating an account, participating in gameplay, making payments in Bitcoin SATS via the Lightning Network, or interacting with any features—you expressly agree to the data practices outlined in this Privacy Policy. We urge you to read this document carefully and in its entirety to fully understand your rights and our obligations. If you do not consent to these practices, please refrain from using the Service.
          </p>
          <h3>1. Introduction and Scope</h3>
          <p>
            This Privacy Policy applies to all users of the Thunder Fleet Service, including those accessing it through web browsers, mobile applications (e.g., Android 8.0+ or iOS 13+ devices), or other supported platforms. It governs the handling of data collected directly from you, as well as data generated through your interactions with the Service, such as gameplay activities and payment transactions. This policy is designed to comply with applicable Indian laws, including the Digital Personal Data Protection Act, 2023, the Information Technology Act, 2000, and related regulations, while also adhering to best practices for international data protection standards. We reserve the right to update this policy periodically, and any changes will be communicated as outlined in Section 12.
          </p>
          <h3>2. Information We Collect</h3>
          <p>We collect a wide range of information to provide, maintain, and enhance the Service. This includes:</p>
          <ul>
            <li><strong>Personal Information:</strong>
              <ul>
                <li><strong>Lightning Network Data:</strong> Your Lightning Network address or wallet identifier, which is required for processing payments in Bitcoin SATS and verifying transactions.</li>
                <li><strong>Contact Information:</strong> Your email address (e.g., slatexsense@gmail.com) if you provide it during registration, contact us for support, or opt-in to receive notifications about updates, promotions, or legal matters.</li>
                <li><strong>Identity Verification Data:</strong> In cases where we are legally required to verify your identity (e.g., under anti-money laundering laws), we may request additional details such as your full name or a government-issued ID, though this is not currently a standard requirement.</li>
              </ul>
            </li>
            <li><strong>Gameplay Data:</strong>
              <ul>
                <li><strong>In-Game Actions:</strong> Detailed records of your ship placements, firing patterns, game outcomes, and turn-based decisions to ensure fair play and resolve disputes.</li>
                <li><strong>Performance Statistics:</strong> Metrics such as shots fired, hits, misses, and win/loss ratios, which are tracked to analyze your performance and improve game balance.</li>
                <li><strong>Bot Interaction Data:</strong> Information about your matches against automated players (bots), including response times and strategic choices, to refine bot algorithms and enhance the gaming experience.</li>
              </ul>
            </li>
            <li><strong>Device and Technical Information:</strong>
              <ul>
                <li><strong>Device Identifiers:</strong> Unique device IDs, IP addresses, and MAC addresses to authenticate your access and ensure security.</li>
                <li><strong>System Details:</strong> Operating system version (e.g., Android 8.0+, iOS 13+, or browser type), screen resolution, and hardware capabilities to optimize compatibility and performance.</li>
                <li><strong>Connection Data:</strong> Internet service provider (ISP) details, connection speed, and session duration to troubleshoot connectivity issues and enhance network stability.</li>
              </ul>
            </li>
            <li><strong>Optional Information:</strong>
              <ul>
                <li><strong>User-Submitted Content:</strong> Feedback, suggestions, bug reports, or ideas you voluntarily provide, which may include your name, email, or other personal details if included.</li>
                <li><strong>Profile Preferences:</strong> Custom settings or preferences you set within the game, such as sound options or display themes, if applicable.</li>
              </ul>
            </li>
            <li><strong>Cookies and Tracking Technologies:</strong>
              <p>We employ cookies, web beacons, and similar technologies to monitor your usage patterns, personalize your experience, and measure the effectiveness of our marketing efforts. These may include session cookies (temporary) and persistent cookies (long-term), which track your visits across sessions. You can manage cookie preferences through your browser settings, though disabling them may limit certain features.</p>
            </li>
          </ul>
          <h3>3. How We Use Your Information</h3>
          <p>We utilize your data for a variety of purposes to ensure the Service operates smoothly and meets your expectations:</p>
          <ul>
            <li><strong>Service Delivery:</strong> To provide access to the game, match you with opponents (human or bot), process payments in Bitcoin SATS via the Lightning Network, and deliver real-time gameplay updates.</li>
            <li><strong>Game Integrity and Security:</strong> To detect cheating, prevent unauthorized access, and resolve disputes by analyzing gameplay logs and transaction records.</li>
            <li><strong>Communication:</strong> To send you important updates (e.g., game patches, server maintenance), respond to support requests, or notify you of legal or policy changes via email or in-game messages.</li>
            <li><strong>Improvement and Analytics:</strong> To analyze usage trends, optimize game design, balance bot difficulty, and enhance user experience using aggregated, anonymized data where feasible.</li>
            <li><strong>Legal Compliance:</strong> To fulfill obligations under Indian laws, such as reporting suspicious transactions to authorities or retaining data as required by the DPDP Act, 2023.</li>
            <li><strong>Marketing (Optional):</strong> With your consent, to send promotional offers or newsletters, which you can opt out of at any time by contacting us.</li>
          </ul>
          <h3>4. How We Share Your Information</h3>
          <p>We are committed to not selling your personal information to third parties. However, we may share it under the following circumstances:</p>
          <ul>
            <li><strong>Third-Party Service Providers:</strong> With payment processors (e.g., Lightning Network nodes) to facilitate Bitcoin SATS transactions, analytics platforms to track usage, and cloud service providers to host the Service. These partners are contractually obligated to protect your data and use it only for the purposes we specify.</li>
            <li><strong>Legal Requirements:</strong> With law enforcement, regulatory bodies, or government authorities in India if required by law, court order, or to protect our rights, property, or the safety of our users. This may include sharing data to comply with anti-money laundering (AML) or counter-terrorism financing (CTF) regulations.</li>
            <li><strong>Business Transfers:</strong> In the event of a merger, acquisition, sale of assets, or bankruptcy, your data may be transferred to the successor entity, subject to this Privacy Policy or a comparable notice.</li>
            <li><strong>With Your Consent:</strong> For any other purpose with your explicit, informed consent, which you can withdraw at any time by contacting us.</li>
            <li><strong>Aggregated or Anonymized Data:</strong> We may share non-personally identifiable data (e.g., aggregated statistics on game performance) with partners or the public to promote the Service, provided it cannot be linked to you.</li>
          </ul>
          <h3>5. Data Security</h3>
          <p>We employ a multi-layered approach to protect your data, including:</p>
          <ul>
            <li><strong>Physical Security:</strong> Secure data centers with restricted access and surveillance.</li>
            <li><strong>Technical Measures:</strong> Encryption of sensitive data (e.g., Lightning addresses) during transmission and storage using industry-standard protocols like TLS.</li>
            <li><strong>Organizational Controls:</strong> Access restrictions for employees and regular security audits to prevent unauthorized access or breaches.</li>
          </ul>
          <p>
            Despite these efforts, no system is entirely immune to risks, especially given the decentralized nature of the Lightning Network. You acknowledge these inherent risks, and we are not liable for data breaches caused by external factors beyond our reasonable control. In the event of a breach affecting your personal data, we will notify you via email (e.g., slatexsense@gmail.com) within 72 hours, as required by the DPDP Act, 2023, and take remedial actions such as notifying the Indian Data Protection Authority and offering support.
          </p>
          <h3>6. Data Retention and Deletion</h3>
          <p><strong>Retention Periods:</strong></p>
          <ul>
            <li>Personal information (e.g., Lightning address, email) is retained for 1 year after your last activity or as long as needed to provide the Service, unless extended by legal requirements (e.g., 5 years for financial records under Indian tax laws).</li>
            <li>Gameplay data (e.g., logs, statistics) is stored for 30 days post-game for dispute resolution, then anonymized or deleted.</li>
            <li>Technical data (e.g., IP addresses) is retained for 90 days for security purposes, then discarded.</li>
          </ul>
          <p><strong>Deletion Requests:</strong> You may request deletion of your data by contacting us at slatexsense@gmail.com, and we will comply within 30 days, subject to legal retention obligations (e.g., AML compliance). We will confirm deletion in writing.</p>
          <h3>7. Your Rights and Choices</h3>
          <p>Under the Digital Personal Data Protection Act, 2023, you have the following rights, which you can exercise by contacting us at slatexsense@gmail.com:</p>
          <ul>
            <li><strong>Right to Access:</strong> Request a detailed report of the personal data we hold about you, including its source and purpose, within 30 days.</li>
            <li><strong>Right to Correction:</strong> Update or rectify inaccurate or incomplete data, such as correcting a misspelled email address.</li>
            <li><strong>Right to Deletion:</strong> Request erasure of your data, except where retention is mandated by law (e.g., tax records).</li>
            <li><strong>Right to Restriction:</strong> Limit the processing of your data for specific purposes (e.g., opting out of marketing).</li>
            <li><strong>Right to Data Portability:</strong> Receive your data in a structured, machine-readable format for transfer to another service, where technically feasible.</li>
            <li><strong>Right to Object:</strong> Challenge the processing of your data for direct marketing or profiling, which we will honor unless overridden by a legitimate interest.</li>
          </ul>
          <p>We may require identity verification (e.g., a copy of your ID) to process these requests, and we will respond within the legal timeframe, typically 30 days, with possible extensions for complex cases.</p>
          <h3>8. International Data Transfers</h3>
          <p>
            Your data may be processed on servers located in India or other countries where our third-party providers operate (e.g., the United States or Singapore). We ensure compliance with Indian data protection laws by implementing safeguards such as Standard Contractual Clauses (SCCs) or binding corporate rules, as approved by the Indian Data Protection Authority. You consent to these transfers by using the Service, understanding that data protection standards may vary by jurisdiction.
          </p>
          <h3>9. Children’s Privacy</h3>
          <p>
            The Service is intended for users aged 18 and above, as stipulated in our Terms and Conditions. We do not knowingly collect personal data from children under 18. If we discover such collection, we will delete the data immediately, notify the parent or guardian via email (e.g., slatexsense@gmail.com), and report the incident to the relevant authorities if required. Parents or guardians may contact us to initiate this process.
          </p>
          <h3>10. Third-Party Links and Services</h3>
          <p>
            The Service may contain links to third-party websites (e.g., payment gateways, app stores) or integrate with external services (e.g., Lightning Network nodes). We are not responsible for the privacy practices or data security of these entities. Their use of your data is governed by their own policies, which we recommend you review. We disclaim all liability for any unauthorized access or misuse of your data by third parties.
          </p>
          <h3>11. Cookies and Tracking Technologies</h3>
          <p>We use cookies and similar technologies for various purposes:</p>
          <ul>
            <li><strong>Essential Cookies:</strong> To maintain your session, authenticate your login, and enable core functionality.</li>
            <li><strong>Analytical Cookies:</strong> To track usage metrics (e.g., time spent playing, match frequency) and improve the Service, using tools like Google Analytics with anonymized data.</li>
            <li><strong>Advertising Cookies:</strong> With your consent, to deliver targeted ads based on your gameplay preferences, which you can opt out of via your device settings.</li>
          </ul>
          <p>You can manage cookie preferences through your browser or device settings, but disabling them may impair the Service’s performance or accessibility.</p>
          <h3>12. Changes to This Privacy Policy</h3>
          <p>
            We may revise this Privacy Policy to reflect changes in legal requirements, technological advancements, or our data practices. The updated version will be posted on the Service with a new effective date and version number. Significant changes, such as new data collection methods or sharing practices, will be communicated via email, in-game notifications, or a prominent banner at least 30 days in advance, unless immediate updates are needed for compliance or security reasons. Your continued use of the Service after the effective date constitutes acceptance of the revised policy.
          </p>
          <h3>13. Compliance with Indian Laws</h3>
          <p>
            This Privacy Policy is crafted to comply with the Digital Personal Data Protection Act, 2023, the Information Technology Act, 2000, and Reserve Bank of India (RBI) guidelines on cryptocurrency transactions. We may collect additional data or adjust our practices to meet emerging regulations, such as those related to anti-money laundering (AML) or data localization. You agree to use the Service in accordance with these laws, and we reserve the right to suspend your account if your use violates them.
          </p>
          <h3>14. Data Breach Notification</h3>
          <p>In the event of a data breach involving your personal information, we will follow a structured response plan:</p>
          <ul>
            <li>Notify the Indian Data Protection Authority and affected users within 72 hours, as required by the DPDP Act, 2023.</li>
            <li>Provide details of the breach, including the nature of the data exposed and recommended actions (e.g., changing your Lightning Network password).</li>
            <li>Offer support, such as monitoring services, if deemed necessary.</li>
          </ul>
          <p>You will be contacted at the email address provided (e.g., slatexsense@gmail.com) unless otherwise specified.</p>
          <h3>15. Dispute Resolution</h3>
          <p>
            Any disputes arising from this Privacy Policy or the handling of your data will be resolved through binding arbitration in Mumbai, India, under the Indian Arbitration and Conciliation Act, 1996. Each party will bear its own costs unless otherwise ordered by the arbitrator. This clause does not preclude your right to lodge a complaint with the Indian Data Protection Authority.
          </p>
          <h3>16. Limitation of Liability</h3>
          <p>
            We are not liable for any indirect, incidental, or consequential damages resulting from data breaches, loss of access, or misuse of your information by third parties, to the extent permitted by Indian law. Our total liability for any privacy-related claims shall not exceed the amount you paid us for the Service in the preceding 12 months.
          </p>
          <h3>17. Contact Us</h3>
          <p>For questions, concerns, data requests, or to report privacy issues, please contact us at:</p>
          <ul>
            <li>Email: slatexsense@gmail.com</li>
            <li>Hours: Available for email support 9:00 AM to 6:00 PM IST, Monday to Friday, with responses within 3 business days.</li>
          </ul>
          <p>We value your trust and are here to assist you in exercising your privacy rights or addressing any concerns.</p>
          <button
            onClick={() => setShowPrivacyModal(false)}
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
          <h2>How to Play Thunderfleet</h2>
          <div className="how-to-play-sections">
            <section>
              <h3>1: Getting Started</h3>
              <p>
                Welcome to Thunderfleet, a strategic sea battle game! Each player starts with a 9x7 grid (63 cells total). Your mission is to place 5 ships: Aircraft Carrier (5 cells), Battleship (4 cells), Submarine (3 cells), Destroyer (3 cells), and Patrol Boat (2 cells). Position them horizontally or vertically on your grid, ensuring no overlaps or edges hang off. You have 45 seconds to place all ships. If you only place some ships before time runs out, those ships will stay exactly where you placed them, and only the unplaced ships will be positioned automatically. Keep your ship placements secret from your opponent!
              </p>
            </section>
            <section>
              <h3>2: Taking Turns</h3>
              <p>
                Thunderfleet is a turn-based game with time pressure! On your turn, you have 15 seconds to select a coordinate (e.g., A1 to I7) on your opponent's grid to launch an attack. A circular timer will show your remaining time. If you don't fire within 15 seconds, an automatic shot will be fired for you with reduced accuracy (only 20% chance to hit a ship). After you call your shot, your opponent will respond: "Hit" if you strike a ship, "Miss" if you hit water, or "Sunk" if you've destroyed an entire ship. Mark your tracking grid accordingly—"X" for hits, "O" for misses. If you score a hit, you get another turn immediately. Act fast and keep the pressure on!
              </p>
            </section>
            <section>
              <h3>3: Attacking and Sinking</h3>
              <p>
                When attacking, focus on uncovering your opponent’s fleet. Each successful hit reveals part of a ship, so track your progress. A ship sinks when all its cells are hit—listen for the "Sunk" call to know you’ve taken one down. With 17 cells across all 5 ships, you’ll need to land multiple hits. Use your tracking grid to spot patterns, but beware—random shots can throw off your opponent’s strategy too!
              </p>
            </section>
            <section>
              <h3>4: Game Strategy</h3>
              <p>
                Mastering Thunderfleet takes skill! Start by targeting edges or corners to limit possible ship locations. If you hit a ship, try adjacent cells to find its length and orientation—horizontal or vertical. Mix up your shots to avoid predictability. Pay attention to sunk ships to narrow down remaining targets. The player who balances aggression and cunning will come out on top!
              </p>
            </section>
            <section>
              <h3>5: Technical Features</h3>
              <p>
                Thunderfleet includes several technical features for smooth gameplay: When facing a bot opponent, they take 3 seconds to place their ships (just like a real player would). If you disconnect during a game, you have 10 seconds to reconnect before your opponent is awarded the win—this protects against unfair losses due to network issues. Need help? Click the Telegram support button in the top-right corner to reach our support team instantly!
              </p>
            </section>
            <section>
              <h3>6: Winning the Game</h3>
              <p>
                The game ends when you sink all your opponent's ships— 17 hits total! Once you've cleared their fleet, shout "You sank my fleet!" to claim victory. Your opponent will do the same if they sink yours first. Win fast to maximize your Lightning Network SATS rewards! Celebrate your tactical triumph or learn from the battle to improve next time. Ready to dominate the seas? Let's finish this, bro!
              </p>
            </section>
          </div>
          <button
            onClick={() => setShowHowToPlayModal(false)}
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
            onClick={handlePay}
            className={`pay-button ${payButtonLoading ? 'loading' : ''}`}
            disabled={!hostedInvoiceUrl || payButtonLoading || isLoading}
          >
            {payButtonLoading ? 'Loading...' : 'Pay Now'}
          </button>
          <button onClick={handleCancelGame} className="cancel-button" disabled={isLoading}>
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
  }, [betAmount, payoutAmount, lightningInvoice, hostedInvoiceUrl, payButtonLoading, isWaitingForPayment, paymentTimer, handlePay, handleCancelGame, isLoading]);

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
      <div className="fallback-ui" style={{ height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
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
            onClick={handleReconnect}
            className="join-button"
            style={{ padding: '15px 30px', fontSize: '1.2em' }}
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
        height: '100vh',
        width: '100vw',
        overflow: 'hidden', // Remove scrolling
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
      }}
    >
      {/* Show loading screen until app is fully loaded */}
      {!isAppLoaded && (
        <div className="loading-screen" style={{ height: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
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
            <div className="join-screen" style={{ height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
              <h2>Join the Battle ⚡</h2>
              <p>
                Enter your Lightning address and select a bet to start.
              </p>
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: '20px' }}>
                <input
                  type="text"
                  placeholder="Enter username (e.g., user123)"
                  value={lightningAddress}
                  onChange={(e) => {
                    setLightningAddress(e.target.value.toLowerCase()); // Convert to lowercase
                    console.log('Lightning address updated:', e.target.value.toLowerCase());
                  }}
                  style={{ flex: 1, padding: '10px', fontSize: '1em', marginRight: '5px' }}
                />
                <span style={{ marginLeft: '5px', color: '#fff', fontWeight: 'bold' }}>
                  @speed.app
                </span>
              </div>
              <p style={{ marginBottom: '20px', fontSize: '0.9em', color: '#ccc' }}>
                Enter only your Speed Wallet username. We'll automatically add @speed.app
              </p>
              <div className="bet-selection">
                <label htmlFor="bet-amount">Select Bet Amount (Sats): </label>
                <select id="bet-amount" value={betAmount} onChange={selectBet} style={{ padding: '10px', fontSize: '1em' }}>
                  {BET_OPTIONS.map((option, index) => (
                    <option key={index} value={option.amount}>
                      {option.amount} SATS (Win {option.winnings} SATS)
                    </option>
                  ))}
                </select>
              </div>
              <button
                onClick={handleJoinGame}
                className="join-button"
                disabled={isLoading}
                style={{ padding: '15px 30px', fontSize: '1.2em', marginTop: '20px' }}
              >
                {isLoading ? 'Joining...' : 'Join Game'}
              </button>
              <div className="legal-notice" style={{ marginTop: '10px', fontSize: '0.9em' }}>
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
              <p style={{ marginTop: '10px' }}>{message}</p>
            </div>
          )}

          {/* Waiting for Payment Screen */}
          {gameState === 'waiting' && (
            <div className="waiting-screen" style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'center', background: 'rgba(0, 0, 0, 0.7)', zIndex: 1000 }}>
              {PaymentModal}
              {!isLoading && (
                <button
                  onClick={handleJoinGame}
                  className="join-button"
                  style={{ padding: '15px 30px', fontSize: '1.2em', marginTop: '20px' }}
                >
                  Retry
                </button>
              )}
              <p style={{ marginTop: '10px', color: '#fff' }}>{message}</p>
            </div>
          )}

          {/* Waiting for Opponent Screen */}
          {gameState === 'waitingForOpponent' && (
            <div className="waiting-screen" style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'rgba(0, 0, 0, 0.7)', zIndex: 1000, padding: '20px', borderRadius: '10px' }}>
              <h2>Waiting for Opponent</h2>
              <p>{message}</p>
              <div className="loading-spinner"></div>
              <button onClick={handleCancelGame} className="cancel-button" disabled={isLoading} style={{ padding: '15px 30px', fontSize: '1.2em' }}>
                Cancel
              </button>
            </div>
          )}

          {/* Ship Placement Screen */}
          {gameState === 'placing' && (
            <div className="placing-screen" style={{ height: '100vh', overflow: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', paddingBottom: '20px' }}>
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
              <div className="fleet-container" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                {renderShipList()}
                <div
                  onDrop={handleGridDrop}
                  onDragOver={handleGridDragOver}
                  onTouchEnd={handleTouchEnd}
                  style={{ margin: '0 auto', padding: 0 }}
                >
                  {renderGrid(myBoard, false)}
                </div>
              </div>
              <div className="action-buttons" style={{ marginTop: '10px', display: 'flex', gap: '10px', flexWrap: 'wrap', justifyContent: 'center' }}>
                <button
                  onClick={randomizeShips}
                  className="action-button"
                  disabled={isPlacementConfirmed}
                  style={{ padding: '15px 20px', fontSize: '1em' }}
                >
                  Randomize
                </button>
                <button
                  onClick={randomizeUnplacedShips}
                  className="action-button place-remaining"
                  disabled={isPlacementConfirmed}
                  style={{ padding: '15px 20px', fontSize: '1em' }}
                >
                  Place Remaining
                </button>
                <button
                  onClick={clearBoard}
                  className="action-button clear-board"
                  disabled={isPlacementConfirmed}
                  style={{ padding: '15px 20px', fontSize: '1em' }}
                >
                  Clear Board
                </button>
                <button
                  onClick={saveShipPlacement}
                  className="action-button save-placement"
                  disabled={shipCount < 5 || isPlacementConfirmed}
                  style={{ padding: '15px 20px', fontSize: '1em' }}
                >
                  Save Placement
                </button>
              </div>
            </div>
          )}

          {/* Playing Game Screen */}
          {gameState === 'playing' && socket && (
            <div className="playing-screen" style={{ height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
              <h3
                className={turn === socket.id ? 'your-turn' : 'opponent-turn'}
              >
                {turn === socket.id ? 'Your Turn to Fire!' : "Opponent's Turn"}
              </h3>
              <p>{message}</p>
              
              {/* Compact Firing Timer */}
              {fireTimerActive && turn === socket.id && (
                <div className="firing-timer-compact" style={{ margin: '5px 0', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
                  <div className="timer-container-small" style={{ position: 'relative', width: '40px', height: '40px' }}>
                    <svg width="40" height="40" style={{ transform: 'rotate(-90deg)' }}>
                      <circle
                        cx="20"
                        cy="20"
                        r="16"
                        fill="none"
                        stroke="rgba(255, 255, 255, 0.2)"
                        strokeWidth="3"
                      />
                      <circle
                        cx="20"
                        cy="20"
                        r="16"
                        fill="none"
                        stroke={fireTimeLeft <= 5 ? '#ff4444' : '#4CAF50'}
                        strokeWidth="3"
                        strokeLinecap="round"
                        strokeDasharray={`${2 * Math.PI * 16}`}
                        strokeDashoffset={`${2 * Math.PI * 16 * (1 - fireTimeLeft / FIRE_TIMEOUT)}`}
                        style={{ transition: 'stroke-dashoffset 0.5s ease, stroke 0.5s ease' }}
                      />
                    </svg>
                    <div 
                      className="timer-text-small" 
                      style={{ 
                        position: 'absolute', 
                        top: '50%', 
                        left: '50%', 
                        transform: 'translate(-50%, -50%)', 
                        color: fireTimeLeft <= 5 ? '#ff4444' : '#fff', 
                        fontSize: '12px', 
                        fontWeight: 'bold'
                      }}
                    >
                      {fireTimeLeft}
                    </div>
                  </div>
                  <span style={{ color: fireTimeLeft <= 5 ? '#ff4444' : '#fff', fontSize: '12px', fontWeight: 'bold' }}>
                    {fireTimeLeft <= 5 ? 'Hurry!' : 'Fire!'}
                  </span>
                </div>
              )}
              {isOpponentThinking && (
                <div className="opponent-thinking">
                  <div className="loading-spinner"></div>
                  <p>Opponent is thinking...</p>
                </div>
              )}
              <div className="game-boards" style={{ display: 'flex', justifyContent: 'space-around', width: '100%' }}>
                <div>
                  <h4>Your Fleet</h4>
                  {renderGrid(myBoard, false)}
                </div>
                <div>
                  <h4>Enemy Waters</h4>
                  {renderGrid(enemyBoard, true)}
                </div>
              </div>
              <div className="stats-container" style={{ marginTop: '10px', color: '#fff' }}>
                <p>Shots Fired: {gameStats.shotsFired}</p>
                <p>Hits: {gameStats.hits}</p>
                <p>Misses: {gameStats.misses}</p>
              </div>
            </div>
          )}

          {/* Game Finished Screen */}
          {gameState === 'finished' && (
            <div className="finished-screen" style={{ height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'rgba(0, 0, 0, 0.7)', color: '#fff', padding: '20px', borderRadius: '10px' }}>
              <h2>Game Over</h2>
              <p>{message}</p>
              {showConfetti && Confetti}
              <button
                onClick={() => {
                  console.log('Returning to splash screen');
                  setGameState('splash');
                  setGameId(null);
                  setPlayerId(null);
                  setLightningAddress('');
                  setBetAmount('300');
                  setPayoutAmount('500');
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
                  setTurn(null);
                  setMessage('');
                  setTransactionMessage('');
                  setCannonFire(null);
                  setIsPlacementConfirmed(false);
                  setIsDragging(null);
                  setDragPosition({ x: 0, y: 0 });
                  setTimeLeft(PLACEMENT_TIME);
                  setTimerActive(false);
                  setLightningInvoice(null);
                  setHostedInvoiceUrl(null);
                  setPlacementSaved(false);
                  setIsWaitingForPayment(false);
                  setIsOpponentThinking(false);
                  setPaymentTimer(PAYMENT_TIMEOUT);
                  setShowConfetti(false);
                  setGameStats({ shotsFired: 0, hits: 0, misses: 0 });
                }}
                className="join-button"
                style={{ padding: '15px 30px', fontSize: '1.2em', marginTop: '20px' }}
              >
                Return to Menu
              </button>
            </div>
          )}

          {/* Transaction Message */}
          {transactionMessage && (
            <div className="transaction-message" style={{ position: 'fixed', bottom: '10px', left: '50%', transform: 'translateX(-50%)', background: '#333', color: '#fff', padding: '10px 20px', borderRadius: '5px', zIndex: 1000 }}>
              {transactionMessage}
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
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

// Updated logo URL to a more reliable placeholder
const LOGO_URL = 'https://placehold.co/150x150?text=Thunderfleet+Logo';

// Game constants defining the grid size and timing constraints
const GRID_COLS = 9; // Number of columns in the game grid
const GRID_ROWS = 7; // Number of rows in the game grid
const GRID_SIZE = GRID_COLS * GRID_ROWS; // Total number of cells in the grid
const PLACEMENT_TIME = 30; // Time in seconds for ship placement phase
const PAYMENT_TIMEOUT = 300; // Payment verification timeout in seconds (5 minutes)
const JOIN_GAME_TIMEOUT = 20000; // Timeout for joinGame response in milliseconds (20 seconds, increased for stability)
const CONFETTI_COUNT = 50; // Number of confetti pieces (reduced for performance)

// Bet options aligned with server.js for consistency
const BET_OPTIONS = [
  { amount: 300, winnings: 500, fee: 100 },   // Bet: 300 sats, Win: 500 sats, Fee: 100 sats
  { amount: 500, winnings: 800, fee: 200 },   // Bet: 500 sats, Win: 800 sats, Fee: 200 sats
  { amount: 1000, winnings: 1700, fee: 300 }, // Bet: 1000 sats, Win: 1700 sats, Fee: 300 sats
  { amount: 5000, winnings: 8000, fee: 2000 }, // Bet: 5000 sats, Win: 8000 sats, Fee: 2000 sats
  { amount: 10000, winnings: 17000, fee: 3000 }, // Bet: 10000 sats, Win: 17000 sats, Fee: 3000 sats
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
  }, [isSoundEnabled, audio]);
};

const App = () => {
  console.log(`App component rendered at ${new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })} on Thursday, June 12, 2025, 07:44 PM IST`);

  // State variables for managing game state and UI
  const [gameState, setGameState] = useState('splash');
  const [gameId, setGameId] = useState(null);
  const [playerId, setPlayerId] = useState(null);
  const [lightningAddress, setLightningAddress] = useState('');
  const [betAmount, setBetAmount] = useState(null);
  const [payoutAmount, setPayoutAmount] = useState(null);
  const [platformFee, setPlatformFee] = useState(null);
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
  const [isDragging, setIsDragging] = useState(false);
  const [cellSize, setCellSize] = useState(40);
  const [timeLeft, setTimeLeft] = useState(PLACEMENT_TIME);
  const [timerActive, setTimerActive] = useState(false);
  const [lightningInvoice, setLightningInvoice] = useState(null);
  const [hostedInvoiceUrl, setHostedInvoiceUrl] = useState(null);
  const [showQR, setShowQR] = useState(false);
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
  const [paymentLogs, setPaymentLogs] = useState([]);
  const [showPaymentLogs, setShowPaymentLogs] = useState(false);
  const [socket, setSocket] = useState(null);
  const [isLoading, setIsLoading] = useState(false); // Added isLoading state for Join Game button

  // Add a state for initial app loading
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

  // Log gameState changes for debugging
  useEffect(() => {
    console.log('Current gameState:', gameState);
  }, [gameState]);

  // Simulate app loading (e.g., for assets, initial checks)
  useEffect(() => {
    console.log('App useEffect: Simulating app loading');
    const timer = setTimeout(() => {
      setIsAppLoaded(true);
      console.log('App loaded, setting isAppLoaded to true');
    }, 1000); // 1-second delay to ensure initial assets load
    return () => clearTimeout(timer);
  }, []);

  // Function to fetch payment logs from the server
  const fetchPaymentLogs = useCallback(async () => {
    try {
      const response = await fetch('https://thunderfleet-backend.onrender.com/logs');
      const text = await response.text();
      const logs = text.split('\n').filter(line => line.trim()).slice(-5); // Get last 5 logs
      setPaymentLogs(logs);
      console.log('Fetched payment logs:', logs);
    } catch (err) {
      console.error('Error fetching payment logs:', err.message);
      setPaymentLogs(['Error fetching payment logs']);
    }
  }, []);

  // Initialize Socket.IO connection once on mount
  useEffect(() => {
    const newSocket = io('https://thunderfleet-backend.onrender.com', {
      transports: ['polling'], // Match backend by forcing polling
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
        setMessage(`Failed to connect to server: ${error.message}`);
        setIsWaitingForPayment(false);
        setPayButtonLoading(false);
        setIsLoading(false); // Reset loading state
        setGameState('join');
        setLightningInvoice(null);
        setHostedInvoiceUrl(null);
        setShowQR(false);
      },
      disconnect: () => {
        clearTimeout(timeout);
        console.log('[Frontend] Disconnected from server');
        setIsSocketConnected(false);
        setMessage('Disconnected from server. Please try again.');
        setIsWaitingForPayment(false);
        setPayButtonLoading(false);
        setIsLoading(false); // Reset loading state
        setGameState('join');
        setLightningInvoice(null);
        setHostedInvoiceUrl(null);
        setShowQR(false);
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
        setHostedInvoiceUrl(hostedInvoiceUrl);
        setShowQR(true);
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
        setShowQR(false);
        setMessage('Payment verified! Estimated wait time: 10-25 seconds');
        fetchPaymentLogs();
      },
      error: ({ message }) => {
        console.log('Received error from server:', message);
        clearTimeout(joinGameTimeoutRef.current);
        setMessage(`Error: ${message}`);
        setIsWaitingForPayment(false);
        setPayButtonLoading(false);
        setIsLoading(false); // Reset loading state
        setPaymentTimer(PAYMENT_TIMEOUT);
        setGameState('join');
        setLightningInvoice(null);
        setHostedInvoiceUrl(null);
        setShowQR(false);
      },
      matchmakingTimer: ({ message }) => {
        console.log('Received matchmaking timer update:', message);
        setMessage(message);
      },
      matchedWithBot: ({ message }) => {
        console.log('Matched with bot:', message);
        setMessage(message);
      },
      startPlacing: () => {
        console.log('Starting ship placement phase');
        setGameState('placing');
        setMessage('Place your ships! Tap to rotate, drag to position.');
        setIsPlacementConfirmed(false);
        setPlacementSaved(false);
        setShips(prev =>
          prev.map(ship => ({
            ...ship,
            positions: [],
            horizontal: true,
            placed: false,
          }))
        );
        setMyBoard(Array(GRID_SIZE).fill('water'));
        setShipCount(0);
        setGameStats({ shotsFired: 0, hits: 0, misses: 0 });
      },
      placementSaved: () => {
        console.log('Placement saved on server');
        setIsPlacementConfirmed(true);
        setPlacementSaved(true);
        setMessage('Placement saved! Waiting for opponent...');
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
        }
        setIsOpponentThinking(false);
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
        fetchPaymentLogs();
        if (message.includes('You won')) {
          setShowConfetti(true);
          playWinSound();
        } else {
          playLoseSound();
        }
      },
      transaction: ({ message }) => {
        console.log('Transaction message:', message);
        setTransactionMessage(message);
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
  }, [fetchPaymentLogs, playHitSound, playMissSound, playPlaceSound, playWinSound, playLoseSound]);

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
      positions: ship.positions,
      horizontal: ship.horizontal,
    }));
    socket.emit('updateBoard', { gameId, playerId: socket?.id, placements });
    console.log('Server board update emitted:', placements);
  }, [gameId, gameState, isPlacementConfirmed, ships, socket]);

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

    setMyBoard(newBoard);
    setShips(newShips);
    const placedCount = newShips.filter(s => s.placed).length;
    setShipCount(placedCount);
    if (successfulPlacements === 0) {
      setMessage('Unable to place unplaced ships due to space constraints.');
      console.log('No ships were placed during randomization');
    } else {
      setMessage(`${successfulPlacements} ship(s) randomized! ${placedCount}/5 placed.`);
      console.log(`${successfulPlacements} ships randomized, total placed: ${placedCount}`);
    }
    playPlaceSound();
    updateServerBoard(newShips);
  }, [isPlacementConfirmed, ships, myBoard, playPlaceSound, updateServerBoard]);

  // Function to save ship placement to the server
  const saveShipPlacement = useCallback(() => {
    if (placementSaved || !socket) {
      console.log('Placement already saved or no socket, cannot save again');
      return;
    }
    const unplacedShips = ships.filter(ship => !ship.placed);
    if (unplacedShips.length > 0) {
      console.log(`Randomizing ${unplacedShips.length} unplaced ships before saving`);
      randomizeUnplacedShips();
    }

    setPlacementSaved(true);
    setIsPlacementConfirmed(true);
    setMessage('Placement saved! Waiting for opponent...');
    console.log('Ship placement confirmed and saved');

    const placements = ships.map(ship => ({
      name: ship.name,
      positions: ship.positions,
      horizontal: ship.horizontal,
    }));

    socket.emit('savePlacement', { gameId, placements });
    console.log('Emitted savePlacement to server:', placements);
    playPlaceSound();
  }, [placementSaved, ships, gameId, playPlaceSound, randomizeUnplacedShips, socket]);

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
      setIsLoading(false); // Reset loading state
      setMessage('Payment timed out after 5 minutes. Please try again.');
      setGameState('join');
      setLightningInvoice(null);
      setHostedInvoiceUrl(null);
      setShowQR(false);
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

  // Effect to fetch payment logs when entering the join state
  useEffect(() => {
    if (gameState === 'join') {
      fetchPaymentLogs();
    }
  }, [gameState, fetchPaymentLogs]);

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

  // Function to select a bet amount
  const selectBet = useCallback((bet, payout, fee) => {
    console.log('Selecting bet:', { bet, payout, fee });
    setBetAmount(bet);
    setPayoutAmount(payout);
    setPlatformFee(fee);
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

    const sanitizedAddress = lightningAddress.trim().toLowerCase();
    if (!sanitizedAddress.includes('@')) {
      setMessage('Invalid Lightning address format');
      console.log('Validation failed: Invalid Lightning address format');
      return;
    }

    setIsLoading(true); // Set loading state
    socket.emit('joinGame', { lightningAddress, betAmount: parseInt(betAmount) }, () => {
      console.log('Join game callback triggered');
    });

    joinGameTimeoutRef.current = setTimeout(() => {
      console.error('joinGame timed out');
      setMessage('Failed to join game: Server did not respond. Please try again.');
      setGameState('join');
      setIsWaitingForPayment(false);
      setPayButtonLoading(false);
      setIsLoading(false); // Reset loading state
      setLightningInvoice(null);
      setHostedInvoiceUrl(null);
      setShowQR(false);
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
      setMessage('No payment URL available.');
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
    setShowQR(false);
    setIsWaitingForPayment(false);
    setPayButtonLoading(false);
    setIsLoading(false); // Reset loading state
    setPaymentTimer(PAYMENT_TIMEOUT);
  }, [socket, gameId, playerId]);

  // Function to toggle ship orientation
  const toggleOrientation = useCallback((shipIndex) => {
    if (isPlacementConfirmed || !ships[shipIndex].placed) {
      console.log(`Cannot toggle orientation for ship ${shipIndex}: Placement confirmed or ship not placed`);
      return;
    }

    setShips(prev => {
      const updated = [...prev];
      const ship = updated[shipIndex];
      const newHorizontal = !ship.horizontal;

      console.log(`Toggling orientation for ${ship.name} to ${newHorizontal ? 'horizontal' : 'vertical'}`);
      const newPositions = calculateShipPositions(
        { ...ship, horizontal: newHorizontal },
        ship.positions[0].toString()
      );

      if (newPositions) {
        setMyBoard(prevBoard => {
          const newBoard = [...prevBoard];
          ship.positions.forEach(pos => (newBoard[pos] = 'water'));
          newPositions.forEach(pos => (newBoard[pos] = 'ship'));
          console.log(`Updated board for ${ship.name} with new positions:`, newPositions);
          return newBoard;
        });

        updated[shipIndex] = { ...ship, horizontal: newHorizontal, positions: newPositions };
        playPlaceSound();
        updateServerBoard(updated);
        setMessage(`${ship.name} rotated successfully!`);
      } else {
        setMessage('Cannot rotate: Ship would go out of bounds or overlap another ship.');
        console.log(`Failed to rotate ${ship.name}: Invalid position`);
      }

      return updated;
    });
  }, [isPlacementConfirmed, ships, calculateShipPositions, playPlaceSound, updateServerBoard]);

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

    setMyBoard(newBoard);
    setShips(newShips);
    const placedCount = newShips.filter(s => s.placed).length;
    setShipCount(placedCount);
    if (successfulPlacements < SHIP_CONFIG.length) {
      setMessage('Some ships couldn’t be placed. Adjust manually or try again.');
      console.log(`Randomized ${successfulPlacements} out of ${SHIP_CONFIG.length} ships`);
    } else {
      setMessage('Ships randomized! Drag to reposition or Save Placement.');
      console.log('All ships successfully randomized');
    }
    playPlaceSound();
    updateServerBoard(newShips);
  }, [isPlacementConfirmed, ships, playPlaceSound, updateServerBoard]);

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
            return (
              <div
                key={index}
                className={`cell ${cell} ${isDragging ? 'drag-active' : ''}`}
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
                  backgroundColor: cell === 'water' ? '#1e90ff' : cell === 'ship' ? '#888' : cell === 'hit' ? '#ff4500' : '#333',
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
                  style={{
                    position: 'absolute',
                    top: Math.floor(ship.positions[0] / GRID_COLS) * cellSize + 2,
                    left: (ship.positions[0] % GRID_COLS) * cellSize + 2,
                    width: ship.horizontal ? ship.size * cellSize - 4 : cellSize - 4,
                    height: ship.horizontal ? cellSize - 4 : ship.size * cellSize - 4,
                    backgroundImage: `url(${ship.horizontal ? ship.horizontalImg : ship.verticalImg})`,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                    opacity: isPlacementConfirmed ? 1 : 0.8,
                    cursor: isPlacementConfirmed ? 'default' : 'grab',
                    pointerEvents: isPlacementConfirmed ? 'none' : 'auto',
                    touchAction: 'none',
                  }}
                  onClick={() => !isPlacementConfirmed && toggleOrientation(ship.id)}
                  onTouchStart={(e) => {
                    e.preventDefault();
                    if (!isPlacementConfirmed) toggleOrientation(ship.id);
                  }}
                />
              )
            );
          })}
      </div>
    );
  }, [cellSize, ships, isDragging, gameState, turn, cannonFire, isPlacementConfirmed, handleFire, toggleOrientation, socket?.id]);

  // Function to render the list of ships for placement
  const renderShipList = useCallback(() => {
    if (isPlacementConfirmed) {
      console.log('Not rendering ship list: Placement confirmed');
      return null;
    }
    console.log('Rendering ship list for placement');
    return (
      <div className="ships-list">
        {ships.map((ship, i) => (
          <div key={i} className="ship-container">
            <div className="ship-info">
              <span style={{ color: '#ffffff !important' }}>{ship.name}</span>
              <span className="ship-status" style={{ color: '#ffffff !important' }}>{ship.placed ? '✅ Placed' : '❌ Not placed'}</span>
            </div>
            <div
              className="ship"
              draggable={!isPlacementConfirmed}
              onDragStart={(e) => {
                e.dataTransfer.setData('text/plain', i.toString());
                setIsDragging(true);
                console.log(`Started dragging ${ship.name}`);
              }}
              onDragEnd={() => {
                setIsDragging(false);
                console.log(`Stopped dragging ${ship.name}`);
              }}
              onTouchStart={(e) => {
                if (isPlacementConfirmed) return;
                e.preventDefault();
                setIsDragging(true);
                const touch = e.touches[0];
                const data = { shipIndex: i, startX: touch.clientX, startY: touch.clientY };
                sessionStorage.setItem('dragData', JSON.stringify(data));
                console.log(`Touch drag started for ${ship.name}`);
              }}
              onTouchMove={(e) => {
                if (!isDragging || isPlacementConfirmed) return;
                e.preventDefault();
                console.log(`Touch moving for ${ship.name}`);
              }}
              onTouchEnd={(e) => {
                if (!isDragging || isPlacementConfirmed) return;
                e.preventDefault();
                setIsDragging(false);
                const data = JSON.parse(sessionStorage.getItem('dragData'));
                if (!data) return;
                const { shipIndex } = data;
                const touch = e.changedTouches[0];
                const gridRect = gridRef.current.getBoundingClientRect();
                const x = touch.clientX - gridRect.left;
                const y = touch.clientY - gridRect.top;
                console.log(`Touch ended for ${ship.name}, dropping at x:${x}, y:${y}`);
                handleGridDrop({ x, y, shipIndex: parseInt(shipIndex) });
              }}
              style={{
                backgroundImage: `url(${ship.horizontal ? ship.horizontalImg : ship.verticalImg})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                width: ship.horizontal ? `${ship.size * (cellSize * 0.6)}px` : `${cellSize * 0.8}px`,
                height: ship.horizontal ? `${cellSize * 0.8}px` : `${ship.size * (cellSize * 0.6)}px`,
                opacity: ship.placed ? 0.5 : 1,
                cursor: isPlacementConfirmed ? 'default' : 'grab',
                border: '2px solid #333',
                borderRadius: '4px',
                margin: '5px 0',
                touchAction: 'none'
              }}
            >
              <span className="ship-label" style={{ color: '#ffffff !important' }}>{ship.name}</span>
            </div>
            <button
              onClick={() => toggleOrientation(i)}
              onTouchStart={(e) => {
                e.preventDefault();
                toggleOrientation(i);
              }}
              className="orientation-button"
              disabled={!ship.placed || isPlacementConfirmed}
            >
              {ship.horizontal ? '↕️ Vertical' : '↔️ Horizontal'}
            </button>
          </div>
        ))}
      </div>
    );
  }, [isPlacementConfirmed, ships, cellSize, isDragging, toggleOrientation, handleGridDrop]);

  // Component to render the splash screen
  const SplashScreen = useMemo(() => {
    console.log('Rendering SplashScreen');
    return (
      <div
        className="splash-screen"
        style={{
          textAlign: 'center',
          padding: '40px',
          backgroundColor: '#0000ff !important', // Blue background for debugging
          visibility: 'visible !important',
          opacity: '1 !important',
          minHeight: '100vh'
        }}
      >
        <img
          src={LOGO_URL}
          alt="Thunderfleet Logo"
          style={{
            width: '150px',
            marginBottom: '20px',
            visibility: 'visible !important',
            opacity: '1 !important'
          }}
          onError={() => console.error('Failed to load logo image')}
        />
        <h1
          className="game-title"
          style={{
            color: '#ffffff !important',
            visibility: 'visible !important',
            opacity: '1 !important',
            fontSize: '2rem',
            marginBottom: '20px'
          }}
        >
          ⚡ Lightning Sea Battle ⚡
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
          style={{
            padding: '10px 20px',
            backgroundColor: '#3498db',
            color: '#ffffff !important',
            border: 'none',
            borderRadius: '5px',
            cursor: 'pointer',
            margin: '10px',
            visibility: 'visible !important',
            opacity: '1 !important'
          }}
        >
          Start Game
        </button>
        <div style={{ marginTop: '20px' }}>
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
            style={{
              background: '#3498db',
              marginRight: '10px',
              padding: '10px 20px',
              color: '#ffffff !important',
              border: 'none',
              borderRadius: '5px',
              cursor: 'pointer',
              visibility: 'visible !important',
              opacity: '1 !important'
            }}
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
            className="join-button"
            style={{
              background: isSoundEnabled ? '#e74c3c' : '#2ecc71',
              padding: '10px 20px',
              color: '#ffffff !important',
              border: 'none',
              borderRadius: '5px',
              cursor: 'pointer',
              visibility: 'visible !important',
              opacity: '1 !important'
            }}
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
      <div className="modal" style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        background: 'rgba(0, 0, 0, 0.8)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 1000,
      }}>
        <div className="modal-content" style={{
          background: '#fff',
          color: '#333',
          padding: '20px',
          borderRadius: '10px',
          maxWidth: '90%',
          maxHeight: '80%',
          overflowY: 'auto',
        }}>
          <h2 style={{ color: '#333 !important' }}>Terms and Conditions</h2>
          <p style={{ color: '#333 !important' }}>
            Welcome to Lightning Sea Battle! By using this application, you agree to the following terms:
          </p>
          <ul>
            <li style={{ color: '#333 !important' }}>All payments are made in Bitcoin SATS via the Lightning Network.</li>
            <li style={{ color: '#333 !important' }}>Winnings are subject to platform fees as displayed during bet selection.</li>
            <li style={{ color: '#333 !important' }}>We are not responsible for any losses due to network issues or payment failures.</li>
            <li style={{ color: '#333 !important' }}>Game results are final and determined by the server.</li>
            <li style={{ color: '#333 !important' }}>Users must be 18+ to participate.</li>
          </ul>
          <p style={{ color: '#333 !important' }}>Please contact support@thunderfleet.com for any inquiries.</p>
          <button
            onClick={() => setShowTermsModal(false)}
            onTouchStart={() => setShowTermsModal(false)}
            className="join-button"
            style={{ background: '#e74c3c' }}
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
      <div className="modal" style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        background: 'rgba(0, 0, 0, 0.8)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 1000,
      }}>
        <div className="modal-content" style={{
          background: '#fff',
          color: '#333',
          padding: '20px',
          borderRadius: '10px',
          maxWidth: '90%',
          maxHeight: '80%',
          overflowY: 'auto',
        }}>
          <h2 style={{ color: '#333 !important' }}>Privacy Policy</h2>
          <p style={{ color: '#333 !important' }}>
            At Lightning Sea Battle, we value your privacy:
          </p>
          <ul>
            <li style={{ color: '#333 !important' }}>We collect your Lightning address solely for payment processing.</li>
            <li style={{ color: '#333 !important' }}>Game data (e.g., board state, game results) is stored temporarily to facilitate gameplay.</li>
            <li style={{ color: '#333 !important' }}>We do not share your data with third parties, except as required for payment processing.</li>
            <li style={{ color: '#333 !important' }}>Payment logs are stored securely and used for transparency and dispute resolution.</li>
          </ul>
          <p style={{ color: '#333 !important' }}>Contact support@thunderfleet.com for privacy-related concerns.</p>
          <button
            onClick={() => setShowPrivacyModal(false)}
            onTouchStart={() => setShowPrivacyModal(false)}
            className="join-button"
            style={{ background: '#e74c3c' }}
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
      <div className="modal" style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        background: 'rgba(0, 0, 0, 0.8)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 1000,
      }}>
        <div className="modal-content" style={{
          background: '#fff',
          color: '#333',
          padding: '20px',
          borderRadius: '10px',
          maxWidth: '90%',
          maxHeight: '80%',
          overflowY: 'auto',
        }}>
          <h2 style={{ color: '#333 !important' }}>How to Play Lightning Sea Battle</h2>
          <p style={{ color: '#333 !important' }}>Lightning Sea Battle is a Battleship-style game with Bitcoin SATS betting:</p>
          <ol>
            <li style={{ color: '#333 !important' }}><strong>Join the Game:</strong> Enter your Lightning address and select a bet amount.</li>
            <li style={{ color: '#333 !important' }}><strong>Pay to Play:</strong> Use the QR code or payment link to pay the entry fee via Lightning Network.</li>
            <li style={{ color: '#333 !important' }}><strong>Place Your Ships:</strong> Drag and drop your ships on the grid. Tap to rotate, or use the Randomize buttons.</li>
            <li style={{ color: '#333 !important' }}><strong>Battle:</strong> Take turns firing at the enemy grid. Hit all enemy ships to win!</li>
            <li style={{ color: '#333 !important' }}><strong>Win SATS:</strong> If you win, your payout (minus platform fee) will be sent to your Lightning address.</li>
          </ol>
          <p style={{ color: '#333 !important' }}>Good luck, Captain! ⚡</p>
          <button
            onClick={() => setShowHowToPlayModal(false)}
            onTouchStart={() => setShowHowToPlayModal(false)}
            className="join-button"
            style={{ background: '#e74c3c' }}
          >
            Close
          </button>
        </div>
      </div>
    );
  }, []);

  // Component to render the payment logs modal
  const PaymentLogsModal = useMemo(() => {
    console.log('Rendering PaymentLogsModal');
    return (
      <div className="modal" style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        background: 'rgba(0, 0, 0, 0.8)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 1000,
      }}>
        <div className="modal-content" style={{
          background: '#fff',
          color: '#333',
          padding: '20px',
          borderRadius: '10px',
          maxWidth: '90%',
          maxHeight: '80%',
          overflowY: 'auto',
        }}>
          <h2 style={{ color: '#333 !important' }}>Recent Payment Logs</h2>
          {paymentLogs.length > 0 ? (
            <ul style={{ listStyleType: 'none', padding: 0 }}>
              {paymentLogs.map((log, index) => (
                <li key={index} style={{ margin: '10px 0', fontSize: '0.9rem', color: '#333 !important' }}>{log}</li>
              ))}
            </ul>
          ) : (
            <p style={{ color: '#333 !important' }}>No recent payment logs available.</p>
          )}
          <button
            onClick={() => setShowPaymentLogs(false)}
            onTouchStart={() => setShowPaymentLogs(false)}
            className="join-button"
            style={{ background: '#e74c3c' }}
          >
            Close
          </button>
        </div>
      </div>
    );
  }, [paymentLogs]);

  // Component to render the payment modal
  const PaymentModal = useMemo(() => {
    console.log('Rendering PaymentModal');
    return (
      <div className="payment-modal">
        <h3 style={{ color: '#ffffff !important' }}>⚡ Pay {betAmount} SATS to join ⚡</h3>
        <p className="winnings-info">
          Win {payoutAmount} SATS!
        </p>
        {showQR && lightningInvoice && (
          <div className="qr-container">
            <QRCodeSVG value={lightningInvoice} size={window.innerWidth < 320 ? 150 : 200} level="H" includeMargin={true} />
          </div>
        )}
        <div className="invoice-controls">
          <button onClick={() => setShowQR(!showQR)} className="qr-toggle">
            {showQR ? 'Hide QR Code' : 'Show QR Code'}
          </button>
          <button
            onClick={() => navigator.clipboard.writeText(lightningInvoice || hostedInvoiceUrl)}
            className="copy-button"
          >
            Copy Invoice
          </button>
          <button
            onClick={handlePay}
            className={`pay-button ${payButtonLoading ? 'loading' : ''}`}
            disabled={payButtonLoading}
          >
            Pay Now
          </button>
          <button onClick={handleCancelGame} className="cancel-button">
            Cancel
          </button>
        </div>
        {isWaitingForPayment && (
          <div className="payment-status">
            <p style={{ color: '#ffffff !important' }}>Waiting for payment confirmation...</p>
            <div className="timer-container">
              <div className="timer-bar">
                <div
                  className="timer-progress"
                  style={{ width: `${(paymentTimer / PAYMENT_TIMEOUT) * 100}%` }}
                ></div>
              </div>
              <div className="timer-text" style={{ color: '#ffffff !important' }}>
                Time left:{' '}
                <span className={paymentTimer <= 30 ? 'time-warning' : ''}>
                  {Math.floor(paymentTimer / 60)}:{(paymentTimer % 60).toString().padStart(2, '0')}
                </span>
              </div>
            </div>
            <div className="loading-spinner"></div>
          </div>
        )}
      </div>
    );
  }, [betAmount, payoutAmount, showQR, lightningInvoice, hostedInvoiceUrl, payButtonLoading, isWaitingForPayment, paymentTimer, handlePay, handleCancelGame]);

  // Component to render confetti animation
  const Confetti = useMemo(() => {
    console.log('Rendering Confetti');
    const confettiPieces = Array.from({ length: CONFETTI_COUNT }).map((_, i) => {
      const colors = ['#ff4500', '#2ecc71', '#3498db', '#f39c12', '#e74c3c'];
      const left = Math.random() * 100;
      const animationDelay = Math.random() * 5;
      return (
        <div
          key={i}
          className="confetti-piece"
          style={{
            left: `${left}%`,
            backgroundColor: colors[Math.floor(Math.random() * colors.length)],
            animationDelay: `${animationDelay}s`,
          }}
        />
      );
    });

    return <div className="confetti">{confettiPieces}</div>;
  }, []);

  // Component to render game statistics
  const GameStats = useMemo(() => {
    console.log('Rendering GameStats');
    return (
      <div className="game-stats" style={{ margin: '20px 0', textAlign: 'center' }}>
        <h3 style={{ color: '#ffffff !important' }}>Game Statistics</h3>
        <p style={{ color: '#ffffff !important' }}>Shots Fired: {gameStats.shotsFired}</p>
        <p style={{ color: '#ffffff !important' }}>Hits: {gameStats.hits}</p>
        <p style={{ color: '#ffffff !important' }}>Misses: {gameStats.misses}</p>
        <p style={{ color: '#ffffff !important' }}>
          Accuracy: {gameStats.shotsFired > 0 ? ((gameStats.hits / gameStats.shotsFired) * 100).toFixed(2) : 0}%
        </p>
      </div>
    );
  }, [gameStats]);

  // Function to handle drag over events on the grid
  const handleGridDragOver = useCallback((e) => {
    e.preventDefault();
    console.log('Drag over grid');
  }, []);

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
      ship.positions.forEach((pos) => (newBoard[pos] = 'water'));
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
      console.log(`Updated ship ${ship.name} with new positions:`, newPositions);
      return updated;
    });

    const newShipCount = ship.positions.length > 0 ? shipCount : shipCount + 1;
    setShipCount(newShipCount);
    setMessage(
      newShipCount === 5
        ? 'All ships placed! Click "Save Placement".'
        : `${newShipCount} of 5 ships placed.`
    );
    console.log(`Ship count updated to ${newShipCount}`);

    playPlaceSound();
    setIsDragging(false);
    if (updatedShips) updateServerBoard(updatedShips);
  }, [isPlacementConfirmed, ships, cellSize, shipCount, calculateShipPositions, playPlaceSound, updateServerBoard]);

  // Memoized bet selection UI to prevent re-renders
  const betSelection = useMemo(() => {
    console.log('Rendering betSelection');
    return (
      <div className="bet-selection">
        <label htmlFor="bet-select" style={{ color: '#ffffff !important' }}>Select Your Bet:</label>
        <select
          id="bet-select"
          value={betAmount || ""}
          onChange={(e) => {
            const selectedOption = BET_OPTIONS.find(option => option.amount === Number(e.target.value));
            if (selectedOption) {
              selectBet(selectedOption.amount, selectedOption.winnings, selectedOption.fee);
            }
          }}
        >
          <option value="" disabled>Select a bet</option>
          {BET_OPTIONS.map(option => (
            <option key={option.amount} value={option.amount}>
              Bet: {option.amount} SATS
            </option>
          ))}
        </select>
      </div>
    );
  }, [betAmount, selectBet]);

  // Default static fallback UI to ensure something always renders
  const DefaultFallbackUI = (
    <div
      style={{
        color: '#ffffff !important',
        backgroundColor: '#ff0000 !important', // Red background for debugging
        textAlign: 'center',
        padding: '20px',
        fontSize: '18px',
        minHeight: '100vh',
        visibility: 'visible !important',
        opacity: '1 !important'
      }}
    >
      <p>Thunderfleet App - Initializing...</p>
      <p>Current Time: 07:44 PM IST on Thursday, June 12, 2025</p>
      <p>If you see this for more than a few seconds, please refresh the page.</p>
      <button
        onClick={() => window.location.reload()}
        style={{
          padding: '10px 20px',
          backgroundColor: '#3498db',
          color: '#ffffff !important',
          border: 'none',
          borderRadius: '5px',
          cursor: 'pointer',
          visibility: 'visible !important',
          opacity: '1 !important'
        }}
      >
        Refresh
      </button>
    </div>
  );

  // Render the main application UI
  console.log('Rendering App UI with states - isAppLoaded:', isAppLoaded, 'isSocketConnected:', isSocketConnected, 'gameState:', gameState);

  // Show loading UI while app initializes
  if (!isAppLoaded) {
    console.log('Rendering app loading UI');
    return (
      <div
        style={{
          color: '#ffffff !important',
          backgroundColor: '#ff0000 !important', // Red background for debugging
          textAlign: 'center',
          padding: '20px',
          fontSize: '18px',
          minHeight: '100vh',
          visibility: 'visible !important',
          opacity: '1 !important'
        }}
      >
        <p>Loading Thunderfleet App... Please wait.</p>
        <p>Current Time: 07:44 PM IST on Thursday, June 12, 2025</p>
      </div>
    );
  }

  return (
    <div
      className="App"
      style={{
        backgroundColor: '#00ff00 !important', // Green background for debugging
        minHeight: '100vh',
        visibility: 'visible !important',
        opacity: '1 !important'
      }}
    >
      {showConfetti && Confetti}
      {showTermsModal && TermsModal}
      {showPrivacyModal && PrivacyModal}
      {showHowToPlayModal && HowToPlayModal}
      {showPaymentLogs && PaymentLogsModal}

      {gameState === 'splash' && SplashScreen}

      {gameState !== 'splash' && (
        <>
          <h1
            className="game-title"
            style={{
              color: '#ffffff !important',
              visibility: 'visible !important',
              opacity: '1 !important',
              fontSize: '2rem',
              textAlign: 'center',
              padding: '20px 0'
            }}
          >
            ⚡ Lightning Sea Battle ⚡
          </h1>
          <div style={{ position: 'absolute', top: '10px', right: '10px' }}>
            <button
              onClick={() => {
                console.log('Sound toggle button clicked');
                setIsSoundEnabled(!isSoundEnabled);
              }}
              onTouchStart={() => {
                console.log('Sound toggle button touched');
                setIsSoundEnabled(!isSoundEnabled);
              }}
              className="join-button"
              style={{
                background: isSoundEnabled ? '#e74c3c' : '#2ecc71',
                padding: '10px 20px',
                color: '#ffffff !important',
                border: 'none',
                borderRadius: '5px',
                cursor: 'pointer',
                visibility: 'visible !important',
                opacity: '1 !important'
              }}
            >
              {isSoundEnabled ? '🔇 Mute' : '🔊 Unmute'}
            </button>
          </div>
          {message && (
            <p
              className={`message ${message.includes('Failed to connect') || message.includes('Disconnected') ? 'error' : ''}`}
              style={{
                color: '#ffffff !important',
                visibility: 'visible !important',
                opacity: '1 !important',
                textAlign: 'center',
                margin: '10px 0'
              }}
            >
              {message}
            </p>
          )}
          {gameState === 'playing' && isOpponentThinking && (
            <div className="waiting">
              <div className="loading-spinner"></div>
              <p
                className="waiting-text"
                style={{
                  color: '#ffffff !important',
                  visibility: 'visible !important',
                  opacity: '1 !important'
                }}
              >
                Opponent is thinking...
              </p>
            </div>
          )}
          {transactionMessage && (
            <p
              className="transaction"
              style={{
                color: '#f39c12 !important',
                visibility: 'visible !important',
                opacity: '1 !important',
                textAlign: 'center'
              }}
            >
              {transactionMessage}
            </p>
          )}

          {gameState === 'join' && (
            <div className="join">
              <h2
                style={{
                  color: '#ffffff !important',
                  visibility: 'visible !important',
                  opacity: '1 !important'
                }}
              >
                Select Your Bet
              </h2>
              {betSelection}
              {betAmount && (
                <p
                  className="winnings-info"
                  style={{
                    color: '#2ecc71 !important',
                    visibility: 'visible !important',
                    opacity: '1 !important'
                  }}
                >
                  Win: {payoutAmount} SATS (Platform Fee: {platformFee} SATS)
                </p>
              )}

              <input
                type="text"
                placeholder="Enter your Lightning address (e.g., player@your-wallet.com)"
                value={lightningAddress}
                onChange={(e) => {
                  console.log('Lightning address input changed:', e.target.value);
                  setLightningAddress(e.target.value);
                }}
                className="lightning-input"
                style={{
                  visibility: 'visible !important',
                  opacity: '1 !important',
                  padding: '10px',
                  margin: '10px',
                  borderRadius: '5px',
                  border: 'none'
                }}
              />
              <button
                onClick={() => handleJoinGame()}
                onTouchStart={() => handleJoinGame()}
                className="join-button"
                disabled={!isSocketConnected || !betAmount || !lightningAddress || isLoading}
                style={{
                  padding: '10px 20px',
                  backgroundColor: '#3498db',
                  color: '#ffffff !important',
                  border: 'none',
                  borderRadius: '5px',
                  cursor: 'pointer',
                  margin: '10px',
                  visibility: 'visible !important',
                  opacity: '1 !important'
                }}
              >
                Join Game {isLoading && <span className="loading-spinner"></span>}
              </button>
              <button
                onClick={() => {
                  console.log('View Payment Logs button clicked');
                  fetchPaymentLogs();
                  setShowPaymentLogs(true);
                }}
                onTouchStart={() => {
                  console.log('View Payment Logs button touched');
                  fetchPaymentLogs();
                  setShowPaymentLogs(true);
                }}
                className="join-button"
                style={{
                  background: '#f39c12',
                  padding: '10px 20px',
                  color: '#ffffff !important',
                  border: 'none',
                  borderRadius: '5px',
                  cursor: 'pointer',
                  margin: '10px',
                  visibility: 'visible !important'
                  opacity: '1 !important'
                }}
              >
                View Payment Logs
              </button>
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
                style={{
                  background: '#3498db',
                  padding: '10px 20px',
                  color: '#ffffff !important',
                  border: 'none',
                  borderRadius: '5px',
                  cursor: 'pointer',
                  margin: '10px',
                  visibility: 'visible !important',
                  opacity: '1 !important'
                }}
              >
                How to Play
              </button>
            </div>
          )}

          {(gameState === 'waiting' || (gameState === 'join' && lightningInvoice)) && PaymentModal}

          {gameState === 'placing' && (
            <div className="placing">
              <h2
                style={{
                  color: '#ffffff !important',
                  visibility: 'visible !important',
                  opacity: '1 !important'
                }}
              >
                Place Your Ships
              </h2>
              <div className="timer-container">
                <div className="timer-bar">
                  <div
                    className="timer-progress"
                    style={{ width: `${(timeLeft / PLACEMENT_TIME) * 100}%` }}
                  ></div>
                </div>
                <div
                  className="timer-text"
                  style={{
                    color: '#ffffff !important',
                    visibility: 'visible !important',
                    opacity: '1 !important'
                  }}
                >
                  Time left:{' '}
                  <span className={timeLeft <= 10 ? 'time-warning' : ''}>
                    {timeLeft} seconds
                  </span>
                </div>
              </div>
              <div
                onDragOver={handleGridDragOver}
                onDrop={handleGridDrop}
                style={{
                  display: 'flex',
                  justifyContent: 'center',
                  margin: '20px 0',
                  visibility: 'visible !important',
                  opacity: '1 !important'
                }}
              >
                {renderGrid(myBoard, false)}
              </div>
              {renderShipList()}
              <div className="placement-controls">
                <button
                  onClick={randomizeShips}
                  onTouchStart={(e) => {
                    e.preventDefault();
                    randomizeShips();
                  }}
                  className="placement-button"
                  disabled={isPlacementConfirmed}
                >
                  Randomize All
                </button>
                <button
                  onClick={randomizeUnplacedShips}
                  onTouchStart={(e) => {
                    e.preventDefault();
                    randomizeUnplacedShips();
                  }}
                  className="placement-button"
                  disabled={isPlacementConfirmed}
                >
                  Randomize Unplaced
                </button>
                <button
                  onClick={clearBoard}
                  onTouchStart={(e) => {
                    e.preventDefault();
                    clearBoard();
                  }}
                  className="placement-button"
                  disabled={isPlacementConfirmed}
                >
                  Clear Board
                </button>
                <button
                  onClick={saveShipPlacement}
                  onTouchStart={(e) => {
                    e.preventDefault();
                    saveShipPlacement();
                  }}
                  className="placement-button save"
                  disabled={isPlacementConfirmed || shipCount < 5}
                >
                  Save Placement
                </button>
              </div>
            </div>
          )}

          {gameState === 'playing' && (
            <div className="playing">
              <h2
                style={{
                  color: '#ffffff !important',
                  visibility: 'visible !important',
                  opacity: '1 !important'
                }}
              >
                Battle Phase
              </h2>
              <div className="boards">
                <div className="board-section">
                  <h3
                    style={{
                      color: '#ffffff !important',
                      visibility: 'visible !important',
                      opacity: '1 !important'
                    }}
                  >
                    Your Board
                  </h3>
                  {renderGrid(myBoard, false)}
                </div>
                <div className="board-section">
                  <h3
                    style={{
                      color: '#ffffff !important',
                      visibility: 'visible !important',
                      opacity: '1 !important'
                    }}
                  >
                    Enemy Board
                  </h3>
                  {renderGrid(enemyBoard, true)}
                </div>
              </div>
              {GameStats}
            </div>
          )}

          {gameState === 'finished' && (
            <div className="finished">
              <h2
                style={{
                  color: '#ffffff !important',
                  visibility: 'visible !important',
                  opacity: '1 !important'
                }}
              >
                Game Over
              </h2>
              {GameStats}
              <div className="boards">
                <div className="board-section">
                  <h3
                    style={{
                      color: '#ffffff !important',
                      visibility: 'visible !important',
                      opacity: '1 !important'
                    }}
                  >
                    Your Board
                  </h3>
                  {renderGrid(myBoard, false)}
                </div>
                <div className="board-section">
                  <h3
                    style={{
                      color: '#ffffff !important',
                      visibility: 'visible !important',
                      opacity: '1 !important'
                    }}
                  >
                    Enemy Board
                  </h3>
                  {renderGrid(enemyBoard, true)}
                </div>
              </div>
              <button
                onClick={() => {
                  console.log('Play Again button clicked');
                  setGameState('join');
                  setMessage('');
                  setTransactionMessage('');
                  setShowConfetti(false);
                  setGameStats({ shotsFired: 0, hits: 0, misses: 0 });
                  setMyBoard(Array(GRID_SIZE).fill('water'));
                  setEnemyBoard(Array(GRID_SIZE).fill('water'));
                  setShips(SHIP_CONFIG.map((ship, index) => ({
                    ...ship,
                    id: index,
                    positions: [],
                    horizontal: true,
                    placed: false,
                  })));
                  setShipCount(0);
                  setBetAmount(null);
                  setPayoutAmount(null);
                  setPlatformFee(null);
                  setLightningAddress('');
                  setLightningInvoice(null);
                  setHostedInvoiceUrl(null);
                  setShowQR(false);
                  setIsWaitingForPayment(false);
                  setPaymentTimer(PAYMENT_TIMEOUT);
                }}
                onTouchStart={() => {
                  console.log('Play Again button touched');
                  setGameState('join');
                  setMessage('');
                  setTransactionMessage('');
                  setShowConfetti(false);
                  setGameStats({ shotsFired: 0, hits: 0, misses: 0 });
                  setMyBoard(Array(GRID_SIZE).fill('water'));
                  setEnemyBoard(Array(GRID_SIZE).fill('water'));
                  setShips(SHIP_CONFIG.map((ship, index) => ({
                    ...ship,
                    id: index,
                    positions: [],
                    horizontal: true,
                    placed: false,
                  })));
                  setShipCount(0);
                  setBetAmount(null);
                  setPayoutAmount(null);
                  setPlatformFee(null);
                  setLightningAddress('');
                  setLightningInvoice(null);
                  setHostedInvoiceUrl(null);
                  setShowQR(false);
                  setIsWaitingForPayment(false);
                  setPaymentTimer(PAYMENT_TIMEOUT);
                }}
                className="join-button"
                style={{
                  background: '#2ecc71',
                  padding: '10px 20px',
                  color: '#ffffff !important',
                  border: 'none',
                  borderRadius: '5px',
                  cursor: 'pointer',
                  margin: '10px',
                  visibility: 'visible !important',
                  opacity: '1 !important'
                }}
              >
                Play Again
              </button>
              <button
                onClick={() => {
                  console.log('View Payment Logs button clicked');
                  fetchPaymentLogs();
                  setShowPaymentLogs(true);
                }}
                onTouchStart={() => {
                  console.log('View Payment Logs button touched');
                  fetchPaymentLogs();
                  setShowPaymentLogs(true);
                }}
                className="join-button"
                style={{
                  background: '#f39c12',
                  padding: '10px 20px',
                  color: '#ffffff !important',
                  border: 'none',
                  borderRadius: '5px',
                  cursor: 'pointer',
                  margin: '10px',
                  visibility: 'visible !important',
                  opacity: '1 !important'
                }}
              >
                View Payment Logs
              </button>
            </div>
          )}
        </>
      )}

      <footer
        style={{
          padding: '20px',
          textAlign: 'center',
          color: '#ffffff !important',
          visibility: 'visible !important',
          opacity: '1 !important'
        }}
      >
        <p style={{ margin: '5px 0', color: '#ffffff !important' }}>
          © 2025 Thunderfleet. All rights reserved.
        </p>
        <p style={{ margin: '5px 0' }}>
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              console.log('Terms & Conditions link clicked');
              setShowTermsModal(true);
            }}
            style={{ color: '#3498db !important', textDecoration: 'none' }}
          >
            Terms & Conditions
          </a>{' '}
          |{' '}
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              console.log('Privacy Policy link clicked');
              setShowPrivacyModal(true);
            }}
            style={{ color: '#3498db !important', textDecoration: 'none' }}
          >
            Privacy Policy
          </a>
        </p>
        <p style={{ margin: '5px 0', color: '#ffffff !important' }}>
          Current Time: 07:49 PM IST on Thursday, June 12, 2025
        </p>
      </footer>
    </div>
  );
};

export default App;
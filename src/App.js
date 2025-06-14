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

// Import the new logo
import logo from './assets/logo.png';

// Game constants defining the grid size and timing constraints
const GRID_COLS = 9; // Number of columns in the game grid
const GRID_ROWS = 7; // Number of rows in the game grid
const GRID_SIZE = GRID_COLS * GRID_ROWS; // Total number of cells in the grid
const PLACEMENT_TIME = 30; // Time in seconds for ship placement phase
const PAYMENT_TIMEOUT = 300; // Payment verification timeout in seconds (5 minutes)
const JOIN_GAME_TIMEOUT = 20000; // Timeout for joinGame response in milliseconds (20 seconds, increased for stability)
const CONFETTI_COUNT = 50; // Number of confetti pieces (reduced for performance)

// Bet options aligned with server.js for consistency (used in dropdown now)
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
  }, [isSoundEnabled, audio, src]);
};

const App = () => {
  console.log(`App component rendered at ${new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })}`);

  // State variables for managing game state and UI
  const [gameState, setGameState] = useState('splash');
  const [gameId, setGameId] = useState(null);
  const [playerId, setPlayerId] = useState(null);
  const [lightningAddress, setLightningAddress] = useState('');
  const [betAmount, setBetAmount] = useState('300'); // Default bet amount for dropdown
  const [payoutAmount, setPayoutAmount] = useState('500'); // Default payout amount
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

  // Function to fetch payment logs from the server
  const fetchPaymentLogs = useCallback(async () => {
    try {
      const response = await fetch('https://thunderfleet-backend.onrender.com/logs');
      const text = await response.text();
      const logs = text.split('\n').filter(line => line.trim()).slice(-5);
      setPaymentLogs(logs);
      console.log('Fetched payment logs:', logs);
    } catch (err) {
      console.error('Error fetching payment logs:', err.message);
      setPaymentLogs(['Error fetching payment logs']);
    }
  }, []);

  // Initialize Socket.IO connection
  useEffect(() => {
    const newSocket = io('https://thunderfleet-backend.onrender.com', {
      transports: ['polling'],
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
        setHostedInvoiceUrl(hostedInvoiceUrl || null); // Fallback to null if missing
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
        setMessage('Payment verified! Estimated wait time: 10-25 seconds');
        fetchPaymentLogs();
      },
      error: ({ message }) => {
        console.log('Received error from server:', message);
        clearTimeout(joinGameTimeoutRef.current);
        setMessage(`Error: ${message}. Click Retry to try again.`);
        setIsWaitingForPayment(false);
        setPayButtonLoading(false);
        setIsLoading(false);
        setPaymentTimer(PAYMENT_TIMEOUT);
        setLightningInvoice(null);
        setHostedInvoiceUrl(null);
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
            const ShotBoard = [...prev];
            ShotBoard[position] = hit ? 'hit' : 'miss';
            return ShotBoard;
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
  }, [fetchPaymentLogs, playHitSound, playMissSound, playPlaceSound, playWinSound, playLoseSound, betAmount]);

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

    const sanitizedAddress = lightningAddress.trim().toLowerCase();
    if (!sanitizedAddress.includes('@')) {
      setMessage('Invalid Lightning address format');
      console.log('Validation failed: Invalid Lightning address format');
      return;
    }

    setIsLoading(true);
    socket.emit('joinGame', { lightningAddress, betAmount: parseInt(betAmount) }, () => {
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
  }, [cellSize, ships, isDragging, gameState, turn, cannonFire, isPlacementConfirmed, handleFire, toggleOrientation, socket]);

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

  // Function to handle drag over events on the grid
  const handleGridDragOver = useCallback((e) => {
    e.preventDefault();
    console.log('Drag over grid');
  }, []);

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
              <span style={{ color: '#ffffff' }}>{ship.name}</span>
              <span className="ship-status" style={{ color: '#ffffff' }}>{ship.placed ? '✅ Placed' : '❌ Not placed'}</span>
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
              <span className="ship-label" style={{ color: '#ffffff' }}>{ship.name}</span>
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
      <div className="splash-screen">
        <img
          src={logo}
          alt="Thunderfleet Logo"
          className="game-logo"
          onError={() => console.error('Failed to load logo image')}
        />
        <h1 className="game-title">
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
            <li><strong>Join the Game:</strong> Enter your Lightning address and select a bet amount to join a game.</li>
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
            onClick={handlePay}
            className={`pay-button ${payButtonLoading ? 'loading' : ''}`}
            disabled={!hostedInvoiceUrl || payButtonLoading}
          >
            {payButtonLoading ? 'Loading...' : 'Pay Now'}
          </button>
          <button onClick={handleCancelGame} className="cancel-button">
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
                  {Math.floor(paymentTimer / 60)}:{(paymentTimer % 60).toString().padStart(2, '0')}
                </span>
              </div>
            </div>
            <div className="loading-spinner"></div>
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
            onClick={handleReconnect}
            onTouchStart={handleReconnect}
            className="join-button"
          >
            Retry Connection
          </button>
        )}
      </div>
    );
  }, [isSocketConnected, handleReconnect]);

  // Component to render payment logs modal
  const PaymentLogsModal = useMemo(() => {
    console.log('Rendering PaymentLogsModal');
    return (
      <div className="modal">
        <div className="modal-content">
          <h2>Recent Payment Logs</h2>
          {paymentLogs.length > 0 ? (
            <ul>
              {paymentLogs.map((log, index) => (
                <li key={index}>{log}</li>
              ))}
            </ul>
          ) : (
            <p>No payment logs available.</p>
          )}
          <button
            onClick={() => setShowPaymentLogs(false)}
            onTouchStart={() => setShowPaymentLogs(false)}
            className="join-button"
          >
            Close
          </button>
        </div>
      </div>
    );
  }, [paymentLogs]);

  // Render the main app UI
  return (
    <div className="App">
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
              <input
                type="text"
                placeholder="Lightning Address (e.g., user@domain)"
                value={lightningAddress}
                onChange={(e) => {
                  setLightningAddress(e.target.value);
                  console.log('Lightning address updated:', e.target.value);
                }}
              />
              <div className="bet-selection">
                <label htmlFor="bet-amount">Select Bet Amount (Sats): </label>
                <select id="bet-amount" value={betAmount} onChange={selectBet}>
                  {BET_OPTIONS.map((option, index) => (
                    <option key={index} value={option.amount}>
                      {option.amount} SATS (Win {option.winnings} SATS, Fee: {option.fee} SATS)
                    </option>
                  ))}
                </select>
              </div>
              <button
                onClick={handleJoinGame}
                onTouchStart={handleJoinGame}
                className="join-button"
                disabled={isLoading}
              >
                {isLoading ? 'Joining...' : 'Join Game'}
              </button>
              <div className="legal-notice">
                By playing game you agree to our 
                <a href="/terms-and-conditions" target="_blank" rel="noopener noreferrer"> Terms and Conditions </a>
                and 
                <a href="/privacy-policy" target="_blank" rel="noopener noreferrer"> Privacy Policy</a>.
              </div>
              <p>{message}</p>
              <button
                onClick={() => setShowPaymentLogs(true)}
                onTouchStart={() => setShowPaymentLogs(true)}
                className="join-button payment-logs-button"
              >
                View Payment Logs
              </button>
            </div>
          )}

          {/* Waiting for Payment Screen */}
          {gameState === 'waiting' && (
            <div className="waiting-screen">
              {PaymentModal}
              {!isLoading && (
                <button
                  onClick={handleJoinGame}
                  onTouchStart={handleJoinGame}
                  className="join-button"
                >
                  Retry
                </button>
              )}
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
              <div
                onDrop={handleGridDrop}
                onDragOver={handleGridDragOver}
                onTouchEnd={(e) => {
                  if (!isDragging) return;
                  e.preventDefault();
                  const touch = e.changedTouches[0];
                  const gridRect = gridRef.current.getBoundingClientRect();
                  const x = touch.clientX - gridRect.left;
                  const y = touch.clientY - gridRect.top;
                  const data = JSON.parse(sessionStorage.getItem('dragData'));
                  if (data) {
                    handleGridDrop({ x, y, shipIndex: parseInt(data.shipIndex) });
                  }
                }}
              >
                {renderGrid(myBoard, false)}
              </div>
              {renderShipList()}
              <div className="action-buttons">
                <button
                  onClick={randomizeShips}
                  onTouchStart={randomizeShips}
                  className="action-button"
                  disabled={isPlacementConfirmed}
                >
                  Randomize
                </button>
                <button
                  onClick={randomizeUnplacedShips}
                  onTouchStart={randomizeUnplacedShips}
                  className="action-button place-remaining"
                  disabled={isPlacementConfirmed}
                >
                  Place Remaining
                </button>
                <button
                  onClick={clearBoard}
                  onTouchStart={clearBoard}
                  className="action-button clear-board"
                  disabled={isPlacementConfirmed}
                >
                  Clear Board
                </button>
                <button
                  onClick={saveShipPlacement}
                  onTouchStart={saveShipPlacement}
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
                onClick={() => {
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
                onTouchStart={() => {
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
              <button
                onClick={() => setShowPaymentLogs(true)}
                onTouchStart={() => setShowPaymentLogs(true)}
                className="join-button payment-logs-button"
              >
                View Payment Logs
              </button>
              {Confetti}
            </div>
          )}

          {/* Modals */}
          {showTermsModal && TermsModal}
          {showPrivacyModal && PrivacyModal}
          {showHowToPlayModal && HowToPlayModal}
          {showPaymentLogs && PaymentLogsModal}
        </>
      )}
    </div>
  );
};

export default App;
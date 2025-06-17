import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import io from 'socket.io-client';
import { QRCodeSVG } from 'qrcode.react';
import './Cargo.css';
import explosionSound from './sounds/explosion.mp3';
import splashSound from './sounds/splash.mp3';
import victorySound from './sounds/victory.mp3';
import loseSound from './sounds/lose.mp3'; // Re-added this import
import placeSound from './sounds/place.mp3';
import timerSound from './sounds/timer.mp3';

// Constants for game configuration
const GRID_ROWS = 10;
const GRID_COLS = 10;
const GRID_SIZE = GRID_ROWS * GRID_COLS;
const SHIP_CONFIG = [
  { name: 'Carrier', size: 5, horizontalImg: '/ships/carrier-horizontal.png', verticalImg: '/ships/carrier-vertical.png' },
  { name: 'Battleship', size: 4, horizontalImg: '/ships/battleship-horizontal.png', verticalImg: '/ships/battleship-vertical.png' },
  { name: 'Destroyer', size: 3, horizontalImg: '/ships/destroyer-horizontal.png', verticalImg: '/ships/destroyer-vertical.png' },
  { name: 'Submarine', size: 3, horizontalImg: '/ships/submarine-horizontal.png', verticalImg: '/ships/submarine-vertical.png' },
  { name: 'Patrol Boat', size: 2, horizontalImg: '/ships/patrol-horizontal.png', verticalImg: '/ships/patrol-vertical.png' },
];
const PLACEMENT_TIME = 60;
const PAYMENT_TIMEOUT = 300;
const JOIN_GAME_TIMEOUT = 10000;
const CONFETTI_COUNT = 100;
const BET_OPTIONS = [
  { amount: 300, winnings: 500 },
  { amount: 500, winnings: 900 },
  { amount: 1000, winnings: 1800 },
  { amount: 2500, winnings: 4500 },
];

// Seeded random number generator
function mulberry32(a) {
  return function () {
    let t = a += 0x6D2B79F5;
    t = Math.imul((t ^ (t >>> 15)), (t | 1));
    t ^= t + Math.imul((t ^ (t >>> 7)), (t | 61));
    return (((t ^ (t >>> 14)) >>> 0)) / 4294967296;
  };
}

const App = () => {
  // State variables
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
  const [botTargetQueue, setBotTargetQueue] = useState([]);

  // References
  const timerRef = useRef(null);
  const paymentTimerRef = useRef(null);
  const joinGameTimeoutRef = useRef(null);
  const seededRandom = useRef(null);
  const gridRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);

  // Initialize Audio objects for sound effects
  const hitSound = useRef(new Audio(explosionSound));
  const missSound = useRef(new Audio(splashSound));
  const winSound = useRef(new Audio(victorySound));
  const loseSound = useRef(new Audio(loseSound)); // Fixed: Now using the imported loseSound
  const placeShipSound = useRef(new Audio(placeSound));
  const timerTickSound = useRef(new Audio(timerSound));

  // Function to play a sound if sound is enabled
  const playSound = useCallback((sound) => {
    if (isSoundEnabled) {
      sound.current.currentTime = 0; // Reset to start
      sound.current.play().catch((error) => {
        console.error('Error playing sound:', error);
      });
    }
  }, [isSoundEnabled]);

  // Cleanup Audio objects on unmount
  useEffect(() => {
    return () => {
      [hitSound, missSound, winSound, loseSound, placeShipSound, timerTickSound].forEach((sound) => {
        sound.current.pause();
      });
    };
  }, []);

  // Log gameState changes
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
    const socket = io('https://thunderfleet-backend.onrender.com', {
      transports: ['polling'],
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });
    setSocket(socket);

    console.log('Setting up socket listeners');
    const timeout = setTimeout(() => {
      if (!socket.connected) {
        setIsSocketConnected(false);
        setMessage("Failed to connect to the server. Please try again.");
      }
    }, 5000);

    const handlers = {
      connect: () => {
        clearTimeout(timeout);
        reconnectAttemptsRef.current = 0;
        console.log('[Frontend] Connected:', socket.id);
        setIsSocketConnected(true);
        setPlayerId(socket.id);
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
        setGameState('waitingForOpponent');
        setMessage('Waiting for opponent to join... Estimated wait time: 10-25 seconds');
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
            const placedCount = updated.filter(s => s.positions.length > 0).length;
            setShipCount(placedCount);
            console.log(`Updated local ship count to ${placedCount}`);
            return updated;
          });
          playSound(placeShipSound);
        }
      },
      startGame: ({ turn, message }) => {
        console.log(`Starting game, turn: ${turn}, message: ${message}`);
        setGameState('playing');
        setTurn(turn);
        setMessage(message);
        setIsOpponentThinking(turn !== socket?.id);
        setPlacementSaved(false);
        setEnemyBoard(Array(GRID_SIZE).fill('water'));
        setBotTargetQueue([]);
      },
      fireResult: ({ player, position, hit }) => {
        console.log(`Fire result: player=${player}, position=${position}, hit=${hit}`);
        const row = Math.floor(position / GRID_COLS);
        const col = position % GRID_COLS;
        hit ? playSound(hitSound) : playSound(missSound);
        setGameStats(prev => ({
          ...prev,
          shotsFired: player === socket?.id ? prev.shotsFired + 1 : prev.shotsFired,
          hits: player === socket?.id && hit ? prev.hits + 1 : prev.hits,
          misses: player === socket?.id && !hit ? prev.misses + 1 : prev.misses,
        }));
        if (player === socket?.id) {
          setCannonFire({ row, col, hit });
          setTimeout(() => setCannonFire(null), 1000);
          setEnemyBoard(prev => {
            const shotBoard = [...prev];
            shotBoard[position] = hit ? 'hit' : 'miss';
            return shotBoard;
          });
          setMessage(hit ? 'Hit! You get another turn!' : 'Miss!');
        } else {
          setMyBoard(prev => {
            const newBoard = [...prev];
            newBoard[position] = hit ? 'hit' : 'miss';
            return newBoard;
          });
          setMessage(hit ? 'Opponent hit your ship!' : 'Opponent missed!');
          if (hit) {
            const adjacentPositions = [
              position - GRID_COLS,
              position + GRID_COLS,
              position - 1,
              position + 1,
            ].filter(pos => 
              pos >= 0 && pos < GRID_SIZE &&
              (pos % GRID_COLS === position % GRID_COLS || Math.floor(pos / GRID_COLS) === Math.floor(position / GRID_COLS)) &&
              myBoard[pos] !== 'hit' && myBoard[pos] !== 'miss'
            );
            setBotTargetQueue(prev => [...prev, ...adjacentPositions]);
            console.log(`Bot hit at ${position}, queuing adjacent cells:`, adjacentPositions);
          }
        }
        setIsOpponentThinking(false);
      },
      nextTurn: ({ turn }) => {
        console.log(`Next turn: ${turn}`);
        setTurn(turn);
        setMessage(turn === socket?.id ? 'Your turn to fire!' : 'Opponent\'s turn');
        setIsOpponentThinking(turn !== socket?.id);
        if (turn !== socket?.id && gameState === 'playing') {
          setTimeout(() => {
            let position;
            if (botTargetQueue.length > 0) {
              position = botTargetQueue[0];
              setBotTargetQueue(prev => prev.slice(1));
              console.log(`Bot firing at queued position ${position}`);
            } else {
              const availablePositions = myBoard
                .map((cell, idx) => (myBoard[idx] !== 'hit' && myBoard[idx] !== 'miss' ? idx : null))
                .filter(pos => pos !== null);
              position = availablePositions[Math.floor(seededRandom.current() * availablePositions.length)];
              console.log(`Bot firing randomly at position ${position}`);
            }
            if (position !== undefined) {
              socket.emit('fire', { gameId, position });
              const row = Math.floor(position / GRID_COLS);
              const col = position % GRID_COLS;
              setCannonFire({ row, col, hit: false });
              setTimeout(() => setCannonFire(null), 1000);
            }
          }, 1000);
        }
      },
      gameEnd: ({ message }) => {
        console.log('Game ended:', message);
        setGameState('finished');
        setIsOpponentThinking(false);
        setMessage(message);
        playSound(loseSound); // This will now work with the imported loseSound
      },
      transaction: ({ message }) => {
        console.log('Transaction message:', message);
        setTransactionMessage(message);
      },
    };

    Object.entries(handlers).forEach(([event, handler]) => {
      socket.on(event, handler);
    });

    socket.connect();

    return () => {
      clearTimeout(timeout);
      Object.entries(handlers).forEach(([event, handler]) => {
        socket.off(event, handler);
      });
      socket.disconnect();
    };
  }, [playSound, betAmount, gameState, botTargetQueue, enemyBoard, gameId, myBoard]);

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
      const placedCount = ships.filter(ship => ship.positions.length > 0).length;
      setShipCount(placedCount);
      console.log(`Updated shipCount to ${placedCount}`);
    }
  }, [gameState, ships]);

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

  const selectBet = useCallback((event) => {
    const selectedAmount = event.target.value;
    console.log('Selecting bet:', selectedAmount);
    setBetAmount(selectedAmount);
    const selectedOption = BET_OPTIONS.find(option => option.amount === parseInt(selectedAmount));
    setPayoutAmount(selectedOption ? selectedOption.winnings : null);
  }, []);

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

  const handlePay = useCallback(() => {
    if (hostedInvoiceUrl) {
      setPayButtonLoading(true);
      console.log('Opening hosted invoice URL:', hostedInvoiceUrl);
      window.open(hostedInvoiceUrl, '_blank');
    } else {
      setMessage('No payment URL available. Please scan the QR code to pay.');
    }
  }, [hostedInvoiceUrl]);

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

  const calculateShipPositions = useCallback((ship, destinationId) => {
    console.log(`Calculating positions for ship ${ship.name} at destination ${destinationId}`);
    const position = parseInt(destinationId);
    let row = Math.floor(position / GRID_COLS);
    let col = position % GRID_COLS;

    if (ship.horizontal) {
      const maxCol = GRID_COLS - ship.size;
      col = Math.max(0, Math.min(col, maxCol));
    } else {
      const maxRow = GRID_ROWS - ship.size;
      row = Math.max(0, Math.min(row, maxRow));
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

  const toggleOrientation = useCallback((shipIndex) => {
    if (placementSaved || !ships[shipIndex].placed) {
      console.log(`Cannot toggle orientation for ship ${shipIndex}: Placement saved or ship not placed`);
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
        playSound(placeShipSound);
        updateServerBoard(updated);
        setMessage(`${ship.name} rotated successfully! You can still reposition ships.`);
      } else {
        setMessage('Cannot rotate: Ship would go out of bounds or overlap another ship.');
        console.log(`Failed to rotate ${ship.name}: Invalid position`);
      }

      return updated;
    });
  }, [placementSaved, ships, calculateShipPositions, playSound, updateServerBoard]);

  const randomizeShips = useCallback(() => {
    if (placementSaved) {
      console.log('Cannot randomize ships: Placement already saved');
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
    const placedCount = newShips.filter(s => s.positions.length > 0).length;
    setShipCount(placedCount);
    if (successfulPlacements < SHIP_CONFIG.length) {
      setMessage('Some ships couldn’t be placed. Adjust manually or try again.');
      console.log(`Randomized ${successfulPlacements} out of ${SHIP_CONFIG.length} ships`);
    } else {
      setMessage('Ships randomized! Drag to reposition or Save Placement.');
      console.log('All ships successfully randomized');
    }
    playSound(placeShipSound);
    updateServerBoard(newShips);
  }, [placementSaved, ships, playSound, updateServerBoard]);

  const clearBoard = useCallback(() => {
    if (placementSaved) {
      console.log('Cannot clear board: Placement already saved');
      return;
    }
    console.log('Clearing the board');
    setMyBoard(Array(GRID_SIZE).fill('water'));
    setShips(prev => prev.map(ship => ({ ...ship, positions: [], placed: false })));
    setShipCount(0);
    setMessage('Board cleared. Place your ships!');
    updateServerBoard();
  }, [placementSaved, updateServerBoard]);

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

  const handleDragStart = (e, shipIndex) => {
    e.dataTransfer.setData('text/plain', shipIndex.toString());
    setIsDragging(shipIndex);
    console.log(`Started dragging ship ${shipIndex}`);
  };

  const handleTouchStart = (e, shipIndex) => {
    e.preventDefault();
    setIsDragging(shipIndex);
    const touch = e.touches[0];
    const data = { shipIndex, startX: touch.clientX, startY: touch.clientY };
    sessionStorage.setItem('dragData', JSON.stringify(data));
    console.log(`Touch drag started for ship ${shipIndex}`);
  };

  const handleTouchMove = useCallback((e) => {
    if (isDragging === null || placementSaved) return;
    e.preventDefault();
    console.log(`Touch moving for ship ${isDragging}`);
  }, [isDragging, placementSaved]);

  const handleGridDrop = useCallback((e) => {
    let shipIndex, x, y;
    if (e.dataTransfer) {
      e.preventDefault();
      if (placementSaved) {
        console.log('Cannot drop ship: Placement saved');
        return;
      }
      shipIndex = parseInt(e.dataTransfer.getData('text/plain'));
      const rect = e.currentTarget.getBoundingClientRect();
      x = Math.max(0, e.clientX - rect.left);
      y = Math.max(0, e.clientY - rect.top);
      console.log(`Desktop drop at x:${x}, y:${y}, shipIndex:${shipIndex}`);
    } else {
      shipIndex = e.shipIndex;
      x = Math.max(0, e.x);
      y = Math.max(0, e.y);
      console.log(`Mobile drop at x:${x}, y:${y}, shipIndex:${shipIndex}`);
    }

    if (placementSaved) {
      console.log('Cannot drop ship: Placement saved');
      return;
    }

    const ship = ships[shipIndex];
    const col = Math.min(Math.max(Math.floor(x / cellSize), 0), GRID_COLS - 1);
    const row = Math.min(Math.max(Math.floor(y / cellSize), 0), GRID_ROWS - 1);
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

    playSound(placeShipSound);
    setIsDragging(null);
    if (updatedShips) updateServerBoard(updatedShips);
  }, [placementSaved, ships, cellSize, calculateShipPositions, playSound, updateServerBoard]);

  const handleTouchEnd = useCallback((e) => {
    if (isDragging === null || placementSaved) return;
    e.preventDefault();
    setIsDragging(null);
    const data = JSON.parse(sessionStorage.getItem('dragData'));
    if (!data) return;
    const { shipIndex } = data;
    const touch = e.changedTouches[0];
    const gridRect = gridRef.current.getBoundingClientRect();
    const x = touch.clientX - gridRect.left;
    const y = touch.clientY - gridRect.top;
    console.log(`Touch ended for ship ${shipIndex}, dropping at x:${x}, y:${y}`);
    handleGridDrop({ x, y, shipIndex: parseInt(shipIndex) });
  }, [isDragging, placementSaved, handleGridDrop]);

  const handleGridDragOver = useCallback((e) => {
    e.preventDefault();
    console.log('Drag over grid');
  }, []);

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
      setMessage(`${successfulPlacements} ship(s) randomized! ${placedCount}/5 placed. You can still reposition ships.`);
      console.log(`${successfulPlacements} ships randomized, total placed: ${placedCount}`);
    }
    playSound(placeShipSound);
    updateServerBoard(newShips);
  }, [isPlacementConfirmed, ships, myBoard, playSound, updateServerBoard]);

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
    setMessage('Placement saved! Waiting for opponent... You can still reposition your ships until the game starts.');
    console.log('Ship placement confirmed and saved');

    const placements = ships.map(ship => ({
      name: ship.name,
      positions: ship.positions,
      horizontal: ship.horizontal,
    }));

    socket.emit('savePlacement', { gameId, placements });
    console.log('Emitted savePlacement to server:', placements);
    playSound(placeShipSound);
  }, [placementSaved, ships, gameId, playSound, randomizeUnplacedShips, socket]);

  const autoSavePlacement = useCallback(() => {
    console.log('Auto-saving placement due to time running out');
    randomizeUnplacedShips();
    saveShipPlacement();
  }, [randomizeUnplacedShips, saveShipPlacement]);

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

  useEffect(() => {
    if (playerId) {
      const seed = playerId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) + Date.now();
      seededRandom.current = mulberry32(seed);
      console.log(`Initialized seeded random generator with seed: ${seed}`);
    }
  }, [playerId]);

  useEffect(() => {
    if (timerActive && timeLeft > 0) {
      console.log(`Placement timer active, time left: ${timeLeft} seconds`);
      timerRef.current = setTimeout(() => {
        setTimeLeft(timeLeft - 1);
        if ([10, 5, 4, 3, 2, 1].includes(timeLeft)) {
          console.log(`Playing timer sound at ${timeLeft} seconds remaining`);
          playSound(timerTickSound);
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
  }, [timerActive, timeLeft, autoSavePlacement, playSound]);

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
        onDragOver={isEnemy ? undefined : handleGridDragOver}
        onDrop={isEnemy ? undefined : handleGridDrop}
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
                className={`cell ${cell} ${isDragging !== null ? 'drag-active' : ''}`}
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
                  draggable={!placementSaved}
                  onDragStart={(e) => handleDragStart(e, ship.id)}
                  onDragEnd={() => {
                    setIsDragging(null);
                    console.log(`Stopped dragging ${ship.name}`);
                  }}
                  onTouchStart={(e) => {
                    e.preventDefault();
                    handleTouchStart(e, ship.id);
                    if (!placementSaved) toggleOrientation(ship.id);
                  }}
                  onTouchMove={handleTouchMove}
                  onTouchEnd={handleTouchEnd}
                  style={{
                    position: 'absolute',
                    top: Math.floor(ship.positions[0] / GRID_COLS) * cellSize + 2,
                    left: (ship.positions[0] % GRID_COLS) * cellSize + 2,
                    width: ship.horizontal ? ship.size * cellSize - 4 : cellSize - 4,
                    height: ship.horizontal ? cellSize - 4 : ship.size * cellSize - 4,
                    backgroundImage: `url(${ship.horizontal ? ship.horizontalImg : ship.verticalImg})`,
                    backgroundSize: 'cover',
                    backgroundPosition: "center",
                    opacity: placementSaved ? 1 : 0.8,
                    cursor: placementSaved ? 'default' : 'grab',
                    pointerEvents: placementSaved ? 'none' : 'auto',
                    touchAction: 'none',
                  }}
                  onClick={() => !placementSaved && toggleOrientation(ship.id)}
                />
              )
            );
          })}
      </div>
    );
  }, [cellSize, ships, isDragging, gameState, turn, cannonFire, placementSaved, handleFire, toggleOrientation, socket, handleTouchMove, handleTouchEnd, handleGridDragOver, handleGridDrop]);

  const renderShipList = useCallback(() => {
    if (placementSaved) {
      console.log('Not rendering ship list: Placement saved');
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
                draggable={!placementSaved}
                onDragStart={(e) => handleDragStart(e, i)}
                onDragEnd={() => {
                  setIsDragging(null);
                  console.log(`Stopped dragging ${ship.name}`);
                }}
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
                  cursor: placementSaved ? 'default' : 'grab',
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
  }, [placementSaved, ships, cellSize, isDragging, handleTouchMove, handleTouchEnd]);

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
  }, [lightningInvoice, hostedInvoiceUrl, betAmount, payoutAmount, isWaitingForPayment, paymentTimer, payButtonLoading, handlePay, handleCancelGame]);

  const Confetti = useMemo(() => {
    console.log('Rendering Confetti');
    const particles = Array.from({ length: CONFETTI_COUNT }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      animationDuration: 3 + Math.random() * 2,
      rotation: Math.random() * 360,
    }));
    return (
      <div className="confetti">
        {particles.map(particle => (
          <div
            key={particle.id}
            className="confetti-particle"
            style={{
              left: `${particle.left}%`,
              animationDuration: `${particle.animationDuration}s`,
              transform: `rotate(${particle.rotation}deg)`,
              backgroundColor: `hsl(${Math.random() * 360}, 70%, 60%)`,
            }}
          />
        ))}
      </div>
    );
  }, []);

  useEffect(() => {
    if (gameState === 'finished' && message.includes('You win')) {
      console.log('Triggering confetti for win');
      setShowConfetti(true);
      setTimeout(() => setShowConfetti(false), 5000);
      playSound(winSound);
    }
  }, [gameState, message, playSound]);

  const renderGameStats = useCallback(() => {
    console.log('Rendering game stats');
    const accuracy = gameStats.shotsFired > 0 ? ((gameStats.hits / gameStats.shotsFired) * 100).toFixed(1) : 0;
    return (
      <div className="game-stats">
        <h3>Game Stats</h3>
        <p>Shots Fired: {gameStats.shotsFired}</p>
        <p>Hits: {gameStats.hits}</p>
        <p>Misses: {gameStats.misses}</p>
        <p>Accuracy: {accuracy}%</p>
      </div>
    );
  }, [gameStats]);

  const handleResetGame = useCallback(() => {
    console.log('Resetting game');
    setGameState('join');
    setGameId(null);
    setPlayerId(null);
    setLightningAddress('');
    setBetAmount('300');
    setPayoutAmount('500');
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
    setTurn(null);
    setMessage('');
    setTransactionMessage('');
    setCannonFire(null);
    setIsPlacementConfirmed(false);
    setIsDragging(null);
    setTimeLeft(PLACEMENT_TIME);
    setTimerActive(false);
    setLightningInvoice(null);
    setHostedInvoiceUrl(null);
    setPlacementSaved(false);
    setIsWaitingForPayment(false);
    setIsOpponentThinking(false);
    setPaymentTimer(PAYMENT_TIMEOUT);
    setGameStats({ shotsFired: 0, hits: 0, misses: 0 });
    setShowConfetti(false);
    setIsLoading(false);
    setBotTargetQueue([]);
    reconnectAttemptsRef.current = 0;
    socket?.emit('leaveGame', { gameId, playerId });
    console.log('Emitted leaveGame to server');
  }, [socket, gameId, playerId]);

  if (!isAppLoaded) {
    console.log('App not loaded, rendering loading screen');
    return (
      <div className="loading-screen">
        <div className="spinner"></div>
        <p>Loading...</p>
      </div>
    );
  }

  console.log(`Rendering main app, gameState: ${gameState}`);
  return (
    <div className="app">
      {showConfetti && <Confetti />}
      {showTermsModal && <TermsModal />}
      {showPrivacyModal && <PrivacyModal />}
      {showHowToPlayModal && <HowToPlayModal />}

      {gameState === 'splash' && <SplashScreen />}

      {gameState === 'join' && (
        <div className="join-game">
          <h1>⚡ Lightning Sea Battle ⚡</h1>
          <p>Enter your Lightning address to join the game!</p>
          <input
            type="text"
            placeholder="Enter Lightning Address (e.g., user@domain)"
            value={lightningAddress}
            onChange={(e) => {
              console.log('Lightning address input changed:', e.target.value);
              setLightningAddress(e.target.value);
            }}
            className="lightning-input"
            disabled={isLoading}
          />
          <p>Select your bet amount:</p>
          <select
            value={betAmount}
            onChange={selectBet}
            className="bet-select"
            disabled={isLoading}
          >
            {BET_OPTIONS.map((option, index) => (
              <option key={index} value={option.amount}>
                Bet {option.amount} SATS (Win {option.winnings} SATS)
              </option>
            ))}
          </select>
          <button
            onClick={handleJoinGame}
            onTouchStart={handleJoinGame}
            className={`join-button ${isLoading ? 'loading' : ''}`}
            disabled={isLoading}
          >
            {isLoading ? 'Joining...' : 'Join Game'}
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
          {message && <p className="message">{message}</p>}
          {!isSocketConnected && (
            <button
              onClick={handleReconnect}
              onTouchStart={handleReconnect}
              className="retry-button"
            >
              Retry Connection
            </button>
          )}
        </div>
      )}

      {(gameState === 'waiting' || gameState === 'waitingForOpponent') && (
        <div className="waiting">
          <h1>⚡ Lightning Sea Battle ⚡</h1>
          {isWaitingForPayment && <PaymentModal />}
          <p className="message">{message}</p>
          <div className="loading-spinner"></div>
          <button
            onClick={handleCancelGame}
            onTouchStart={handleCancelGame}
            className="cancel-button"
          >
            Cancel
          </button>
          {!isSocketConnected && (
            <button
              onClick={handleReconnect}
              onTouchStart={handleReconnect}
              className="retry-button"
            >
              Retry Connection
            </button>
          )}
        </div>
      )}

      {gameState === 'placing' && (
        <div className="placing">
          <h1>⚡ Lightning Sea Battle ⚡</h1>
          <p className="message">{message}</p>
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
                {Math.floor(timeLeft / 60)}:{(timeLeft % 60).toString().padStart(2, '0')}
              </span>
            </div>
          </div>
          <div className="board-label">Your Board</div>
          {renderGrid(myBoard, false)}
          {renderShipList()}
          <div className="placement-controls">
            <button
              onClick={randomizeShips}
              onTouchStart={randomizeShips}
              className="placement-button"
              disabled={placementSaved}
            >
              Randomize Ships
            </button>
            <button
              onClick={clearBoard}
              onTouchStart={clearBoard}
              className="placement-button"
              disabled={placementSaved}
            >
              Clear Board
            </button>
            <button
              onClick={saveShipPlacement}
              onTouchStart={saveShipPlacement}
              className="placement-button save-button"
              disabled={shipCount < 5 || placementSaved}
            >
              Save Placement
            </button>
          </div>
          {!isSocketConnected && (
            <button
              onClick={handleReconnect}
              onTouchStart={handleReconnect}
              className="retry-button"
            >
              Retry Connection
            </button>
          )}
        </div>
      )}

      {gameState === 'playing' && (
        <div className="playing">
          <h1>⚡ Lightning Sea Battle ⚡</h1>
          <p className="message">{message}</p>
          {isOpponentThinking && (
            <div className="opponent-thinking">
              <p>Opponent is thinking...</p>
              <div className="loading-spinner"></div>
            </div>
          )}
          <div className="boards-container">
            <div className="board-section">
              <div className="board-label">Your Board</div>
              {renderGrid(myBoard, false)}
            </div>
            <div className="board-section">
              <div className="board-label">Enemy Board</div>
              {renderGrid(enemyBoard, true)}
            </div>
          </div>
          {renderGameStats()}
          {!isSocketConnected && (
            <button
              onClick={handleReconnect}
              onTouchStart={handleReconnect}
              className="retry-button"
            >
              Retry Connection
            </button>
          )}
        </div>
      )}

      {gameState === 'finished' && (
        <div className="finished">
          <h1>⚡ Lightning Sea Battle ⚡</h1>
          <p className="message">{message}</p>
          {transactionMessage && <p className="transaction-message">{transactionMessage}</p>}
          <div className="boards-container">
            <div className="board-section">
              <div className="board-label">Your Board</div>
              {renderGrid(myBoard, false)}
            </div>
            <div className="board-section">
              <div className="board-label">Enemy Board</div>
              {renderGrid(enemyBoard, true)}
            </div>
          </div>
          {renderGameStats()}
          <button
            onClick={handleResetGame}
            onTouchStart={handleResetGame}
            className="join-button"
          >
            Play Again
          </button>
          {!isSocketConnected && (
            <button
              onClick={handleReconnect}
              onTouchStart={handleReconnect}
              className="retry-button"
            >
              Retry Connection
            </button>
          )}
        </div>
      )}

      <footer className="footer">
        <div className="footer-links">
          <button
            onClick={() => setShowTermsModal(true)}
            onTouchStart={() => setShowTermsModal(true)}
            className="footer-link"
          >
            Terms
          </button>
          <button
            onClick={() => setShowPrivacyModal(true)}
            onTouchStart={() => setShowPrivacyModal(true)}
            className="footer-link"
          >
            Privacy
          </button>
          <button
            onClick={() => setShowHowToPlayModal(true)}
            onTouchStart={() => setShowHowToPlayModal(true)}
            className="footer-link"
          >
            How to Play
          </button>
        </div>
        <p>© 2025 ThunderFleet. All rights reserved.</p>
      </footer>
    </div>
  );
};

export default App;
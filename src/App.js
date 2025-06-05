import React, { useState, useEffect, useCallback, useRef } from 'react';
import io from 'socket.io-client';
import { QRCodeSVG } from 'qrcode.react';
import './Cargo.css';

// Ship images
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

// Game constants
const GRID_COLS = 9;
const GRID_ROWS = 7;
const GRID_SIZE = GRID_COLS * GRID_ROWS;
const PLACEMENT_TIME = 30;
const PAYMENT_TIMEOUT = 300; // 5 minutes in seconds

// Bet options with corresponding winnings
const BET_OPTIONS = [
  { amount: 300, checkoutLink: 'https://checkout.tryspeed.com/pay/cs_live_mbepx7uex8EePJYc', winnings: 500 },
  { amount: 500, checkoutLink: 'https://checkout.tryspeed.com/pay/cs_live_mbfa1tla1489rcLP', winnings: 800 },
  { amount: 1000, checkoutLink: 'https://checkout.tryspeed.com/pay/cs_live_mbfa78qgrjeGFe4u', winnings: 1700 },
  { amount: 5000, checkoutLink: 'https://checkout.tryspeed.com/pay/cs_live_mbfa8k07PbKc7GmD', winnings: 8000 },
  { amount: 10000, checkoutLink: 'https://checkout.tryspeed.com/pay/cs_live_mbfa93htPd5lQyjS', winnings: 17000 },
];

// Sound effects
const useSound = (src) => {
  const [audio] = useState(() => {
    const audio = new Audio(src);
    audio.addEventListener('loadedmetadata', () => {
      console.log(`${src} duration: ${audio.duration} seconds`);
    });
    return audio;
  });
  return () => audio.play().catch(err => console.log('Audio error:', err));
};

// Use environment variable for backend URL
const socket = io(process.env.REACT_APP_BACKEND_URL || 'http://localhost:4000', {
  reconnectionAttempts: 5,
  reconnectionDelay: 1000,
});

const SHIP_CONFIG = [
  { name: 'Aircraft Carrier', size: 5, horizontalImg: carrierHorizontal, verticalImg: carrierVertical },
  { name: 'Battleship', size: 4, horizontalImg: battleshipHorizontal, verticalImg: battleshipVertical },
  { name: 'Submarine', size: 3, horizontalImg: submarineHorizontal, verticalImg: submarineVertical },
  { name: 'Destroyer', size: 3, horizontalImg: cruiserHorizontal, verticalImg: cruiserVertical },
  { name: 'Patrol Boat', size: 2, horizontalImg: patrolHorizontal, verticalImg: patrolVertical },
];

// Seeded random number generator for unique randomization per player
const mulberry32 = (a) => {
  return function() {
    let t = a += 0x6D2B79F5;
    t = Math.imul((t ^ (t >>> 15)), (t | 1));
    t ^= (t + Math.imul((t ^ (t >>> 7)), (t | 61)));
    return ((((t ^ (t >>> 14)) >>> 0)) / 4294967296);
  };
};

const App = () => {
  const [gameState, setGameState] = useState('join');
  const [gameId, setGameId] = useState(null);
  const [playerId, setPlayerId] = useState(null);
  const [lightningAddress, setLightningAddress] = useState('');
  const [betAmount, setBetAmount] = useState(BET_OPTIONS[0].amount); // Default to 300 sats
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
  const [confetti, setConfetti] = useState(false);
  const [cannonFire, setCannonFire] = useState(null);
  const [isPlacementConfirmed, setIsPlacementConfirmed] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [cellSize, setCellSize] = useState(40);
  const [timeLeft, setTimeLeft] = useState(PLACEMENT_TIME);
  const [timerActive, setTimerActive] = useState(false);
  const [paymentRequest, setPaymentRequest] = useState('');
  const [hostedInvoiceUrl, setHostedInvoiceUrl] = useState(null);
  const [showQR, setShowQR] = useState(false);
  const [placementSaved, setPlacementSaved] = useState(false);
  const [isWaitingForPayment, setIsWaitingForPayment] = useState(false);
  const [matchmakingTimer, setMatchmakingTimer] = useState(null);
  const [isOpponentThinking, setIsOpponentThinking] = useState(false);
  const [paymentTimer, setPaymentTimer] = useState(PAYMENT_TIMEOUT);

  const timerRef = useRef(null);
  const paymentTimerRef = useRef(null);
  const seededRandom = useRef(null);

  // Define sound effects early since they're used in useEffect
  const playHitSound = useSound('/sounds/explosion.mp3');
  const playMissSound = useSound('/sounds/splash.mp3');
  const playWinSound = useSound('/sounds/victory.mp3');
  const playPlaceSound = useSound('/sounds/place.mp3');
  const playTimerSound = useSound('/sounds/timer.mp3');

  // Define functions that will be used in useEffect hooks early
  const calculateShipPositions = useCallback((ship, destinationId) => {
    const position = parseInt(destinationId);
    let row = Math.floor(position / GRID_COLS);
    let col = position % GRID_COLS;
    const positions = [];

    if (!ship.horizontal) {
      const maxRow = GRID_ROWS - ship.size;
      if (row > maxRow) {
        row = maxRow;
      }
    } else {
      const maxCol = GRID_COLS - ship.size;
      if (col > maxCol) {
        col = maxCol;
      }
    }

    for (let i = 0; i < ship.size; i++) {
      const pos = ship.horizontal ? row * GRID_COLS + col + i : (row + i) * GRID_COLS + col;
      if (pos >= GRID_SIZE) return null;
      if (ship.horizontal && col + i >= GRID_COLS) return null;
      if (!ship.horizontal && row + i >= GRID_ROWS) return null;
      if (myBoard[pos] === 'ship' && !ship.positions.includes(pos)) return null;
      positions.push(pos);
    }

    return positions;
  }, [myBoard]);

  const updateServerBoard = useCallback((updatedShips) => {
    if (gameState !== 'placing' || isPlacementConfirmed) return;
    const placements = (updatedShips || ships).map(ship => ({
      name: ship.name,
      positions: ship.positions,
      horizontal: ship.horizontal,
    }));
    console.log('[updateServerBoard] Sending placements:', placements);
    socket.emit('updateBoard', { gameId, placements });
  }, [gameId, gameState, isPlacementConfirmed, ships]);

  const updateBoardFromServer = useCallback(() => {
    socket.emit('updateBoard', { gameId, placements: ships });
  }, [gameId, ships]);

  const randomizeUnplacedShips = useCallback(() => {
    console.log('[randomizeUnplacedShips] Starting...');
    if (isPlacementConfirmed) {
      console.log('[randomizeUnplacedShips] Placement confirmed, returning');
      return;
    }

    const unplacedShips = ships.filter(ship => !ship.placed);
    console.log('[randomizeUnplacedShips] Unplaced ships:', unplacedShips.length);
    
    if (unplacedShips.length === 0) return;

    const newBoard = [...myBoard];
    const newShips = [...ships];
    let successfulPlacements = 0;

    unplacedShips.forEach((ship) => {
      let placed = false;
      let attempts = 0;

      const shipSize = ship.size;
      const shipId = ship.id;

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
          }
          placed = true;
        }
      }

      if (!placed) {
        console.log(`[randomizeUnplacedShips] Failed to place ship ${ship.name} after 100 attempts`);
      }
    });

    setMyBoard(newBoard);
    setShips(newShips);
    const placedCount = newShips.filter(s => s.placed).length;
    setShipCount(placedCount);
    if (successfulPlacements === 0) {
      setMessage('Unable to place unplaced ships due to space constraints. Clear the board and try again.');
    } else {
      setMessage(`${successfulPlacements} ship(s) randomized! ${placedCount}/5 placed.`);
    }
    playPlaceSound();
    updateServerBoard(newShips);
  }, [isPlacementConfirmed, ships, myBoard, playPlaceSound, updateServerBoard]);

  const saveShipPlacement = useCallback(() => {
    if (placementSaved) return;
    const unplacedShips = ships.filter(ship => !ship.placed);
    if (unplacedShips.length > 0) {
      randomizeUnplacedShips();
    }

    setPlacementSaved(true);
    setIsPlacementConfirmed(true);
    setMessage('Placement saved! Waiting for opponent...');

    const placements = ships.map(ship => ({
      name: ship.name,
      positions: ship.positions,
      horizontal: ship.horizontal,
    }));

    console.log('[saveShipPlacement] Emitting savePlacement:', { gameId, placements });
    socket.emit('savePlacement', { gameId, placements });
    playPlaceSound();
  }, [placementSaved, ships, gameId, playPlaceSound, randomizeUnplacedShips]);

  // Define autoSavePlacement before the useEffect that uses it
  const autoSavePlacement = useCallback(() => {
    randomizeUnplacedShips();
    saveShipPlacement();
  }, [randomizeUnplacedShips, saveShipPlacement]);

  // Now define useEffect hooks
  useEffect(() => {
    console.log('[Debug] gameState:', gameState, 'isPlacementConfirmed:', isPlacementConfirmed);
  }, [gameState, isPlacementConfirmed]);

  useEffect(() => {
    if (playerId) {
      const seed = playerId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) + Date.now();
      seededRandom.current = mulberry32(seed);
    }
  }, [playerId]);

  useEffect(() => {
    const handleResize = () => {
      setCellSize(window.innerWidth < 768 ? 30 : 40);
    };
    window.addEventListener('resize', handleResize);
    handleResize();
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (timerActive && timeLeft > 0) {
      timerRef.current = setTimeout(() => {
        setTimeLeft(timeLeft - 1);
        if ([10, 5, 4, 3, 2, 1].includes(timeLeft)) {
          playTimerSound();
        }
      }, 1000);
    } else if (timerActive && timeLeft === 0) {
      setTimerActive(false);
      setMessage('Time up! Saving placement...');
      autoSavePlacement(); // Now this will work since autoSavePlacement is defined above
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [timerActive, timeLeft, autoSavePlacement, playTimerSound]);

  useEffect(() => {
    if (isWaitingForPayment && paymentTimer > 0) {
      paymentTimerRef.current = setTimeout(() => {
        setPaymentTimer(paymentTimer - 1);
      }, 1000);
    } else if (isWaitingForPayment && paymentTimer === 0) {
      setIsWaitingForPayment(false);
      setMessage('Payment timed out after 5 minutes. Please try again.');
      setGameState('join');
      setPaymentRequest('');
      setHostedInvoiceUrl(null);
      setShowQR(false);
      socket.emit('cancelGame', { gameId, playerId });
    }
    return () => {
      if (paymentTimerRef.current) clearTimeout(paymentTimerRef.current);
    };
  }, [isWaitingForPayment, paymentTimer, gameId, playerId]);

  useEffect(() => {
    if (gameState === 'placing') {
      setTimerActive(true);
      setTimeLeft(PLACEMENT_TIME);
      setPlacementSaved(false);
      setIsPlacementConfirmed(false);
    } else {
      setTimerActive(false);
    }
  }, [gameState]);

  useEffect(() => {
    const handlers = {
      connect: () => {
        console.log('[Frontend] Connected:', socket.id);
        setMessage('');
      },
      joined: ({ gameId, playerId }) => {
        setGameId(gameId);
        setPlayerId(playerId);
        setGameState('waiting');
        setMessage('Waiting for opponent...');
      },
      paymentRequest: ({ lightningInvoice, hostedInvoiceUrl }) => {
        console.log('Received paymentRequest:', { lightningInvoice, hostedInvoiceUrl });
        setPaymentRequest(lightningInvoice);
        setHostedInvoiceUrl(hostedInvoiceUrl);
        setShowQR(true);
        setIsWaitingForPayment(true);
        setPaymentTimer(PAYMENT_TIMEOUT);
        setMessage(`Scan to pay ${betAmount} sats`);
      },
      paymentVerified: () => {
        setIsWaitingForPayment(false);
        setPaymentTimer(PAYMENT_TIMEOUT); // Reset timer
        setMessage('Payment verified! Waiting for opponent...');
      },
      error: ({ message }) => {
        setMessage(`Error: ${message}`);
        setIsWaitingForPayment(false);
        setPaymentTimer(PAYMENT_TIMEOUT); // Reset timer
        setGameState('join');
        setPaymentRequest('');
        setHostedInvoiceUrl(null);
        setShowQR(false);
      },
      matchmakingTimer: ({ timeLeft }) => {
        setMatchmakingTimer(timeLeft);
        if (timeLeft === 0) {
          setMatchmakingTimer(null);
        }
      },
      matchedWithBot: ({ message }) => {
        setMessage('Opponent found! Preparing game...');
      },
      startPlacing: () => {
        setGameState('placing');
        setMessage('Place your ships! Drag to position, click to rotate.');
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
      },
      placementSaved: () => {
        setIsPlacementConfirmed(true);
        setPlacementSaved(true);
        setMessage('Placement saved! Waiting for opponent...');
      },
      placementAutoSaved: () => {
        setIsPlacementConfirmed(true);
        setPlacementSaved(true);
        setMessage('Time up! Ships auto-placed. Waiting for opponent...');
        updateBoardFromServer();
      },
      games: ({ count, grid, ships: serverShips }) => {
        console.log('[Frontend] Received games event:', { count, grid, serverShips });
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
      startGame: ({ turn }) => {
        setGameState('playing');
        setTurn(turn);
        setMessage(turn === playerId ? 'Your turn to fire!' : 'Opponent\'s turn');
        setIsOpponentThinking(turn !== playerId);
        setPlacementSaved(false);
      },
      fireResult: ({ player, position, hit }) => {
        console.log(`[fireResult] player: ${player}, position: ${position}, hit: ${hit}, myBoard:`, myBoard);
        const row = Math.floor(position / GRID_COLS);
        const col = position % GRID_COLS;
        hit ? playHitSound() : playMissSound();
        if (player === playerId) {
          setCannonFire({ row, col, hit });
          setEnemyBoard(prev => {
            const newBoard = [...prev];
            newBoard[position] = hit ? 'hit' : 'miss';
            return newBoard;
          });
          if (hit) {
            setMessage('Hit! You get another turn!');
          }
        } else {
          setMyBoard(prev => {
            const newBoard = [...prev];
            newBoard[position] = hit ? 'hit' : 'miss';
            return newBoard;
          });
        }
        setIsOpponentThinking(false);
      },
      nextTurn: ({ turn }) => {
        setTurn(turn);
        setMessage(turn === playerId ? 'Your turn to fire!' : 'Opponent\'s turn');
        setIsOpponentThinking(turn !== playerId);
      },
      gameEnd: ({ message }) => {
        setGameState('finished');
        setIsOpponentThinking(false);
        playWinSound();
        setMessage(message);
        setConfetti(true);
      },
      transaction: ({ message }) => {
        setTransactionMessage(message);
      },
    };

    Object.entries(handlers).forEach(([event, handler]) => {
      socket.on(event, handler);
    });

    return () => {
      Object.entries(handlers).forEach(([event, handler]) => {
        socket.off(event, handler);
      });
    };
  }, [playerId, playHitSound, playMissSound, playPlaceSound, playWinSound, myBoard, betAmount, updateBoardFromServer]);

  // Define remaining functions after useEffect hooks
  const handleJoinGame = () => {
    if (!lightningAddress) {
      setMessage('Please enter a Lightning address');
      return;
    }

    const sanitizedAddress = lightningAddress.trim().toLowerCase();
    if (!sanitizedAddress.includes('@')) {
      setMessage('Invalid Lightning address format');
      return;
    }

    socket.emit('joinGame', { lightningAddress: sanitizedAddress, betAmount });
    setMessage('Processing payment...');
  };

  const toggleOrientation = (shipIndex) => {
    console.log('[toggleOrientation] Called for ship:', shipIndex);
    if (isPlacementConfirmed || !ships[shipIndex].placed) {
      console.log('[toggleOrientation] Cannot toggle - confirmed or not placed');
      return;
    }

    setShips(prev => {
      const updated = [...prev];
      const ship = updated[shipIndex];
      const newHorizontal = !ship.horizontal;

      const newPositions = calculateShipPositions(
        { ...ship, horizontal: newHorizontal },
        ship.positions[0].toString()
      );

      if (newPositions) {
        setMyBoard(prevBoard => {
          const newBoard = [...prevBoard];
          ship.positions.forEach(pos => (newBoard[pos] = 'water'));
          newPositions.forEach(pos => (newBoard[pos] = 'ship'));
          return newBoard;
        });

        updated[shipIndex] = { ...ship, horizontal: newHorizontal, positions: newPositions };
        playPlaceSound();
        updateServerBoard(updated);
      } else {
        setMessage('Cannot rotate: Ship would go out of bounds or overlap another ship.');
      }

      return updated;
    });
  };

  const randomizeShips = () => {
    console.log('[randomizeShips] Starting...');
    if (isPlacementConfirmed) {
      console.log('[randomizeShips] Placement confirmed, returning');
      return;
    }

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
          placed = true;
        }
      }

      if (!placed) {
        console.log(`[randomizeShips] Failed to place ship ${shipConfig.name} after 100 attempts`);
      }
    });

    setMyBoard(newBoard);
    setShips(newShips);
    const placedCount = newShips.filter(s => s.placed).length;
    setShipCount(placedCount);
    if (successfulPlacements < SHIP_CONFIG.length) {
      setMessage('Some ships couldn’t be placed due to space constraints. Adjust manually or try again.');
    } else {
      setMessage('Ships randomized! Drag to reposition or Save Placement.');
    }
    playPlaceSound();
    updateServerBoard(newShips);
  };

  const clearBoard = () => {
    if (isPlacementConfirmed) return;
    setMyBoard(Array(GRID_SIZE).fill('water'));
    setShips(prev => prev.map(ship => ({ ...ship, positions: [], placed: false })));
    setShipCount(0);
    setMessage('Board cleared. Place your ships!');
    updateServerBoard();
  };

  const handleFire = (position) => {
    if (gameState === 'playing' && turn === playerId && enemyBoard[position] === 'water') {
      socket.emit('fire', { gameId, position });
    }
  };

  const renderGrid = (board, isEnemy) => {
    return (
      <div
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
                style={{
                  cursor:
                    isEnemy && cell === 'water' && gameState === 'playing' && turn === playerId
                      ? 'crosshair'
                      : 'default',
                  width: cellSize,
                  height: cellSize,
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
            console.log(
              `[Render Ship] ${ship.name}: placed=${ship.placed}, positions=${ship.positions}, horizontal=${ship.horizontal}`
            );
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
                  }}
                  onClick={() => !isPlacementConfirmed && toggleOrientation(ship.id)}
                />
              )
            );
          })}
      </div>
    );
  };

  const renderShipList = () => {
    if (isPlacementConfirmed) return null;
    return (
      <div className="ships-list">
        {ships.map((ship, i) => (
          <div key={i} className="ship-container">
            <div className="ship-info">
              <span>{ship.name}</span>
              <span className="ship-status">{ship.placed ? '✅ Placed' : '❌ Not placed'}</span>
            </div>
            <div
              className="ship"
              draggable={!isPlacementConfirmed}
              onDragStart={(e) => {
                e.dataTransfer.setData('text/plain', i.toString());
                setIsDragging(true);
              }}
              onDragEnd={() => setIsDragging(false)}
              style={{
                backgroundImage: `url(${ship.horizontal ? ship.horizontalImg : ship.verticalImg})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                width: ship.horizontal ? `${ship.size * 40}px` : '40px',
                height: ship.horizontal ? '40px' : `${ship.size * 40}px`,
                opacity: ship.placed ? 0.5 : 1,
                cursor: isPlacementConfirmed ? 'default' : 'grab',
                border: '2px solid #333',
                borderRadius: '4px',
                margin: '5px 0',
              }}
            >
              <span className="ship-label">{ship.name}</span>
            </div>
            <button
              onClick={() => {
                console.log(
                  `[Orientation Button] Ship ${ship.name}, placed: ${ship.placed}, isPlacementConfirmed: ${isPlacementConfirmed}`
                );
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
  };

  const PaymentModal = () => (
    <div className="payment-modal">
      <h3>⚡ Pay {betAmount} sats to join ⚡</h3>
      <p className="winnings-info">
        Win {BET_OPTIONS.find((option) => option.amount === betAmount)?.winnings} sats!
      </p>
      {showQR && paymentRequest && (
        <div className="qr-container">
          <QRCodeSVG value={paymentRequest} size={200} level="H" includeMargin={true} />
        </div>
      )}
      <div className="invoice-controls">
        <button onClick={() => setShowQR(!showQR)} className="qr-toggle">
          {showQR ? 'Hide QR Code' : 'Show QR Code'}
        </button>
        <button
          onClick={() => navigator.clipboard.writeText(paymentRequest)}
          className="copy-button"
        >
          Copy Invoice
        </button>
        {hostedInvoiceUrl && (
          <a
            href={hostedInvoiceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="pay-button"
          >
            Pay via Browser
          </a>
        )}
        <button
          onClick={async () => {
            try {
              await window.Speed.openWallet(paymentRequest);
            } catch (error) {
              setMessage('Error opening wallet: ' + error.message);
            }
          }}
          className="pay-button"
        >
          Pay with Speed Wallet
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

  const handleGridDragOver = (e) => {
    e.preventDefault();
  };

  const handleGridDrop = (e) => {
    e.preventDefault();
    if (isPlacementConfirmed) return;

    const shipIndex = parseInt(e.dataTransfer.getData('text/plain'));
    const ship = ships[shipIndex];

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const col = Math.floor(x / cellSize);
    const row = Math.floor(y / cellSize);
    const position = row * GRID_COLS + col;

    if (row >= GRID_ROWS || col >= GRID_COLS || position >= GRID_SIZE) {
      setMessage('Invalid drop position!');
      return;
    }

    const newPositions = calculateShipPositions(ship, position.toString());
    if (!newPositions) {
      setMessage('Invalid placement!');
      return;
    }

    console.log('[Grid Drop] Ship:', ship.name, 'Position:', position, 'New positions:', newPositions);

    let updatedShips;
    setMyBoard((prev) => {
      const newBoard = [...prev];
      ship.positions.forEach((pos) => (newBoard[pos] = 'water'));
      newPositions.forEach((pos) => (newBoard[pos] = 'ship'));
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
      return updated;
    });

    const newShipCount = ship.positions.length > 0 ? shipCount : shipCount + 1;
    setShipCount(newShipCount);
    setMessage(
      newShipCount === 5
        ? 'All ships placed! Click "Save Placement".'
        : `${newShipCount} of 5 ships placed.`
    );

    playPlaceSound();
    setIsDragging(false);
    if (updatedShips) {
      updateServerBoard(updatedShips);
    }
  };

  return (
    <div className="App">
      <h1 className="game-title">⚡ Lightning Sea Battle ⚡</h1>
      {message && <p className="message">{message}</p>}
      {gameState === 'playing' && isOpponentThinking && (
        <p className="thinking-message">Opponent is thinking...</p>
      )}
      {transactionMessage && <p className="transaction">{transactionMessage}</p>}

      {confetti && (
        <div className="confetti">
          {Array.from({ length: 100 }).map((_, i) => (
            <div
              key={i}
              className="confetti-piece"
              style={{
                left: `${Math.random() * 100}%`,
                backgroundColor: ['#f39c12', '#e74c3c', '#3498db', '#2ecc71', '#9b59b6'][
                  Math.floor(Math.random() * 5)
                ],
                animationDelay: `${Math.random() * 3}s`,
              }}
            />
          ))}
          <div className="win-message">You Won!</div>
        </div>
      )}

      {gameState === 'join' && (
        <div className="join">
          <input
            type="text"
            placeholder="player@your-wallet.com"
            value={lightningAddress}
            onChange={(e) => setLightningAddress(e.target.value)}
            className="lightning-input"
          />
          <div className="bet-selection">
            <label htmlFor="bet-amount">Select Bet Amount: </label>
            <select
              id="bet-amount"
              value={betAmount}
              onChange={(e) => setBetAmount(Number(e.target.value))}
            >
              {BET_OPTIONS.map((option) => (
                <option key={option.amount} value={option.amount}>
                  {option.amount} sats (Win {option.winnings} sats)
                </option>
              ))}
            </select>
          </div>
          <button onClick={handleJoinGame} className="join-button">
            Join Battle ({betAmount} sats)
          </button>
          {(paymentRequest || hostedInvoiceUrl) && <PaymentModal />}
        </div>
      )}

      {gameState === 'waiting' && (
        <div className="waiting">
          <div className="loading-spinner"></div>
          <p className="waiting-text">Looking for an opponent...</p>
          {matchmakingTimer !== null && (
            <div className="timer-container">
              <div className="timer-bar">
                <div
                  className="timer-progress"
                  style={{ width: `${(matchmakingTimer / 10) * 100}%` }}
                ></div>
              </div>
              <div className="timer-text">
                Time left:{' '}
                <span className={matchmakingTimer <= 3 ? 'time-warning' : ''}>{matchmakingTimer}s</span>
              </div>
            </div>
          )}
        </div>
      )}

      {(gameState === 'placing' || gameState === 'playing' || gameState === 'finished') && (
        <div className="game-container">
          {(gameState === 'placing' || gameState === 'playing' || gameState === 'finished') && (
            <>
              <div className="board">
                <h2 className="board-title">Your Fleet</h2>
                <div onDragOver={handleGridDragOver} onDrop={handleGridDrop}>
                  {renderGrid(myBoard, false)}
                </div>
              </div>
              {(gameState === 'playing' || gameState === 'finished') && (
                <div className="board">
                  <h2 className="board-title">Enemy Waters</h2>
                  {renderGrid(enemyBoard, true)}
                </div>
              )}
            </>
          )}

          {gameState === 'placing' && !isPlacementConfirmed && (
            <div className="ships-controls">
              <div className="timer-container">
                <div className="timer-bar">
                  <div
                    className="timer-progress"
                    style={{ width: `${(timeLeft / PLACEMENT_TIME) * 100}%` }}
                  ></div>
                </div>
                <div className="timer-text">
                  Time left:{' '}
                  <span className={timeLeft <= 10 ? 'time-warning' : ''}>{timeLeft}s</span>
                </div>
              </div>
              <div className="ships">
                <h2 className="ships-title">Ships ({shipCount}/5)</h2>
                {renderShipList()}
              </div>
              <div className="placement-controls">
                <button
                  onClick={() => {
                    console.log('[Button Click] Randomize All clicked');
                    randomizeShips();
                  }}
                  className="randomize-button"
                >
                  🎲 Randomize All
                </button>
                <button
                  onClick={() => {
                    console.log('[Button Click] Randomize Unplaced clicked');
                    randomizeUnplacedShips();
                  }}
                  className="randomize-button"
                >
                  🎲 Randomize Unplaced
                </button>
                <button onClick={clearBoard} className="clear-button">
                  🧹 Clear
                </button>
                <button
                  onClick={saveShipPlacement}
                  className={`save-button ${shipCount === 5 ? 'pulse' : ''}`}
                  disabled={placementSaved}
                >
                  {placementSaved ? '✓ Placement Saved' : '💾 Save Placement'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {gameState === 'finished' && (
        <div className="game-end">
          <button onClick={() => window.location.reload()} className="join-button">
            ⚡ Play Again
          </button>
        </div>
      )}
    </div>
  );
};

export default App;
import React from 'react';

// Memoized Cell component to prevent unnecessary re-renders
const Cell = React.memo(({ 
  index, 
  cell, 
  isUnderShip, 
  isDragging, 
  isEnemy, 
  gameState, 
  turn, 
  socketId, 
  cannonFire, 
  onFire 
}) => {
  const row = Math.floor(index / 9); // GRID_COLS = 9
  const col = index % 9;
  
  return (
    <div
      className={`cell ${cell === 'hit' ? 'hit' : ''} ${cell === 'miss' ? 'miss' : ''} ${cell === 'ship' ? 'ship' : ''} ${cell === 'water' ? 'water' : ''} ${isUnderShip ? 'hovered' : ''} ${isDragging !== null ? 'drag-active' : ''}`}
      onClick={() => isEnemy && onFire(index)}
      onTouchStart={(e) => {
        e.preventDefault();
        if (isEnemy) onFire(index);
      }}
      style={{
        cursor: isEnemy && cell === 'water' && gameState === 'playing' && turn === socketId ? 'crosshair' : 'default',
        touchAction: 'none',
        transition: 'none', // Prevent cell transition animations
      }}
      data-grid-index={index}
      data-grid-type={isEnemy ? "enemy" : "player"}
    >
      {isEnemy && cannonFire && cannonFire.row === row && cannonFire.col === col && (
        <div className={`cannonball-effect ${cannonFire.hit ? 'hit' : 'miss'}`}></div>
      )}
    </div>
  );
});

Cell.displayName = 'Cell';

export default Cell;
